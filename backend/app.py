from __future__ import annotations

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import json
from pathlib import Path
from typing import Optional, Dict, Any

DATA_DIR = Path(__file__).resolve().parent / "data"

app = FastAPI(title="Canary Backend", version="0.3.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # hackathon/dev ok; tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_LAYERS = {"cancer", "neuro", "amr"}


def zfill_fips(x) -> str:
    if pd.isna(x):
        return ""
    s = str(x).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s.zfill(5)


def load_metrics_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"fips": str})
    if "fips" not in df.columns:
        raise ValueError("metrics.csv must include a 'fips' column.")

    df["fips"] = df["fips"].map(zfill_fips)

    # Accept either "poverty" or "deprivation"
    if "deprivation" not in df.columns and "poverty" in df.columns:
        df["deprivation"] = pd.to_numeric(df["poverty"], errors="coerce")
    if "poverty" not in df.columns and "deprivation" in df.columns:
        df["poverty"] = pd.to_numeric(df["deprivation"], errors="coerce")

    return df


def build_metrics_index(metrics_df: pd.DataFrame) -> Dict[str, Dict[str, Any]]:
    m = metrics_df.copy()
    m["fips"] = m["fips"].map(zfill_fips)
    return m.set_index("fips").to_dict(orient="index")


def load_geojson(path: Path) -> dict:
    with open(path, "r") as f:
        gj = json.load(f)
    if gj.get("type") != "FeatureCollection":
        raise ValueError(f"{path.name} must be a FeatureCollection.")
    return gj


def extract_fips_from_props(props: dict) -> str:
    for key in ("GEOID", "FIPS", "geoid", "fips"):
        val = props.get(key)
        if val:
            return zfill_fips(val)

    geo_id = props.get("GEO_ID", "")
    if geo_id:
        return zfill_fips(geo_id[-5:])

    state = props.get("STATE", "")
    county = props.get("COUNTY", "")
    if state and county:
        return str(state).zfill(2) + str(county).zfill(3)

    return ""


def scenario_score(row: pd.Series, layer: str, dPm25: float, poverty: float, access: float) -> float:
    """
    0..1 score from:
      base risk + pm25 + deprivation + low_access
    Scenario controls:
      dPm25 (delta), poverty/access multipliers (0..1)
    """
    base = float(row.get(f"base_{layer}", row.get("base", 0.3)) or 0.3)

    w_pm25 = float(row.get("w_pm25", 1.0) or 1.0)
    w_dep  = float(row.get("w_deprivation", row.get("w_poverty", 0.8)) or 0.8)
    w_low_access = abs(float(row.get("w_access", -0.7) or -0.7))

    pm25 = float(row.get("pm25", 0.5) or 0.5)
    dep  = float(row.get("deprivation", row.get("poverty", 0.5)) or 0.5)
    acc  = float(row.get("access", 0.6) or 0.6)

    pm25_eff   = max(0.0, min(1.0, pm25 + float(dPm25)))
    dep        = max(0.0, min(1.0, dep))
    low_access = max(0.0, min(1.0, 1.0 - acc))

    dep_mult = float(poverty)
    acc_mult = float(access)

    raw = (
        0.55 * base
        + 0.20 * (w_pm25 * pm25_eff)
        + 0.15 * ((w_dep * dep_mult) * dep)
        + 0.10 * ((w_low_access * acc_mult) * low_access)
    )
    return float(max(0.0, min(1.0, raw)))


def attach_props(counties_gj: dict, metrics_by_fips: Dict[str, Dict[str, Any]], layer: str) -> dict:
    base_key = f"base_{layer}"
    out = {"type": "FeatureCollection", "features": []}

    for feat in counties_gj.get("features", []):
        props = feat.get("properties", {}) or {}
        fips = extract_fips_from_props(props)
        if not fips:
            continue

        m = metrics_by_fips.get(fips, {})

        new_props = dict(props)
        new_props.update({
            "fips": fips,
            "STATE": props.get("STATE", fips[:2]),
            "county": m.get("county", props.get("NAME", "")) or props.get("NAME", ""),
            "state": m.get("state", "") or props.get("STATE", ""),
            "base": float(m.get(base_key, 0.3) or 0.3),

            "w_pm25": float(m.get("w_pm25", 1.0) or 1.0),
            "w_poverty": float(m.get("w_poverty", m.get("w_deprivation", 0.8)) or 0.8),
            "w_deprivation": float(m.get("w_deprivation", m.get("w_poverty", 0.8)) or 0.8),
            "w_access": float(m.get("w_access", -0.7) or -0.7),

            "pm25": float(m.get("pm25", 0.5) or 0.5),
            "pm25_raw": float(m.get("pm25_raw", 0.0) or 0.0),
            "deprivation": float(m.get("deprivation", m.get("poverty", 0.5)) or 0.5),
            "poverty": float(m.get("poverty", m.get("deprivation", 0.5)) or 0.5),
            "access": float(m.get("access", 0.6) or 0.6),

            "uninsured": float(m.get("uninsured", 0.0) or 0.0),
            "structural_vulnerability": float(m.get("structural_vulnerability", 0.5) or 0.5),
            "equity_gap": float(m.get("equity_gap", 0.5) or 0.5),
        })

        out["features"].append({
            "type": "Feature",
            "geometry": feat.get("geometry"),
            "properties": new_props,
        })

    return out


@app.get("/health")
def health():
    return {"ok": True, "service": "canary-backend"}


@app.get("/states")
def states():
    states_path = DATA_DIR / "states.geojson"
    return load_geojson(states_path)


@app.get("/geojson")
def geojson(layer: str = Query("cancer")):
    if layer not in ALLOWED_LAYERS:
        return {"error": True, "message": f"layer must be one of {sorted(ALLOWED_LAYERS)}"}

    counties_path = DATA_DIR / "counties.geojson"
    metrics_path  = DATA_DIR / "metrics.csv"

    counties = load_geojson(counties_path)
    metrics_df = load_metrics_csv(metrics_path)
    idx = build_metrics_index(metrics_df)

    return attach_props(counties, idx, layer)


@app.get("/metrics")
def metrics(fips: str):
    metrics_path = DATA_DIR / "metrics.csv"
    metrics_df = load_metrics_csv(metrics_path)
    idx = build_metrics_index(metrics_df)
    f = zfill_fips(fips)
    return {"fips": f, "metrics": idx.get(f)}


@app.get("/equity_summary")
def equity_summary(
    layer: str = Query("cancer"),
    dPm25: float = Query(0.0),
    poverty: float = Query(0.5),
    access: float = Query(0.6),
    targeted_pm25_cleanup: bool = Query(False),
    cleanup_strength: float = Query(0.20),
    state_fips: Optional[str] = Query(None),
):
    if layer not in ALLOWED_LAYERS:
        return {"error": True, "message": f"layer must be one of {sorted(ALLOWED_LAYERS)}"}

    df = load_metrics_csv(DATA_DIR / "metrics.csv").copy()

    # Filter by state if provided
    if state_fips:
        sf = str(state_fips).zfill(2)
        df = df[df["fips"].str.startswith(sf)].copy()
        if len(df) == 0:
            return {"error": True, "message": f"No counties found for state_fips={sf}"}

    for c in ["deprivation", "poverty", "access", "pm25", "equity_gap", "structural_vulnerability"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # -------- Uncertainty / completeness (simple, judge-friendly) --------
    required_cols = ["pm25", "deprivation", "access"]
    n_total = int(len(df))
    non_null_all = int(df[required_cols].notna().all(axis=1).sum()) if n_total else 0
    completeness = float(non_null_all / n_total) if n_total else 0.0

    missing_counts = {c: int(df[c].isna().sum()) for c in required_cols}

    # group splits
    q25 = df["deprivation"].quantile(0.25)
    q75 = df["deprivation"].quantile(0.75)
    a25 = df["access"].quantile(0.25)
    a75 = df["access"].quantile(0.75)

    df["score"] = df.apply(lambda r: scenario_score(r, layer, dPm25, poverty, access), axis=1)

    def avg_score(sub: pd.DataFrame, col: str = "score") -> float:
        if len(sub) == 0:
            return 0.0
        return float(pd.to_numeric(sub[col], errors="coerce").mean())

    def mean(sub: pd.DataFrame, col: str) -> float:
        if len(sub) == 0:
            return 0.0
        return float(pd.to_numeric(sub[col], errors="coerce").mean())

    high_dep = df[df["deprivation"] >= q75]
    low_dep  = df[df["deprivation"] <= q25]

    gap_dep = abs(avg_score(high_dep) - avg_score(low_dep))
    gap_acc = abs(avg_score(df[df["access"] <= a25]) - avg_score(df[df["access"] >= a75]))

    drivers = {
        "pm25_gap": mean(high_dep, "pm25") - mean(low_dep, "pm25"),
        "deprivation_gap": mean(high_dep, "deprivation") - mean(low_dep, "deprivation"),
        "low_access_gap": (1.0 - mean(high_dep, "access")) - (1.0 - mean(low_dep, "access")),
    }

    df["underserved_score"] = (
        pd.to_numeric(df.get("equity_gap", 0.5), errors="coerce").fillna(0.5) * 0.6
        + pd.to_numeric(df.get("structural_vulnerability", 0.5), errors="coerce").fillna(0.5) * 0.4
    )

    top = (
        df.sort_values("underserved_score", ascending=False)
        .head(10)[["fips", "county", "state", "access", "deprivation", "pm25", "underserved_score"]]
        .fillna(0)
        .to_dict(orient="records")
    )

    # Policy simulation
    gap_before = gap_dep
    gap_after = gap_before

    if targeted_pm25_cleanup:
        extra = -abs(float(cleanup_strength))
        df2 = df.copy()
        is_high = df2["deprivation"] >= q75

        df2.loc[~is_high, "score_policy"] = df2.loc[~is_high].apply(
            lambda r: scenario_score(r, layer, dPm25, poverty, access), axis=1
        )
        df2.loc[is_high, "score_policy"] = df2.loc[is_high].apply(
            lambda r: scenario_score(r, layer, dPm25 + extra, poverty, access), axis=1
        )

        gap_after = abs(
            avg_score(df2[df2["deprivation"] >= q75], col="score_policy")
            - avg_score(df2[df2["deprivation"] <= q25], col="score_policy")
        )

    return {
        "layer": layer,
        "scenario": {"dPm25": dPm25, "poverty": poverty, "access": access},
        "state_fips": state_fips,

        "deprivation_gap": float(gap_dep),
        "access_gap": float(gap_acc),

        "drivers": {k: float(v) for k, v in drivers.items()},
        "group_avgs": {
            "high_dep": float(avg_score(high_dep)),
            "low_dep": float(avg_score(low_dep)),
            "low_access": float(avg_score(df[df["access"] <= a25])),
            "high_access": float(avg_score(df[df["access"] >= a75])),
        },

        "policy": {
            "targeted_pm25_cleanup": bool(targeted_pm25_cleanup),
            "cleanup_strength": float(cleanup_strength),
            "gap_before": float(gap_before),
            "gap_after": float(gap_after),
            "delta": float(gap_after - gap_before),
        },

        # NEW: Uncertainty/completeness bundle
        "data_completeness": {
            "n_counties": n_total,
            "complete_rows": non_null_all,
            "completeness": completeness,  # 0..1
            "missing_counts": missing_counts,
            "cols": required_cols,
        },

        "top_underserved": top,

        # Bioethics framing (backend sends a canonical statement)
        "bioethics_note": (
            "Equity metrics are structural proxies (county-level), not individual blame. "
            "Use for resource allocation and upstream interventions; not for individual-level clinical decisions."
        ),
    }
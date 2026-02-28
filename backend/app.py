from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"

app = FastAPI(title="Canary Backend", version="0.1.0")

# Hackathon-friendly CORS (lock down later)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def zfill_fips(x) -> str:
    if pd.isna(x):
        return ""
    s = str(x).strip()
    # Handle numeric-looking strings like 6087.0
    if s.endswith(".0"):
        s = s[:-2]
    return s.zfill(5)

def load_metrics_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"fips": str})
    if "fips" not in df.columns:
        raise ValueError("metrics.csv must include a 'fips' column.")
    df["fips"] = df["fips"].map(zfill_fips)
    return df

def build_metrics_index(metrics_df: pd.DataFrame) -> dict:
    # Convert to a dict keyed by fips for fast lookup
    metrics_df = metrics_df.copy()
    metrics_df["fips"] = metrics_df["fips"].map(zfill_fips)
    return metrics_df.set_index("fips").to_dict(orient="index")

def load_counties_geojson(path: Path) -> dict:
    with open(path, "r") as f:
        gj = json.load(f)
    if gj.get("type") != "FeatureCollection":
        raise ValueError("counties.geojson must be a FeatureCollection.")
    return gj

def attach_props(geojson: dict, metrics_by_fips: dict, layer: str) -> dict:
    base_key = f"base_{layer}"
    out = {"type": "FeatureCollection", "features": []}

    for feat in geojson.get("features", []):
        props = feat.get("properties", {}) or {}
        geoid = props.get("GEOID") or props.get("FIPS") or props.get("geoid") or props.get("fips")
        if geoid is None:
            continue

        fips = zfill_fips(geoid)
        m = metrics_by_fips.get(fips)
        if not m:
            continue

        # Build properties expected by the frontend.
        new_props = dict(props)
        new_props.update({
            "fips": fips,
            "county": m.get("county", props.get("NAME", "")),
            "state": m.get("state", props.get("STATE", "")),
            "base": float(m.get(base_key, 0.0)),
            "w_pm25": float(m.get("w_pm25", 0.0)),
            "w_poverty": float(m.get("w_poverty", 0.0)),
            "w_access": float(m.get("w_access", 0.0)),
            "pm25": float(m.get("pm25", 0.0)),
            "poverty": float(m.get("poverty", 0.0)),
            "access": float(m.get("access", 0.0)),
        })

        out["features"].append({
            "type": "Feature",
            "geometry": feat.get("geometry"),
            "properties": new_props
        })

    return out

@app.get("/health")
def health():
    return {"ok": True, "service": "canary-backend"}

@app.get("/geojson")
def geojson(
    layer: str = Query("cancer", pattern="^(cancer|neuro|amr)$")
):
    """Return counties GeoJSON with properties attached for the requested layer."""
    counties_path = DATA_DIR / "counties.geojson"
    metrics_path = DATA_DIR / "metrics.csv"

    counties = load_counties_geojson(counties_path)
    metrics_df = load_metrics_csv(metrics_path)
    metrics_by_fips = build_metrics_index(metrics_df)

    return attach_props(counties, metrics_by_fips, layer)

@app.get("/metrics")
def metrics(fips: str):
    """Return the metrics row for a given FIPS."""
    metrics_path = DATA_DIR / "metrics.csv"
    metrics_df = load_metrics_csv(metrics_path)
    idx = build_metrics_index(metrics_df)
    f = zfill_fips(fips)
    return {"fips": f, "metrics": idx.get(f)}


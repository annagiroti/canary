from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"

app = FastAPI(title="Canary Backend", version="0.1.0")

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
    metrics_df = metrics_df.copy()
    metrics_df["fips"] = metrics_df["fips"].map(zfill_fips)
    return metrics_df.set_index("fips").to_dict(orient="index")

def load_counties_geojson(path: Path) -> dict:
    with open(path, "r") as f:
        gj = json.load(f)
    if gj.get("type") != "FeatureCollection":
        raise ValueError("counties.geojson must be a FeatureCollection.")
    return gj

def extract_fips_from_props(props: dict) -> str:
    """Extract 5-digit FIPS from various property key formats."""
    # Try clean keys first
    for key in ("GEOID", "FIPS", "geoid", "fips"):
        val = props.get(key)
        if val:
            return zfill_fips(val)
    # Handle GEO_ID format: '0500000US06087' → '06087'
    geo_id = props.get("GEO_ID", "")
    if geo_id:
        return geo_id[-5:]
    # Fallback: combine STATE + COUNTY
    state = props.get("STATE", "")
    county = props.get("COUNTY", "")
    if state and county:
        return (str(state).zfill(2) + str(county).zfill(3))
    return ""

def attach_props(geojson: dict, metrics_by_fips: dict, layer: str) -> dict:
    base_key = f"base_{layer}"
    out = {"type": "FeatureCollection", "features": []}

    for feat in geojson.get("features", []):
        props = feat.get("properties", {}) or {}
        fips = extract_fips_from_props(props)
        if not fips:
            continue

        m = metrics_by_fips.get(fips)

        # Include all counties even without metrics (so map shows all shapes)
        new_props = dict(props)
        new_props.update({
            "fips":      fips,
            "STATE":     props.get("STATE", fips[:2]),
            "county":    m.get("county", props.get("NAME", "")) if m else props.get("NAME", ""),
            "state":     m.get("state",  props.get("STATE", "")) if m else props.get("STATE", ""),
            "base":      float(m.get(base_key, 0.3)) if m else 0.3,
            "w_pm25":    float(m.get("w_pm25",   0.18))  if m else 0.18,
            "w_poverty": float(m.get("w_poverty", 0.14)) if m else 0.14,
            "w_access":  float(m.get("w_access", -0.20)) if m else -0.20,
            "pm25":      float(m.get("pm25",    0.5)) if m else 0.5,
            "poverty":   float(m.get("poverty", 0.5)) if m else 0.5,
            "access":    float(m.get("access",  0.5)) if m else 0.5,
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

@app.get("/geojson")
def geojson(
    layer: str = Query("cancer", pattern="^(cancer|neuro|amr)$")
):
    """Return counties GeoJSON with properties attached for the requested layer."""
    counties_path = DATA_DIR / "counties.geojson"
    metrics_path  = DATA_DIR / "metrics.csv"

    counties   = load_counties_geojson(counties_path)
    metrics_df = load_metrics_csv(metrics_path)
    metrics_by_fips = build_metrics_index(metrics_df)

    return attach_props(counties, metrics_by_fips, layer)

@app.get("/metrics")
def metrics(fips: str):
    """Return the metrics row for a given FIPS."""
    metrics_path = DATA_DIR / "metrics.csv"
    metrics_df   = load_metrics_csv(metrics_path)
    idx = build_metrics_index(metrics_df)
    f = zfill_fips(fips)
    return {"fips": f, "metrics": idx.get(f)}

@app.get("/states")
def states():
    """Return state boundary GeoJSON for the drill-down map."""
    states_path = DATA_DIR / "states.geojson"
    with open(states_path, "r") as f:
        return json.load(f)
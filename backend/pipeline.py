from __future__ import annotations

from pathlib import Path
import pandas as pd

DATA = Path("data")
RAW = DATA / "raw"
OUT = DATA

PLACES_PATH = RAW / "places.csv"
EPA_PATH = RAW / "aqs_pm25.csv"
METRICS_OUT = OUT / "metrics.csv"

# Pick a year from PLACES (you have 2023 in sample)
PLACES_YEAR = 2023

# AQS parameter code for PM2.5
PM25_PARAM = 88101


def zfill_fips(x) -> str:
    s = str(x).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s.zfill(5)


def normalize_0_1(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    lo, hi = s.quantile(0.05), s.quantile(0.95)
    if pd.isna(lo) or pd.isna(hi) or hi == lo:
        return pd.Series([0.5] * len(s), index=s.index)
    return ((s.clip(lo, hi) - lo) / (hi - lo)).clip(0, 1)


def load_places_selected(year: int) -> pd.DataFrame:
    """
    PLACES columns (confirmed from your header):
    Year, StateAbbr, LocationName, LocationID, MeasureId, Data_Value, Data_Value_Type, ...
    We'll filter to one year + selected MeasureId values, then pivot wide to one row per county.
    """
    usecols = ["Year", "StateAbbr", "StateDesc", "LocationName", "LocationID", "MeasureId", "Data_Value", "Data_Value_Type"]
    places = pd.read_csv(PLACES_PATH, usecols=usecols, dtype=str)

    # Filter to year and crude prevalence (most interpretable)
    places["Year"] = pd.to_numeric(places["Year"], errors="coerce")
    places = places[places["Year"] == year].copy()

    # Prefer crude prevalence rows if present
    places = places[places["Data_Value_Type"].str.contains("Crude", na=False)].copy()

    places["fips"] = places["LocationID"].map(zfill_fips)
    places["value"] = pd.to_numeric(places["Data_Value"], errors="coerce")

    # Pick a small set of measures that are likely present and useful as proxies:
    # (These are MeasureId values in PLACES.)
    keep = {
        "CSMOKING": "places_smoking",
        "OBESITY": "places_obesity",
        "STROKE": "places_stroke",
        "DIABETES": "places_diabetes",
        "ACCESS2": "places_uninsured",   # % uninsured (often used as access proxy)
        # Good optional extras if you want:
        # "COPD": "places_copd",
        # "ASTHMA": "places_asthma",
        # "BPHIGH": "places_high_bp",
    }

    places = places[places["MeasureId"].isin(keep.keys())].copy()

    meta = (
        places.groupby("fips", as_index=False)
        .agg(
            county=("LocationName", "first"),
            state=("StateAbbr", "first"),
        )
    )

    wide = (
        places.pivot_table(index="fips", columns="MeasureId", values="value", aggfunc="first")
        .reset_index()
        .rename(columns=keep)
    )

    return meta.merge(wide, on="fips", how="left")


def load_pm25_by_county() -> pd.DataFrame:
    """
    EPA AQS annual monitor file (confirmed header):
    "State Code","County Code","Parameter Code","Arithmetic Mean", ...
    We'll filter PM2.5 and average Arithmetic Mean across monitors within each county.
    """
    usecols = ["State Code", "County Code", "Parameter Code", "Arithmetic Mean"]
    epa = pd.read_csv(EPA_PATH, usecols=usecols, dtype=str)

    epa["Parameter Code"] = pd.to_numeric(epa["Parameter Code"], errors="coerce")
    epa = epa[epa["Parameter Code"] == PM25_PARAM].copy()

    epa["fips"] = epa["State Code"].astype(str).str.zfill(2) + epa["County Code"].astype(str).str.zfill(3)
    epa["pm25"] = pd.to_numeric(epa["Arithmetic Mean"], errors="coerce")

    pm25 = epa.groupby("fips", as_index=False).agg(pm25=("pm25", "mean"))
    return pm25


def build_metrics(places: pd.DataFrame, pm25: pd.DataFrame) -> pd.DataFrame:
    df = places.merge(pm25, on="fips", how="left")

    # Access: convert % uninsured -> 0..1 access score
    if "places_uninsured" in df.columns:
        uninsured = pd.to_numeric(df["places_uninsured"], errors="coerce") / 100.0
        df["access"] = (1.0 - uninsured).clip(0, 1)
    else:
        df["access"] = 0.6

    # Poverty: you don't have ACS yet, so for now use a proxy from smoking/obesity/diabetes
    proxy_cols = [c for c in ["places_smoking", "places_obesity", "places_diabetes"] if c in df.columns]
    if proxy_cols:
        proxy = pd.concat([pd.to_numeric(df[c], errors="coerce") for c in proxy_cols], axis=1).mean(axis=1)
        df["poverty"] = normalize_0_1(proxy)
    else:
        df["poverty"] = 0.2

    # Normalize drivers
    pm25_n = normalize_0_1(df["pm25"])
    smoke_n = normalize_0_1(df["places_smoking"]) if "places_smoking" in df.columns else pd.Series(0.5, index=df.index)
    stroke_n = normalize_0_1(df["places_stroke"]) if "places_stroke" in df.columns else pd.Series(0.5, index=df.index)
    diab_n = normalize_0_1(df["places_diabetes"]) if "places_diabetes" in df.columns else pd.Series(0.5, index=df.index)

    # Build base layer scores (0..1)
    # These are vulnerability indices (not literal incidence) — great for hackathon.
    df["base_cancer"] = (0.65 * smoke_n + 0.35 * pm25_n).fillna(0.5).clip(0, 1)
    df["base_neuro"] = (0.70 * stroke_n + 0.30 * pm25_n).fillna(0.5).clip(0, 1)
    df["base_amr"] = (0.70 * diab_n + 0.30 * (1.0 - df["access"])).fillna(0.5).clip(0, 1)

    # Slider weights (demo coefficients)
    df["w_pm25"] = 1.0
    df["w_poverty"] = 0.8
    df["w_access"] = -0.7

    out_cols = [
        "fips", "county", "state",
        "base_cancer", "base_neuro", "base_amr",
        "w_pm25", "w_poverty", "w_access",
        "pm25", "poverty", "access",
    ]
    for c in out_cols:
        if c not in df.columns:
            df[c] = pd.NA

    out = df[out_cols].copy()

    # Sanity: fips should be 5 digits, unique
    out["fips"] = out["fips"].map(zfill_fips)
    out = out.dropna(subset=["fips"])
    out = out.drop_duplicates(subset=["fips"], keep="first")

    return out


def main():
    if not PLACES_PATH.exists():
        raise FileNotFoundError(f"Missing {PLACES_PATH}. Download PLACES first.")
    if not EPA_PATH.exists():
        raise FileNotFoundError(f"Missing {EPA_PATH}. Download EPA AQS file first.")

    print("Loading PLACES...")
    places = load_places_selected(PLACES_YEAR)
    print("PLACES counties:", len(places))

    print("Loading EPA PM2.5...")
    pm25 = load_pm25_by_county()
    print("PM2.5 counties:", len(pm25))

    print("Building metrics.csv ...")
    metrics = build_metrics(places, pm25)
    metrics.to_csv(METRICS_OUT, index=False)

    print("\nWrote:", METRICS_OUT)
    print("Rows:", len(metrics))
    print("Non-null pm25:", metrics["pm25"].notna().sum())
    print(metrics.head(3).to_string(index=False))


if __name__ == "__main__":
    main()
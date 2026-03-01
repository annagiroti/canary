from __future__ import annotations

from pathlib import Path
import pandas as pd
import json

DATA = Path("data")
RAW = DATA / "raw"
OUT = DATA

PLACES_PATH = RAW / "places.csv"
EPA_PATH = RAW / "aqs_pm25.csv"
METRICS_OUT = OUT / "metrics.csv"

PM25_PARAM = 88101

VALID_STATE_FIPS = {str(i).zfill(2) for i in range(1, 57) if i not in (3, 7, 14, 43, 52)}


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


def load_places_selected() -> pd.DataFrame:
    """
    Load PLACES data for 2022 and 2023, keeping the most recent year per county.
    """
    usecols = ["Year", "StateAbbr", "LocationName", "LocationID", "MeasureId", "Data_Value", "Data_Value_Type"]
    places = pd.read_csv(PLACES_PATH, usecols=usecols, dtype=str)

    # Accept both 2022 and 2023
    places["Year"] = pd.to_numeric(places["Year"], errors="coerce")
    places = places[places["Year"].isin([2022, 2023])].copy()

    # Crude prevalence only
    places = places[places["Data_Value_Type"].str.contains("Crude", na=False)].copy()

    places["fips"] = places["LocationID"].map(zfill_fips)
    places["value"] = pd.to_numeric(places["Data_Value"], errors="coerce")

    keep = {
        "CSMOKING": "places_smoking",
        "OBESITY":  "places_obesity",
        "STROKE":   "places_stroke",
        "DIABETES": "places_diabetes",
        "ACCESS2":  "places_uninsured",
        "TEETHLOST":  "places_teeth",
        "SLEEP":      "places_sleep",
        "DEPRESSION": "places_depression",
        "COPD":       "places_copd",
    }

    places = places[places["MeasureId"].isin(keep.keys())].copy()

    # Keep most recent year per county+measure
    places = places.sort_values("Year", ascending=False)
    places = places.drop_duplicates(subset=["fips", "MeasureId"], keep="first")

    meta = (
        places.groupby("fips", as_index=False)
        .agg(county=("LocationName", "first"), state=("StateAbbr", "first"))
    )

    wide = (
        places.pivot_table(index="fips", columns="MeasureId", values="value", aggfunc="first")
        .reset_index()
        .rename(columns=keep)
    )

    return meta.merge(wide, on="fips", how="left")


def load_pm25_by_county() -> pd.DataFrame:
    usecols = ["State Code", "County Code", "Parameter Code", "Arithmetic Mean"]
    epa = pd.read_csv(EPA_PATH, usecols=usecols, dtype=str, encoding="latin-1")

    epa["Parameter Code"] = pd.to_numeric(epa["Parameter Code"], errors="coerce")
    epa = epa[epa["Parameter Code"] == PM25_PARAM].copy()

    epa["fips"] = epa["State Code"].astype(str).str.zfill(2) + epa["County Code"].astype(str).str.zfill(3)
    epa["pm25"] = pd.to_numeric(epa["Arithmetic Mean"], errors="coerce")

    return epa.groupby("fips", as_index=False).agg(pm25=("pm25", "mean"))


def clean_metrics(df: pd.DataFrame) -> pd.DataFrame:
    """Fill NaNs with medians and clip to valid ranges. Ensures JSON-safe output."""
    numeric_cols = [
        "base_cancer", "base_neuro", "base_amr",
        "w_pm25", "w_poverty", "w_access",
        "pm25", "poverty", "access",
    ]

    print("\nCleaning NaN values:")
    for col in numeric_cols:
        if col not in df.columns:
            continue
        n_nan = df[col].isna().sum()
        if n_nan > 0:
            median = df[col].median()
            df[col] = df[col].fillna(median)
            print(f"  {col}: filled {n_nan} NaNs with median={median:.4f}")

    for col in ["base_cancer", "base_neuro", "base_amr", "pm25", "poverty", "access"]:
        if col in df.columns:
            df[col] = df[col].clip(0, 1)

    df["county"] = df["county"].fillna("Unknown")
    df["state"]  = df["state"].fillna("Unknown")
    df = df[df["fips"].str[:2].isin(VALID_STATE_FIPS)].copy()

    total_nan = df[numeric_cols].isna().sum().sum()
    print(f"\nTotal NaNs remaining: {total_nan}")
    if total_nan == 0:
        print("✓ No NaNs — safe for JSON serialization")
    else:
        print("WARNING — NaNs still present:")
        print(df[numeric_cols].isna().sum())

    try:
        json.dumps(df.head(5).to_dict(orient="records"))
        print("✓ JSON serialization check passed")
    except Exception as e:
        print(f"✗ JSON check failed: {e}")

    return df


def build_metrics(places: pd.DataFrame, pm25: pd.DataFrame) -> pd.DataFrame:
    df = places.merge(pm25, on="fips", how="left")

    if "places_uninsured" in df.columns:
        uninsured = pd.to_numeric(df["places_uninsured"], errors="coerce") / 100.0
        df["access"] = (1.0 - uninsured).clip(0, 1)
    else:
        df["access"] = 0.6

    # ── CHANGED: fallback proxy cols for states missing primary measures ──
    primary_proxy = [c for c in ["places_smoking", "places_obesity", "places_diabetes"] if c in df.columns]
    fallback_proxy = [c for c in ["places_copd", "places_depression", "places_teeth", "places_sleep"] if c in df.columns]
    proxy_cols = primary_proxy if primary_proxy else fallback_proxy
    if proxy_cols:
        proxy = pd.concat([pd.to_numeric(df[c], errors="coerce") for c in proxy_cols], axis=1).mean(axis=1)
        df["poverty"] = normalize_0_1(proxy)
    else:
        df["poverty"] = 0.2

    pm25_n = normalize_0_1(df["pm25"])

    # ── CHANGED: fallback for smoke_n, stroke_n, diab_n ──
    if "places_smoking" in df.columns:
        smoke_n = normalize_0_1(df["places_smoking"])
    elif "places_copd" in df.columns:
        smoke_n = normalize_0_1(df["places_copd"])
    else:
        smoke_n = pd.Series(0.5, index=df.index)

    if "places_stroke" in df.columns:
        stroke_n = normalize_0_1(df["places_stroke"])
    elif "places_depression" in df.columns:
        stroke_n = normalize_0_1(df["places_depression"])
    else:
        stroke_n = pd.Series(0.5, index=df.index)

    if "places_diabetes" in df.columns:
        diab_n = normalize_0_1(df["places_diabetes"])
    elif "places_teeth" in df.columns:
        diab_n = normalize_0_1(df["places_teeth"])
    else:
        diab_n = pd.Series(0.5, index=df.index)

    # rest is unchanged
    df["base_cancer"] = (0.65 * smoke_n  + 0.35 * pm25_n).clip(0, 1)
    df["base_neuro"]  = (0.70 * stroke_n + 0.30 * pm25_n).clip(0, 1)
    df["base_amr"]    = (0.70 * diab_n   + 0.30 * (1.0 - df["access"])).clip(0, 1)

    df["w_pm25"]    = 1.0
    df["w_poverty"] = 0.8
    df["w_access"]  = -0.7

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
    out["fips"] = out["fips"].map(zfill_fips)
    out = out.dropna(subset=["fips"])
    out = out.drop_duplicates(subset=["fips"], keep="first")
    out = clean_metrics(out)

    return out


def main():
    if not PLACES_PATH.exists():
        raise FileNotFoundError(f"Missing {PLACES_PATH}.")
    if not EPA_PATH.exists():
        raise FileNotFoundError(f"Missing {EPA_PATH}.")

    print("Loading PLACES (2022 + 2023)...")
    places = load_places_selected()
    print(f"PLACES counties: {len(places)}")
    print(f"States covered: {sorted(places['fips'].str[:2].unique().tolist())}")

    print("\nLoading EPA PM2.5...")
    pm25 = load_pm25_by_county()
    print(f"PM2.5 counties: {len(pm25)}")

    print("\nBuilding metrics...")
    metrics = build_metrics(places, pm25)

    metrics.to_csv(METRICS_OUT, index=False)
    print(f"\n✓ Wrote {len(metrics)} rows to {METRICS_OUT}")
    print(metrics.head(3).to_string(index=False))


if __name__ == "__main__":
    main()
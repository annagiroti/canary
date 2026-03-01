from __future__ import annotations

from pathlib import Path
import pandas as pd

DATA = Path("data")
RAW = DATA / "raw"
OUT = DATA

PLACES_PATH = RAW / "places.csv"
EPA_PATH = RAW / "aqs_pm25.csv"
METRICS_OUT = OUT / "metrics.csv"

PLACES_YEAR = 2023
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


def load_places_selected(year: int) -> pd.DataFrame:
    """
    Expects a CDC PLACES export CSV in RAW/places.csv.
    We filter to County-level rows and keep a small set of measures.
    """
    df = pd.read_csv(PLACES_PATH, dtype=str)
    # common PLACES columns in your file:
    # Year,StateAbbr,LocationName,Data_Value,LocationID,MeasureId,Data_Value_Type,...
    df = df[df["Year"].astype(str) == str(year)].copy()

    # County fips is LocationID in your file (5-digit)
    df["fips"] = df["LocationID"].map(zfill_fips)

    # Keep specific measures (you can expand later)
    keep = {
        "CANCER":   "places_cancer",
        "CSMOKING": "places_smoking",
        "OBESITY":  "places_obesity",
        "STROKE":   "places_stroke",
        "DIABETES": "places_diabetes",
        "ACCESS2":  "places_uninsured",  # % uninsured
    }

    df = df[df["MeasureId"].isin(keep.keys())].copy()
    df["value"] = pd.to_numeric(df["Data_Value"], errors="coerce")

    meta = (
        df.groupby("fips", as_index=False)
        .agg(county=("LocationName", "first"), state=("StateAbbr", "first"))
    )

    wide = (
        df.pivot_table(index="fips", columns="MeasureId", values="value", aggfunc="first")
        .reset_index()
        .rename(columns=keep)
    )

    return meta.merge(wide, on="fips", how="left")


def load_pm25_by_county() -> pd.DataFrame:
    usecols = ["State Code", "County Code", "Parameter Code", "Arithmetic Mean"]
    epa = pd.read_csv(EPA_PATH, usecols=usecols, dtype=str, encoding="latin-1")

    epa["Parameter Code"] = pd.to_numeric(epa["Parameter Code"], errors="coerce")
    epa = epa[epa["Parameter Code"] == PM25_PARAM].copy()

    epa["fips"] = (
        epa["State Code"].astype(str).str.zfill(2)
        + epa["County Code"].astype(str).str.zfill(3)
    )

    epa["pm25_raw"] = pd.to_numeric(epa["Arithmetic Mean"], errors="coerce")

    return epa.groupby("fips", as_index=False).agg(pm25_raw=("pm25_raw", "mean"))


def clean_metrics(df: pd.DataFrame) -> pd.DataFrame:
    """Fill NaNs with medians and clip to valid ranges. Ensures JSON-safe output."""
    numeric_cols = [
        "base_cancer", "base_neuro", "base_amr",
        "w_pm25", "w_deprivation", "w_access",
        "pm25", "pm25_raw", "deprivation", "poverty", "access", "uninsured",
        "structural_vulnerability", "equity_gap",
    ]

    print("\nCleaning NaN values:")
    for col in numeric_cols:
        if col not in df.columns:
            continue
        n_nan = df[col].isna().sum()
        if n_nan > 0:
            median = pd.to_numeric(df[col], errors="coerce").median()
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(median)
            print(f"  {col}: filled {n_nan} NaNs with median={median:.4f}")

    # Clip normalized columns to 0..1
    for col in [
        "base_cancer", "base_neuro", "base_amr",
        "pm25", "deprivation", "poverty", "access",
        "structural_vulnerability", "equity_gap",
    ]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").clip(0, 1)

    # uninsured is percent (0-100) in PLACES, keep as 0..100 (and also safe)
    if "uninsured" in df.columns:
        df["uninsured"] = pd.to_numeric(df["uninsured"], errors="coerce").clip(0, 100)

    # Fix string columns
    df["county"] = df["county"].fillna("Unknown")
    df["state"]  = df["state"].fillna("Unknown")

    # Drop invalid state fips if present
    if "STATE" in df.columns:
        df = df[df["STATE"].astype(str).str.zfill(2).isin(VALID_STATE_FIPS)].copy()

    return df


def build_metrics() -> pd.DataFrame:
    places = load_places_selected(PLACES_YEAR)
    pm25 = load_pm25_by_county()

    df = places.merge(pm25, on="fips", how="left")

    # --- Drivers ---
    # Access proxy from uninsured:
    # uninsured in PLACES is % uninsured; normalize to 0..1 for access = 1 - uninsured_norm
    if "places_uninsured" in df.columns:
        uninsured_pct = pd.to_numeric(df["places_uninsured"], errors="coerce")
        uninsured_norm = normalize_0_1(uninsured_pct)  # 0..1
        df["uninsured"] = uninsured_pct
        df["access"] = (1.0 - uninsured_norm).clip(0, 1)
    else:
        df["uninsured"] = pd.NA
        df["access"] = 0.6

    # Deprivation proxy from multiple adverse outcomes (structural proxy, not "personal blame"):
    proxy_cols = [c for c in ["places_smoking", "places_obesity", "places_diabetes"] if c in df.columns]
    if proxy_cols:
        proxy = pd.concat([pd.to_numeric(df[c], errors="coerce") for c in proxy_cols], axis=1).mean(axis=1)
        df["deprivation"] = normalize_0_1(proxy)
    else:
        df["deprivation"] = 0.5

    # Keep poverty as alias for compatibility with existing frontend
    df["poverty"] = df["deprivation"]

    # PM2.5: normalize raw values into 0..1 driver
    if "pm25_raw" in df.columns:
        df["pm25"] = normalize_0_1(df["pm25_raw"])
    else:
        df["pm25_raw"] = pd.NA
        df["pm25"] = 0.5

    # Normalize health outcomes for base risk
    pm25_n   = normalize_0_1(df["pm25"])
    smoke_n  = normalize_0_1(df["places_smoking"])  if "places_smoking"  in df.columns else pd.Series(0.5, index=df.index)
    stroke_n = normalize_0_1(df["places_stroke"])   if "places_stroke"   in df.columns else pd.Series(0.5, index=df.index)
    diab_n   = normalize_0_1(df["places_diabetes"]) if "places_diabetes" in df.columns else pd.Series(0.5, index=df.index)

    # --- Baseline Layer Scores (simple, interpretable) ---
    df["base_cancer"] = (0.65 * smoke_n  + 0.35 * pm25_n).clip(0, 1)
    df["base_neuro"]  = (0.70 * stroke_n + 0.30 * pm25_n).clip(0, 1)
    df["base_amr"]    = (0.70 * diab_n   + 0.30 * (1.0 - df["access"])).clip(0, 1)

    # Slider weights (kept simple/transparent)
    df["w_pm25"]        = 1.0
    df["w_deprivation"] = 0.8
    df["w_access"]      = -0.7

    # --- Equity-focused derived signals (for Bioethics track) ---
    # Structural vulnerability: exposure + deprivation + low access
    df["structural_vulnerability"] = (
        0.4 * df["pm25"] + 0.4 * df["deprivation"] + 0.2 * (1.0 - df["access"])
    ).clip(0, 1)

    # Equity gap per county: emphasize compounding disadvantage
    df["equity_gap"] = normalize_0_1(
        df["structural_vulnerability"] + 0.5 * df["deprivation"] + 0.5 * (1.0 - df["access"])
    )

    out_cols = [
        "fips", "county", "state",
        "base_cancer", "base_neuro", "base_amr",
        "w_pm25", "w_deprivation", "w_access",
        "pm25", "pm25_raw",
        "deprivation", "poverty",
        "access", "uninsured",
        "structural_vulnerability", "equity_gap",
    ]

    for c in out_cols:
        if c not in df.columns:
            df[c] = pd.NA

    out = df[out_cols].copy()
    out["fips"] = out["fips"].map(zfill_fips)
    out = out.dropna(subset=["fips"]).drop_duplicates(subset=["fips"], keep="first")

    out = clean_metrics(out)
    return out


def main():
    if not PLACES_PATH.exists():
        raise FileNotFoundError(f"Missing {PLACES_PATH}. Download PLACES first.")
    if not EPA_PATH.exists():
        raise FileNotFoundError(f"Missing {EPA_PATH}. Download EPA AQS file first.")

    print("Loading and building metrics...")
    metrics = build_metrics()

    print(f"Writing {METRICS_OUT} ...")
    METRICS_OUT.parent.mkdir(parents=True, exist_ok=True)
    metrics.to_csv(METRICS_OUT, index=False)
    print(f"Done. Rows: {len(metrics)}")


if __name__ == "__main__":
    main()
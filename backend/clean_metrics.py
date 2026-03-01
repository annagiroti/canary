"""
clean_metrics.py
Cleans the raw metrics.csv and outputs a JSON-safe version.
Run from the backend/ directory:
    python3 clean_metrics.py
"""
from pathlib import Path
import pandas as pd
import json

INPUT  = Path("data/metrics.csv")
OUTPUT = Path("data/metrics.csv")  # overwrites in place

def zfill_fips(x) -> str:
    s = str(x).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s.zfill(5)

def main():
    print("Loading metrics.csv...")
    df = pd.read_csv(INPUT, dtype=str)

    print(f"  Loaded {len(df)} rows")

    # ── 1. Fix FIPS ─────────────────────────────────────────────
    df["fips"] = df["fips"].map(zfill_fips)

    # ── 2. Drop bad rows ─────────────────────────────────────────
    # Drop the US aggregate row (fips=00059) and any non-US territories
    valid_states = {str(i).zfill(2) for i in range(1, 57) if i not in (3, 7, 14, 43, 52)}
    df = df[df["fips"].str[:2].isin(valid_states)].copy()
    print(f"  After dropping bad rows: {len(df)} rows")

    # ── 3. Convert numeric columns ───────────────────────────────
    numeric_cols = [
        "base_cancer", "base_neuro", "base_amr",
        "w_pm25", "w_poverty", "w_access",
        "pm25", "poverty", "access",
    ]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # ── 4. Fill NaNs with medians ────────────────────────────────
    print("\nFilling NaN values with column medians:")
    for col in numeric_cols:
        n_nan = df[col].isna().sum()
        if n_nan > 0:
            median = df[col].median()
            # pm25 has lots of missing — use median of available values
            df[col] = df[col].fillna(median)
            print(f"  {col}: filled {n_nan} NaNs with median={median:.4f}")

    # ── 5. Clip scores to valid range ────────────────────────────
    for col in ["base_cancer", "base_neuro", "base_amr", "pm25", "poverty", "access"]:
        df[col] = df[col].clip(0, 1)

    # ── 6. Fix string columns ────────────────────────────────────
    df["county"] = df["county"].fillna("Unknown")
    df["state"]  = df["state"].fillna("Unknown")

    # ── 7. Drop duplicates ───────────────────────────────────────
    df = df.drop_duplicates(subset=["fips"], keep="first")
    print(f"\nFinal row count: {len(df)}")

    # ── 8. Verify zero NaNs remain ───────────────────────────────
    total_nan = df[numeric_cols].isna().sum().sum()
    print(f"Total NaNs remaining: {total_nan}")
    if total_nan > 0:
        print("WARNING: NaNs still present!")
        print(df[numeric_cols].isna().sum())
    else:
        print("✓ No NaNs — safe for JSON serialization")

    # ── 9. Verify JSON serializable ─────────────────────────────
    try:
        sample = df.head(5).to_dict(orient="records")
        json.dumps(sample)
        print("✓ JSON serialization check passed")
    except Exception as e:
        print(f"✗ JSON check failed: {e}")

    # ── 10. Save ─────────────────────────────────────────────────
    df.to_csv(OUTPUT, index=False)
    print(f"\nSaved clean metrics to: {OUTPUT}")
    print(df.head(3).to_string(index=False))

if __name__ == "__main__":
    main()

# Canary Backend (FastAPI)

## Quickstart
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

## Endpoints
- `GET /health` – simple health check
- `GET /geojson?layer=cancer|neuro|amr` – returns county GeoJSON with risk properties attached
- `GET /metrics?fips=06087` – returns the metrics row for a county

## Data files
Place these in `backend/data/`:
- `counties.geojson` – FeatureCollection of county polygons, with a `GEOID` (preferred) or `FIPS` property
- `metrics.csv` – merged table keyed by `fips` (5-digit)

See the top of `metrics.csv` in this repo for the expected columns.

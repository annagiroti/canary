# Canary — Climate Health Risk Atlas

Canary is a hackathon-ready climate health risk atlas with:
- **Frontend:** Vite + React + MapLibre GL choropleth map, sliders, tooltips
- **Backend:** FastAPI that serves county GeoJSON with risk properties and metrics lookup by FIPS

## Repo structure
- `/frontend` — React app (MapLibre choropleth + controls)
- `/backend` — FastAPI app + data loader/merger

## Run (local dev)
### 1) Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

Test:
```bash
curl "http://localhost:8000/health"
curl "http://localhost:8000/geojson?layer=cancer" | head
```

### 2) Frontend
```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:5173

## Data inputs
Put these files in `backend/data/`:
- `counties.geojson` — county polygons with a FIPS property (prefer `GEOID`)
- `metrics.csv` — one row per county keyed by `fips` (5 digits)

### Expected metrics.csv columns (minimum)
- `fips`, `county`, `state`
- `base_cancer`, `base_neuro`, `base_amr`
- `w_pm25`, `w_poverty`, `w_access`
- `pm25`, `poverty`, `access`

## Notes for hackathon speed
- Start with the provided sample `metrics.csv` + `counties.geojson` to get the UI working.
- Then swap in real data and keep the same columns.

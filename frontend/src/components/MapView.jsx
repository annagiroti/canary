import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { scenarioScore } from '../lib/score.js'
import { LAYER_PALETTES } from '../App.jsx'

const API = 'http://localhost:8000'

const COLOR_STOPS = {
  cancer: [0, '#fef9c3', 0.25, '#fde047', 0.5, '#f97316', 0.75, '#dc2626', 1, '#7f1d1d'],
  neuro:  [0, '#ede9fe', 0.25, '#a78bfa', 0.5, '#7c3aed', 0.75, '#4c1d95', 1, '#1e1b4b'],
  amr:    [0, '#d1fae5', 0.25, '#34d399', 0.5, '#059669', 0.75, '#065f46', 1, '#022c22'],
}

// US state name → 2-digit FIPS code
const STATE_NAME_TO_FIPS = {
  'Alabama': '01', 'Alaska': '02', 'Arizona': '04', 'Arkansas': '05',
  'California': '06', 'Colorado': '08', 'Connecticut': '09', 'Delaware': '10',
  'District of Columbia': '11', 'Florida': '12', 'Georgia': '13', 'Hawaii': '15',
  'Idaho': '16', 'Illinois': '17', 'Indiana': '18', 'Iowa': '19', 'Kansas': '20',
  'Kentucky': '21', 'Louisiana': '22', 'Maine': '23', 'Maryland': '24',
  'Massachusetts': '25', 'Michigan': '26', 'Minnesota': '27', 'Mississippi': '28',
  'Missouri': '29', 'Montana': '30', 'Nebraska': '31', 'Nevada': '32',
  'New Hampshire': '33', 'New Jersey': '34', 'New Mexico': '35', 'New York': '36',
  'North Carolina': '37', 'North Dakota': '38', 'Ohio': '39', 'Oklahoma': '40',
  'Oregon': '41', 'Pennsylvania': '42', 'Rhode Island': '44', 'South Carolina': '45',
  'South Dakota': '46', 'Tennessee': '47', 'Texas': '48', 'Utah': '49',
  'Vermont': '50', 'Virginia': '51', 'Washington': '53', 'West Virginia': '54',
  'Wisconsin': '55', 'Wyoming': '56', 'Puerto Rico': '72',
}

export default function MapView({ layer, scenario, onHover, onSelect }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)

  const [geo, setGeo] = useState(null)         // county GeoJSON (from backend)
  const [stateGeo, setStateGeo] = useState(null) // state GeoJSON (from backend)
  const [mapReady, setMapReady] = useState(false)

  const [selectedState, setSelectedState] = useState(null) // { name, fips }

  const hoveredStateId = useRef(null)
  const hoveredCountyId = useRef(null)

  // Fetch county GeoJSON from backend
  useEffect(() => {
    fetch(`${API}/geojson?layer=${layer}`)
      .then(r => r.json())
      .then(setGeo)
      .catch(() => console.warn('Backend not available'))
  }, [layer])

  // Fetch state GeoJSON from backend
  useEffect(() => {
    fetch(`${API}/states`)
      .then(r => r.json())
      .then(setStateGeo)
      .catch(() => console.warn('States endpoint not available'))
  }, [])

  // Zoom back out to full US
  const zoomOut = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    setSelectedState(null)

    map.flyTo({ center: [-98.5, 39.8], zoom: 3.2, duration: 800 })

    // Show states, hide counties
    if (map.getLayer('counties-fill')) {
      map.setLayoutProperty('counties-fill', 'visibility', 'none')
      map.setLayoutProperty('counties-line', 'visibility', 'none')
      if (map.getLayer('counties-hover-line')) {
        map.setLayoutProperty('counties-hover-line', 'visibility', 'none')
      }
    }
    if (map.getLayer('states-fill')) {
      map.setLayoutProperty('states-fill', 'visibility', 'visible')
      map.setLayoutProperty('states-line', 'visibility', 'visible')
      map.setLayoutProperty('states-hover', 'visibility', 'visible')
    }

    // clear hover tooltip
    onHover?.(null)
  }, [onHover])

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
      center: [-98.5, 39.8],
      zoom: 3.2,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      // ── State source ──────────────────────────────────────────
      map.addSource('states', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        generateId: true,
      })

      // State fill (base)
      map.addLayer({
        id: 'states-fill',
        type: 'fill',
        source: 'states',
        paint: {
          'fill-color': 'rgba(124,58,237,0.18)',
          'fill-opacity': 1,
        },
      })

      // State hover highlight
      map.addLayer({
        id: 'states-hover',
        type: 'fill',
        source: 'states',
        paint: {
          'fill-color': 'rgba(124,58,237,0.45)',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
        },
      })

      // State borders
      map.addLayer({
        id: 'states-line',
        type: 'line',
        source: 'states',
        paint: { 'line-color': 'rgba(200,180,255,0.9)', 'line-width': 1.5 },
      })

      // ── County source (hidden until drill-in) ─────────────────
      map.addSource('counties', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        generateId: true, // required for feature-state hover
      })

      map.addLayer({
        id: 'counties-fill',
        type: 'fill',
        source: 'counties',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#334', 'fill-opacity': 0.85 },
      })

      // County borders (make them readable)
      map.addLayer({
        id: 'counties-line',
        type: 'line',
        source: 'counties',
        layout: { visibility: 'none' },
        paint: {
          'line-color': 'rgba(255,255,255,0.28)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.2, 5, 0.45, 7, 0.85, 9, 1.25],
        },
      })

      // County hover outline (crisp highlight)
      map.addLayer({
        id: 'counties-hover-line',
        type: 'line',
        source: 'counties',
        layout: { visibility: 'none' },
        paint: {
          'line-color': 'rgba(255,255,255,0.85)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.0, 6, 1.8, 9, 3.0],
        },
        filter: ['boolean', ['feature-state', 'hover'], false],
      })

      // ── State interactions ────────────────────────────────────
      map.on('mousemove', 'states-fill', e => {
        map.getCanvas().style.cursor = 'pointer'
        const id = e.features?.[0]?.id

        if (hoveredStateId.current !== null && hoveredStateId.current !== id) {
          map.setFeatureState({ source: 'states', id: hoveredStateId.current }, { hover: false })
        }
        hoveredStateId.current = id
        if (id !== undefined && id !== null) {
          map.setFeatureState({ source: 'states', id }, { hover: true })
        }

        const name = e.features?.[0]?.properties?.name
        onHover?.({ point: e.point, lngLat: e.lngLat, props: { county: name, state: '', isState: true } })
      })

      map.on('mouseleave', 'states-fill', () => {
        map.getCanvas().style.cursor = ''
        if (hoveredStateId.current !== null) {
          map.setFeatureState({ source: 'states', id: hoveredStateId.current }, { hover: false })
          hoveredStateId.current = null
        }
        onHover?.(null)
      })

      map.on('click', 'states-fill', e => {
        const name = e.features?.[0]?.properties?.name
        if (!name) return
        const fips = STATE_NAME_TO_FIPS[name]
        if (!fips) return

        // Zoom to state bounds (handles multipolygons)
        const bounds = new maplibregl.LngLatBounds()
        const geom = e.features?.[0]?.geometry
        if (geom?.type === 'Polygon') {
          geom.coordinates.forEach(ring => ring.forEach(c => bounds.extend(c)))
        } else if (geom?.type === 'MultiPolygon') {
          geom.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(c => bounds.extend(c))))
        }
        map.fitBounds(bounds, { padding: 60, duration: 800 })

        setSelectedState({ name, fips })

        // Hide states, show counties
        map.setLayoutProperty('states-fill',  'visibility', 'none')
        map.setLayoutProperty('states-line',  'visibility', 'none')
        map.setLayoutProperty('states-hover', 'visibility', 'none')

        map.setLayoutProperty('counties-fill', 'visibility', 'visible')
        map.setLayoutProperty('counties-line', 'visibility', 'visible')
        map.setLayoutProperty('counties-hover-line', 'visibility', 'visible')
      })

      // ── County interactions ───────────────────────────────────
      map.on('mousemove', 'counties-fill', e => {
        map.getCanvas().style.cursor = 'pointer'
        const f = e.features?.[0]
        const id = f?.id

        // Toggle hover state to drive hover outline layer
        if (hoveredCountyId.current !== null && hoveredCountyId.current !== id) {
          map.setFeatureState({ source: 'counties', id: hoveredCountyId.current }, { hover: false })
        }
        if (id !== undefined && id !== null) {
          hoveredCountyId.current = id
          map.setFeatureState({ source: 'counties', id }, { hover: true })
        }

        if (f) onHover?.({ point: e.point, lngLat: e.lngLat, props: f.properties })
      })

      map.on('mouseleave', 'counties-fill', () => {
        map.getCanvas().style.cursor = ''
        if (hoveredCountyId.current !== null) {
          map.setFeatureState({ source: 'counties', id: hoveredCountyId.current }, { hover: false })
          hoveredCountyId.current = null
        }
        onHover?.(null)
      })

      map.on('click', 'counties-fill', e => {
        const f = e.features?.[0]
        if (f) onSelect?.(f.properties)
      })

      setMapReady(true)
    })

    return () => { map.remove(); mapRef.current = null }
  }, [onHover, onSelect])

  // Load state GeoJSON + color by avg county risk score
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !stateGeo) return

    // Compute avg score per state from county data
    const stateTotals = {}
    if (geo) {
      geo.features.forEach(ft => {
        const stateFips = ft.properties?.STATE || ft.properties?.fips?.slice(0, 2)
        if (!stateFips) return
        const score = Math.min(1, Math.max(0, scenarioScore(ft.properties, scenario)))
        if (!stateTotals[stateFips]) stateTotals[stateFips] = { sum: 0, count: 0 }
        stateTotals[stateFips].sum += score
        stateTotals[stateFips].count += 1
      })
    }

    // Attach avg_score to each state feature
    const enriched = {
      ...stateGeo,
      features: stateGeo.features.map(f => {
        const name = f.properties?.name
        const fips = STATE_NAME_TO_FIPS[name]
        const entry = fips ? stateTotals[fips] : null
        const avg_score = entry ? entry.sum / entry.count : 0.35
        return { ...f, properties: { ...f.properties, avg_score } }
      }),
    }

    map.getSource('states')?.setData(enriched)

    // Color states by avg_score using same ramp as counties
    const stops = COLOR_STOPS[layer]
    map.setPaintProperty('states-fill', 'fill-color', [
      'interpolate', ['linear'], ['get', 'avg_score'], ...stops,
    ])
    map.setPaintProperty('states-fill', 'fill-opacity', 0.75)
  }, [stateGeo, mapReady, geo, scenario, layer])

  // Update county choropleth when layer/scenario/selectedState changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !geo) return

    const stops = COLOR_STOPS[layer]

    // Filter counties to selected state only
    const features = selectedState
      ? geo.features.filter(f => f.properties?.STATE === selectedState.fips || f.properties?.fips?.startsWith(selectedState.fips))
      : geo.features

    const scored = {
      type: 'FeatureCollection',
      features: features.map(ft => {
        const score = Math.min(1, Math.max(0, scenarioScore(ft.properties, scenario)))
        return { ...ft, properties: { ...ft.properties, score } }
      }),
    }

    map.getSource('counties')?.setData(scored)

    map.setPaintProperty('counties-fill', 'fill-color', [
      'interpolate', ['linear'], ['get', 'score'], ...stops,
    ])
  }, [geo, scenario, layer, mapReady, selectedState])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Back button — only shown when drilled into a state */}
      {selectedState && (
        <button
          onClick={zoomOut}
          style={{
            position: 'absolute', top: 16, left: 16,
            background: 'rgba(8,9,14,0.92)', border: '1px solid rgba(255,255,255,0.15)',
            color: '#e8e8f0', borderRadius: 8, padding: '8px 16px',
            cursor: 'pointer', fontSize: 12, fontFamily: "'DM Mono',monospace",
            backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 8,
            transition: 'all .2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(124,58,237,0.3)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(8,9,14,0.92)'}
        >
          ← {selectedState.name}
        </button>
      )}

      {/* Hint shown on state view */}
      {!selectedState && (
        <div style={{
          position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(8,9,14,0.75)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20, padding: '6px 16px', fontSize: 11,
          fontFamily: "'DM Mono',monospace", color: '#666',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          click a state to explore counties
        </div>
      )}

      <Legend layer={layer} />
    </div>
  )
}

function Legend({ layer }) {
  const palette = LAYER_PALETTES[layer]
  const labels = { cancer: 'Cancer Risk', neuro: 'Neuro Risk', amr: 'AMR Vulnerability' }
  return (
    <div style={{
      position: 'absolute', bottom: 28, left: 16,
      background: 'rgba(8,9,14,0.88)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8, padding: '10px 14px', backdropFilter: 'blur(8px)', pointerEvents: 'none',
    }}>
      <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', marginBottom: 8, letterSpacing: '.1em' }}>
        {labels[layer].toUpperCase()} INDEX
      </div>
      <div style={{ display: 'flex', gap: 2, marginBottom: 6 }}>
        {palette.map((c, i) => <div key={i} style={{ width: 24, height: 8, borderRadius: 2, background: c }} />)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: "'DM Mono',monospace", color: '#444' }}>
        <span>Low</span><span>Critical</span>
      </div>
    </div>
  )
}
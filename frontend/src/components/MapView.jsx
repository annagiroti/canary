import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { scenarioScore } from '../lib/score.js'
import { LAYER_PALETTES } from '../App.jsx'

const API = 'http://localhost:8000'

// Color stop values for MapLibre interpolate expression per layer
const COLOR_STOPS = {
  cancer: [0, '#fef9c3', 0.25, '#fde047', 0.5, '#f97316', 0.75, '#dc2626', 1, '#7f1d1d'],
  neuro:  [0, '#ede9fe', 0.25, '#a78bfa', 0.5, '#7c3aed', 0.75, '#4c1d95', 1, '#1e1b4b'],
  amr:    [0, '#d1fae5', 0.25, '#34d399', 0.5, '#059669', 0.75, '#065f46', 1, '#022c22'],
}

export default function MapView({ layer, scenario, onHover, onSelect }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const [geo, setGeo] = useState(null)
  const [mapReady, setMapReady] = useState(false)

  // Fetch GeoJSON from backend
  useEffect(() => {
    fetch(`${API}/geojson?layer=${layer}`)
      .then(r => r.json())
      .then(setGeo)
      .catch(() => console.warn('Backend not available — connect FastAPI to see real data'))
  }, [layer])

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [-98.5, 39.8],
      zoom: 3.2,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      map.addSource('counties', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'counties-fill', type: 'fill', source: 'counties',
        paint: { 'fill-color': '#334', 'fill-opacity': 0.8 },
      })
      map.addLayer({
        id: 'counties-line', type: 'line', source: 'counties',
        paint: { 'line-width': 0.3, 'line-color': 'rgba(0,0,0,0.4)' },
      })
      map.addLayer({
        id: 'counties-hover', type: 'fill', source: 'counties',
        paint: { 'fill-color': 'rgba(255,255,255,0.15)', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0] },
      })

      map.on('mousemove', 'counties-fill', e => {
        map.getCanvas().style.cursor = 'pointer'
        const f = e.features?.[0]
        if (f) onHover?.({ lngLat: e.lngLat, props: f.properties })
      })
      map.on('mouseleave', 'counties-fill', () => {
        map.getCanvas().style.cursor = ''
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

  // Update choropleth whenever geo or scenario changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !geo) return

    const stops = COLOR_STOPS[layer]

    const scored = {
      ...geo,
      features: geo.features.map(ft => {
        const score = Math.min(1, Math.max(0, scenarioScore(ft.properties, scenario)))
        return { ...ft, properties: { ...ft.properties, score } }
      }),
    }

    map.getSource('counties')?.setData(scored)
    map.setPaintProperty('counties-fill', 'fill-color', [
      'interpolate', ['linear'], ['get', 'score'], ...stops,
    ])
  }, [geo, scenario, layer, mapReady])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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

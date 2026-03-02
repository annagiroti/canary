import { useState, useEffect } from 'react'
import MapView from './components/MapView.jsx'
import ControlPanel from './components/ControlPanel.jsx'
import Tooltip from './components/Tooltip.jsx'
import { scenarioScore } from './lib/score.js'

const API = 'http://localhost:8000'

export const LAYER_META = {
  cancer: { label: 'Cancer Risk',       icon: '⬡', desc: 'Composite cancer vulnerability from pollution, poverty, and care access.' },
  neuro:  { label: 'Neuro Risk',        icon: '◈', desc: 'Neurological disorder risk linked to PM2.5 exposure and socioeconomic stress.' },
  amr:    { label: 'AMR Vulnerability', icon: '⬟', desc: 'Antimicrobial resistance burden — access gaps and climate-linked infection pressure.' },
}

export const LAYER_PALETTES = {
  cancer: ['#fef9c3','#fde047','#f97316','#dc2626','#7f1d1d'],
  neuro:  ['#ede9fe','#a78bfa','#7c3aed','#4c1d95','#1e1b4b'],
  amr:    ['#d1fae5','#34d399','#059669','#065f46','#022c22'],
}

export function riskLabel(s) {
  if (s >= 0.75) return { text: 'Critical', cls: 'critical' }
  if (s >= 0.55) return { text: 'High',     cls: 'high' }
  if (s >= 0.35) return { text: 'Moderate', cls: 'moderate' }
  return { text: 'Low', cls: 'low' }
}

function SelectedPanel({ county, scenario, onClose }) {
  const props = county
  const allScores = {
    cancer: scenarioScore(props, scenario),
    neuro:  scenarioScore(props, scenario),
    amr:    scenarioScore(props, scenario),
  }

  return (
    <div style={{
      width: 240, borderLeft: '1px solid rgba(255,255,255,0.07)',
      padding: '20px 18px', overflowY: 'auto', background: '#08090e', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {props.county || props.NAME || 'County'}{props.state ? `, ${props.state}` : ''}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>

      <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', marginBottom: 10, letterSpacing: '.1em' }}>RISK SCORES</div>
      {Object.entries(allScores).map(([k, v]) => {
        const rl = riskLabel(v)
        return (
          <div key={k} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11 }}>{LAYER_META[k].label}</span>
              <span className={`risk-badge ${rl.cls}`}>{rl.text}</span>
            </div>
            <div className="score-bar-bg">
              <div className="score-bar-fill" style={{ width: `${Math.min(1,Math.max(0,v))*100}%`, background: LAYER_PALETTES[k][3] }} />
            </div>
          </div>
        )
      })}

      <div style={{ marginTop: 16, fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', marginBottom: 10, letterSpacing: '.1em' }}>COUNTY PROFILE</div>
      {[
        { label: 'PM2.5 Exposure',    val: props.pm25,    fmt: v => `${(v*100).toFixed(0)}%` },
        { label: 'Poverty Rate',      val: props.poverty, fmt: v => `${(v*100).toFixed(0)}%` },
        { label: 'Healthcare Access', val: props.access,  fmt: v => `${(v*100).toFixed(0)}%` },
        { label: 'FIPS Code',         val: props.fips,    fmt: v => v },
      ].map(r => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
          <span style={{ fontSize: 11, color: '#666' }}>{r.label}</span>
          <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: '#aaa' }}>
            {r.val != null ? r.fmt(r.val) : '—'}
          </span>
        </div>
      ))}

      <div style={{ marginTop: 16, padding: '10px 12px', background: 'rgba(124,58,237,0.1)', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)' }}>
        <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#7c3aed', marginBottom: 4 }}>MODEL NOTE</div>
        <div style={{ fontSize: 10, color: '#555', lineHeight: 1.5 }}>
          Sensitivity weights from OLS regression on CDC PLACES + EPA AQS. Adjust sliders to explore policy scenarios.
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [layer, setLayer]           = useState('cancer')
  const [scenario, setScenario]     = useState({ dPm25: 0, poverty: 0.5, access: 0.6 })
  const [hover, setHover]           = useState(null)
  const [selected, setSelected]     = useState(null)
  const [tab, setTab]               = useState('map')
  const [countyData, setCountyData] = useState([])
  const [selectedState, setSelectedState] = useState(null)


  // Fetch real county data from backend whenever layer changes
  useEffect(() => {
    fetch(`${API}/geojson?layer=${layer}`)
      .then(r => r.json())
      .then(d => setCountyData(d.features.map(f => f.properties)))
      .catch(() => console.warn('Backend not available'))
  }, [layer])

  const visibleCounties = selectedState
  ? countyData.filter(c => c.STATE === selectedState.fips || c.fips?.startsWith(selectedState.fips))
  : countyData

  return (
    <div style={{
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
      background: '#08090e', color: '#e8e8f0',
      height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=DM+Mono:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        .layer-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #a0a0b8; padding: 7px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'DM Mono', monospace; letter-spacing: 0.05em; transition: all .2s; }
        .layer-btn.active { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.3); color: #fff; }
        .layer-btn:hover:not(.active) { background: rgba(255,255,255,0.08); color: #ccc; }
        .risk-badge { font-size: 10px; font-family: 'DM Mono', monospace; padding: 2px 8px; border-radius: 4px; font-weight: 500; }
        .risk-badge.critical { background: rgba(220,38,38,0.25);  color: #fca5a5; border: 1px solid rgba(220,38,38,0.4); }
        .risk-badge.high     { background: rgba(249,115,22,0.25); color: #fdba74; border: 1px solid rgba(249,115,22,0.4); }
        .risk-badge.moderate { background: rgba(234,179,8,0.25);  color: #fde68a; border: 1px solid rgba(234,179,8,0.4); }
        .risk-badge.low      { background: rgba(34,197,94,0.25);  color: #86efac; border: 1px solid rgba(34,197,94,0.4); }
        input[type=range] { -webkit-appearance:none; width:100%; height:3px; border-radius:2px; background:#222; outline:none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:#7c3aed; cursor:pointer; border: 2px solid #fff; }
        .tab-btn { background:none; border:none; color:#666; padding:8px 0; font-size:12px; font-family:'DM Mono',monospace; cursor:pointer; letter-spacing:.06em; border-bottom: 2px solid transparent; transition: all .2s; }
        .tab-btn.active { color:#fff; border-bottom-color: #7c3aed; }
        .county-row { display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:6px; cursor:pointer; transition: background .15s; }
        .county-row:hover { background: rgba(255,255,255,0.05); }
        .county-row.sel { background: rgba(124,58,237,0.15); }
        .score-bar-bg   { background: rgba(255,255,255,0.08); border-radius:2px; height:4px; flex:1; }
        .score-bar-fill { height:4px; border-radius:2px; transition: width .4s ease; }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.02)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#7c3aed,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⬡</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '.02em' }}>Canary</div>
            <div style={{ fontSize: 10, color: '#555', fontFamily: "'DM Mono',monospace", letterSpacing: '.08em' }}>HEALTH EQUITY ANALYSIS PLATFORM</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {Object.entries(LAYER_META).map(([k, v]) => (
            <button key={k} className={`layer-btn${layer === k ? ' active' : ''}`} onClick={() => setLayer(k)}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#444', fontFamily: "'DM Mono',monospace" }}>live scenario · county risk atlas</div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ControlPanel
          layer={layer}
          scenario={scenario}
          setScenario={setScenario}
          tab={tab}
          setTab={setTab}
          selected={selected}
          onSelect={setSelected}
          countyData={visibleCounties}
          selectedState={selectedState}
        />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <MapView layer={layer} scenario={scenario} onHover={setHover} onSelect={setSelected} onStateChange={setSelectedState} />
          <div style={{ position: 'absolute', top: 16, right: 16, maxWidth: 220, background: 'rgba(8,9,14,0.88)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 14px', backdropFilter: 'blur(8px)', pointerEvents: 'none' }}>
            <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#7c3aed', marginBottom: 4 }}>{LAYER_META[layer].icon} {LAYER_META[layer].label}</div>
            <div style={{ fontSize: 11, color: '#666', lineHeight: 1.5 }}>{LAYER_META[layer].desc}</div>
          </div>
          <Tooltip hover={hover} scenario={scenario} layer={layer} />
        </div>
        {selected && (
          <SelectedPanel county={selected} scenario={scenario} onClose={() => setSelected(null)} />
        )}
      </div>
    </div>
  )
}
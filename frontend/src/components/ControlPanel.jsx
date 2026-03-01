import { scenarioScore } from '../lib/score.js'
import { LAYER_META, LAYER_PALETTES, riskLabel } from '../App.jsx'

export default function ControlPanel({ layer, scenario, setScenario, tab, setTab, selected, onSelect, countyData }) {
  return (
    <div style={{
      width: 280, borderRight: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#08090e',
    }}>
      {/* Scenario Sliders */}
      <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', letterSpacing: '.1em', marginBottom: 14 }}>
          SCENARIO CONTROLS
        </div>
        {[
          { key: 'dPm25',   label: 'PM2.5 Δ',          min: -0.2, max: 0.2, step: 0.01, fmt: v => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%` },
          { key: 'poverty', label: 'Poverty Index',     min: 0,    max: 1,   step: 0.01, fmt: v => v.toFixed(2) },
          { key: 'access',  label: 'Healthcare Access', min: 0,    max: 1,   step: 0.01, fmt: v => v.toFixed(2) },
        ].map(s => (
          <div key={s.key} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: '#888' }}>{s.label}</span>
              <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: '#ccc' }}>
                {s.fmt(scenario[s.key] ?? 0)}
              </span>
            </div>
            <input
              type="range" min={s.min} max={s.max} step={s.step}
              value={scenario[s.key] ?? 0}
              onChange={e => setScenario(prev => ({ ...prev, [s.key]: parseFloat(e.target.value) }))}
            />
          </div>
        ))}
        <div style={{ fontSize: 10, color: '#2a2a40', lineHeight: 1.5, fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
          score = base + w·Δpm25 + w·Δpoverty + w·Δaccess
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 20, padding: '0 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button className={`tab-btn${tab === 'map' ? ' active' : ''}`} onClick={() => setTab('map')}>TOP COUNTIES</button>
        <button className={`tab-btn${tab === 'equity' ? ' active' : ''}`} onClick={() => setTab('equity')}>EQUITY</button>
      </div>

      {tab === 'map' && (
        <TopCountiesTab
          scenario={scenario}
          layer={layer}
          selected={selected}
          onSelect={onSelect}
          countyData={countyData}
        />
      )}
      {tab === 'equity' && (
        <EquityTab scenario={scenario} layer={layer} countyData={countyData} />
      )}
    </div>
  )
}

function TopCountiesTab({ scenario, layer, selected, onSelect, countyData }) {
  const palette = LAYER_PALETTES[layer]

  // Score and sort all real counties from backend
  const scored = countyData
    .filter(c => c && c.base != null)
    .map(c => ({ ...c, score: scenarioScore(c, scenario) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)

  if (scored.length === 0) {
    return (
      <div style={{ padding: '20px 18px', fontSize: 11, color: '#444', fontFamily: "'DM Mono',monospace" }}>
        Loading counties...
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
      {scored.map((c, i) => {
        const rl = riskLabel(c.score)
        const barColor = palette[Math.min(palette.length - 1, Math.floor(c.score * palette.length))]
        return (
          <div
            key={c.fips}
            className={`county-row${selected?.fips === c.fips ? ' sel' : ''}`}
            onClick={() => onSelect(c)}
          >
            <span style={{ fontSize: 10, color: '#444', fontFamily: "'DM Mono',monospace", width: 18 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.county}, {c.state}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <div className="score-bar-bg">
                  <div className="score-bar-fill" style={{ width: `${Math.min(1, Math.max(0, c.score)) * 100}%`, background: barColor }} />
                </div>
                <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#777', minWidth: 32 }}>
                  {(c.score * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <span className={`risk-badge ${rl.cls}`}>{rl.text}</span>
          </div>
        )
      })}
    </div>
  )
}

function EquityTab({ scenario, layer, countyData }) {
  // Split by poverty proxy — high poverty = bottom 25%, low poverty = top 25%
  const sorted = [...countyData].sort((a, b) => Number(a.poverty) - Number(b.poverty))
  const q = Math.floor(sorted.length / 4)
  const highIncome = sorted.slice(0, q)         // lowest poverty
  const lowIncome  = sorted.slice(sorted.length - q) // highest poverty

  const avg = arr => arr.length === 0 ? 0 :
    arr.reduce((s, c) => s + scenarioScore(c, scenario), 0) / arr.length

  const avgLow  = avg(lowIncome)
  const avgHigh = avg(highIncome)
  const gap = (avgLow - avgHigh).toFixed(3)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
      <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', letterSpacing: '.1em', marginBottom: 14 }}>
        DISPARITY ANALYSIS
      </div>

      <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Disparity Gap (high vs low poverty)</div>
        <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: '#fca5a5' }}>{gap}</div>
        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>Higher = greater inequity in {LAYER_META[layer].label}</div>
      </div>

      {[
        { label: 'High poverty counties (avg)',  val: avgLow,  color: '#f97316' },
        { label: 'Low poverty counties (avg)',   val: avgHigh, color: '#34d399' },
      ].map(d => (
        <div key={d.label} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 11, color: '#777' }}>{d.label}</span>
            <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: d.color }}>{(d.val * 100).toFixed(1)}%</span>
          </div>
          <div className="score-bar-bg">
            <div className="score-bar-fill" style={{ width: `${d.val * 100}%`, background: d.color }} />
          </div>
        </div>
      ))}

      <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid #7c3aed' }}>
        <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', marginBottom: 6 }}>BIOETHICS NOTE</div>
        <div style={{ fontSize: 11, color: '#777', lineHeight: 1.6 }}>
          Risk scores reflect structural inequities — not individual behavior. Interventions should prioritize upstream determinants: housing, pollution policy, and care access.
        </div>
      </div>
    </div>
  )
}

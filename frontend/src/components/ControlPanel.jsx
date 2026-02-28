import { scenarioScore, riskFromScore } from '../lib/score.js'
import { LAYER_META, LAYER_PALETTES, riskLabel } from '../App.jsx'

export default function ControlPanel({ layer, scenario, setScenario, tab, setTab, selected, onSelect }) {
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
        <TopCountiesTab scenario={scenario} layer={layer} selected={selected} onSelect={onSelect} />
      )}
      {tab === 'equity' && (
        <EquityTab scenario={scenario} layer={layer} />
      )}
    </div>
  )
}

// Placeholder top-counties list — replace with real data from /geojson once loaded
const SAMPLE_COUNTIES = [
  { fips:'06037', county:'Los Angeles', state:'CA', base_cancer:0.72, base_neuro:0.68, base_amr:0.61, poverty:0.78, access:0.42, pm25:0.81, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'low' },
  { fips:'36061', county:'New York',    state:'NY', base_cancer:0.69, base_neuro:0.74, base_amr:0.77, poverty:0.71, access:0.55, pm25:0.76, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'low' },
  { fips:'42101', county:'Philadelphia',state:'PA', base_cancer:0.74, base_neuro:0.71, base_amr:0.76, poverty:0.75, access:0.45, pm25:0.73, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'low' },
  { fips:'01073', county:'Jefferson',   state:'AL', base_cancer:0.75, base_neuro:0.72, base_amr:0.78, poverty:0.76, access:0.38, pm25:0.74, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'low' },
  { fips:'12086', county:'Miami-Dade',  state:'FL', base_cancer:0.67, base_neuro:0.64, base_amr:0.71, poverty:0.68, access:0.48, pm25:0.60, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'low' },
  { fips:'17031', county:'Cook',        state:'IL', base_cancer:0.64, base_neuro:0.62, base_amr:0.59, poverty:0.66, access:0.58, pm25:0.70, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'low' },
  { fips:'48201', county:'Harris',      state:'TX', base_cancer:0.60, base_neuro:0.57, base_amr:0.63, poverty:0.62, access:0.50, pm25:0.65, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'mid' },
  { fips:'06085', county:'Santa Clara', state:'CA', base_cancer:0.38, base_neuro:0.41, base_amr:0.35, poverty:0.30, access:0.85, pm25:0.42, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'high'},
  { fips:'53033', county:'King',        state:'WA', base_cancer:0.35, base_neuro:0.38, base_amr:0.30, poverty:0.28, access:0.88, pm25:0.37, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'high'},
  { fips:'27053', county:'Hennepin',    state:'MN', base_cancer:0.40, base_neuro:0.43, base_amr:0.38, poverty:0.38, access:0.82, pm25:0.41, w_pm25:0.18, w_poverty:0.14, w_access:-0.20, income_q:'high'},
]

function baseKey(layer) { return `base_${layer}` }

function TopCountiesTab({ scenario, layer, selected, onSelect }) {
  const palette = LAYER_PALETTES[layer]
  const scored = SAMPLE_COUNTIES
    .map(c => ({ ...c, base: c[baseKey(layer)] ?? 0.5, score: scenarioScore({ ...c, base: c[baseKey(layer)] ?? 0.5 }, scenario) }))
    .sort((a, b) => b.score - a.score)

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

function EquityTab({ scenario, layer }) {
  const lowIncome  = SAMPLE_COUNTIES.filter(c => c.income_q === 'low')
  const highIncome = SAMPLE_COUNTIES.filter(c => c.income_q === 'high')

  const avg = arr => arr.reduce((s, c) => s + scenarioScore({ ...c, base: c[baseKey(layer)] ?? 0.5 }, scenario), 0) / arr.length
  const avgLow  = avg(lowIncome)
  const avgHigh = avg(highIncome)
  const gap = (avgLow - avgHigh).toFixed(3)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
      <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', letterSpacing: '.1em', marginBottom: 14 }}>
        DISPARITY ANALYSIS
      </div>

      <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Disparity Gap (low vs high income)</div>
        <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: '#fca5a5' }}>{gap}</div>
        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>Higher = greater inequity in {LAYER_META[layer].label}</div>
      </div>

      {[
        { label: 'Low-income counties (avg)',  val: avgLow,  color: '#f97316' },
        { label: 'High-income counties (avg)', val: avgHigh, color: '#34d399' },
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

import { useEffect, useMemo, useState } from 'react'
import { scenarioScore } from '../lib/score.js'
import { LAYER_META, LAYER_PALETTES, riskLabel } from '../App.jsx'

const API = 'http://localhost:8000'

export default function ControlPanel({ layer, scenario, setScenario, tab, setTab, selected, onSelect, selectedState }) {
  return (
    <div style={{
      width: 280, borderRight: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#08090e',
    }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', letterSpacing: '.1em', marginBottom: 14 }}>
          SCENARIO CONTROLS
        </div>

        {[
          { key: 'dPm25',   label: 'PM2.5 Δ',           min: -0.2, max: 0.2, step: 0.01, fmt: v => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%` },
          { key: 'poverty', label: 'Deprivation Index', min: 0,    max: 1,   step: 0.01, fmt: v => v.toFixed(2) },
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
          score = base + w·Δpm25 + w·Δdeprivation + w·Δaccess
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, padding: '0 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button className={`tab-btn${tab === 'map' ? ' active' : ''}`} onClick={() => setTab('map')}>TOP COUNTIES</button>
        <button className={`tab-btn${tab === 'equity' ? ' active' : ''}`} onClick={() => setTab('equity')}>EQUITY</button>
      </div>

      {tab === 'map' && (
        <TopCountiesTab
          layer={layer}
          scenario={scenario}
          selectedState={selectedState}
          selected={selected}
          onSelect={onSelect}
        />
      )}

      {tab === 'equity' && (
        <EquityTab
          scenario={scenario}
          layer={layer}
          onSelect={onSelect}
          selectedState={selectedState}
        />
      )}
    </div>
  )
}

/**
 * Top Counties (real data)
 * Shows top 5 counties ONLY for the currently-selected layer.
 * If a state is selected, rankings are scoped to that state.
 */
function TopCountiesTab({ layer, scenario, selectedState, selected, onSelect }) {
  const [byLayer, setByLayer] = useState({ cancer: [], neuro: [], amr: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const layers = ['cancer', 'neuro', 'amr']
    Promise.all(
      layers.map(l =>
        fetch(`${API}/geojson?layer=${l}`)
          .then(r => r.json())
          .then(gj => (gj.features ?? []).map(f => f.properties))
          .catch(() => [])
      )
    ).then(([cancer, neuro, amr]) => {
      if (cancelled) return
      setByLayer({ cancer, neuro, amr })
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  function inSelectedState(c) {
    if (!selectedState?.fips) return true
    const sf = selectedState.fips
    return c.STATE === sf || (c.fips?.startsWith?.(sf))
  }

  function top5(layerKey) {
    const palette = LAYER_PALETTES[layerKey]
    const rows = (byLayer[layerKey] ?? [])
      .filter(inSelectedState)
      .map(c => {
        const base = c.base ?? 0.3
        const score = scenarioScore({ ...c, base }, scenario)
        const barColor = palette[Math.min(palette.length - 1, Math.floor(score * palette.length))]
        return { ...c, base, score, barColor }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    return rows
  }

  const scopedLabel = selectedState?.name ? `in ${selectedState.name}` : 'nationwide'

  const section = useMemo(() => {
    if (layer === 'cancer') return { key: 'cancer', title: 'TOP CANCER RISK COUNTIES', icon: '🧬' }
    if (layer === 'neuro')  return { key: 'neuro',  title: 'TOP NEURO RISK COUNTIES',  icon: '🧠' }
    if (layer === 'amr')    return { key: 'amr',    title: 'TOP AMR VULNERABILITY COUNTIES', icon: '🦠' }
    return null
  }, [layer])

  const rows = section ? top5(section.key) : []

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
      <div style={{ fontSize: 10, color: '#666', fontFamily: "'DM Mono',monospace", letterSpacing: '.08em', margin: '4px 4px 10px' }}>
        Rankings {scopedLabel} · scenario-adjusted
      </div>

      {loading && (
        <div style={{ padding: 12, fontSize: 12, color: '#777' }}>Loading county rankings…</div>
      )}

      {!loading && section && (
        <div style={{ marginBottom: 14, padding: '10px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, color: '#bbb', fontFamily: "'DM Mono',monospace", letterSpacing: '.08em' }}>
              {section.icon} {section.title}
            </div>
            <div style={{ fontSize: 10, color: '#666', fontFamily: "'DM Mono',monospace" }}>
              top 5
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            {rows.map((c, i) => {
              const rl = riskLabel(c.score)
              return (
                <div
                  key={`${section.key}-${c.fips}`}
                  className={`county-row${selected?.fips === c.fips ? ' sel' : ''}`}
                  onClick={() => onSelect?.(c)}
                >
                  <span style={{ fontSize: 10, color: '#444', fontFamily: "'DM Mono',monospace", width: 18 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.county || c.NAME || 'County'}{c.state ? `, ${c.state}` : ''}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <div className="score-bar-bg">
                        <div className="score-bar-fill" style={{ width: `${Math.min(1, Math.max(0, c.score)) * 100}%`, background: c.barColor }} />
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

            {rows.length === 0 && (
              <div style={{ padding: 10, fontSize: 11, color: '#666' }}>
                No county data found for this scope.
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && !section && (
        <div style={{ padding: 12, fontSize: 12, color: '#777' }}>
          Unknown layer: {String(layer)}
        </div>
      )}
    </div>
  )
}

function EquityTab({ scenario, layer, onSelect, selectedState }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [summary, setSummary] = useState(null)

  const [policyOn, setPolicyOn] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null)

    const params = new URLSearchParams({
      layer,
      dPm25: String(scenario.dPm25 ?? 0),
      poverty: String(scenario.poverty ?? 0.5),
      access: String(scenario.access ?? 0.6),
      targeted_pm25_cleanup: String(policyOn),
      cleanup_strength: "0.20",
      ...(selectedState ? { state_fips: selectedState.fips } : {}),
    })

    fetch(`${API}/equity_summary?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d?.error) throw new Error(d.message || 'equity_summary error')
        setSummary(d)
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setErr(String(e?.message || e))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [layer, scenario.dPm25, scenario.poverty, scenario.access, policyOn, selectedState?.fips])

  const gap = summary?.deprivation_gap ?? 0
  const avgHigh = summary?.group_avgs?.high_dep ?? 0
  const avgLow  = summary?.group_avgs?.low_dep ?? 0

  const drivers = summary?.drivers ?? { pm25_gap: 0, deprivation_gap: 0, low_access_gap: 0 }
  const policy = summary?.policy ?? { targeted_pm25_cleanup: false, gap_before: gap, gap_after: gap, delta: 0 }

  const driverRows = useMemo(() => ([
    { k: 'pm25_gap', label: 'Pollution exposure gap', val: drivers.pm25_gap },
    { k: 'deprivation_gap', label: 'Deprivation gap', val: drivers.deprivation_gap },
    { k: 'low_access_gap', label: 'Care access gap', val: drivers.low_access_gap },
  ]), [drivers])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
      <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', letterSpacing: '.1em', marginBottom: 14 }}>
        STRUCTURAL INEQUITY ANALYSIS
      </div>

      {loading && <div style={{ fontSize: 11, color: '#777' }}>Loading equity metrics…</div>}
      {err && <div style={{ fontSize: 11, color: '#fca5a5' }}>Equity endpoint error: {err}</div>}

      {!loading && !err && summary && (
        <>
          <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>
              Inequity Gap (high vs low deprivation)
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: '#fca5a5' }}>
              {gap.toFixed(3)}
            </div>
            <div style={{ fontSize: 10, color: '#666', marginTop: 6, lineHeight: 1.5 }}>
              High-deprivation counties carry higher climate-linked {LAYER_META[layer].label.toLowerCase()} burden under the current scenario.
            </div>
          </div>

          {[
            { label: 'High-deprivation counties (avg)', val: avgHigh, color: '#f97316' },
            { label: 'Low-deprivation counties (avg)',  val: avgLow,  color: '#34d399' },
          ].map(d => (
            <div key={d.label} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: '#777' }}>{d.label}</span>
                <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: d.color }}>{(d.val * 100).toFixed(1)}%</span>
              </div>
              <div className="score-bar-bg">
                <div className="score-bar-fill" style={{ width: `${Math.max(0, Math.min(1, d.val)) * 100}%`, background: d.color }} />
              </div>
            </div>
          ))}

          <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', marginBottom: 8, letterSpacing: '.08em' }}>
              WHAT DRIVES THE GAP
            </div>
            {driverRows.map(r => (
              <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#777' }}>{r.label}</span>
                <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: '#bbb' }}>
                  {r.val >= 0 ? '+' : ''}{r.val.toFixed(3)}
                </span>
              </div>
            ))}
            <div style={{ fontSize: 10, color: '#666', marginTop: 8, lineHeight: 1.5 }}>
              These are *structural* differences (exposure, deprivation, access), not individual behavior.
            </div>
          </div>

          <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(124,58,237,0.08)', borderRadius: 8, border: '1px solid rgba(124,58,237,0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#b9a3ff', letterSpacing: '.08em' }}>
                POLICY SIMULATION
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#bbb' }}>
                <input type="checkbox" checked={policyOn} onChange={e => setPolicyOn(e.target.checked)} />
                Targeted PM2.5 cleanup
              </label>
            </div>

            <div style={{ fontSize: 11, color: '#777', marginBottom: 8, lineHeight: 1.5 }}>
              Applies an additional 20% PM2.5 reduction only in the highest-deprivation counties.
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#bbb' }}>
              <span>Gap before</span>
              <span style={{ fontFamily: "'DM Mono',monospace" }}>{policy.gap_before.toFixed(3)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#bbb', marginTop: 6 }}>
              <span>Gap after</span>
              <span style={{ fontFamily: "'DM Mono',monospace" }}>{policy.gap_after.toFixed(3)}</span>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: policy.delta < 0 ? '#34d399' : '#fca5a5' }}>
              Equity change: {policy.delta < 0 ? '' : '+'}{policy.delta.toFixed(3)} {policy.delta < 0 ? '(improves equity)' : '(worsens equity)'}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', marginBottom: 8, letterSpacing: '.08em' }}>
              TOP UNDER-RESOURCED COUNTIES
            </div>
            {(summary.top_underserved ?? []).slice(0, 8).map(c => (
              <div
                key={c.fips}
                className="county-row"
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect?.(c)}
                title="Click to select"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.county}, {c.state}
                  </div>
                  <div style={{ fontSize: 10, color: '#666', marginTop: 3, fontFamily: "'DM Mono',monospace" }}>
                    access {(Number(c.access) * 100).toFixed(0)}% · dep {(Number(c.deprivation) * 100).toFixed(0)}% · pm25 {(Number(c.pm25) * 100).toFixed(0)}%
                  </div>
                </div>
                <span className="risk-badge critical">Priority</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid #7c3aed' }}>
            <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#555', marginBottom: 6 }}>BIOETHICS NOTE</div>
            <div style={{ fontSize: 11, color: '#777', lineHeight: 1.6 }}>
              Risk and equity scores reflect structural conditions (exposure + access), not individual blame. This tool is intended to guide upstream interventions and resource allocation.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
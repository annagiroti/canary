import { scenarioScore } from '../lib/score.js'
import { riskLabel } from '../App.jsx'

export default function Tooltip({ hover, scenario, layer }) {
  if (!hover) return null

  const { props, point } = hover
  const isState = Boolean(props?.isState)

  // For states we don't compute a county score (optional: you could show avg_score if you attach it)
  const score = isState ? null : Math.min(1, Math.max(0, scenarioScore(props, scenario)))
  const rl = score === null ? null : riskLabel(score)

  // Drivers only make sense for counties
  const drivers = isState
    ? []
    : [
        { label: 'Pollution',  val: Number(props.pm25 ?? 0) },
        { label: 'Poverty',    val: Number(props.poverty ?? 0) },
        { label: 'Low Access', val: 1 - Number(props.access ?? 1) },
      ].sort((a, b) => b.val - a.val)

  // Cursor-follow positioning (clamped to viewport)
  const width = 240
  const height = isState ? 90 : 200
  const pad = 12

  const xRaw = point?.x ?? (window.innerWidth - width - 16)
  const yRaw = point?.y ?? (window.innerHeight - height - 16)

  const x = Math.max(16, Math.min(window.innerWidth - width - 16, xRaw + pad))
  const y = Math.max(16, Math.min(window.innerHeight - height - 16, yRaw + pad))

  const title = isState
    ? (props.county || props.NAME || 'State')
    : `${props.county || props.NAME || 'County'}${props.state ? `, ${props.state}` : ''}`

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        background: 'rgba(8,9,14,0.95)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        padding: '14px 18px',
        backdropFilter: 'blur(12px)',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
        {title}
      </div>

      {isState ? (
        <div style={{ fontSize: 11, color: '#888', fontFamily: "'DM Mono',monospace" }}>
          click to explore counties
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>
              {(score * 100).toFixed(1)}
            </span>
            <span className={`risk-badge ${rl.cls}`}>{rl.text}</span>
          </div>

          <div
            style={{
              fontSize: 10,
              color: '#555',
              marginBottom: 6,
              fontFamily: "'DM Mono',monospace",
              letterSpacing: '.08em',
            }}
          >
            TOP DRIVERS
          </div>

          {drivers.map(d => (
            <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#888', width: 76 }}>{d.label}</span>
              <div className="score-bar-bg" style={{ flex: 1 }}>
                <div className="score-bar-fill" style={{ width: `${d.val * 100}%`, background: '#7c3aed' }} />
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "'DM Mono',monospace",
                  color: '#666',
                  width: 30,
                  textAlign: 'right',
                }}
              >
                {(d.val * 100).toFixed(0)}%
              </span>
            </div>
          ))}

          {props.fips && (
            <div style={{ fontSize: 9, color: '#333', marginTop: 8, fontFamily: "'DM Mono',monospace" }}>
              FIPS {props.fips}
            </div>
          )}
        </>
      )}
    </div>
  )
}
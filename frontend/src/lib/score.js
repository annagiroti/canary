export function scenarioScore(props, scenario) {
  const base = Number(props.base ?? props.base_cancer ?? 0.3)

  const wPm25 = Number(props.w_pm25 ?? 0.18)
  const wDep  = Number(props.w_deprivation ?? props.w_poverty ?? 0.14)
  const wAcc  = Number(props.w_access ?? -0.20)

  const countyDep = Number(props.deprivation ?? props.poverty ?? 0.5)
  const countyAcc = Number(props.access ?? 0.6)

  const targetDep = (scenario.poverty ?? 0.5)  // slider name kept for compatibility
  const targetAcc = (scenario.access ?? 0.6)
  const dPm25     = (scenario.dPm25 ?? 0)

  const dDep = targetDep - countyDep
  const dAcc = targetAcc - countyAcc

  const raw = base + wPm25 * dPm25 + wDep * dDep + wAcc * dAcc

  // keep within 0..1 for consistent riskLabel + color ramps
  return Math.max(0, Math.min(1, raw))
}

export function riskFromScore(s) {
  if (s >= 0.75) return { text: 'Critical', cls: 'critical' }
  if (s >= 0.55) return { text: 'High',     cls: 'high' }
  if (s >= 0.35) return { text: 'Moderate', cls: 'moderate' }
  return { text: 'Low', cls: 'low' }
}
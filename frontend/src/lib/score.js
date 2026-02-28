export function scenarioScore(props, scenario) {
  const base    = Number(props.base    ?? props.base_cancer ?? 0)
  const wPm25   = Number(props.w_pm25   ?? 0.18)
  const wPov    = Number(props.w_poverty ?? 0.14)
  const wAcc    = Number(props.w_access  ?? -0.20)

  const dPoverty = (scenario.poverty ?? 0.5) - Number(props.poverty ?? 0.5)
  const dAccess  = (scenario.access  ?? 0.6) - Number(props.access  ?? 0.6)
  const dPm25    = scenario.dPm25 ?? 0

  return base + wPm25 * dPm25 + wPov * dPoverty + wAcc * dAccess
}

export function riskFromScore(s) {
  if (s >= 0.75) return { text: 'Critical', cls: 'critical' }
  if (s >= 0.55) return { text: 'High',     cls: 'high' }
  if (s >= 0.35) return { text: 'Moderate', cls: 'moderate' }
  return { text: 'Low', cls: 'low' }
}

export function calculateForecastMetric(metric, dueDateForRow, window, targetPercent) {
  const dueRows = metric.rows.map((row) => ({ row, due: dueDateForRow(row) }))
    .filter(({ due }) => due && due >= window.start && due <= window.end)
    .sort((left, right) => left.due - right.due);
  const atRisk = dueRows.filter(({ row }) => row._compliant).length;
  const dueNonCompliant = dueRows.length - atRisk;
  const baselineCount = Math.max(0, metric.compliant - atRisk);
  const targetCount = Math.ceil(metric.total * targetPercent / 100);
  const actionsRequired = Math.max(0, targetCount - baselineCount);
  const availableActions = dueRows.length;
  const actionsFromPeriod = Math.min(actionsRequired, availableActions);
  const outsidePeriodShortfall = Math.max(0, actionsRequired - availableActions);
  const allDueClosedCount = Math.min(metric.total, metric.compliant + dueNonCompliant);
  const nextPointTarget = Math.min(100, metric.compliantPercent + 1);
  const nextPointActions = Math.max(0, Math.ceil(metric.total * nextPointTarget / 100) - metric.compliant);
  return {
    dueRows,
    atRisk,
    dueNonCompliant,
    targetCount,
    actionsRequired,
    actionsFromPeriod,
    outsidePeriodShortfall,
    nextPointActions,
    noActionPercent: percentage(baselineCount, metric.total),
    allDueClosedPercent: percentage(allDueClosedCount, metric.total),
    targetPercent,
  };
}

export function mondayCheckpoints(now, count = 4) {
  const monday = startOfDay(now);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  return Array.from({ length: count }, (_, index) => {
    const result = new Date(monday);
    result.setDate(result.getDate() - (count - index - 1) * 7);
    return result;
  });
}

export function calculateArchivePoint(metric, checkpoint, compliantAt) {
  const compliantRows = metric.rows.filter((row) => compliantAt(row, checkpoint));
  return {
    compliant: compliantRows.length,
    nonCompliant: metric.total - compliantRows.length,
    percent: percentage(compliantRows.length, metric.total),
  };
}

function percentage(numerator, denominator) {
  return denominator ? numerator / denominator * 100 : 0;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

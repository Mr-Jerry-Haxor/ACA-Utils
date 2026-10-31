export function calculateForecastMetric(metric, dueDateForRow, window, targetPercent) {
  const asOf = window.asOf ?? window.start;
  const evaluatedRows = metric.rows.map((row) => {
    const due = dueDateForRow(row);
    const overdueNonCompliant = Boolean(due && window.includeOverdueNonCompliant && !row._compliant && due < asOf);
    return { row, due, overdueNonCompliant };
  });
  const pastDueRows = evaluatedRows.filter(({ row, due }) => due && !row._compliant && due < asOf)
    .map((item) => ({ ...item, overdueNonCompliant: true }))
    .sort((left, right) => left.due - right.due);
  const periodDueRows = evaluatedRows.filter(({ due }) => due && due >= window.start && due <= window.end)
    .sort((left, right) => left.due - right.due);
  const dueRows = evaluatedRows
    .filter(({ due, overdueNonCompliant }) => due && ((due >= window.start && due <= window.end) || overdueNonCompliant))
    .sort((left, right) => left.due - right.due);
  const atRisk = dueRows.filter(({ row }) => row._compliant).length;
  const dueNonCompliant = dueRows.length - atRisk;
  const overdueNonCompliant = dueRows.filter((item) => item.overdueNonCompliant).length;
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
    periodDueRows,
    pastDueRows,
    pastDueNonCompliant: pastDueRows.length,
    atRisk,
    dueNonCompliant,
    overdueNonCompliant,
    baselineCount,
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

export function calculateForecastTargets(metric, dueDateForRow, window, targets = [95, 96, 97, 98, 99, 100]) {
  const base = calculateForecastMetric(metric, dueDateForRow, window, targets[0] ?? 95);
  const actionsByTarget = Object.fromEntries(targets.map((target) => [
    target,
    Math.max(0, Math.ceil(metric.total * target / 100) - base.baselineCount),
  ]));
  return { ...base, targets: [...targets], actionsByTarget };
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

export function deriveArchiveStatus({ currentCompliant, dueDate = null, completionDate = null }, checkpoint) {
  const checkpointStart = startOfDay(checkpoint);
  const checkpointEnd = new Date(checkpointStart);
  checkpointEnd.setHours(23, 59, 59, 999);
  const due = dueDate ? startOfDay(dueDate) : null;
  const completion = completionDate ? startOfDay(completionDate) : null;
  if (completion && completion > checkpointEnd) return { compliant: false, reason: 'Completion occurred after checkpoint' };
  if (due && due < checkpointStart) return { compliant: false, reason: 'Due date had expired before checkpoint' };
  if (completion || due) return { compliant: true, reason: completion && due ? 'Completed and within due date at checkpoint' : completion ? 'Completed by checkpoint' : 'Due date remained current at checkpoint' };
  return { compliant: Boolean(currentCompliant), reason: 'No dated evidence available; current status used' };
}

export function annualCompletionFromDue(dueDate) {
  if (!dueDate) return null;
  const result = startOfDay(dueDate);
  result.setFullYear(result.getFullYear() - 1);
  return result;
}

export function annualDueFromCompletion(completionDate) {
  if (!completionDate) return null;
  const result = startOfDay(completionDate);
  result.setFullYear(result.getFullYear() + 1);
  return result;
}

export function recoveryOrientationDue(orientationDate, recoveryLevel) {
  if (!orientationDate) return null;
  const level = Number(String(recoveryLevel ?? '').match(/RL\s*(\d)/i)?.[1] ?? 0);
  if (level < 1 || level > 5) return null;
  const result = startOfDay(orientationDate);
  result.setDate(result.getDate() + (level <= 2 ? 365 : 180));
  return result;
}

function percentage(numerator, denominator) {
  return denominator ? numerator / denominator * 100 : 0;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

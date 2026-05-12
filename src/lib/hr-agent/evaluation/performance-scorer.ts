import type {
  HrPerformanceMetrics,
  HrPnlPoint,
} from "@/lib/hr-agent/models/agent-application";

function mean(values: number[]) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  const avg = mean(values);

  if (avg === null || values.length < 2) {
    return null;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function buildReturns(series: HrPnlPoint[]) {
  const returns: number[] = [];

  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1]?.value;
    const current = series[index]?.value;

    if (typeof previous === "number" && previous !== 0 && typeof current === "number") {
      returns.push((current - previous) / Math.abs(previous));
    }
  }

  return returns;
}

function calculateDrawdownStats(series: HrPnlPoint[]) {
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  const drawdowns: number[] = [];
  let currentDuration = 0;
  let longestDuration = 0;

  for (const point of series) {
    peak = Math.max(peak, point.value);

    if (peak > 0) {
      const drawdown = ((point.value - peak) / peak) * 100;
      maxDrawdown = Math.min(maxDrawdown, drawdown);

      if (drawdown < 0) {
        drawdowns.push(Math.abs(drawdown));
        currentDuration += 1;
        longestDuration = Math.max(longestDuration, currentDuration);
      } else {
        currentDuration = 0;
      }
    }
  }

  return {
    maxDrawdownPct: Number.isFinite(maxDrawdown) ? Math.abs(maxDrawdown) : null,
    averageDrawdownPct:
      drawdowns.length > 0
        ? Number((drawdowns.reduce((sum, value) => sum + value, 0) / drawdowns.length).toFixed(2))
        : null,
    drawdownDurationBars: longestDuration > 0 ? longestDuration : null,
  };
}

function calculateSharpe(returns: number[]) {
  const avg = mean(returns);
  const sd = standardDeviation(returns);

  if (avg === null || sd === null || sd === 0) {
    return null;
  }

  return (avg / sd) * Math.sqrt(252);
}

function calculateSortino(returns: number[]) {
  const avg = mean(returns);
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = standardDeviation(downside);

  if (avg === null || downsideDeviation === null || downsideDeviation === 0) {
    return null;
  }

  return (avg / downsideDeviation) * Math.sqrt(252);
}

function buildRollingReturns(returns: number[], windowSize: number) {
  if (returns.length < windowSize) {
    return [];
  }

  const aggregated: number[] = [];

  for (let index = windowSize - 1; index < returns.length; index += 1) {
    let total = 0;

    for (let offset = windowSize + -1; offset >= 0; offset -= 1) {
      total += returns[index - offset] ?? 0;
    }

    aggregated.push(total);
  }

  return aggregated;
}

function calculateCvar(returns: number[], alpha = 0.95) {
  if (returns.length === 0) {
    return null;
  }

  const sorted = [...returns].sort((left, right) => left - right);
  const tailCount = Math.max(1, Math.ceil((1 - alpha) * sorted.length));
  const tail = sorted.slice(0, tailCount);
  const average = mean(tail);

  return average === null ? null : average * 100;
}

function calculateNetReturn(series: HrPnlPoint[]) {
  if (series.length < 2) {
    return null;
  }

  const first = series[0]?.value;
  const last = series[series.length - 1]?.value;

  if (typeof first !== "number" || typeof last !== "number" || first === 0) {
    return null;
  }

  return ((last - first) / Math.abs(first)) * 100;
}

export function scoreAgentPerformance({
  pnlSeries,
  totalSignalsGenerated,
  winningSignals,
  correlationWithExistingAgents,
  correlationWithSp500,
  correlationWithRates,
  correlationWithVol,
  grossExposures,
  turnovers,
  transactionCostDragPct,
  netReturnPct,
}: {
  pnlSeries: HrPnlPoint[];
  totalSignalsGenerated: number;
  winningSignals: number;
  correlationWithExistingAgents: number | null;
  correlationWithSp500?: number | null;
  correlationWithRates?: number | null;
  correlationWithVol?: number | null;
  grossExposures?: number[];
  turnovers?: number[];
  transactionCostDragPct?: number | null;
  netReturnPct?: number | null;
}): HrPerformanceMetrics {
  const returns = buildReturns(pnlSeries);
  const sharpeRatio = calculateSharpe(returns);
  const sortinoRatio = calculateSortino(returns);
  const drawdownStats = calculateDrawdownStats(pnlSeries);
  const weeklyReturns = buildRollingReturns(returns, 5);
  const dailyVolatility = standardDeviation(returns);
  const weeklyVolatility = standardDeviation(weeklyReturns);
  const worstDay = returns.length > 0 ? Math.min(...returns) * 100 : null;
  const worstWeek = weeklyReturns.length > 0 ? Math.min(...weeklyReturns) * 100 : null;
  const averageGrossExposure = mean(grossExposures ?? []);
  const peakGrossExposure =
    grossExposures && grossExposures.length > 0 ? Math.max(...grossExposures) : null;
  const averageTurnover = mean(turnovers ?? []);
  const derivedNetReturn = calculateNetReturn(pnlSeries);

  return {
    sharpeRatio: sharpeRatio === null ? null : Number(sharpeRatio.toFixed(2)),
    sortinoRatio: sortinoRatio === null ? null : Number(sortinoRatio.toFixed(2)),
    maxDrawdownPct: drawdownStats.maxDrawdownPct,
    averageDrawdownPct: drawdownStats.averageDrawdownPct,
    drawdownDurationBars: drawdownStats.drawdownDurationBars,
    winRatePct:
      totalSignalsGenerated > 0
        ? Number(((winningSignals / totalSignalsGenerated) * 100).toFixed(1))
        : null,
    totalSignalsGenerated,
    correlationWithExistingAgents,
    correlationWithSp500:
      typeof correlationWithSp500 === "number" ? Number(correlationWithSp500.toFixed(2)) : null,
    correlationWithRates:
      typeof correlationWithRates === "number" ? Number(correlationWithRates.toFixed(2)) : null,
    correlationWithVol:
      typeof correlationWithVol === "number" ? Number(correlationWithVol.toFixed(2)) : null,
    dailyVolatilityPct:
      dailyVolatility === null ? null : Number((dailyVolatility * 100).toFixed(2)),
    weeklyVolatilityPct:
      weeklyVolatility === null ? null : Number((weeklyVolatility * 100).toFixed(2)),
    cvar95Pct: calculateCvar(returns) === null ? null : Number(calculateCvar(returns)!.toFixed(2)),
    worstDayPct: worstDay === null ? null : Number(worstDay.toFixed(2)),
    worstWeekPct: worstWeek === null ? null : Number(worstWeek.toFixed(2)),
    averageGrossExposurePct:
      averageGrossExposure === null ? null : Number((averageGrossExposure * 100).toFixed(2)),
    peakGrossExposurePct:
      peakGrossExposure === null ? null : Number((peakGrossExposure * 100).toFixed(2)),
    concentrationRiskPct:
      peakGrossExposure === null ? null : Number((peakGrossExposure * 100).toFixed(2)),
    turnoverPct:
      averageTurnover === null ? null : Number((averageTurnover * 100).toFixed(2)),
    transactionCostDragPct:
      typeof transactionCostDragPct === "number"
        ? Number(transactionCostDragPct.toFixed(2))
        : null,
    netReturnPct:
      typeof netReturnPct === "number"
        ? Number(netReturnPct.toFixed(2))
        : derivedNetReturn === null
          ? null
          : Number(derivedNetReturn.toFixed(2)),
    pnlSeries,
  };
}

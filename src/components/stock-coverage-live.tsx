"use client";

import Link from "next/link";
import { startTransition, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  StockCoverageChartRange,
  StockCoverageChartPoint,
  StockCoverageDebateMessage,
  StockCoverageForecast,
  StockCoverageLiveData,
  StockCoveragePageData,
  StockResearchAgent,
  StockResearchArticle,
} from "@/lib/stocks/types";
import { CharacterTextReveal } from "@/components/character-text-reveal";

const REFRESH_INTERVAL_MS = 60_000;
const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const STOCK_CHART_HEIGHT = 280;
const STOCK_Y_AXIS_WIDTH = 84;
const STOCK_CHART_RANGES: StockCoverageChartRange[] = ["1D", "1M", "1Y"];
const RESEARCH_ARCHIVE_PAGE_SIZE = 4;

type StockChartRow = {
  timestamp: string;
  price: number;
  time: string;
};

type ChartCoordinate = {
  x: number;
  y: number;
};

type DragSelection = {
  startIndex: number;
  endIndex: number;
  startCoordinate: ChartCoordinate | null;
  endCoordinate: ChartCoordinate | null;
};

type RechartsMouseState = {
  activeTooltipIndex?: number | string | null;
  activeCoordinate?: {
    x?: number;
    y?: number;
  } | null;
} | null;

type SectionTheme = "light" | "dark";
function formatUsd(
  value: number | null,
  options?: {
    maximumFractionDigits?: number;
    signDisplay?: Intl.NumberFormatOptions["signDisplay"];
  }
) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    signDisplay: options?.signDisplay,
  }).format(value);
}

function formatPct(value: number | null, signDisplay: "always" | "auto" = "auto") {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 2,
    signDisplay,
  }).format(value / 100);
}

function parseDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
}

function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(parseDateValue(value));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatSignedUsd(value: number | null, maximumFractionDigits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
    signDisplay: "always",
  }).format(value);
}

function formatSignedPercent(value: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%`;
}

function formatPacificTimeLabel(value: string, rangeLabel: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    ...(rangeLabel === "1D"
      ? {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }
      : {
          month: "short",
          day: "numeric",
        }),
  }).format(new Date(value));
}

function formatPacificLatestLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function getActiveIndex(state: RechartsMouseState) {
  if (!state) {
    return null;
  }

  if (
    typeof state.activeTooltipIndex === "number" &&
    Number.isFinite(state.activeTooltipIndex)
  ) {
    return state.activeTooltipIndex;
  }

  if (
    typeof state.activeTooltipIndex === "string" &&
    state.activeTooltipIndex.trim().length > 0
  ) {
    const parsed = Number(state.activeTooltipIndex);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getActiveCoordinate(state: RechartsMouseState): ChartCoordinate | null {
  if (!state?.activeCoordinate) {
    return null;
  }

  const { x, y } = state.activeCoordinate;

  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }

  return { x, y };
}

function getStockYAxisDomain(data: Array<{ price: number }>) {
  const values = data.map((point) => point.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.12, max * 0.0035, 0.5);

  return [Math.max(0, min - pad), max + pad] as [number, number];
}

function buildEmptyStockChart(rangeLabel: StockCoverageChartRange) {
  return {
    rangeLabel,
    trend: "flat" as const,
    points: [],
    note: null,
  };
}

function getNormalizedCharts(liveData: StockCoverageLiveData) {
  const payload = liveData as StockCoverageLiveData & {
    chart?: {
      rangeLabel?: StockCoverageChartRange;
      trend?: "up" | "down" | "flat";
      points?: Array<{ timestamp: string; price: number }>;
      note?: string | null;
    };
    charts?: Partial<
      Record<
        StockCoverageChartRange,
        {
          rangeLabel?: StockCoverageChartRange;
          trend?: "up" | "down" | "flat";
          points?: Array<{ timestamp: string; price: number }>;
          note?: string | null;
        }
      >
    >;
  };
  const legacyChart = payload.chart;
  const chartMap = payload.charts;
  const firstAvailableChart =
    chartMap?.["1D"] ??
    chartMap?.["1M"] ??
    chartMap?.["1Y"] ??
    legacyChart ??
    null;

  return {
    "1D": {
      ...buildEmptyStockChart("1D"),
      ...(chartMap?.["1D"] ?? firstAvailableChart),
      rangeLabel: "1D" as const,
    },
    "1M": {
      ...buildEmptyStockChart("1M"),
      ...(chartMap?.["1M"] ?? firstAvailableChart),
      rangeLabel: "1M" as const,
    },
    "1Y": {
      ...buildEmptyStockChart("1Y"),
      ...(chartMap?.["1Y"] ?? firstAvailableChart),
      rangeLabel: "1Y" as const,
    },
  };
}

function StockHistoryTooltip({
  active,
  payload,
  rangeLabel,
}: {
  active?: boolean;
  payload?: Array<{
    value?: number | string;
    payload?: {
      timestamp: string;
      time: string;
      price: number;
    };
  }>;
  rangeLabel: string;
}) {
  const point = payload?.[0]?.payload;
  const rawValue = payload?.[0]?.value;
  const value =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string"
        ? Number(rawValue)
        : null;

  if (!active || !point || typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return (
    <div
      className="rounded border border-black/10 bg-white px-3 py-2 text-xs text-black shadow-sm"
      style={{ pointerEvents: "none" }}
    >
      <div className="mb-2 text-[10px] uppercase tracking-[0.08em] text-black/45">
        {rangeLabel === "1D" ? `${point.time} PT` : point.time}
      </div>
      <div className="text-black">{formatUsd(value)}</div>
    </div>
  );
}

export function StockPriceChart({
  liveData,
  liveError,
}: {
  liveData: StockCoverageLiveData;
  liveError: string | null;
}) {
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const [selectedRange, setSelectedRange] = useState<StockCoverageChartRange>("1D");
  const [hoveredRange, setHoveredRange] = useState<StockCoverageChartRange | null>(null);
  const [selection, setSelection] = useState<DragSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [chartWidth, setChartWidth] = useState(0);
  const normalizedCharts = useMemo(() => getNormalizedCharts(liveData), [liveData]);
  const selectedChart = normalizedCharts[selectedRange] ?? normalizedCharts["1D"];
  const chartRows = useMemo(
    () =>
      selectedChart.points.map((point) => ({
        timestamp: point.timestamp,
        price: point.price,
        time: formatPacificTimeLabel(point.timestamp, selectedChart.rangeLabel),
      })) satisfies StockChartRow[],
    [selectedChart.points, selectedChart.rangeLabel]
  );

  const yAxisDomain = useMemo<[number, number]>(
    () => (chartRows.length > 0 ? getStockYAxisDomain(chartRows) : [0, 1]),
    [chartRows]
  );
  const latestChange = liveData.quote.change;
  const latestChangePct = formatSignedPercent(liveData.quote.changePct);
  const stroke =
    latestChange === null
      ? "#10b981"
      : latestChange < 0
        ? "#ef4444"
        : "#10b981";
  const resetDragSelection = () => {
    setSelection(null);
    setIsDragging(false);
  };

  useEffect(() => {
    const frame = chartFrameRef.current;

    if (!frame) {
      return;
    }

    const syncWidth = () => {
      setChartWidth(frame.clientWidth);
    };

    syncWidth();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry) {
        setChartWidth(entry.contentRect.width);
      }
    });

    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, []);

  const handleMouseDown = (state: RechartsMouseState) => {
    const index = getActiveIndex(state);

    if (index === null) {
      return;
    }

    const coordinate = getActiveCoordinate(state);
    setIsDragging(true);
    setSelection({
      startIndex: index,
      endIndex: index,
      startCoordinate: coordinate,
      endCoordinate: coordinate,
    });
  };

  const handleMouseMove = (state: RechartsMouseState) => {
    if (!isDragging) {
      return;
    }

    const index = getActiveIndex(state);

    if (index === null) {
      return;
    }

    const coordinate = getActiveCoordinate(state);
    setSelection((previous) =>
      previous
        ? {
            startIndex: previous.startIndex,
            endIndex: index,
            startCoordinate: previous.startCoordinate,
            endCoordinate: coordinate,
          }
        : previous
    );
  };

  const handleMouseUp = () => {
    if (!isDragging) {
      return;
    }

    resetDragSelection();
  };

  const selectedStart =
    selection && chartRows[Math.min(selection.startIndex, selection.endIndex)];
  const selectedEnd =
    selection && chartRows[Math.max(selection.startIndex, selection.endIndex)];
  const hasSelectionRange =
    !!selection &&
    selection.startIndex !== selection.endIndex &&
    !!selectedStart &&
    !!selectedEnd;
  const hasActiveSelection = isDragging && hasSelectionRange;
  const deltaValue =
    hasSelectionRange && selectedStart && selectedEnd
      ? selectedEnd.price - selectedStart.price
      : null;
  const deltaPct =
    hasSelectionRange && selectedStart && selectedEnd && selectedStart.price !== 0
      ? ((selectedEnd.price - selectedStart.price) / Math.abs(selectedStart.price)) * 100
      : null;
  const selectionAnchorX =
    selection?.startCoordinate && selection?.endCoordinate
      ? (selection.startCoordinate.x + selection.endCoordinate.x) / 2
      : selection?.endCoordinate?.x ?? selection?.startCoordinate?.x ?? null;
  const selectionCardWidth = 236;
  const selectionCardPadding = 16;
  const selectionCardLeft =
    selectionAnchorX !== null && chartWidth > 0
      ? Math.min(
          Math.max(selectionAnchorX, selectionCardWidth / 2 + selectionCardPadding),
          Math.max(
            selectionCardWidth / 2 + selectionCardPadding,
            chartWidth - selectionCardWidth / 2 - selectionCardPadding
          )
        )
      : null;
  const suppressHoverState = isDragging;
  const hasChartDimensions = chartWidth > 0;

  return (
    <div className="w-full px-2 py-1 text-black lg:px-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="tabular-nums text-[clamp(2.25rem,3.35vw,3.1rem)] font-semibold tracking-[-0.04em] text-black">
            {formatUsd(liveData.quote.price)}
          </span>
          {typeof latestChange === "number" ? (
            <span
              className={`tabular-nums text-[clamp(1.25rem,1.8vw,1.45rem)] font-medium tracking-[-0.03em] ${
                latestChange < 0 ? "text-red-500" : "text-emerald-600"
              }`}
            >
              {formatSignedUsd(latestChange)}
              {latestChangePct ? <span className="ml-1">({latestChangePct})</span> : null}
            </span>
          ) : null}
          <span className="text-[10px] uppercase tracking-[0.08em] text-black/40">
            latest {formatPacificLatestLabel(liveData.quote.updatedAt)} PT
          </span>
        </div>

        <div className="flex items-center gap-1 self-center">
          {STOCK_CHART_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => {
                resetDragSelection();
                setSelectedRange(range);
              }}
              onMouseEnter={() => setHoveredRange(range)}
              onMouseLeave={() => setHoveredRange((current) => (current === range ? null : current))}
              onFocus={() => setHoveredRange(range)}
              onBlur={() => setHoveredRange((current) => (current === range ? null : current))}
              className="rounded px-2.5 py-1 text-[11px] transition-colors"
              style={{
                backgroundColor:
                  selectedRange === range || hoveredRange === range ? "#f3f3f3" : "transparent",
                color: selectedRange === range ? "#0d0d0d" : "rgba(0, 0, 0, 0.52)",
              }}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {chartRows.length === 0 ? (
        <div
          className="flex items-center justify-center py-16 text-sm text-black/58"
          style={{ height: STOCK_CHART_HEIGHT }}
        >
          {selectedChart.note ?? "No recent price history is available yet."}
        </div>
      ) : (
        <div
          ref={chartFrameRef}
          className="relative w-full min-w-0 select-none overflow-hidden"
          style={{ WebkitUserSelect: "none", height: STOCK_CHART_HEIGHT }}
          onMouseDownCapture={(event) => {
            event.preventDefault();
          }}
          onDragStartCapture={(event) => {
            event.preventDefault();
          }}
        >
          {hasChartDimensions ? (
            <LineChart
              width={chartWidth}
              height={STOCK_CHART_HEIGHT}
              data={chartRows}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ cursor: isDragging ? "ew-resize" : "crosshair" }}
            >
              <defs>
                <linearGradient id="stockHistoryFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              {hasActiveSelection && selectedStart && selectedEnd ? (
                <ReferenceArea
                  x1={selectedStart.timestamp}
                  x2={selectedEnd.timestamp}
                  strokeOpacity={0}
                  fill={stroke}
                  fillOpacity={0.08}
                />
              ) : null}
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(128,128,128,0.22)"
                vertical={false}
              />
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 10, fill: "rgba(0,0,0,0.42)" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(0,0,0,0.12)" }}
                minTickGap={28}
                tickFormatter={(value) =>
                  formatPacificTimeLabel(String(value), selectedChart.rangeLabel)
                }
              />
              <YAxis
                domain={yAxisDomain}
                tick={{ fontSize: 10, fill: "rgba(0,0,0,0.42)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatUsd(value, { maximumFractionDigits: 2 })}
                width={STOCK_Y_AXIS_WIDTH}
              />
              <Tooltip
                cursor={false}
                content={<StockHistoryTooltip rangeLabel={selectedChart.rangeLabel} />}
                wrapperStyle={{
                  display: suppressHoverState ? "none" : undefined,
                  pointerEvents: "none",
                }}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke="transparent"
                fill="url(#stockHistoryFill)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke={stroke}
                strokeWidth={2}
                dot={false}
                activeDot={suppressHoverState ? false : { r: 4, fill: stroke }}
                isAnimationActive={false}
              />
              {hasActiveSelection && selectedStart && selectedEnd ? (
                <>
                  <ReferenceLine
                    x={selectedStart.timestamp}
                    stroke={stroke}
                    strokeDasharray="3 3"
                    strokeOpacity={0.55}
                  />
                  <ReferenceLine
                    x={selectedEnd.timestamp}
                    stroke={stroke}
                    strokeDasharray="3 3"
                    strokeOpacity={0.55}
                  />
                  <ReferenceDot
                    x={selectedStart.timestamp}
                    y={selectedStart.price}
                    r={4}
                    fill={stroke}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                  <ReferenceDot
                    x={selectedEnd.timestamp}
                    y={selectedEnd.price}
                    r={4}
                    fill={stroke}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                </>
              ) : null}
            </LineChart>
          ) : null}

          <div className="pointer-events-none absolute inset-0 z-20">
            {hasActiveSelection &&
            selectedStart &&
            selectedEnd &&
            deltaValue !== null &&
            selectionCardLeft !== null ? (
              <div
                className="absolute top-3 w-[236px] max-w-[calc(100%-24px)] -translate-x-1/2 rounded border border-black/10 bg-white/95 px-3 py-2 shadow-[0_10px_26px_rgba(15,23,42,0.12)] backdrop-blur"
                style={{ left: `${selectionCardLeft}px` }}
              >
                <div className="text-[10px] uppercase tracking-[0.08em] text-black/45">
                  {selectedStart.time}
                  {" \u2192 "}
                  {selectedEnd.time}
                </div>
                <div
                  className={`tabular-nums mt-1 text-[1rem] font-medium ${
                    deltaValue > 0
                      ? "text-emerald-600"
                      : deltaValue < 0
                        ? "text-red-500"
                        : "text-black"
                  }`}
                >
                  Δ {formatSignedUsd(deltaValue)}
                  {deltaPct !== null ? <span className="ml-1">({formatSignedPercent(deltaPct)})</span> : null}
                </div>
                <div className="tabular-nums mt-1 text-[11px] text-black/52">
                  {formatUsd(selectedStart.price)} {" \u2192 "} {formatUsd(selectedEnd.price)}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {liveData.quote.note && chartRows.length > 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-black/58">{liveData.quote.note}</p>
      ) : null}

      {liveError ? <p className="mt-4 text-sm text-red-500">{liveError}</p> : null}

      {selectedChart.note && chartRows.length > 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-black/58">{selectedChart.note}</p>
      ) : null}
    </div>
  );
}

function messageToneClass(
  message: StockCoverageDebateMessage,
  theme: SectionTheme = "light"
) {
  if (theme === "dark") {
    return "text-white";
  }

  if (message.renderType === "action") {
    return "text-emerald-700";
  }

  if (message.renderType === "alert" || message.priority === "CRITICAL") {
    return "text-amber-800";
  }

  if (message.messageType === "SIGNAL") {
    return "text-blue-700";
  }

  return "text-black/56";
}

function avatarColor(senderId: string) {
  const palette = [
    "bg-[#0f172a]",
    "bg-[#1d4ed8]",
    "bg-[#0f766e]",
    "bg-[#7c2d12]",
    "bg-[#4c1d95]",
    "bg-[#14532d]",
  ];
  let hash = 0;

  for (let index = 0; index < senderId.length; index += 1) {
    hash = (hash * 33 + senderId.charCodeAt(index)) >>> 0;
  }

  return palette[hash % palette.length];
}

function initials(message: StockCoverageDebateMessage) {
  return message.senderName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function researchAgentSlug(agent: StockResearchAgent) {
  return (
    agent.slug ??
    agent.handle
      .replace(/^PC-/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

function researchAgentCardDescription(agent: StockResearchAgent) {
  const text = agent.summary.trim();

  if (text.length <= 112) {
    return text;
  }

  return `${text.slice(0, 109).replace(/\s+\S*$/, "")}...`;
}

function StatBlock({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-t border-black/10 pt-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/42">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-black">{value}</p>
      <p className="mt-2 text-sm leading-relaxed text-black/58">{detail}</p>
    </div>
  );
}

function getScenarioUpside(targetPrice: number, currentPrice: number | null) {
  if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return null;
  }

  return ((targetPrice - currentPrice) / currentPrice) * 100;
}

function buildSvgLinePath(points: ChartCoordinate[]) {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function buildSvgAreaPath(points: ChartCoordinate[], baselineY: number) {
  if (points.length === 0) {
    return "";
  }

  const linePath = buildSvgLinePath(points);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return `${linePath} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`;
}

function ForecastConeChart({
  forecast,
  currentPrice,
  historyPoints,
  theme = "light",
}: {
  forecast: StockCoverageForecast;
  currentPrice: number | null;
  historyPoints: StockCoverageChartPoint[];
  theme?: SectionTheme;
}) {
  const chartId = useId().replace(/:/g, "");
  const isDark = theme === "dark";
  const chartCurrent =
    typeof currentPrice === "number" && Number.isFinite(currentPrice) && currentPrice > 0
      ? currentPrice
      : historyPoints[historyPoints.length - 1]?.price ?? forecast.baseline.targetPrice;

  const prices = [
    chartCurrent,
    forecast.bear.targetPrice,
    forecast.baseline.targetPrice,
    forecast.bull.targetPrice,
    ...historyPoints.map((point) => point.price),
  ];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pad = Math.max((maxPrice - minPrice) * 0.16, maxPrice * 0.05, 10);
  const domainMin = Math.max(0, minPrice - pad);
  const domainMax = maxPrice + pad;
  const width = 760;
  const height = 390;
  const top = 28;
  const bottom = 44;
  const left = 74;
  const right = 124;
  const historyLeftX = left;
  const nowX = 434;
  const futureX = width - right;
  const chartBottom = height - bottom;

  const yForPrice = (value: number) =>
    top + ((domainMax - value) / (domainMax - domainMin || 1)) * (height - top - bottom);

  const historyCoordinates =
    historyPoints.length > 0
      ? historyPoints.map((point, index) => ({
          x:
            historyLeftX +
            (index / Math.max(historyPoints.length - 1, 1)) * (nowX - historyLeftX),
          y: yForPrice(point.price),
        }))
      : [{ x: historyLeftX, y: yForPrice(chartCurrent) }, { x: nowX, y: yForPrice(chartCurrent) }];
  const historyPath = buildSvgLinePath(historyCoordinates);
  const historyAreaPath = buildSvgAreaPath(historyCoordinates, chartBottom);

  const currentY = yForPrice(chartCurrent);
  const bearY = yForPrice(forecast.bear.targetPrice);
  const baseY = yForPrice(forecast.baseline.targetPrice);
  const bullY = yForPrice(forecast.bull.targetPrice);
  const innerBullPrice =
    forecast.baseline.targetPrice +
    (forecast.bull.targetPrice - forecast.baseline.targetPrice) * 0.58;
  const innerBearPrice =
    forecast.baseline.targetPrice -
    (forecast.baseline.targetPrice - forecast.bear.targetPrice) * 0.58;
  const innerBullY = yForPrice(innerBullPrice);
  const innerBearY = yForPrice(innerBearPrice);
  const currentUpside = getScenarioUpside(forecast.baseline.targetPrice, chartCurrent);
  const gridValues = [
    forecast.bull.targetPrice,
    forecast.baseline.targetPrice,
    chartCurrent,
    forecast.bear.targetPrice,
  ];
  const gridLabelSet = new Set<number>();
  const axisStartLabel =
    historyPoints[0]?.timestamp
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          year: "2-digit",
        }).format(new Date(historyPoints[0].timestamp))
      : "Start";
  const historyMidIndex =
    historyPoints.length > 2 ? Math.floor((historyPoints.length - 1) / 2) : null;
  const axisMidLabel =
    historyMidIndex !== null
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          year: "2-digit",
        }).format(new Date(historyPoints[historyMidIndex].timestamp))
      : null;
  const historyMidX =
    historyMidIndex !== null
      ? historyCoordinates[historyMidIndex]?.x ?? (historyLeftX + nowX) / 2
      : null;
  const historyStroke = "#5aa08f";
  const baseStroke = "#2b6b66";
  const bullStroke = "#5aa08f";
  const bearStroke = "#c79f72";
  const currentStroke = "#d07c1f";
  const labelTone = isDark ? "text-white" : "text-black/42";
  const headingTone = isDark ? "text-white" : "text-black";
  const bodyTone = isDark ? "text-white" : "text-black/62";
  const legendTone = isDark ? "text-white" : "text-black/56";
  const gridStroke = isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.08)";
  const axisTextFill = isDark ? "#FFFFFF" : "rgba(0,0,0,0.42)";
  const axisTextStrongFill = isDark ? "#FFFFFF" : "rgba(0,0,0,0.52)";
  const futureLineStroke = isDark ? "rgba(255,255,255,0.18)" : "rgba(15,23,42,0.12)";
  const historyAreaTop = isDark ? "rgba(90,160,143,0.22)" : "rgba(90,160,143,0.28)";
  const historyAreaBottom = isDark ? "rgba(90,160,143,0.03)" : "rgba(90,160,143,0.04)";
  const forecastConeStart = isDark ? "rgba(90,160,143,0.16)" : "rgba(90,160,143,0.12)";
  const forecastConeEnd = isDark ? "rgba(90,160,143,0.4)" : "rgba(90,160,143,0.34)";
  const forecastCoreStart = isDark ? "rgba(43,107,102,0.14)" : "rgba(43,107,102,0.08)";
  const forecastCoreEnd = isDark ? "rgba(43,107,102,0.24)" : "rgba(43,107,102,0.18)";
  const shadowColor = isDark ? "rgba(0,0,0,0.28)" : "rgba(15,23,42,0.14)";

  return (
    <div className="p-1">
      <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${labelTone}`}>
        Scenario Range
      </p>
      <h3 className={`mt-3 text-[1.18rem] font-semibold tracking-[-0.03em] ${headingTone}`}>
        Price history with 12-month forecast fan
      </h3>
      <p className={`mt-2 max-w-3xl text-sm leading-relaxed ${bodyTone}`}>
        Historical price context appears on the left, followed by the baseline, bull, and bear range
        over the next {forecast.horizonLabel.toLowerCase()}.
      </p>

      <div className="mt-5">
        <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] ${legendTone}`}>
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#5aa08f]" />
            Historical price
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#2b6b66]" />
            Baseline projection
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#c79f72]" />
            Bull / bear range
          </div>
        </div>

        <svg
          className="mt-6 h-auto w-full"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Historical stock price with 12-month baseline, bull, and bear forecast range"
        >
          <defs>
            <linearGradient id={`history-area-${chartId}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={historyAreaTop} />
              <stop offset="100%" stopColor={historyAreaBottom} />
            </linearGradient>
            <linearGradient id={`forecast-cone-${chartId}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={forecastConeStart} />
              <stop offset="100%" stopColor={forecastConeEnd} />
            </linearGradient>
            <linearGradient id={`forecast-core-${chartId}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={forecastCoreStart} />
              <stop offset="100%" stopColor={forecastCoreEnd} />
            </linearGradient>
            <filter id={`point-glow-${chartId}`} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor={shadowColor} />
            </filter>
          </defs>

          <rect x={0} y={0} width={width} height={height} fill="transparent" />

          {gridValues.map((value) => {
            const rounded = Math.round(value * 100) / 100;
            if (gridLabelSet.has(rounded)) {
              return null;
            }

            gridLabelSet.add(rounded);
            const y = yForPrice(value);

            return (
              <g key={value}>
                <line
                  x1={historyLeftX}
                  x2={futureX}
                  y1={y}
                  y2={y}
                  stroke={gridStroke}
                  strokeDasharray={rounded === Math.round(chartCurrent * 100) / 100 ? "0" : "4 6"}
                />
                <text
                  x={left - 12}
                  y={y + 4}
                  fill={axisTextFill}
                  fontSize="11"
                  textAnchor="end"
                >
                  {formatUsd(value, { maximumFractionDigits: 0 })}
                </text>
              </g>
            );
          })}

          <line
            x1={nowX}
            x2={nowX}
            y1={top}
            y2={chartBottom}
            stroke="rgba(208,124,31,0.28)"
            strokeWidth="2.5"
          />
          <line
            x1={futureX}
            x2={futureX}
            y1={top}
            y2={chartBottom}
            stroke={futureLineStroke}
            strokeWidth="1.5"
          />

          {historyAreaPath ? (
            <path d={historyAreaPath} fill={`url(#history-area-${chartId})`} />
          ) : null}
          <path
            d={historyPath}
            fill="none"
            stroke={historyStroke}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          <polygon
            fill={`url(#forecast-cone-${chartId})`}
            points={`${nowX},${currentY} ${futureX},${bullY} ${futureX},${bearY}`}
          />
          <polygon
            fill={`url(#forecast-core-${chartId})`}
            points={`${nowX},${currentY} ${futureX},${innerBullY} ${futureX},${innerBearY}`}
          />
          <line
            x1={nowX}
            x2={futureX}
            y1={currentY}
            y2={bullY}
            stroke="rgba(90,160,143,0.24)"
            strokeWidth="1.5"
          />
          <line
            x1={nowX}
            x2={futureX}
            y1={currentY}
            y2={bearY}
            stroke="rgba(199,159,114,0.24)"
            strokeWidth="1.5"
          />
          <line
            x1={nowX}
            x2={futureX}
            y1={currentY}
            y2={baseY}
            stroke={baseStroke}
            strokeWidth="3"
          />
          <text
            x={historyLeftX}
            y={top - 10}
            fill={axisTextFill}
            fontSize="11"
            fontWeight="600"
            letterSpacing="0.08em"
          >
            PRICE HISTORY
          </text>
          <text
            x={nowX + 12}
            y={top - 10}
            fill={axisTextFill}
            fontSize="11"
            fontWeight="600"
            letterSpacing="0.08em"
          >
            FORECAST
          </text>
          <circle
            cx={nowX}
            cy={currentY}
            fill={currentStroke}
            r="7.5"
            stroke="#ffffff"
            strokeWidth="3"
            filter={`url(#point-glow-${chartId})`}
          />
          <circle
            cx={futureX}
            cy={baseY}
            fill={baseStroke}
            r="7"
            stroke="#ffffff"
            strokeWidth="3"
            filter={`url(#point-glow-${chartId})`}
          />
          <circle cx={futureX} cy={bullY} fill={bullStroke} r="5.5" stroke="#ffffff" strokeWidth="2.5" />
          <circle cx={futureX} cy={bearY} fill={bearStroke} r="5.5" stroke="#ffffff" strokeWidth="2.5" />

          <text
            x={historyLeftX}
            y={height - 8}
            fill={axisTextFill}
            fontSize="11"
            textAnchor="start"
          >
            {axisStartLabel}
          </text>
          {axisMidLabel && historyMidX !== null ? (
            <text
              x={historyMidX}
              y={height - 8}
              fill={axisTextFill}
              fontSize="11"
              textAnchor="middle"
            >
              {axisMidLabel}
            </text>
          ) : null}
          <text x={nowX} y={height - 8} fill={axisTextStrongFill} fontSize="11" textAnchor="middle">
            Latest
          </text>
          <text
            x={futureX}
            y={height - 8}
            fill={axisTextStrongFill}
            fontSize="11"
            textAnchor="middle"
          >
            {forecast.horizonLabel}
          </text>

          <text
            x={nowX + 16}
            y={currentY - 14}
            fill={isDark ? "#FFFFFF" : currentStroke}
            fontSize="13"
            fontWeight="600"
          >
            {formatUsd(chartCurrent)}
          </text>
          <text
            x={futureX + 18}
            y={bullY + 4}
            fill={isDark ? "#FFFFFF" : bullStroke}
            fontSize="13"
            fontWeight="600"
          >
            Bull {formatUsd(forecast.bull.targetPrice, { maximumFractionDigits: 0 })}
          </text>
          <text
            x={futureX + 18}
            y={baseY + 4}
            fill={isDark ? "#FFFFFF" : baseStroke}
            fontSize="13"
            fontWeight="600"
          >
            Base {formatUsd(forecast.baseline.targetPrice, { maximumFractionDigits: 0 })}
          </text>
          <text
            x={futureX + 18}
            y={bearY + 4}
            fill={isDark ? "#FFFFFF" : bearStroke}
            fontSize="13"
            fontWeight="600"
          >
            Bear {formatUsd(forecast.bear.targetPrice, { maximumFractionDigits: 0 })}
          </text>
          {currentUpside !== null ? (
            <text
              x={futureX + 18}
              y={baseY + 26}
              fill={isDark ? "#FFFFFF" : "rgba(43,107,102,0.68)"}
              fontSize="11"
              fontWeight="500"
            >
              {formatPct(currentUpside, "always")} vs latest
            </text>
          ) : null}
        </svg>
      </div>
    </div>
  );
}

function ForecastOutlook({
  forecast,
  currentPrice,
  historyPoints,
  theme = "light",
}: {
  forecast: StockCoverageForecast;
  currentPrice: number | null;
  historyPoints: StockCoverageChartPoint[];
  theme?: SectionTheme;
}) {
  const isDark = theme === "dark";
  const baseUpside = getScenarioUpside(forecast.baseline.targetPrice, currentPrice);
  const bullUpside = getScenarioUpside(forecast.bull.targetPrice, currentPrice);
  const bearUpside = getScenarioUpside(forecast.bear.targetPrice, currentPrice);
  const bodyTone = isDark ? "text-white" : "text-black/66";
  const emphasisTone = isDark ? "text-white" : "text-black";

  return (
    <section>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(22rem,1.12fr)] lg:items-start lg:gap-16">
        <div>
          <div className={`max-w-3xl space-y-6 text-[1.02rem] leading-[1.92] ${bodyTone}`}>
            <p>{forecast.summary}</p>
            <p>
              <span className={`font-semibold ${emphasisTone}`}>
                Base case {formatUsd(forecast.baseline.targetPrice, { maximumFractionDigits: 0 })}
                {baseUpside === null ? "" : ` (${formatPct(baseUpside, "always")})`}:
              </span>{" "}
              {forecast.baseline.expectation}. {forecast.baseline.summary}
            </p>
            <p>
              <span className={`font-semibold ${emphasisTone}`}>
                Bull case {formatUsd(forecast.bull.targetPrice, { maximumFractionDigits: 0 })}
                {bullUpside === null ? "" : ` (${formatPct(bullUpside, "always")})`}:
              </span>{" "}
              {forecast.bull.expectation}. {forecast.bull.summary}
            </p>
            <p>
              <span className={`font-semibold ${emphasisTone}`}>
                Bear case {formatUsd(forecast.bear.targetPrice, { maximumFractionDigits: 0 })}
                {bearUpside === null ? "" : ` (${formatPct(bearUpside, "always")})`}:
              </span>{" "}
              {forecast.bear.expectation}. {forecast.bear.summary}
            </p>
          </div>
        </div>

        <div>
          <ForecastConeChart
            forecast={forecast}
            currentPrice={currentPrice}
            historyPoints={historyPoints}
            theme={theme}
          />
        </div>
      </div>
    </section>
  );
}

function ResearchArchive({
  symbol,
  items,
  theme = "light",
}: {
  symbol: string;
  items: StockResearchArticle[];
  theme?: SectionTheme;
}) {
  const [visibleCount, setVisibleCount] = useState(RESEARCH_ARCHIVE_PAGE_SIZE);
  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;
  const isDark = theme === "dark";

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="pt-10">
      <h2
        className={`font-display text-[1.5rem] leading-[1.08] tracking-[-0.04em] min-[80rem]:text-[2rem] min-[90rem]:text-[2.5rem] min-[120rem]:text-[3rem] ${
          isDark ? "text-white" : "text-black"
        }`}
      >
        Deep Research
      </h2>

      <div className="mt-12 grid gap-x-10 gap-y-14 md:grid-cols-2 xl:grid-cols-4">
        {visibleItems.map((item) => (
          <article key={item.id} className="flex min-h-[11rem] flex-col justify-between gap-4">
            <div>
              <p
                className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                  isDark ? "text-white" : "text-black/42"
                }`}
              >
                {item.agentHandle.replace(/^PC-/, "")} · {item.briefType}
              </p>
              <h3
                className={`research-archive-heading mt-5 max-w-[19rem] text-[1.05rem] leading-[1.5] ${
                  isDark ? "text-white" : "text-black/84"
                }`}
              >
                <Link
                  href={`/stocks/${symbol.toLowerCase()}/research/${item.slug}`}
                  className={`research-archive-link transition-colors ${
                    isDark ? "hover:text-white focus-visible:text-white" : "hover:text-black/72 focus-visible:text-black/72"
                  }`}
                >
                  <span className="research-archive-title-text">{item.title}</span>
                </Link>
              </h3>
            </div>

            <p className={`text-[1.05rem] ${isDark ? "text-white" : "text-black/84"}`}>
              {formatDate(item.publishedAt)}
            </p>
          </article>
        ))}
      </div>

      {hasMore ? (
        <div className="mt-12 flex justify-center">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((current) =>
                Math.min(current + RESEARCH_ARCHIVE_PAGE_SIZE, items.length)
              )
            }
            className={`rounded-full border px-6 py-3 text-sm font-semibold transition-colors ${
              isDark
                ? "border-white text-white hover:bg-white/10 hover:text-white"
                : "border-black/12 text-black hover:bg-black hover:text-white"
            }`}
          >
            Load more
          </button>
        </div>
      ) : null}
    </section>
  );
}

function AgentShowcase({
  symbol,
  agents,
}: {
  symbol: string;
  agents: StockResearchAgent[];
}) {
  const visibleAgents = agents.filter(
    (agent) =>
      !/synth/i.test(agent.code) &&
      !/synth/i.test(agent.handle) &&
      !/synthesis/i.test(agent.name) &&
      !/synthesis/i.test(agent.role)
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollPageCount, setScrollPageCount] = useState(1);
  const [activeScrollPage, setActiveScrollPage] = useState(0);

  useEffect(() => {
    const node = scrollRef.current;

    if (!node) {
      return;
    }

    const updateScrollState = () => {
      const { clientWidth, scrollLeft, scrollWidth } = node;
      const nextPageCount = Math.max(1, Math.ceil(scrollWidth / Math.max(clientWidth, 1)));
      const maxScrollLeft = Math.max(scrollWidth - clientWidth, 0);
      const nextActivePage =
        maxScrollLeft <= 0 ? 0 : Math.round((scrollLeft / maxScrollLeft) * (nextPageCount - 1));

      setScrollPageCount(nextPageCount);
      setActiveScrollPage(nextActivePage);
    };

    updateScrollState();

    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(node);

    if (node.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(node.firstElementChild);
    }

    node.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      resizeObserver.disconnect();
      node.removeEventListener("scroll", updateScrollState);
    };
  }, [visibleAgents.length]);

  if (visibleAgents.length === 0) {
    return null;
  }

  const showcaseRailPadding = "max(3rem, calc((100vw - 1500px) / 2 + 3rem))";

  return (
    <section className="relative mt-20">
      <div className="relative left-1/2 w-screen -translate-x-1/2">
        <div
          ref={scrollRef}
          className="scrollbar-hidden overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory pb-2"
          style={{ scrollPaddingInline: showcaseRailPadding }}
        >
          <div className="flex w-max gap-8" style={{ paddingInline: showcaseRailPadding }}>
            {visibleAgents.map((agent) => (
              <Link
                key={agent.code}
                href={`/stocks/${symbol.toLowerCase()}/agents/${researchAgentSlug(agent)}`}
                className="agent-showcase-card group flex h-[24.75rem] w-[19.5rem] shrink-0 snap-start flex-col align-top"
              >
                <div className="flex aspect-[320/224] w-full items-center justify-center bg-black px-8 text-center">
                  <p className="text-[1rem] font-medium uppercase tracking-[0.14em] text-white">
                    {agent.handle}
                  </p>
                </div>

                <div className="flex flex-1 flex-col">
                  <h3 className="mt-5 overflow-hidden text-[1.1rem] font-medium tracking-[-0.03em] whitespace-nowrap text-black text-ellipsis">
                    {agent.name}
                  </h3>
                  <p className="mt-2 pr-2 text-[1rem] leading-[1.42] text-black/72 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">
                    <span className="agent-showcase-description-text">
                      {researchAgentCardDescription(agent)}
                    </span>
                  </p>

                  <p className="mt-auto pt-8 text-[1rem] font-medium text-black">Learn more</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {scrollPageCount > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-4">
          {Array.from({ length: scrollPageCount }).map((_, index) => {
            const isActive = index === activeScrollPage;

            return (
              <span
                key={`agent-scroll-indicator-${index + 1}`}
                className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                  isActive ? "border-black" : "border-transparent"
                }`}
              >
                <span
                  className={`block rounded-full transition-all ${
                    isActive ? "h-2.5 w-2.5 bg-black" : "h-2.5 w-2.5 bg-black"
                  }`}
                />
              </span>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function DebatePanel({
  messages,
  eyebrow = "Live discussion",
  title = "AI Commentary",
  theme = "light",
}: {
  messages: StockCoverageDebateMessage[];
  eyebrow?: string;
  title?: string;
  theme?: SectionTheme;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(Math.min(3, messages.length));
  const isDark = theme === "dark";

  useEffect(() => {
    if (!isExpanded || visibleCount >= messages.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      startTransition(() => {
        setVisibleCount((current) => Math.min(messages.length, current + 1));
      });
    }, 3400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isExpanded, messages.length, visibleCount]);

  const visibleMessages = messages.slice(0, visibleCount);
  const toggleDiscussion = () => {
    setIsExpanded((current) => {
      const nextExpanded = !current;
      setVisibleCount(nextExpanded ? Math.min(3, messages.length) : 0);
      return nextExpanded;
    });
  };

  return (
    <section className="pt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${
              isDark ? "text-white" : "text-black/42"
            }`}
          >
            {eyebrow}
          </p>
          <h2
            className={`mt-3 text-2xl font-semibold tracking-[-0.03em] ${
              isDark ? "text-white" : "text-black"
            }`}
          >
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-5">
          <p
            className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${
              isDark ? "text-white" : "text-black/48"
            }`}
          >
            {messages.length} live remarks
          </p>
          <button
            type="button"
            onClick={toggleDiscussion}
            aria-expanded={isExpanded}
            className={`text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors ${
              isDark ? "text-white hover:text-white" : "text-black hover:text-black/62"
            }`}
          >
            {isExpanded ? "Hide discussion" : "Show discussion"}
          </button>
        </div>
      </div>

      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
          isExpanded ? "mt-8 max-h-[48rem] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="scrollbar-hidden max-h-[38rem] overflow-y-auto">
          {visibleMessages.map((message) => (
            <div key={message.id} className="flex gap-4 py-5">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(
                  message.senderId
                )}`}
              >
                {initials(message)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={`text-sm font-semibold ${isDark ? "text-white" : "text-black"}`}>
                    {message.senderName}
                  </span>
                  <span
                    className={`text-[11px] uppercase tracking-[0.16em] ${
                      isDark ? "text-white" : "text-black/40"
                    }`}
                  >
                    {message.senderRole}
                  </span>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${messageToneClass(message, theme)}`}
                  >
                    {message.messageType.replace(/_/g, " ")}
                  </span>
                  <time
                    className={`text-[11px] ${isDark ? "text-white" : "text-black/42"}`}
                    dateTime={message.timestamp}
                  >
                    {formatTimestamp(message.timestamp)}
                  </time>
                </div>
                <p
                  className={`mt-2 text-sm leading-relaxed ${
                    isDark ? "text-white" : "text-black/76"
                  }`}
                >
                  {message.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function StockCoverageLive({
  initialData,
}: {
  initialData: StockCoveragePageData;
}) {
  const { profile } = initialData;
  const researchProgram = profile.researchProgram;
  const isResearchPage = profile.pageMode === "research" && !!researchProgram;
  const [liveData, setLiveData] = useState<StockCoverageLiveData>(initialData.liveData);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    setLiveData(initialData.liveData);
  }, [initialData.liveData]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await fetch(`/api/stocks/${profile.symbol.toLowerCase()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Refresh failed with status ${response.status}.`);
        }

        const next = (await response.json()) as StockCoverageLiveData;

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setLiveData(next);
          setLiveError(null);
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setLiveError(
            error instanceof Error ? error.message : "Unable to refresh live stock data."
          );
        });
      }
    };

    refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [profile.symbol]);

  const targetUpside = useMemo(() => {
    if (typeof liveData.quote.price !== "number" || liveData.quote.price <= 0) {
      return null;
    }

    return ((profile.priceTarget12m - liveData.quote.price) / liveData.quote.price) * 100;
  }, [liveData.quote.price, profile.priceTarget12m]);
  const normalizedCharts = useMemo(() => getNormalizedCharts(liveData), [liveData]);
  const heroKicker = isResearchPage
    ? `${profile.symbol} · ${profile.sector} · Research sandbox`
    : `${profile.symbol} · ${profile.sector} · ${profile.marketCapLabel} market cap`;
  const secondaryNarrative = isResearchPage ? null : profile.researchThesis;
  const researchAgents = researchProgram?.agents ?? [];
  const publishedResearch = researchProgram?.publishedResearch ?? [];
  const discussionMessages = researchProgram?.feedMessages ?? profile.debateMessages;
  const discussionEyebrow = researchProgram?.feedEyebrow ?? "Live discussion";
  const discussionTitle = researchProgram?.feedTitle ?? "AI Commentary";
  const currentPrice = liveData.quote.price;
  const forecastHistoryPoints =
    normalizedCharts["1Y"].points.length > 0
      ? normalizedCharts["1Y"].points
      : normalizedCharts["1M"].points.length > 0
        ? normalizedCharts["1M"].points
        : normalizedCharts["1D"].points;
  const lowerSections = [
    profile.forecast12m
      ? {
          key: "forecast",
          render: (theme: SectionTheme) => (
            <ForecastOutlook
              forecast={profile.forecast12m!}
              currentPrice={currentPrice}
              historyPoints={forecastHistoryPoints}
              theme={theme}
            />
          ),
        }
      : null,
    publishedResearch.length > 0
      ? {
          key: "research",
          render: (theme: SectionTheme) => (
            <ResearchArchive symbol={profile.symbol} items={publishedResearch} theme={theme} />
          ),
        }
      : null,
    discussionMessages.length > 0
      ? {
          key: "discussion",
          render: (theme: SectionTheme) => (
            <DebatePanel
              key={profile.symbol}
              messages={discussionMessages}
              eyebrow={discussionEyebrow}
              title={discussionTitle}
              theme={theme}
            />
          ),
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; render: (theme: SectionTheme) => ReactNode }>;

  return (
    <div className="marketing-page-light" style={{ backgroundColor: "#ffffff" }}>
      <section className="bg-white pt-32 pb-20 lg:pt-36 lg:pb-24">
        <div className="marketing-container">
          <div className="marketing-rail">
            <div className="grid gap-10 xl:grid-cols-[minmax(0,0.88fr)_minmax(28rem,1.12fr)] xl:items-center xl:gap-16">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/42">
                  {heroKicker}
                </p>

                <h1 className="mt-5 max-w-5xl font-display text-[clamp(2.7rem,5vw,5rem)] leading-[0.94] tracking-[-0.05em] text-balance text-black">
                  <CharacterTextReveal text={profile.companyName} />
                </h1>

                <p className="mt-8 max-w-3xl text-[1.02rem] leading-[1.86] text-black/66">
                  {profile.summary}
                </p>
                {secondaryNarrative ? (
                  <p className="mt-8 max-w-3xl text-base leading-relaxed text-black/72">
                    {secondaryNarrative}
                  </p>
                ) : null}

                <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4 text-sm text-black/66">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                      Website
                    </p>
                    <a
                      href={profile.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex font-semibold text-black underline decoration-black/20 underline-offset-4 transition-colors hover:text-black/72"
                    >
                      {profile.websiteUrl.replace(/^https?:\/\//, "")}
                    </a>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                      Market cap
                    </p>
                    <p className="mt-2 font-semibold text-black">{profile.marketCapLabel}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                      Earnings date
                    </p>
                    <p className="mt-2 font-semibold text-black">
                      {formatDate(profile.earningsDate, { weekday: "short" })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                      Timing
                    </p>
                    <p className="mt-2 font-semibold text-black">
                      {profile.earningsTiming === "Before open"
                        ? "Before market open"
                        : "After market close"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-w-0 xl:self-center xl:pt-8">
                <StockPriceChart liveData={liveData} liveError={liveError} />
              </div>
            </div>

            <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatBlock
                label={isResearchPage && researchProgram ? "Agentic Team Count" : "Research stance"}
                value={isResearchPage && researchProgram ? String(researchProgram.activeAgents) : profile.rating}
                detail={
                  isResearchPage && researchProgram
                    ? "Number of agents covering this company."
                    : profile.debateHeadline
                }
              />
              <StatBlock
                label="12M target"
                value={formatUsd(profile.priceTarget12m, { maximumFractionDigits: 0 })}
                detail={
                  targetUpside === null
                    ? "Upside will be calculated when live pricing is available."
                    : `${formatPct(targetUpside, "always")} versus the latest quote.`
                }
              />
              <StatBlock
                label="Conviction"
                value={`${profile.conviction}/100`}
                detail="Composite score blending research quality, event clarity, and quant confirmation."
              />
              <StatBlock
                label="Consensus EPS"
                value={profile.epsEstimateLabel}
                detail={`${profile.fiscalQuarter} earnings model consensus heading into the release.`}
              />
            </div>

            {isResearchPage && researchAgents.length > 0 ? (
              <AgentShowcase symbol={profile.symbol} agents={researchAgents} />
            ) : null}
          </div>
        </div>
      </section>

      {lowerSections.map((section, index) => {
        const theme: SectionTheme = index % 2 === 0 ? "dark" : "light";

        return (
          <section
            key={section.key}
            className={theme === "dark" ? "py-20 text-white lg:py-24" : "bg-white py-20 lg:py-24"}
            style={
              theme === "dark"
                ? {
                    backgroundColor: "var(--background)",
                  }
                : undefined
            }
          >
            <div className="marketing-container">
              <div className="marketing-rail">{section.render(theme)}</div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

"use client";

import { useId, useMemo, useState } from "react";
import type { DeveloperPortalData } from "@/lib/developer/portal";

type RangeKey = "7d" | "30d" | "90d";

const RANGE_OPTIONS: Array<{ days: number; key: RangeKey; label: string }> = [
  { days: 7, key: "7d", label: "7d" },
  { days: 30, key: "30d", label: "30d" },
  { days: 90, key: "90d", label: "90d" },
];

function formatMonthLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function getRequestChartTicks(
  series: DeveloperPortalData["analytics"]["requests"]["series"]
) {
  if (series.length === 0) {
    return [];
  }

  const lastIndex = series.length - 1;
  const middleIndex = Math.round(lastIndex / 2);
  const tickIndexes = Array.from(new Set([0, middleIndex, lastIndex]));

  return tickIndexes.map((index) => ({
    index,
    label: series[index]?.label ?? "",
  }));
}

function RequestTrendChart({
  rangeLabel,
  series,
}: {
  rangeLabel: string;
  series: DeveloperPortalData["analytics"]["requests"]["series"];
}) {
  const chartId = useId().replace(/:/g, "");
  const width = 960;
  const height = 320;
  const padding = {
    bottom: 42,
    left: 54,
    right: 24,
    top: 18,
  };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxRequests = Math.max(...series.map((point) => point.requests), 0);
  const yMax = Math.max(maxRequests, 1);
  const points = series.map((point, index) => {
    const x =
      padding.left +
      (series.length <= 1 ? 0 : (index / (series.length - 1)) * innerWidth);
    const y = padding.top + (1 - point.requests / yMax) * innerHeight;

    return { ...point, x, y };
  });
  const baselineY = padding.top + innerHeight;
  const linePath =
    points.length === 0
      ? ""
      : points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath =
    points.length === 0
      ? ""
      : `${linePath} L ${points.at(-1)?.x ?? padding.left} ${baselineY} L ${
          points[0]?.x ?? padding.left
        } ${baselineY} Z`;
  const xTicks = getRequestChartTicks(series);
  const yTicks = [0, yMax];
  const getXAxisTextAnchor = (index: number) => {
    if (index === 0) {
      return "start";
    }

    if (index === series.length - 1) {
      return "end";
    }

    return "middle";
  };

  return (
    <div className="developer-request-chart h-[320px] min-w-0" data-range={rangeLabel}>
      <svg
        aria-label={`${rangeLabel} request trend`}
        className="h-full w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id={`developer-requests-fill-${chartId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--developer-chart-fill)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--developer-chart-fill)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => {
          const y = padding.top + (1 - tick / yMax) * innerHeight;

          return (
            <g key={`y-${tick}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="var(--developer-chart-grid)"
                strokeWidth={1}
              />
              <text
                dominantBaseline="middle"
                fill="var(--developer-chart-axis)"
                fontSize="12"
                textAnchor="end"
                x={padding.left - 14}
                y={y}
              >
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}

        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={baselineY}
          y2={baselineY}
          stroke="var(--developer-chart-line)"
          strokeLinecap="round"
          strokeWidth={2}
        />

        {areaPath ? (
          <path d={areaPath} fill={`url(#developer-requests-fill-${chartId})`} />
        ) : null}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke="var(--developer-chart-line)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
          />
        ) : null}

        {points.length > 0 ? (
          <circle
            cx={points.at(-1)?.x}
            cy={points.at(-1)?.y}
            fill="var(--developer-chart-line)"
            r={4}
          />
        ) : null}

        {xTicks.map((tick) => {
          const point = points[tick.index];

          if (!point) {
            return null;
          }

          return (
            <g key={`x-${tick.index}`}>
              <line
                x1={point.x}
                x2={point.x}
                y1={baselineY}
                y2={baselineY + 5}
                stroke="var(--developer-chart-grid)"
                strokeWidth={1}
              />
              <text
                fill="var(--developer-chart-axis)"
                fontSize="12"
                textAnchor={getXAxisTextAnchor(tick.index)}
                x={point.x}
                y={baselineY + 28}
              >
                {tick.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function dayLabel(dayIndex: number) {
  if (dayIndex === 1) {
    return "M";
  }

  if (dayIndex === 3) {
    return "W";
  }

  if (dayIndex === 5) {
    return "F";
  }

  return "";
}

function contributionColor(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) {
    return "var(--developer-heatmap-empty)";
  }

  const ratio = count / maxCount;

  if (ratio >= 0.75) {
    return "var(--developer-heatmap-4)";
  }

  if (ratio >= 0.5) {
    return "var(--developer-heatmap-3)";
  }

  if (ratio >= 0.25) {
    return "var(--developer-heatmap-2)";
  }

  return "var(--developer-heatmap-1)";
}

export function DeveloperOverviewAnalytics({
  analytics,
  latestActivityAt,
}: {
  analytics: DeveloperPortalData["analytics"];
  latestActivityAt: string | null;
}) {
  const [range, setRange] = useState<RangeKey>("30d");
  const selectedRange =
    RANGE_OPTIONS.find((option) => option.key === range) ?? RANGE_OPTIONS[1];

  const requestSeries = useMemo(
    () => analytics.requests.series.slice(-selectedRange.days),
    [analytics.requests.series, selectedRange.days]
  );

  const requestTotal = useMemo(
    () => requestSeries.reduce((sum, point) => sum + point.requests, 0),
    [requestSeries]
  );

  const contributionWeeks = useMemo(() => {
    const weeks: Array<DeveloperPortalData["analytics"]["contributions"]["days"]> = [];

    for (let index = 0; index < analytics.contributions.days.length; index += 7) {
      weeks.push(analytics.contributions.days.slice(index, index + 7));
    }

    return weeks;
  }, [analytics.contributions.days]);

  const monthLabels = useMemo(() => {
    let previousLabel: string | null = null;

    return contributionWeeks.map((week) => {
      const label = week[0] ? formatMonthLabel(week[0].date) : "";

      if (label === previousLabel) {
        return "";
      }

      previousLabel = label;
      return label;
    });
  }, [contributionWeeks]);

  return (
    <div className="developer-analytics space-y-8">
      <section className="developer-analytics-card rounded-[1.5rem] px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted">
              Request Analytics
            </p>
            <h2 className="developer-card-title mt-3 text-2xl font-bold text-foreground">
              Requests made to your submitted agents
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
              Request logging unlocks once submitted agents are promoted into callable runtime.
              Until then, this view stays honest at zero and is ready to ingest live usage the
              moment routing turns on.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((option) => {
              const active = option.key === range;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRange(option.key)}
                  className="developer-range-button rounded-2xl border px-4 py-2 text-sm transition-colors"
                  data-active={active}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="space-y-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Total Requests</p>
              <p className="dashboard-numeric mt-3 text-6xl font-semibold text-foreground">
                {formatNumber(requestTotal)}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
                  Approved Agents
                </p>
                <p className="dashboard-numeric mt-2 text-3xl font-semibold text-foreground">
                  {formatNumber(analytics.requests.activeAgentCount)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
                  Latest Activity
                </p>
                <p className="mt-2 text-sm text-foreground">
                  {latestActivityAt
                    ? new Intl.DateTimeFormat("en-US", {
                        day: "numeric",
                        hour: "2-digit",
                        hour12: false,
                        minute: "2-digit",
                        month: "short",
                      }).format(new Date(latestActivityAt))
                    : "No activity yet"}
                </p>
              </div>
            </div>
          </div>

          <RequestTrendChart rangeLabel={selectedRange.label} series={requestSeries} />
        </div>
      </section>

      <section className="developer-analytics-card rounded-[1.5rem] px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted">
              Contribution History
            </p>
            <h2 className="developer-card-title mt-3 text-2xl font-bold text-foreground">
              GitHub contribution history to your submitted agents
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
              This heatmap reflects the actual days on which submission records moved through the
              portal for your connected repositories. It behaves like a contribution graph, but it
              only counts work that has landed in this intake system.
            </p>
          </div>
          <div className="flex flex-wrap gap-6 text-sm text-muted">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
                Active Days
              </p>
              <p className="dashboard-numeric mt-2 text-3xl font-semibold text-foreground">
                {formatNumber(analytics.contributions.activeDays)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
                Contribution Events
              </p>
              <p className="dashboard-numeric mt-2 text-3xl font-semibold text-foreground">
                {formatNumber(analytics.contributions.totalEvents)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 overflow-x-auto">
          <div className="mx-auto w-max min-w-[1120px]">
            <div
              className="grid gap-1.5 pb-3 text-[11px] uppercase tracking-[0.12em] text-muted"
              style={{
                gridTemplateColumns: `28px repeat(${contributionWeeks.length}, 1.25rem)`,
              }}
            >
              <div />
              {monthLabels.map((label, index) => (
                <div key={`${label}-${index}`} className="min-h-[16px] text-center">
                  {label}
                </div>
              ))}
            </div>

            <div className="flex gap-4">
              <div className="grid grid-rows-7 gap-1.5 pt-1 text-sm text-muted">
                {Array.from({ length: 7 }, (_, dayIndex) => (
                  <div
                    key={`day-label-${dayIndex}`}
                    className="flex h-5 items-center justify-end pr-1"
                  >
                    {dayLabel(dayIndex)}
                  </div>
                ))}
              </div>

              <div className="flex gap-1.5">
                {contributionWeeks.map((week, weekIndex) => (
                  <div key={`week-${weekIndex}`} className="grid grid-rows-7 gap-1.5">
                    {week.map((day) => (
                      <div
                        key={day.date}
                        title={`${formatLongDate(day.date)} · ${day.count} contribution${
                          day.count === 1 ? "" : "s"
                        }`}
                        className="h-5 w-5 rounded-[5px]"
                        style={{
                          backgroundColor: contributionColor(
                            day.count,
                            analytics.contributions.maxDayCount
                          ),
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3 text-sm text-muted">
          <span>Fewer</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={`legend-${level}`}
              className="h-5 w-5 rounded-[5px]"
              style={{
                backgroundColor:
                  level === 0
                    ? contributionColor(0, analytics.contributions.maxDayCount)
                    : contributionColor(
                        Math.max(
                          1,
                          Math.ceil((analytics.contributions.maxDayCount * level) / 4)
                        ),
                        analytics.contributions.maxDayCount || 1
                      ),
              }}
            />
          ))}
          <span>More</span>
        </div>
      </section>
    </div>
  );
}

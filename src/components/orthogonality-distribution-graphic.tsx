"use client";

import { useId, useMemo, useState } from "react";

type ForecastCurve = {
  label: string;
  mean: number;
  stdDev: number;
};

const AGENT_CURVES: ForecastCurve[] = [
  { label: "Agent 01", mean: 76.5, stdDev: 4.0 },
  { label: "Agent 02", mean: 81.2, stdDev: 3.8 },
  { label: "Agent 03", mean: 79.0, stdDev: 4.2 },
  { label: "Agent 04", mean: 82.4, stdDev: 3.5 },
  { label: "Agent 05", mean: 78.5, stdDev: 4.0 },
  { label: "Agent 06", mean: 80.8, stdDev: 3.9 },
  { label: "Agent 07", mean: 80.2, stdDev: 4.1 },
  { label: "Agent 08", mean: 79.6, stdDev: 3.7 },
];

const ENSEMBLE_CURVE: ForecastCurve = {
  label: "Ensemble",
  mean: 79.9,
  stdDev: 1.4,
};

const CHART = {
  height: 420,
  padBottom: 62,
  padLeft: 42,
  padRight: 42,
  padTop: 48,
  width: 620,
  xMax: 95,
  xMin: 65,
};

const TICKS = [65, 70, 75, 80, 85, 90] as const;
const TRUTH = 80;
const CURVE_STEP = 0.25;
const CURVE_SAMPLE_COUNT =
  Math.round((CHART.xMax - CHART.xMin) / CURVE_STEP) + 1;
const PLOT_WIDTH = CHART.width - CHART.padLeft - CHART.padRight;
const PLOT_HEIGHT = CHART.height - CHART.padTop - CHART.padBottom;

function gaussian(x: number, mean: number, stdDev: number) {
  return (
    Math.exp(-0.5 * ((x - mean) / stdDev) ** 2) /
    (stdDev * Math.sqrt(2 * Math.PI))
  );
}

function sampleCurve({ mean, stdDev }: ForecastCurve) {
  return Array.from({ length: CURVE_SAMPLE_COUNT }, (_, index) =>
    gaussian(CHART.xMin + index * CURVE_STEP, mean, stdDev),
  );
}

const Y_MAX = Math.max(
  ...AGENT_CURVES.flatMap(sampleCurve),
  ...sampleCurve(ENSEMBLE_CURVE),
);

function xToPx(value: number) {
  return (
    CHART.padLeft +
    ((value - CHART.xMin) / (CHART.xMax - CHART.xMin)) * PLOT_WIDTH
  );
}

function yToPx(value: number) {
  return CHART.padTop + PLOT_HEIGHT - (value / Y_MAX) * PLOT_HEIGHT;
}

function distributionPath(curve: ForecastCurve) {
  return Array.from({ length: CURVE_SAMPLE_COUNT }, (_, index) => {
    const xValue = CHART.xMin + index * CURVE_STEP;
    const command = index === 0 ? "M" : "L";

    return `${command}${xToPx(xValue).toFixed(1)},${yToPx(
      gaussian(xValue, curve.mean, curve.stdDev),
    ).toFixed(1)}`;
  }).join(" ");
}

export function OrthogonalityDistributionGraphic() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const idPrefix = useId().replace(/:/g, "");
  const titleId = `${idPrefix}-orthogonality-chart-title`;
  const descId = `${idPrefix}-orthogonality-chart-desc`;
  const glowId = `${idPrefix}-orthogonality-glow`;
  const ensembleFillId = `${idPrefix}-ensemble-fill`;
  const paths = useMemo(
    () => ({
      agents: AGENT_CURVES.map(distributionPath),
      ensemble: distributionPath(ENSEMBLE_CURVE),
    }),
    [],
  );
  const axisY = yToPx(0);
  const truthX = xToPx(TRUTH);

  return (
    <div className="marketing-orthogonality-graphic-inner w-full max-w-[34rem] px-4 sm:px-7">
      <svg
        aria-labelledby={`${titleId} ${descId}`}
        className="block h-auto w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      >
        <title id={titleId}>
          Orthogonal agent forecast distributions
        </title>
        <desc id={descId}>
          Multiple uncorrelated agent distributions combine into a narrower
          ensemble forecast around the truth.
        </desc>
        <defs>
          <radialGradient cx="50%" cy="52%" id={glowId} r="62%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.14" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={ensembleFillId} x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect
          fill={`url(#${glowId})`}
          height="340"
          rx="170"
          width="540"
          x="40"
          y="42"
        />

        {TICKS.map((tick) => (
          <g key={tick}>
            <line
              opacity="0.11"
              stroke="#ffffff"
              strokeWidth="1"
              x1={xToPx(tick)}
              x2={xToPx(tick)}
              y1={CHART.padTop}
              y2={axisY}
            />
            <text
              fill="rgba(255,255,255,0.56)"
              fontFamily="var(--font-google-sans), system-ui, sans-serif"
              fontSize="12"
              letterSpacing="0.08em"
              textAnchor="middle"
              x={xToPx(tick)}
              y={CHART.height - 28}
            >
              {tick}
            </text>
          </g>
        ))}

        <line
          stroke="rgba(255,255,255,0.42)"
          strokeDasharray="5 7"
          strokeWidth="1.1"
          x1={truthX}
          x2={truthX}
          y1={CHART.padTop - 15}
          y2={axisY}
        />
        <text
          fill="rgba(255,255,255,0.76)"
          fontFamily="var(--font-google-sans), system-ui, sans-serif"
          fontSize="13"
          fontWeight="500"
          textAnchor="middle"
          x={truthX}
          y={CHART.padTop - 27}
        >
          truth $80B
        </text>

        <line
          opacity="0.32"
          stroke="#ffffff"
          strokeWidth="1"
          x1={CHART.padLeft}
          x2={CHART.width - CHART.padRight}
          y1={axisY}
          y2={axisY}
        />

        {paths.agents.map((path, index) => {
          const isActive = activeIndex === index;
          const isDimmed = activeIndex !== null && !isActive;

          return (
            <g key={AGENT_CURVES[index].label}>
              <path
                d={path}
                fill="none"
                opacity={isActive ? 0.96 : isDimmed ? 0.14 : 0.42}
                pathLength={1}
                stroke="#ffffff"
                strokeLinecap="round"
                strokeWidth={isActive ? 2.4 : 1.05}
                style={{
                  filter: isActive
                    ? "drop-shadow(0 0 9px rgba(255,255,255,0.5))"
                    : "none",
                  strokeDasharray: 1,
                  transition:
                    "opacity 220ms ease, stroke-width 220ms ease, filter 220ms ease",
                }}
              >
                <animate
                  attributeName="stroke-dashoffset"
                  begin={`${index * 60}ms`}
                  dur="820ms"
                  fill="freeze"
                  from="1"
                  to="0"
                />
              </path>
              <path
                aria-label={AGENT_CURVES[index].label}
                d={path}
                fill="none"
                onPointerEnter={() => setActiveIndex(index)}
                onPointerLeave={() => setActiveIndex(null)}
                opacity="0"
                stroke="#ffffff"
                strokeLinecap="round"
                strokeWidth="16"
              />
            </g>
          );
        })}

        <path
          d={`${paths.ensemble} L${xToPx(CHART.xMax).toFixed(1)},${axisY.toFixed(
            1,
          )} L${xToPx(CHART.xMin).toFixed(1)},${axisY.toFixed(1)} Z`}
          fill={`url(#${ensembleFillId})`}
          opacity={activeIndex === null ? 0.54 : 0.34}
          style={{ transition: "opacity 220ms ease" }}
        />
        <path
          d={paths.ensemble}
          fill="none"
          pathLength={1}
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth="3"
          style={{
            filter: "drop-shadow(0 0 12px rgba(255,255,255,0.42))",
            strokeDasharray: 1,
          }}
        >
          <animate
            attributeName="stroke-dashoffset"
            begin="440ms"
            dur="950ms"
            fill="freeze"
            from="1"
            to="0"
          />
        </path>

        {AGENT_CURVES.map((curve, index) => {
          const isActive = activeIndex === index;
          const peakX = xToPx(curve.mean);
          const peakY = yToPx(gaussian(curve.mean, curve.mean, curve.stdDev));

          return (
            <circle
              cx={peakX}
              cy={peakY}
              fill="#ffffff"
              key={curve.label}
              opacity={isActive ? 1 : activeIndex === null ? 0.46 : 0.16}
              r={isActive ? 4 : 2.2}
              style={{
                filter: isActive
                  ? "drop-shadow(0 0 8px rgba(255,255,255,0.62))"
                  : "none",
                transition:
                  "opacity 220ms ease, r 220ms ease, filter 220ms ease",
              }}
            />
          );
        })}

        <g transform="translate(50 62)">
          <line opacity="0.45" stroke="#ffffff" strokeWidth="1" x1="0" x2="22" y1="0" y2="0" />
          <text
            fill="rgba(255,255,255,0.66)"
            fontFamily="var(--font-google-sans), system-ui, sans-serif"
            fontSize="13"
            x="31"
            y="5"
          >
            individual agents
          </text>
          <line stroke="#ffffff" strokeWidth="3" x1="0" x2="22" y1="23" y2="23" />
          <text
            fill="rgba(255,255,255,0.66)"
            fontFamily="var(--font-google-sans), system-ui, sans-serif"
            fontSize="13"
            x="31"
            y="28"
          >
            ensemble
          </text>
        </g>
      </svg>
    </div>
  );
}

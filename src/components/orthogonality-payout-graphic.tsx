const CHART = {
  height: 420,
  padBottom: 64,
  padLeft: 72,
  padRight: 42,
  padTop: 36,
  width: 620,
};

const PLOT_WIDTH = CHART.width - CHART.padLeft - CHART.padRight;
const PLOT_HEIGHT = CHART.height - CHART.padTop - CHART.padBottom;
const X_TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

const PAYOUT_POINTS = [
  { x: 0, y: 0 },
  { x: 0.1, y: 0.04 },
  { x: 0.2, y: 0.12 },
  { x: 0.3, y: 0.32 },
  { x: 0.4, y: 0.68 },
  { x: 0.5, y: 1.18 },
  { x: 0.6, y: 1.88 },
  { x: 0.7, y: 2.72 },
  { x: 0.8, y: 3.86 },
  { x: 0.9, y: 5.18 },
  { x: 1, y: 6.85 },
] as const;

const CALLOUTS = [
  { label: "redundant", x: 0.2, y: 0.12 },
  { label: "differentiated", x: 0.6, y: 1.88 },
  { label: "orthogonal", x: 0.9, y: 5.18 },
] as const;

const Y_MAX = 7.05;

function xToPx(value: number) {
  return CHART.padLeft + value * PLOT_WIDTH;
}

function yToPx(value: number) {
  return CHART.padTop + PLOT_HEIGHT - (value / Y_MAX) * PLOT_HEIGHT;
}

function payoutPath() {
  return PAYOUT_POINTS.map((point, index) => {
    const command = index === 0 ? "M" : "L";

    return `${command}${xToPx(point.x).toFixed(1)},${yToPx(point.y).toFixed(
      1,
    )}`;
  }).join(" ");
}

function xTickLabel(value: number) {
  if (value === 0 || value === 1) {
    return value.toFixed(1).replace(".0", value === 0 ? "" : ".0");
  }

  return value.toFixed(2);
}

export function OrthogonalityPayoutGraphic() {
  const path = payoutPath();
  const axisY = yToPx(0);
  const orthogonalStartX = xToPx(0.78);

  return (
    <div className="marketing-orthogonality-graphic-inner w-full max-w-[35rem] px-4 sm:px-7">
      <div className="lg:-translate-x-8">
        <svg
          aria-labelledby="orthogonality-payout-title orthogonality-payout-desc"
          className="block h-auto w-full overflow-visible"
          role="img"
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        >
        <title id="orthogonality-payout-title">
          Shapley payout rises with useful orthogonality
        </title>
        <desc id="orthogonality-payout-desc">
          A Shapley payout curve starts near zero for redundant agents and
          rises as calibrated, differentiated predictions add marginal value to
          the ensemble.
        </desc>
        <defs>
          <radialGradient cx="58%" cy="56%" id="orthogonality-payout-glow" r="64%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.13" />
            <stop offset="56%" stopColor="#ffffff" stopOpacity="0.035" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="orthogonality-payout-fill" x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect
          fill="url(#orthogonality-payout-glow)"
          height="340"
          rx="170"
          width="540"
          x="45"
          y="40"
        />
        <rect
          fill="rgba(255,255,255,0.06)"
          height={axisY - CHART.padTop}
          opacity="0.72"
          width={xToPx(1) - orthogonalStartX}
          x={orthogonalStartX}
          y={CHART.padTop}
        />

        {X_TICKS.map((tick) => (
          <g key={tick}>
            <line
              opacity="0.1"
              stroke="#ffffff"
              strokeDasharray="4 8"
              strokeWidth="1"
              x1={xToPx(tick)}
              x2={xToPx(tick)}
              y1={CHART.padTop + 18}
              y2={axisY}
            />
            <text
              fill="rgba(255,255,255,0.52)"
              fontFamily="var(--font-google-sans), system-ui, sans-serif"
              fontSize="12"
              letterSpacing="0"
              textAnchor="middle"
              x={xToPx(tick)}
              y={CHART.height - 28}
            >
              {xTickLabel(tick)}
            </text>
          </g>
        ))}

        <line
          opacity="0.32"
          stroke="#ffffff"
          strokeWidth="1"
          x1={CHART.padLeft}
          x2={CHART.width - CHART.padRight}
          y1={axisY}
          y2={axisY}
        />
        <line
          opacity="0.32"
          stroke="#ffffff"
          strokeWidth="1"
          x1={CHART.padLeft}
          x2={CHART.padLeft}
          y1={CHART.padTop}
          y2={axisY}
        />

        <path
          d={`${path} L${xToPx(1).toFixed(1)},${axisY.toFixed(1)} L${xToPx(
            0,
          ).toFixed(1)},${axisY.toFixed(1)} Z`}
          fill="url(#orthogonality-payout-fill)"
          opacity="0.55"
        />
        <path
          d={path}
          fill="none"
          pathLength={1}
          stroke="#ffffff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.4"
          style={{
            filter: "drop-shadow(0 0 12px rgba(255,255,255,0.38))",
            strokeDasharray: 1,
          }}
        >
          <animate
            attributeName="stroke-dashoffset"
            begin="260ms"
            dur="1180ms"
            fill="freeze"
            from="1"
            to="0"
          />
        </path>

        {CALLOUTS.map((callout, index) => {
          const x = xToPx(callout.x);
          const y = yToPx(callout.y);
          const labelX =
            index === 0 ? x - 8 : index === 1 ? x + 16 : x + 2;
          const labelY = index === 0 ? y - 28 : index === 1 ? y + 31 : y - 28;

          return (
            <g key={callout.label}>
              <line
                opacity="0.28"
                stroke="#ffffff"
                strokeWidth="1.2"
                x1={x}
                x2={x}
                y1={index === 1 ? y + 10 : Math.min(y + 10, labelY + 8)}
                y2={index === 1 ? y + 43 : y - 18}
              />
              <circle
                cx={x}
                cy={y}
                fill={index === 0 ? "#1b1b1b" : "#ffffff"}
                stroke="#ffffff"
                strokeWidth={index === 0 ? 2.2 : 0}
                opacity="0"
                r={index === 0 ? 5 : 5}
              >
                <animate
                  attributeName="opacity"
                  begin={`${720 + index * 180}ms`}
                  dur="340ms"
                  fill="freeze"
                  from="0"
                  to="1"
                />
              </circle>
              <text
                fill="rgba(255,255,255,0.68)"
                fontFamily="var(--font-google-sans), system-ui, sans-serif"
                fontSize={index === 2 ? 16 : 15}
                fontStyle="italic"
                fontWeight="600"
                textAnchor={index === 1 ? "start" : "middle"}
                x={labelX}
                y={labelY}
              >
                {callout.label}
              </text>
            </g>
          );
        })}

        <text
          fill="rgba(255,255,255,0.68)"
          fontFamily="var(--font-google-sans), system-ui, sans-serif"
          fontSize="15"
          fontWeight="600"
          textAnchor="middle"
          transform={`rotate(-90 ${CHART.padLeft - 62} ${
            CHART.padTop + PLOT_HEIGHT / 2
          })`}
          x={CHART.padLeft - 62}
          y={CHART.padTop + PLOT_HEIGHT / 2}
        >
          share of fee pool
        </text>

        <text
          fill="rgba(255,255,255,0.56)"
          fontFamily="var(--font-google-sans), system-ui, sans-serif"
          fontSize="16"
          fontWeight="600"
          letterSpacing="0"
          textAnchor="middle"
          x={CHART.padLeft + PLOT_WIDTH / 2}
          y={CHART.height - 2}
        >
          agent orthogonality
        </text>
        </svg>
      </div>
    </div>
  );
}

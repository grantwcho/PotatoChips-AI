const CORRELATION_MATRIX = [
  [1.0, 0.05, -0.02, 0.08, -0.04, 0.03, -0.01, 0.06],
  [0.05, 1.0, 0.04, -0.03, 0.07, -0.05, 0.02, -0.04],
  [-0.02, 0.04, 1.0, 0.06, -0.05, 0.04, 0.07, -0.03],
  [0.08, -0.03, 0.06, 1.0, 0.02, -0.04, 0.05, 0.04],
  [-0.04, 0.07, -0.05, 0.02, 1.0, 0.03, -0.02, 0.05],
  [0.03, -0.05, 0.04, -0.04, 0.03, 1.0, 0.06, -0.02],
  [-0.01, 0.02, 0.07, 0.05, -0.02, 0.06, 1.0, 0.04],
  [0.06, -0.04, -0.03, 0.04, 0.05, -0.02, 0.04, 1.0],
] as const;

const MATRIX = {
  cellGap: 4,
  count: CORRELATION_MATRIX.length,
  pad: 34,
  size: 420,
};

const GRID_SIZE = MATRIX.size - MATRIX.pad * 2;
const CELL_SIZE =
  (GRID_SIZE - MATRIX.cellGap * (MATRIX.count - 1)) / MATRIX.count;

function cellPosition(index: number) {
  return MATRIX.pad + index * (CELL_SIZE + MATRIX.cellGap);
}

function correlationFill(value: number, isDiagonal: boolean) {
  if (isDiagonal) {
    return "rgba(255,255,255,0.88)";
  }

  const intensity = Math.min(1, Math.abs(value));
  const alpha = 0.1 + intensity * 1.6;

  return `rgba(255,255,255,${alpha.toFixed(3)})`;
}

function correlationTextOpacity(value: number, isDiagonal: boolean) {
  if (isDiagonal) {
    return 0.84;
  }

  return 0.4 + Math.min(1, Math.abs(value)) * 2.2;
}

export function OrthogonalityCorrelationMatrixGraphic() {
  return (
    <div className="marketing-orthogonality-graphic-inner flex w-full justify-center px-4 sm:px-7">
      <svg
        aria-labelledby="correlation-matrix-title correlation-matrix-desc"
        className="block h-auto w-full max-w-[28rem] overflow-visible"
        role="img"
        viewBox={`0 0 ${MATRIX.size} ${MATRIX.size}`}
      >
        <title id="correlation-matrix-title">
          Pairwise correlation matrix for unique agents
        </title>
        <desc id="correlation-matrix-desc">
          An eight by eight correlation matrix with near-zero off-diagonal
          values, showing that the agents are less correlated with one another.
        </desc>
        <defs>
          <radialGradient cx="50%" cy="50%" id="correlation-matrix-glow" r="63%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="62%" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect
          fill="url(#correlation-matrix-glow)"
          height="390"
          rx="46"
          width="390"
          x="15"
          y="15"
        />

        <rect
          fill="rgba(255,255,255,0.035)"
          height={GRID_SIZE + 18}
          rx="18"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="1"
          width={GRID_SIZE + 18}
          x={MATRIX.pad - 9}
          y={MATRIX.pad - 9}
        />

        {CORRELATION_MATRIX.map((row, rowIndex) =>
          row.map((value, columnIndex) => {
            const isDiagonal = rowIndex === columnIndex;
            const x = cellPosition(columnIndex);
            const y = cellPosition(rowIndex);
            const animationDelay = (rowIndex + columnIndex) * 45;

            return (
              <g key={`${rowIndex}-${columnIndex}`}>
                <rect
                  fill={correlationFill(value, isDiagonal)}
                  height={CELL_SIZE}
                  opacity="0"
                  rx="4"
                  width={CELL_SIZE}
                  x={x}
                  y={y}
                >
                  <animate
                    attributeName="opacity"
                    begin={`${animationDelay}ms`}
                    dur="420ms"
                    fill="freeze"
                    from="0"
                    to="1"
                  />
                </rect>
                <text
                  dominantBaseline="middle"
                  fill={isDiagonal ? "#000000" : "#ffffff"}
                  fontFamily="var(--font-google-sans), system-ui, sans-serif"
                  fontSize="9.5"
                  opacity={correlationTextOpacity(value, isDiagonal)}
                  textAnchor="middle"
                  x={x + CELL_SIZE / 2}
                  y={y + CELL_SIZE / 2}
                >
                  {value.toFixed(2)}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

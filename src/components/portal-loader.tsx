type OperatorPortalLoaderProps = {
  fullscreen?: boolean;
};

const LOADING_CELLS = Array.from({ length: 8 }, (_, index) => ({
  x: 10 + index * 40,
  y: 10 + index * 40,
  delayClass: `portal-loader__cell--d${index}`,
}));

export function OperatorPortalLoader({
  fullscreen = false,
}: OperatorPortalLoaderProps) {
  return (
    <div
      className={
        fullscreen
          ? "flex min-h-dvh items-center justify-center bg-background text-foreground"
          : "flex min-h-[calc(100dvh-4.5rem)] items-center justify-center text-foreground"
      }
      role="status"
      aria-live="polite"
      aria-label="Loading admin portal"
    >
      <div className="portal-loader" aria-hidden="true">
        <svg
          className="portal-loader__mark"
          viewBox="0 0 340 340"
          xmlns="http://www.w3.org/2000/svg"
          focusable="false"
        >
          <rect width="340" height="340" fill="#ffffff" />
          <rect x="10" y="10" width="320" height="320" fill="#000000" />
          {LOADING_CELLS.map((cell) => (
            <rect
              key={cell.delayClass}
              className={`portal-loader__cell ${cell.delayClass}`}
              x={cell.x}
              y={cell.y}
              width="40"
              height="40"
            />
          ))}
        </svg>
      </div>
      <span className="sr-only">Loading admin portal</span>
    </div>
  );
}

export const ClientPortalLoader = OperatorPortalLoader;

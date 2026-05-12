import type { ReactNode } from "react";

type PortalPageWidth = "default" | "settings" | "wide";

const pageWidthClass: Record<PortalPageWidth, string> = {
  default: "max-w-[76rem]",
  settings: "max-w-[54rem]",
  wide: "max-w-[86rem]",
};

export function PortalPage({
  eyebrow,
  title,
  description,
  action,
  children,
  width = "wide",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  width?: PortalPageWidth;
}) {
  return (
    <div className="portal-page-shell -mx-6 -mb-12 -mt-6 min-h-full px-4 py-8 sm:px-6 lg:px-8">
      <div className={`mx-auto w-full ${pageWidthClass[width]} space-y-7`}>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted">
              {eyebrow}
            </p>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
            {description ? (
              <p className="max-w-[58rem] text-sm leading-6 text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>

        <div className="space-y-6">{children}</div>
      </div>
    </div>
  );
}

export function PortalCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = Boolean(title || description || action);

  return (
    <section
      className={`portal-card-surface overflow-hidden rounded-xl border shadow-[0_1px_0_rgba(0,0,0,0.02)] ${className}`.trim()}
    >
      {hasHeader ? (
        <div className="portal-card-divider flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            {title ? (
              <h2 className="text-sm font-semibold tracking-[-0.01em]">{title}</h2>
            ) : null}
            {description ? (
              <p className="max-w-[58rem] text-sm leading-6 text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div>{children}</div>
    </section>
  );
}

export function PortalInfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="portal-card-divider grid gap-1 border-b px-5 py-3.5 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
      <span className="text-sm text-muted">{label}</span>
      <span className="min-w-0 break-words font-mono text-xs text-foreground sm:justify-self-end sm:text-right">
        {value}
      </span>
    </div>
  );
}

export function PortalActionRow({
  label,
  detail,
  action,
}: {
  label: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="portal-card-divider flex flex-col gap-3 border-b px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-[46rem] space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-sm leading-6 text-muted">{detail}</p>
      </div>
      {action ? <div className="shrink-0 sm:pl-6">{action}</div> : null}
    </div>
  );
}

export function PortalPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "amber" | "emerald" | "neutral" | "rose";
}) {
  return <span className={`portal-pill portal-pill--${tone}`}>{children}</span>;
}

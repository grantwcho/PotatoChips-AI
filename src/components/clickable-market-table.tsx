"use client";

import { useRouter } from "next/navigation";
import { startTransition, useMemo, useState } from "react";

export type EarningsCalendarRow = {
  id: string;
  href: string;
  dayLabel: string;
  timeLabel: string;
  symbol: string;
  companyName: string;
  marketCapLabel: string;
  epsEstimateLabel: string;
  agentCount: number | null;
};

export type IpoCalendarRow = {
  id: string;
  href: string;
  dateLabel: string;
  symbol: string;
  companyName: string;
  exchange: string;
  valueLabel: string;
};

type ClickableMarketTableProps =
  | {
      kind: "earnings";
      rows: EarningsCalendarRow[];
    }
  | {
      kind: "ipo";
      rows: IpoCalendarRow[];
    };

type SortDir = "asc" | "desc";
const INITIAL_VISIBLE_ROWS = 10;

function parseNumericLabel(label: string): number {
  const cleaned = label.replace(/[$,]/g, "");
  const match = cleaned.match(/^(-?[\d.]+)\s*([TBMK])?/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const suffix = (match[2] ?? "").toUpperCase();
  const multipliers: Record<string, number> = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 };
  return num * (multipliers[suffix] ?? 1);
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "right";
}) {
  return (
    <th
      className={`cursor-pointer select-none px-4 py-4 transition-colors hover:text-black/70 ${align === "right" ? "text-right" : ""}`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[9px] ${active ? "opacity-100" : "opacity-0"}`}>
          {dir === "asc" ? "▲" : "▼"}
        </span>
      </span>
    </th>
  );
}

function RowLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <tr
      tabIndex={0}
      role="link"
      onClick={() => {
        startTransition(() => {
          router.push(href);
        });
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        startTransition(() => {
          router.push(href);
        });
      }}
      className="cursor-pointer border-b border-black/8 transition-colors hover:bg-black/[0.03] focus:bg-black/[0.03] focus:outline-none"
    >
      {children}
    </tr>
  );
}

type EarningsSortKey =
  | "dayLabel"
  | "timeLabel"
  | "symbol"
  | "companyName"
  | "marketCapLabel"
  | "epsEstimateLabel"
  | "agentCount";
type IpoSortKey = "dateLabel" | "symbol" | "companyName" | "exchange" | "valueLabel";

function compareEarnings(a: EarningsCalendarRow, b: EarningsCalendarRow, key: EarningsSortKey, dir: SortDir): number {
  let cmp: number;
  if (key === "marketCapLabel") {
    cmp = parseNumericLabel(a.marketCapLabel) - parseNumericLabel(b.marketCapLabel);
  } else if (key === "epsEstimateLabel") {
    cmp = parseNumericLabel(a.epsEstimateLabel) - parseNumericLabel(b.epsEstimateLabel);
  } else if (key === "agentCount") {
    cmp = (a.agentCount ?? -1) - (b.agentCount ?? -1);
  } else {
    cmp = a[key].localeCompare(b[key]);
  }
  return dir === "asc" ? cmp : -cmp;
}

function compareIpo(a: IpoCalendarRow, b: IpoCalendarRow, key: IpoSortKey, dir: SortDir): number {
  let cmp: number;
  if (key === "valueLabel") {
    cmp = parseNumericLabel(a.valueLabel) - parseNumericLabel(b.valueLabel);
  } else {
    cmp = a[key].localeCompare(b[key]);
  }
  return dir === "asc" ? cmp : -cmp;
}

function EarningsTable({ rows }: { rows: EarningsCalendarRow[] }) {
  const [sortKey, setSortKey] = useState<EarningsSortKey>("marketCapLabel");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS);

  function handleSort(key: EarningsSortKey) {
    setVisibleRows(INITIAL_VISIBLE_ROWS);

    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => compareEarnings(a, b, sortKey, sortDir));
  }, [rows, sortKey, sortDir]);
  const visible = sorted.slice(0, visibleRows);
  const hasMore = visibleRows < sorted.length;

  const cols: { key: EarningsSortKey; label: string; align?: "right" }[] = [
    { key: "dayLabel", label: "Day" },
    { key: "timeLabel", label: "Time" },
    { key: "symbol", label: "Ticker" },
    { key: "companyName", label: "Company" },
    { key: "marketCapLabel", label: "Market cap", align: "right" },
    { key: "epsEstimateLabel", label: "EPS est.", align: "right" },
    { key: "agentCount", label: "Agents", align: "right" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-t border-black/10 text-left">
        <thead>
          <tr className="border-b border-black/10 text-[11px] font-semibold uppercase tracking-[0.22em] text-black/48">
            {cols.map((col) => (
              <SortableHeader
                key={col.key}
                label={col.label}
                active={sortKey === col.key}
                dir={sortKey === col.key ? sortDir : "asc"}
                onClick={() => handleSort(col.key)}
                align={col.align}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-4 py-10 text-center text-sm text-black/50">
                No mega-cap earnings are scheduled for this week.
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <RowLink key={row.id} href={row.href}>
                <td className="px-4 py-4 align-top text-sm text-black/62">{row.dayLabel}</td>
                <td className="px-4 py-4 align-top text-sm text-black/62">{row.timeLabel}</td>
                <td className="px-4 py-4 align-top font-mono text-sm font-semibold text-black">
                  {row.symbol}
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="max-w-[18rem]">
                    <p className="text-sm font-semibold text-black">{row.companyName}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-black/45">
                      Debate dossier
                    </p>
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-right font-mono text-sm text-black/72">
                  {row.marketCapLabel}
                </td>
                <td className="px-4 py-4 align-top text-right font-mono text-sm text-black/72">
                  {row.epsEstimateLabel}
                </td>
                <td className="px-4 py-4 align-top text-right text-sm font-semibold text-black/68">
                  {row.agentCount ?? "—"}
                </td>
              </RowLink>
            ))
          )}
        </tbody>
      </table>

      {hasMore ? (
        <div className="flex justify-center pt-8">
          <button
            type="button"
            onClick={() => {
              setVisibleRows((current) =>
                Math.min(current + INITIAL_VISIBLE_ROWS, sorted.length)
              );
            }}
            className="rounded-full border border-black px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-black transition-colors hover:bg-black hover:text-white"
          >
            Show 10 more
          </button>
        </div>
      ) : null}
    </div>
  );
}

function IpoTable({ rows }: { rows: IpoCalendarRow[] }) {
  const [sortKey, setSortKey] = useState<IpoSortKey>("valueLabel");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS);

  function handleSort(key: IpoSortKey) {
    setVisibleRows(INITIAL_VISIBLE_ROWS);

    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => compareIpo(a, b, sortKey, sortDir));
  }, [rows, sortKey, sortDir]);
  const visible = sorted.slice(0, visibleRows);
  const hasMore = visibleRows < sorted.length;

  const cols: { key: IpoSortKey; label: string; align?: "right" }[] = [
    { key: "dateLabel", label: "Date" },
    { key: "symbol", label: "Ticker" },
    { key: "companyName", label: "Company" },
    { key: "exchange", label: "Exchange" },
    { key: "valueLabel", label: "Value", align: "right" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-t border-black/10 text-left">
        <thead>
          <tr className="border-b border-black/10 text-[11px] font-semibold uppercase tracking-[0.22em] text-black/48">
            {cols.map((col) => (
              <SortableHeader
                key={col.key}
                label={col.label}
                active={sortKey === col.key}
                dir={sortKey === col.key ? sortDir : "asc"}
                onClick={() => handleSort(col.key)}
                align={col.align}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-4 py-10 text-center text-sm text-black/50">
                No qualifying IPOs are scheduled for this week.
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <RowLink key={row.id} href={row.href}>
                <td className="px-4 py-4 align-top text-sm text-black/62">{row.dateLabel}</td>
                <td className="px-4 py-4 align-top font-mono text-sm font-semibold text-black">
                  {row.symbol}
                </td>
                <td className="px-4 py-4 align-top text-sm font-semibold text-black">
                  {row.companyName}
                </td>
                <td className="px-4 py-4 align-top text-sm text-black/62">{row.exchange}</td>
                <td className="px-4 py-4 align-top text-right font-mono text-sm text-black/72">
                  {row.valueLabel}
                </td>
              </RowLink>
            ))
          )}
        </tbody>
      </table>

      {hasMore ? (
        <div className="flex justify-center pt-8">
          <button
            type="button"
            onClick={() => {
              setVisibleRows((current) =>
                Math.min(current + INITIAL_VISIBLE_ROWS, sorted.length)
              );
            }}
            className="rounded-full border border-black px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-black transition-colors hover:bg-black hover:text-white"
          >
            Show 10 more
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ClickableMarketTable(props: ClickableMarketTableProps) {
  if (props.kind === "earnings") {
    return <EarningsTable rows={props.rows} />;
  }

  return <IpoTable rows={props.rows} />;
}

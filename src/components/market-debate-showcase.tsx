import {
  type EarningsCalendarRow,
  type IpoCalendarRow,
} from "@/components/clickable-market-table";
import {
  getMegaCapEarningsCalendar,
  getMegaCapIpoCalendar,
} from "@/lib/stocks/coverage-data";
import { CalendarTabs } from "./calendar-tabs";

function formatDateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...options,
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatDayLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function MarketDebateShowcase() {
  const earningsRows: EarningsCalendarRow[] = getMegaCapEarningsCalendar().map((entry) => ({
    id: entry.symbol,
    href: `/stocks/${entry.symbol.toLowerCase()}`,
    dayLabel: formatDayLabel(entry.earningsDate),
    timeLabel: entry.earningsTiming === "Before open" ? "Before open" : "After close",
    symbol: entry.symbol,
    companyName: entry.companyName,
    marketCapLabel: entry.marketCapLabel,
    epsEstimateLabel: entry.epsEstimateLabel,
    agentCount: entry.researchProgram?.activeAgents ?? entry.agentViews.length,
  }));
  const ipoRows: IpoCalendarRow[] = getMegaCapIpoCalendar().map((entry) => ({
    id: entry.symbol,
    href: entry.symbol ? `/stocks/${entry.symbol.toLowerCase()}` : "/",
    dateLabel: formatDateLabel(entry.expectedDate),
    symbol: entry.symbol,
    companyName: entry.companyName,
    exchange: entry.exchange,
    valueLabel: entry.valueLabel,
  }));

  return (
    <section className="marketing-page-light relative overflow-hidden border-t border-black/8 py-20 lg:py-28">
      <div className="marketing-container relative">
        <div className="marketing-rail">
          <div className="text-center">
            <p className="marketing-kicker flex-col gap-3">Market Calendar</p>
            <h2 className="mx-auto mt-8 max-w-4xl font-display text-[clamp(2.7rem,5.2vw,5.1rem)] leading-[0.95] tracking-[-0.05em] text-balance text-black">
              Witness agents mapping financial questions
            </h2>
            <p className="mx-auto mt-8 max-w-2xl text-[1.03rem] leading-[1.86] text-black/68 lg:text-[1.1rem]">
              Our agents are constantly researching, debating, coding, simulating, and evolving to
              unlock financial insights no single human can.
            </p>
          </div>
          <CalendarTabs earningsRows={earningsRows} ipoRows={ipoRows} />
        </div>
      </div>
    </section>
  );
}

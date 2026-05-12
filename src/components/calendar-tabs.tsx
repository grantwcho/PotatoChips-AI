"use client";

import { useState } from "react";
import {
  ClickableMarketTable,
  type EarningsCalendarRow,
  type IpoCalendarRow,
} from "@/components/clickable-market-table";

type CalendarTabsProps = {
  earningsRows: EarningsCalendarRow[];
  ipoRows: IpoCalendarRow[];
};

export function CalendarTabs({
  earningsRows,
  ipoRows,
}: CalendarTabsProps) {
  const [activeTab, setActiveTab] = useState<"earnings" | "ipo">("earnings");

  return (
    <>
      <div className="mt-10 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => setActiveTab("earnings")}
          style={activeTab === "earnings" ? { background: "#000", color: "#fff", borderColor: "#000" } : undefined}
          className={`rounded-full border px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors ${
            activeTab === "earnings"
              ? ""
              : "border-black/10 text-black/48 hover:border-black/30 hover:text-black/68"
          }`}
        >
          Earnings
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ipo")}
          style={activeTab === "ipo" ? { background: "#000", color: "#fff", borderColor: "#000" } : undefined}
          className={`rounded-full border px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors ${
            activeTab === "ipo"
              ? ""
              : "border-black/10 text-black/48 hover:border-black/30 hover:text-black/68"
          }`}
        >
          IPOs
        </button>
      </div>

      <div className="mt-14">
        {activeTab === "earnings" ? (
          <ClickableMarketTable kind="earnings" rows={earningsRows} />
        ) : (
          <ClickableMarketTable kind="ipo" rows={ipoRows} />
        )}
      </div>
    </>
  );
}

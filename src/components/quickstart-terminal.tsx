"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";

export type QuickstartTerminalTab = {
  commands: string[];
  label: string;
  windowsCommands?: string[];
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

function detectWindowsPlatform() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const nav = navigator as NavigatorWithUserAgentData;
  const platformValues = [
    nav.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ];

  return platformValues.some((value) => /win|windows/i.test(value ?? ""));
}

function getTabCommands(tab: QuickstartTerminalTab, isWindows: boolean) {
  return isWindows && tab.windowsCommands?.length
    ? tab.windowsCommands
    : tab.commands;
}

function subscribeToPlatformChanges() {
  return () => {};
}

export function QuickstartTerminal({
  tabs,
  variant = "default",
}: {
  tabs: QuickstartTerminalTab[];
  variant?: "default" | "submit";
}) {
  const [copied, setCopied] = useState(false);
  const isSubmitVariant = variant === "submit";
  const isWindows = useSyncExternalStore(
    subscribeToPlatformChanges,
    detectWindowsPlatform,
    () => false,
  );
  const [activeTab, setActiveTab] = useState(tabs[0]?.label ?? "");
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const selectedTextRef = useRef("");

  const selectedTab = useMemo(
    () => tabs.find((tab) => tab.label === activeTab) ?? tabs[0],
    [activeTab, tabs],
  );
  const selectedCommands = useMemo(
    () => getTabCommands(selectedTab, isWindows),
    [isWindows, selectedTab],
  );
  const commandBlock = useMemo(
    () => selectedCommands.join("\n"),
    [selectedCommands],
  );

  function getSelectedTerminalText() {
    const root = terminalRef.current;
    const selection = window.getSelection();

    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return "";
    }

    const { anchorNode, focusNode } = selection;

    if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
      return "";
    }

    return selection.toString().trim();
  }

  function captureSelectedText() {
    selectedTextRef.current = getSelectedTerminalText();
  }

  async function handleCopy() {
    try {
      const selectedText = selectedTextRef.current || getSelectedTerminalText();

      await navigator.clipboard.writeText(selectedText || commandBlock);
      setCopied(true);
      selectedTextRef.current = "";
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      ref={terminalRef}
      className={
        isSubmitVariant
          ? "quickstart-terminal quickstart-terminal--submit overflow-hidden border border-black/12 bg-white text-black select-text"
          : "quickstart-terminal overflow-hidden rounded-[1rem] border border-white/10 bg-[#171717] text-white select-text"
      }
    >
      <div
        className={
          isSubmitVariant
            ? "quickstart-terminal__bar--submit flex min-h-[3.15rem] items-center justify-between gap-4 border-b px-4 py-2.5 select-none sm:px-5"
            : "flex min-h-[52px] items-center justify-between gap-4 border-b border-white/8 bg-[#202020] px-5 py-3 select-none sm:px-6"
        }
      >
        <div className={isSubmitVariant ? "flex min-w-0 items-center gap-3" : "flex items-center gap-4"}>
          <div
            className={
              isSubmitVariant
                ? "flex items-center gap-1.5 text-white/42"
                : "flex items-center gap-1.5"
            }
          >
            <span
              className={
                isSubmitVariant
                  ? "h-1.5 w-1.5 rounded-full bg-current"
                  : "h-2.5 w-2.5 rounded-full bg-[#ff5f56]"
              }
            />
            <span
              className={
                isSubmitVariant
                  ? "h-1.5 w-1.5 rounded-full bg-current"
                  : "h-2.5 w-2.5 rounded-full bg-[#ffbd2e]"
              }
            />
            <span
              className={
                isSubmitVariant
                  ? "h-1.5 w-1.5 rounded-full bg-current"
                  : "h-2.5 w-2.5 rounded-full bg-[#27c93f]"
              }
            />
          </div>
          <div className={isSubmitVariant ? "flex min-w-0 items-center gap-1" : "flex items-end gap-1"}>
            {tabs.map((tab) => {
              const isActive = tab.label === selectedTab.label;

              return (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => setActiveTab(tab.label)}
                  className={
                    isSubmitVariant
                      ? `inline-flex min-h-10 items-center border-b px-3 text-[11px] font-semibold uppercase tracking-[0.14em] transition sm:px-4 ${
                          isActive
                            ? "border-white text-white"
                            : "border-transparent text-white/46 hover:text-white/72"
                        }`
                      : `inline-flex min-h-[52px] items-center border-x border-t px-6 text-[12px] font-semibold transition ${
                          isActive
                            ? "border-white/10 bg-[#171717] text-white shadow-[inset_0_-2px_0_rgba(255,255,255,0.28)]"
                            : "border-transparent text-white/72 hover:text-white/88"
                        }`
                  }
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onPointerDown={captureSelectedText}
          onClick={handleCopy}
          className={
            isSubmitVariant
              ? "inline-flex min-h-10 shrink-0 items-center border-l border-white/18 pl-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/62 transition hover:text-white"
              : "inline-flex min-h-[52px] items-center border-l border-white/8 pl-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/78 transition hover:text-white"
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="grid">
        {tabs.map((tab) => (
          <pre
            key={`${tab.label}-sizer`}
            aria-hidden="true"
            className={
              isSubmitVariant
                ? "pointer-events-none col-start-1 row-start-1 overflow-x-hidden whitespace-pre-wrap break-words px-4 py-4 font-mono text-[0.78rem] leading-[1.8] text-transparent select-none sm:px-5 sm:text-[0.82rem]"
                : "pointer-events-none col-start-1 row-start-1 overflow-x-hidden whitespace-pre-wrap break-words px-[18px] py-[18px] font-mono text-[0.84rem] leading-[1.7] text-transparent select-none sm:px-6 sm:text-[0.9rem] lg:text-[0.94rem]"
            }
          >
            <code>
              {getTabCommands(tab, isWindows).map((command) => (
                <span key={command} className="flex items-start">
                  <span className="mr-3 shrink-0">$</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words">
                    {command}
                  </span>
                </span>
              ))}
            </code>
          </pre>
        ))}
        <pre
          className={
            isSubmitVariant
              ? "relative z-10 col-start-1 row-start-1 cursor-text overflow-x-hidden whitespace-pre-wrap break-words px-4 py-4 font-mono text-[0.78rem] leading-[1.8] text-black select-text sm:px-5 sm:text-[0.82rem]"
              : "relative z-10 col-start-1 row-start-1 cursor-text overflow-x-hidden whitespace-pre-wrap break-words px-[18px] py-[18px] font-mono text-[0.84rem] leading-[1.7] text-white select-text sm:px-6 sm:text-[0.9rem] lg:text-[0.94rem]"
          }
        >
          <code>
            {selectedCommands.map((command) => (
              <span key={command} className="flex items-start">
                <span
                  className={
                    isSubmitVariant
                      ? "mr-3 shrink-0 text-black/38"
                      : "mr-3 shrink-0 text-[#00ff00]"
                  }
                >
                  $
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">
                  {command}
                </span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

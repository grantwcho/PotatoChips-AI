"use client";

import { EnvironmentVariablesEditor } from "@/components/dashboard/environment-variables-editor";
import { PortalCard, PortalPage, PortalPill } from "@/components/portal-page";
import type { DashboardToolsData } from "@/lib/dashboard/tool-access";

function accessBadgeClass(status: DashboardToolsData["tools"][number]["accessStatus"]) {
  switch (status) {
    case "configured":
      return "bg-emerald-50 text-emerald-800";
    case "partial":
      return "bg-amber-50 text-amber-800";
    case "missing":
      return "bg-rose-50 text-rose-800";
    default:
      return "bg-neutral-100 text-muted";
  }
}

export function DashboardToolsClient({
  initialData,
}: {
  initialData: DashboardToolsData;
}) {
  const stats = [
    `${initialData.environmentVariables.length} environment variables`,
    `${initialData.stats.total} detected requirements`,
    `${initialData.stats.configured} configured`,
    `${initialData.stats.partial} partial`,
    `${initialData.stats.missing} missing`,
  ];

  return (
    <PortalPage
      eyebrow="Admin Portal"
      title="Runtime environment variables."
      description="Configure the container variables that signed submissions need at runtime. External APIs and tools are tracked as sources for these variables, rather than as separate credential forms."
    >

      <div className="flex flex-wrap gap-2">
        {stats.map((stat) => (
          <PortalPill key={stat}>{stat}</PortalPill>
        ))}
        <PortalPill tone={initialData.cloudSyncAvailable ? "emerald" : "amber"}>
          {initialData.cloudSyncAvailable ? "Secret Manager sync enabled" : "Secret Manager sync unavailable"}
        </PortalPill>
      </div>

      <PortalCard>
        <div className="px-5 py-4 text-sm text-muted">{initialData.cloudSyncNote}</div>
      </PortalCard>

      <PortalCard>
        <div className="px-5 py-5">
          <EnvironmentVariablesEditor
            environmentVariables={initialData.environmentVariables}
            requirements={initialData.tools}
            saveEndpoint="/api/dashboard/tools"
          />
        </div>
      </PortalCard>

      {initialData.tools.length > 0 ? (
        <PortalCard
          title="Detected requirement sources"
          description="External APIs, model providers, and tools that requested the environment variables above."
        >
          <div className="divide-y divide-border">
            {initialData.tools.map((tool) => (
              <div key={tool.key} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{tool.label}</h2>
                  <span className="rounded bg-neutral-100 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-muted">
                    {tool.typeLabel}
                  </span>
                  <span className={`rounded px-2 py-1 text-[11px] uppercase tracking-[0.14em] ${accessBadgeClass(tool.accessStatus)}`}>
                    {tool.accessLabel}
                  </span>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{tool.summary}</p>
                {tool.envVars.length > 0 ? (
                  <p className="mt-2 font-mono text-xs text-muted">
                    {tool.envVars.map((envVar) => envVar.envVarName).join(", ")}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted">
                  Used by {tool.usedBy.length} submission{tool.usedBy.length === 1 ? "" : "s"}:{" "}
                  {tool.usedBy.map((entry) => entry.agentName).join(", ")}
                </p>
              </div>
            ))}
          </div>
        </PortalCard>
      ) : null}
    </PortalPage>
  );
}

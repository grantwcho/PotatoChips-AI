"use client";

import { startTransition, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DashboardToolEnvVar,
  DashboardToolRequirement,
} from "@/lib/dashboard/tool-access";

type EnvironmentVariablesEditorProps = {
  environmentVariables?: DashboardToolEnvVar[];
  requirements: DashboardToolRequirement[];
  saveEndpoint: string;
};

type EditorRow = {
  configured: boolean;
  envVar: DashboardToolEnvVar | null;
  id: string;
  name: string;
  syncMessage: string | null;
  usedBy: string[];
};

function syncBadgeClass(syncState: DashboardToolEnvVar["syncState"]) {
  switch (syncState) {
    case "SECRET_MANAGER_SYNCED":
      return "bg-emerald-50 text-emerald-800";
    case "ERROR":
      return "bg-rose-50 text-rose-800";
    case "CONFIGURED_IN_RUNTIME":
      return "bg-blue-50 text-blue-800";
    case "LOCAL_ONLY":
      return "bg-amber-50 text-amber-800";
    default:
      return "bg-neutral-100 text-muted";
  }
}

function formatSyncLabel(syncState: DashboardToolEnvVar["syncState"]) {
  switch (syncState) {
    case "SECRET_MANAGER_SYNCED":
      return "Secret Manager synced";
    case "ERROR":
      return "Cloud sync issue";
    case "CONFIGURED_IN_RUNTIME":
      return "Runtime env";
    case "LOCAL_ONLY":
      return "Stored locally";
    default:
      return "Missing";
  }
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function normalizeEnvVarName(value: string) {
  return value.trim().toUpperCase();
}

function isValidEnvVarName(value: string) {
  return /^[A-Z][A-Z0-9_]*$/.test(value);
}

function stripOptionalQuotes(value: string) {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if (
    trimmed.length >= 2 &&
    (quote === "\"" || quote === "'") &&
    trimmed.at(-1) === quote
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseDotenv(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
      const separatorIndex = normalizedLine.indexOf("=");

      if (separatorIndex <= 0) {
        return null;
      }

      const name = normalizeEnvVarName(normalizedLine.slice(0, separatorIndex));
      const rawValue = normalizedLine.slice(separatorIndex + 1);

      if (!isValidEnvVarName(name)) {
        return null;
      }

      return {
        name,
        value: stripOptionalQuotes(rawValue),
      };
    })
    .filter((entry): entry is { name: string; value: string } => Boolean(entry));
}

function buildRequirementUsage(requirements: DashboardToolRequirement[]) {
  const usageByEnvVar = new Map<string, Set<string>>();

  for (const requirement of requirements) {
    for (const envVar of requirement.envVars) {
      const usage = usageByEnvVar.get(envVar.envVarName) ?? new Set<string>();

      for (const reference of requirement.usedBy) {
        usage.add(reference.agentName);
      }

      usageByEnvVar.set(envVar.envVarName, usage);
    }
  }

  return usageByEnvVar;
}

function buildRows(
  requirements: DashboardToolRequirement[],
  environmentVariables?: DashboardToolEnvVar[]
) {
  const usageByEnvVar = buildRequirementUsage(requirements);
  const envVarMap = new Map<string, DashboardToolEnvVar>();

  for (const requirement of requirements) {
    for (const envVar of requirement.envVars) {
      envVarMap.set(envVar.envVarName, envVar);
    }
  }

  for (const envVar of environmentVariables ?? []) {
    envVarMap.set(envVar.envVarName, envVar);
  }

  return Array.from(envVarMap.values())
    .sort((left, right) => {
      if (left.configured !== right.configured) {
        return left.configured ? 1 : -1;
      }

      return left.envVarName.localeCompare(right.envVarName);
    })
    .map((envVar) => ({
      configured: envVar.configured,
      envVar,
      id: `detected:${envVar.envVarName}`,
      name: envVar.envVarName,
      syncMessage: envVar.syncMessage,
      usedBy: Array.from(usageByEnvVar.get(envVar.envVarName) ?? []),
    }));
}

function buildCustomRow(index: number): EditorRow {
  return {
    configured: false,
    envVar: null,
    id: `custom:${Date.now()}:${index}`,
    name: "",
    syncMessage: null,
    usedBy: [],
  };
}

export function EnvironmentVariablesEditor({
  environmentVariables,
  requirements,
  saveEndpoint,
}: EnvironmentVariablesEditorProps) {
  const router = useRouter();
  const detectedRows = useMemo(
    () => buildRows(requirements, environmentVariables),
    [environmentVariables, requirements]
  );
  const [customRows, setCustomRows] = useState<EditorRow[]>(() =>
    detectedRows.length === 0 ? [buildCustomRow(0)] : []
  );
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [valueDrafts, setValueDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [errorByRow, setErrorByRow] = useState<Record<string, string>>({});
  const rows = [...detectedRows, ...customRows];

  function getRowName(row: EditorRow) {
    return nameDrafts[row.id] ?? row.name;
  }

  function getRowValue(row: EditorRow) {
    return valueDrafts[row.id] ?? "";
  }

  function setRowName(rowId: string, value: string) {
    setNameDrafts((current) => ({
      ...current,
      [rowId]: value,
    }));
  }

  function setRowValue(rowId: string, value: string) {
    setValueDrafts((current) => ({
      ...current,
      [rowId]: value,
    }));
  }

  function applyDotenvPaste(startIndex: number, rawValue: string) {
    const parsed = parseDotenv(rawValue);

    if (parsed.length === 0) {
      return false;
    }

    const missingRows = Math.max(0, startIndex + parsed.length - rows.length);
    const nextCustomRows = [
      ...customRows,
      ...Array.from({ length: missingRows }, (_, index) =>
        buildCustomRow(customRows.length + index)
      ),
    ];
    const targetRows = [...detectedRows, ...nextCustomRows];

    setCustomRows(nextCustomRows);
    setNameDrafts((current) => {
      const next = { ...current };

      parsed.forEach((entry, index) => {
        const row = targetRows[startIndex + index];

        if (row) {
          next[row.id] = entry.name;
        }
      });

      return next;
    });
    setValueDrafts((current) => {
      const next = { ...current };

      parsed.forEach((entry, index) => {
        const row = targetRows[startIndex + index];

        if (row) {
          next[row.id] = entry.value;
        }
      });

      return next;
    });

    return true;
  }

  function addVariable() {
    setCustomRows((current) => [...current, buildCustomRow(current.length)]);
  }

  function removeCustomRow(rowId: string) {
    setCustomRows((current) => current.filter((row) => row.id !== rowId));
    setNameDrafts((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
    setValueDrafts((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
    setErrorByRow((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }

  async function saveVariables() {
    const nextErrors: Record<string, string> = {};
    const candidates = rows
      .map((row) => ({
        envVarName: normalizeEnvVarName(getRowName(row)),
        row,
        value: getRowValue(row).trim(),
      }))
      .filter((entry) => entry.envVarName || entry.value);

    for (const candidate of candidates) {
      if (!candidate.envVarName) {
        nextErrors[candidate.row.id] = "Enter a name.";
      } else if (!isValidEnvVarName(candidate.envVarName)) {
        nextErrors[candidate.row.id] = "Use A-Z, 0-9, and underscores.";
      } else if (!candidate.value) {
        nextErrors[candidate.row.id] = "Enter a value.";
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrorByRow(nextErrors);
      setGeneralError("Fix the highlighted environment variables before saving.");
      return;
    }

    const saveCandidates = candidates.filter((candidate) => candidate.value);

    if (saveCandidates.length === 0) {
      setGeneralError("Enter at least one environment variable value to save.");
      return;
    }

    setPending(true);
    setGeneralError(null);
    setErrorByRow({});

    const failedRows: Record<string, string> = {};

    for (const candidate of saveCandidates) {
      try {
        const response = await fetch(saveEndpoint, {
          body: JSON.stringify({
            envVarName: candidate.envVarName,
            value: candidate.value,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(body.error || "Unable to save this variable.");
        }
      } catch (error) {
        failedRows[candidate.row.id] =
          error instanceof Error ? error.message : "Unable to save this variable.";
      }
    }

    setPending(false);

    if (Object.keys(failedRows).length > 0) {
      setErrorByRow(failedRows);
      setGeneralError("Some environment variables could not be saved.");
      return;
    }

    setValueDrafts((current) => {
      const next = { ...current };

      for (const candidate of saveCandidates) {
        delete next[candidate.row.id];
      }

      return next;
    });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
          Environment variables
        </h2>
        <p className="text-sm leading-6 text-muted">
          Paste a .env file into the name input field to populate environment variables in bulk.
        </p>
      </div>

      <div className="space-y-4">
        {rows.map((row, index) => {
          const envVar = row.envVar;
          const value = getRowValue(row);
          const name = getRowName(row);
          const lastUpdated = formatTimestamp(envVar?.lastUpdatedAt ?? null);

          return (
            <div key={row.id} className="space-y-2">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <fieldset className="rounded-md border border-border px-3 pb-3 pt-1.5">
                  <legend className="px-2 text-sm text-muted">Name {index + 1}</legend>
                  <input
                    autoComplete="off"
                    className="w-full bg-transparent text-base text-foreground outline-none"
                    onChange={(event) => {
                      if (applyDotenvPaste(index, event.target.value)) {
                        return;
                      }

                      setRowName(row.id, event.target.value);
                    }}
                    placeholder="ENV"
                    value={name}
                  />
                </fieldset>
                <fieldset className="rounded-md border border-border px-3 pb-3 pt-1.5">
                  <legend className="px-2 text-sm text-muted">Value {index + 1}</legend>
                  <input
                    autoComplete="off"
                    className="w-full bg-transparent text-base text-foreground outline-none"
                    onChange={(event) => setRowValue(row.id, event.target.value)}
                    placeholder={
                      row.configured
                        ? "Configured; enter a new value to update"
                        : "prod"
                    }
                    value={value}
                  />
                </fieldset>
              </div>
              <div className="grid gap-2 text-xs text-muted lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="px-6">e.g. ENV, or paste .env file</div>
                <div className="flex flex-wrap items-center gap-2 px-6">
                  <span>e.g. prod</span>
                  {envVar ? (
                    <span
                      className={`rounded px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${syncBadgeClass(
                        envVar.syncState
                      )}`}
                    >
                      {formatSyncLabel(envVar.syncState)}
                    </span>
                  ) : null}
                  {lastUpdated ? <span>Last updated {lastUpdated}</span> : null}
                </div>
              </div>
              {row.usedBy.length > 0 || row.syncMessage || errorByRow[row.id] ? (
                <div className="space-y-1 px-6 text-xs leading-5 text-muted">
                  {row.usedBy.length > 0 ? (
                    <p>Used by {row.usedBy.join(", ")}</p>
                  ) : null}
                  {row.syncMessage ? <p>{row.syncMessage}</p> : null}
                  {errorByRow[row.id] ? (
                    <p className="text-rose-700">{errorByRow[row.id]}</p>
                  ) : null}
                </div>
              ) : null}
              {row.id.startsWith("custom:") ? (
                <div className="px-6">
                  <button
                    className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:text-foreground"
                    onClick={() => removeCustomRow(row.id)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {generalError ? <p className="text-sm text-rose-700">{generalError}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-foreground transition-colors hover:border-black disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending}
          onClick={addVariable}
          type="button"
        >
          Add variable
        </button>
        <button
          className="inline-flex items-center justify-center rounded-md border border-black bg-black px-4 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white transition-colors hover:bg-black/86 disabled:cursor-not-allowed disabled:bg-black/35"
          disabled={pending}
          onClick={saveVariables}
          type="button"
        >
          {pending ? "Saving..." : "Save variables"}
        </button>
      </div>
    </div>
  );
}

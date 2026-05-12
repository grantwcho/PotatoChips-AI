import "server-only";

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_AGENT_SEEDS } from "@/lib/agents/default-agents";
import {
  isPythonTradingAgentId,
  type PythonTradingAgentId,
} from "@/lib/agents/trading-agent-config";

const PYTHON_RESOLUTION_TIMEOUT_MS = 8_000;

const AGENT_REQUIRED_MODULES: Record<PythonTradingAgentId, string[]> = {
  "AGT-STATARB-001": ["numpy", "pandas", "yaml", "statsmodels"],
  "AGT-TREND-001": ["numpy", "pandas", "yaml"],
  "AGT-VOL-001": ["numpy", "pandas", "yaml"],
};

type PythonRuntimeCheck =
  | {
      executable: string;
      ok: true;
    }
  | {
      ok: false;
      reason: string;
    };

const pythonExecutableCache = new Map<string, Promise<string>>();

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

async function maybeHasFilesystemPath(candidate: string) {
  if (!candidate.includes(path.sep)) {
    return true;
  }

  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function runPythonCheck(input: {
  modules: string[];
  pythonBin: string;
}): Promise<PythonRuntimeCheck> {
  if (!(await maybeHasFilesystemPath(input.pythonBin))) {
    return {
      ok: false,
      reason: "not found",
    };
  }

  return await new Promise<PythonRuntimeCheck>((resolve) => {
    const script = [
      "import importlib.util, json, sys",
      `modules = ${JSON.stringify(input.modules)}`,
      "missing = [module for module in modules if importlib.util.find_spec(module) is None]",
      'print(json.dumps({"executable": sys.executable, "missing": missing}))',
    ].join("; ");
    const child = spawn(input.pythonBin, ["-c", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        reason: `timed out after ${PYTHON_RESOLUTION_TIMEOUT_MS}ms`,
      });
    }, PYTHON_RESOLUTION_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        reason: error instanceof Error ? error.message : "failed to launch",
      });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if ((code ?? 0) !== 0) {
        resolve({
          ok: false,
          reason: stderr.trim() || `exited with code ${code ?? 0}`,
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as {
          executable?: unknown;
          missing?: unknown;
        };
        const missing = Array.isArray(parsed.missing)
          ? parsed.missing.filter((value): value is string => typeof value === "string")
          : [];

        if (missing.length > 0) {
          resolve({
            ok: false,
            reason: `missing modules: ${missing.join(", ")}`,
          });
          return;
        }

        resolve({
          ok: true,
          executable:
            typeof parsed.executable === "string" && parsed.executable.trim()
              ? parsed.executable.trim()
              : input.pythonBin,
        });
      } catch (error) {
        resolve({
          ok: false,
          reason:
            error instanceof Error
              ? `invalid runtime probe output: ${error.message}`
              : "invalid runtime probe output",
        });
      }
    });
  });
}

function getPythonCandidates() {
  return unique([
    process.env.PYTHON_TRADING_AGENT_BIN?.trim(),
    path.resolve(process.cwd(), ".venv/bin/python"),
    path.resolve(process.cwd(), "venv/bin/python"),
    "python3",
    "/usr/bin/python3",
    "python",
  ]);
}

export function getPythonAgentExecutionConfig(agentId: PythonTradingAgentId) {
  const seed = DEFAULT_AGENT_SEEDS.find((candidate) => candidate.id === agentId);
  const packagePath =
    seed?.config && typeof seed.config.packagePath === "string"
      ? seed.config.packagePath
      : null;
  const configPath =
    seed?.config && typeof seed.config.configPath === "string"
      ? seed.config.configPath
      : null;

  if (!packagePath || !configPath) {
    throw new Error(`Python research agent ${agentId} is missing package/config metadata.`);
  }

  return {
    cwd: path.resolve(process.cwd(), packagePath),
    configPath: path.resolve(process.cwd(), configPath),
  };
}

export async function resolvePythonExecutable(input: {
  label: string;
  requiredModules: string[];
}) {
  const cacheKey = `${input.label}:${input.requiredModules.join(",")}`;
  const cached = pythonExecutableCache.get(cacheKey);

  if (cached) {
    return await cached;
  }

  const resolutionPromise = (async () => {
    const attempts: string[] = [];

    for (const candidate of getPythonCandidates()) {
      const result = await runPythonCheck({
        pythonBin: candidate,
        modules: input.requiredModules,
      });

      if (result.ok) {
        return candidate;
      }

      attempts.push(`${candidate} (${result.reason})`);
    }

    throw new Error(
      [
        `No usable Python runtime found for ${input.label}.`,
        `Required modules: ${input.requiredModules.join(", ")}.`,
        `Tried: ${attempts.join("; ")}.`,
        "Set PYTHON_TRADING_AGENT_BIN to a Python environment with the research-agent dependencies installed.",
      ].join("\n")
    );
  })();

  pythonExecutableCache.set(cacheKey, resolutionPromise);

  try {
    return await resolutionPromise;
  } catch (error) {
    pythonExecutableCache.delete(cacheKey);
    throw error;
  }
}

export async function resolvePythonTradingAgentRuntime(agentId: PythonTradingAgentId) {
  if (!isPythonTradingAgentId(agentId)) {
    throw new Error(`Unsupported Python research agent id: ${agentId}`);
  }

  const { cwd, configPath } = getPythonAgentExecutionConfig(agentId);
  const pythonBin = await resolvePythonExecutable({
    label: agentId,
    requiredModules: AGENT_REQUIRED_MODULES[agentId],
  });

  return {
    cwd,
    configPath,
    pythonBin,
  };
}

export async function resolvePythonBenchmarkRuntime() {
  return await resolvePythonExecutable({
    label: "dashboard benchmark replay",
    requiredModules: ["pandas"],
  });
}

export function summarizePythonExecutionFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Python execution failed.";
  const normalized = message.toLowerCase();
  const missingModule = message.match(/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/);

  if (missingModule) {
    return `Python runtime is missing \`${missingModule[1]}\`. Set \`PYTHON_TRADING_AGENT_BIN\` to an environment with the research-agent dependencies installed.`;
  }

  if (
    normalized.includes("no usable python runtime found") ||
    normalized.includes("set python_trading_agent_bin")
  ) {
    const lines = message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.at(-1) ?? message;
  }

  if (
    normalized.includes("could not resolve host") ||
    normalized.includes("dns") ||
    normalized.includes("configured market-data provider returned no") ||
    normalized.includes("no configured market-data provider returned")
  ) {
    return "Market data fetch failed in the current environment. Python replays need outbound access to the configured approved data providers.";
  }

  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1) ?? message;
}

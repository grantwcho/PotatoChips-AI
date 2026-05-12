import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import {
  resolvePythonTradingAgentRuntime,
  summarizePythonExecutionFailure,
} from "@/lib/agents/python-runtime";
import { isPythonTradingAgentId, type PythonTradingAgentId } from "@/lib/agents/trading-agent-config";

type JsonRecord = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_STATE_DIR = "/tmp/gptcapital-agent-state";

function parseStdout(stdout: string, agentId: PythonTradingAgentId) {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error(`${agentId} did not return any JSON output.`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `${agentId} returned invalid JSON: ${error instanceof Error ? error.message : "unknown parse failure"}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${agentId} returned a non-object payload.`);
  }

  return parsed as JsonRecord;
}

export async function runPythonTradingAgent(input: {
  agentId: PythonTradingAgentId;
  payload: JsonRecord;
  timeoutMs?: number;
}) {
  if (!isPythonTradingAgentId(input.agentId)) {
    throw new Error(`Unsupported Python research agent id: ${input.agentId}`);
  }

  const { cwd, configPath, pythonBin } = await resolvePythonTradingAgentRuntime(input.agentId);
  const stateDir =
    process.env.GPTCAPITAL_AGENT_STATE_DIR?.trim() || DEFAULT_STATE_DIR;
  const timeoutMs = Math.max(5_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const repoPythonPath = process.cwd();

  return await new Promise<JsonRecord>((resolve, reject) => {
    const child = spawn(pythonBin, ["main.py", "--config", configPath], {
      cwd,
      env: {
        ...process.env,
        GPTCAPITAL_AGENT_STATE_DIR: stateDir,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${repoPythonPath}${path.delimiter}${process.env.PYTHONPATH}`
          : repoPythonPath,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
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
      reject(new Error(`${input.agentId} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

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
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if ((exitCode ?? 0) !== 0) {
        reject(
          new Error(
            summarizePythonExecutionFailure(
              `${input.agentId} exited with code ${exitCode ?? 0}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`
            )
          )
        );
        return;
      }

      try {
        resolve(parseStdout(stdout, input.agentId));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.write(JSON.stringify(input.payload));
    child.stdin.end();
  });
}

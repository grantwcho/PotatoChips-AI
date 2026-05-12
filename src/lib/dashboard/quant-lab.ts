import "server-only";

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DashboardQuantLabBenchmarkMetric,
  DashboardQuantLabCodeSnippet,
  DashboardQuantLabCommitDetailData,
  DashboardQuantLabCommitRow,
  DashboardQuantLabData,
  DashboardQuantLabKpiCheck,
  DashboardQuantLabStrategyCard,
  DashboardQuantLabSummaryMetric,
} from "@/lib/dashboard/types";

const execFileAsync = promisify(execFile);

type StrategyKey = "statarb" | "trend" | "volatility" | "platform";
type BenchmarkStrategyKey = Exclude<StrategyKey, "platform">;
type CommitStatus = DashboardQuantLabCommitRow["status"];
type KpiStatus = DashboardQuantLabKpiCheck["status"];
type BenchmarkStatus = DashboardQuantLabStrategyCard["benchmarkStatus"];

type StrategyDefinition = {
  id: StrategyKey;
  label: string;
  ownerName: string;
  ownerAgentId: string;
  trackedPaths: string[];
  preferredSnippetPaths: string[];
  readmePath?: string;
  backtestPath?: string;
  stage: DashboardQuantLabStrategyCard["stage"];
};

type BenchmarkStrategyDefinition = StrategyDefinition & {
  id: BenchmarkStrategyKey;
};

type GitCommitRecord = {
  authorName: string;
  files: string[];
  fullHash: string;
  shortHash: string;
  subject: string;
  timestamp: string;
};

type BenchmarkArtifact = {
  metrics: Record<string, number | Record<string, unknown>>;
  source: string;
  window: {
    end: string;
    start: string;
  };
};

type BenchmarkArtifactMap = Partial<
  Record<BenchmarkStrategyKey, BenchmarkArtifact>
>;

type InternalCommitEntry = {
  benchmarkHighlights: string[];
  benchmarkMetrics: DashboardQuantLabBenchmarkMetric[];
  codeSnippets: DashboardQuantLabCodeSnippet[];
  codeSummary: string;
  commit: DashboardQuantLabCommitRow;
  deploymentNote: string;
  deploymentStage: string;
  fullHash: string | null;
  intent: string;
  kpiChecks: DashboardQuantLabKpiCheck[];
  learnedFromDeployments: boolean;
  learnedFromPastIterations: boolean;
  learningEvidence: string[];
  relatedCommitIds: string[];
  strategyKey: StrategyKey;
  strategySummary: string;
  touchedStrategies: StrategyKey[];
  usedKnowledgeBase: boolean;
};

const GIT_FIELD_SEPARATOR = "\u001f";
const GIT_RECORD_SEPARATOR = "\u001e";
const BENCHMARK_ARTIFACT_PATH = path.resolve(
  process.cwd(),
  "src/lib/dashboard/quant-lab-benchmarks.json"
);

const STRATEGIES: ReadonlyArray<BenchmarkStrategyDefinition> = [
  {
    id: "statarb",
    label: "Statistical Arbitrage",
    ownerName: "Statistical Researcher (AGT-STATARB-001)",
    ownerAgentId: "AGT-STATARB-001",
    trackedPaths: ["agents/agt_statarb_001"],
    preferredSnippetPaths: [
      "agents/agt_statarb_001/statarb_agent/agent.py",
      "agents/agt_statarb_001/backtest.py",
      "agents/agt_statarb_001/tests/test_signals.py",
    ],
    readmePath: "agents/agt_statarb_001/README.md",
    backtestPath: "agents/agt_statarb_001/backtest.py",
    stage: "paper",
  },
  {
    id: "trend",
    label: "Trend Following",
    ownerName: "Systematic Trend Follower (AGT-TREND-001)",
    ownerAgentId: "AGT-TREND-001",
    trackedPaths: ["agents/agt_trend_001"],
    preferredSnippetPaths: [
      "agents/agt_trend_001/trend_agent/agent.py",
      "agents/agt_trend_001/backtest.py",
      "agents/agt_trend_001/tests/test_position_sizing.py",
    ],
    readmePath: "agents/agt_trend_001/README.md",
    backtestPath: "agents/agt_trend_001/backtest.py",
    stage: "paper",
  },
  {
    id: "volatility",
    label: "Volatility",
    ownerName: "Volatility Researcher (AGT-VOL-001)",
    ownerAgentId: "AGT-VOL-001",
    trackedPaths: ["agents/agt_vol_001"],
    preferredSnippetPaths: [
      "agents/agt_vol_001/vol_agent/agent.py",
      "agents/agt_vol_001/backtest.py",
      "agents/agt_vol_001/tests/test_regime.py",
    ],
    readmePath: "agents/agt_vol_001/README.md",
    backtestPath: "agents/agt_vol_001/backtest.py",
    stage: "paper",
  },
];

const EXECUTION_SURFACE: StrategyDefinition = {
  id: "platform",
  label: "Research Workflow Platform",
  ownerName: "Research runtime + evaluation infrastructure",
  ownerAgentId: "AGT-EXEC-001",
  trackedPaths: ["src/lib/agents"],
  preferredSnippetPaths: [
    "src/lib/agents/python-trading.ts",
    "src/lib/agents/python-runtime.ts",
    "src/lib/agents/runtime.ts",
  ],
  stage: "deployed",
};

const TRACKED_SURFACES = [...STRATEGIES, EXECUTION_SURFACE] as const;

function isBenchmarkStrategyKey(key: StrategyKey): key is BenchmarkStrategyKey {
  return key !== "platform";
}

function compactPath(filePath: string) {
  return filePath.replace(/^src\//u, "").replace(/^agents\//u, "");
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSignedPercent(value: number, digits = 2) {
  const formatted = formatPercent(value, digits);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatNumber(value: number, digits = 2) {
  return value.toFixed(digits);
}

function strategyDefinitionForKey(key: StrategyKey) {
  return TRACKED_SURFACES.find((strategy) => strategy.id === key) ?? EXECUTION_SURFACE;
}

function commitStrategyLabel(touchedStrategies: StrategyKey[]) {
  const strategyOnly = touchedStrategies.filter((key) => key !== "platform");
  const includesPlatform = touchedStrategies.includes("platform");

  if (strategyOnly.length === 0) {
    return "Research Workflow Platform";
  }

  if (strategyOnly.length === 1 && !includesPlatform) {
    return strategyDefinitionForKey(strategyOnly[0]).label;
  }

  if (strategyOnly.length === 1 && includesPlatform) {
    return `${strategyDefinitionForKey(strategyOnly[0]).label} + Workflow`;
  }

  return includesPlatform ? "Cross-Sleeve + Workflow" : "Cross-Sleeve Research";
}

function primaryStrategyKey(touchedStrategies: StrategyKey[]) {
  const strategyOnly = touchedStrategies.filter(isBenchmarkStrategyKey);

  if (strategyOnly.length > 0) {
    return strategyOnly[0];
  }

  return touchedStrategies.includes("platform") ? "platform" : "statarb";
}

function inferCommitStatus(files: string[], touchedStrategies: StrategyKey[]): CommitStatus {
  if (
    touchedStrategies.includes("platform") &&
    !files.some((file) => file.endsWith("backtest.py") || file.includes("/tests/"))
  ) {
    return "deployed";
  }

  if (files.some((file) => file.endsWith("backtest.py") || file.includes("/tests/"))) {
    return "research";
  }

  return "paper";
}

function inferCommitCategory(files: string[], touchedStrategies: StrategyKey[]) {
  if (
    files.some(
      (file) =>
        file.includes("python-trading.ts") ||
        file.includes("python-runtime.ts") ||
        file.endsWith("runtime.ts")
    )
  ) {
    return "research-runtime";
  }

  if (files.some((file) => file.includes("repository.ts") || file.includes("learning.ts"))) {
    return "knowledge/persistence";
  }

  if (files.some((file) => file.endsWith("backtest.py"))) {
    return "strategy/replay";
  }

  if (files.some((file) => file.includes("/tests/"))) {
    return "strategy/validation";
  }

  return touchedStrategies.includes("platform") ? "research-platform" : "strategy/model";
}

function inferAgentRole(files: string[], touchedStrategies: StrategyKey[]) {
  if (files.some((file) => file.includes("repository.ts") || file.includes("learning.ts"))) {
    return "Repository + learning surface";
  }

  if (touchedStrategies.includes("platform")) {
    return "Research workflow surface";
  }

  return "Strategy surface";
}

function getLanguageFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".py") {
    return "python";
  }

  if (extension === ".ts" || extension === ".tsx") {
    return "typescript";
  }

  if (extension === ".js" || extension === ".jsx") {
    return "javascript";
  }

  if (extension === ".md") {
    return "markdown";
  }

  if (extension === ".yaml" || extension === ".yml") {
    return "yaml";
  }

  return "text";
}

function metricTone(value: number) {
  if (value > 0) {
    return "positive" as const;
  }

  if (value < 0) {
    return "negative" as const;
  }

  return "neutral" as const;
}

function kpiStatusFromBoolean(value: boolean): KpiStatus {
  return value ? "pass" : "miss";
}

function benchmarkStatusFromChecks(checks: DashboardQuantLabKpiCheck[]): BenchmarkStatus {
  if (checks.length === 0) {
    return "watch";
  }

  return checks.every((check) => check.status === "pass") ? "pass" : "miss";
}

async function readTextFileSafe(filePath: string) {
  try {
    return await readFile(path.resolve(process.cwd(), filePath), "utf8");
  } catch {
    return null;
  }
}

async function safeGit(args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: process.cwd(),
    });
    return stdout;
  } catch {
    return null;
  }
}

function extractReadmeSummary(markdown: string | null) {
  if (!markdown) {
    return "Real strategy package present in the repository, but no README summary was available.";
  }

  const lines = markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = lines.find((line) => !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("`"));

  return candidate ?? "Real strategy package present in the repository.";
}

async function loadStrategySummaries() {
  const entries = await Promise.all(
    STRATEGIES.map(async (strategy) => {
      const readme = strategy.readmePath ? await readTextFileSafe(strategy.readmePath) : null;
      return [strategy.id, extractReadmeSummary(readme)] as const;
    })
  );

  return Object.fromEntries(entries) as Record<BenchmarkStrategyKey, string>;
}

async function loadBenchmarkArtifacts(): Promise<BenchmarkArtifactMap> {
  try {
    const raw = await readFile(BENCHMARK_ARTIFACT_PATH, "utf8");
    return JSON.parse(raw) as BenchmarkArtifactMap;
  } catch {
    return {};
  }
}

function parseGitHistory(stdout: string | null): GitCommitRecord[] {
  if (!stdout) {
    return [];
  }

  return stdout
    .split(GIT_RECORD_SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [metadata, ...fileLines] = chunk.split(/\r?\n/u);
      const [fullHash, shortHash, timestamp, authorName, subject] = metadata.split(
        GIT_FIELD_SEPARATOR
      );

      return {
        fullHash,
        shortHash,
        timestamp,
        authorName,
        subject,
        files: fileLines.map((line) => line.trim()).filter(Boolean),
      };
    });
}

async function loadRelevantGitCommits(limit = 24) {
  const trackedPaths = TRACKED_SURFACES.flatMap((surface) => surface.trackedPaths);
  const format = `${GIT_RECORD_SEPARATOR}%H${GIT_FIELD_SEPARATOR}%h${GIT_FIELD_SEPARATOR}%ad${GIT_FIELD_SEPARATOR}%an${GIT_FIELD_SEPARATOR}%s`;
  const stdout = await safeGit([
    "log",
    "-n",
    String(limit),
    "--date=iso",
    `--format=${format}`,
    "--name-only",
    "--",
    ...trackedPaths,
  ]);

  return parseGitHistory(stdout);
}

function touchedStrategiesForFiles(files: string[]) {
  return TRACKED_SURFACES.filter((surface) =>
    surface.trackedPaths.some((trackedPath) => files.some((file) => file.startsWith(trackedPath)))
  ).map((surface) => surface.id) as StrategyKey[];
}

function sourceFilesForCommit(files: string[]) {
  return files.filter((file) => /\.(md|py|ts|tsx|yaml|yml)$/u.test(file));
}

async function readCurrentFileSnippet(filePath: string): Promise<DashboardQuantLabCodeSnippet> {
  const absolutePath = path.resolve(process.cwd(), filePath);

  try {
    const contents = await readFile(absolutePath, "utf8");
    const lines = contents.split(/\r?\n/u);
    const endLine = Math.min(lines.length, 80);
    const code = lines.slice(0, endLine).join("\n").trimEnd();

    return {
      label: path.basename(filePath),
      path: filePath,
      language: getLanguageFromPath(filePath),
      caption: "Current repository snapshot for this tracked quant surface.",
      startLine: 1,
      endLine,
      code,
    };
  } catch {
    return {
      label: path.basename(filePath),
      path: filePath,
      language: getLanguageFromPath(filePath),
      caption: "The current repository snapshot for this file is unavailable in this environment.",
      startLine: 1,
      endLine: 1,
      code: "// File unavailable in this environment.",
    };
  }
}

async function readCommitPatchSnippet(
  fullHash: string,
  filePath: string
): Promise<DashboardQuantLabCodeSnippet> {
  const stdout = await safeGit(["show", "--format=", "--unified=3", fullHash, "--", filePath]);

  if (!stdout || !stdout.trim()) {
    return readCurrentFileSnippet(filePath);
  }

  const code = stdout.trimEnd();
  const lineCount = code.split(/\r?\n/u).length;

  return {
    label: path.basename(filePath),
    path: filePath,
    language: "diff",
    caption: "Actual patch from the repository history for this commit and file.",
    startLine: 1,
    endLine: lineCount,
    code,
  };
}

function buildStrategyArtifactMetrics(
  strategyKey: BenchmarkStrategyKey,
  artifact: BenchmarkArtifact | null
): DashboardQuantLabBenchmarkMetric[] {
  if (!artifact) {
    return [
      {
        label: `${strategyDefinitionForKey(strategyKey).label} benchmark`,
        value: "Unavailable",
        detail:
          "No committed benchmark artifact exists for this sleeve yet, so Quant Lab can only show the real code and repo history.",
        tone: "neutral",
      },
    ];
  }

  const metrics = artifact.metrics;

  if (strategyKey === "trend") {
    return [
      {
        label: "Trend total return",
        value: formatSignedPercent(Number(metrics.total_return ?? 0)),
        detail: `Real historical replay output from ${artifact.window.start} to ${artifact.window.end}.`,
        tone: metricTone(Number(metrics.total_return ?? 0)),
      },
      {
        label: "Trend CAGR",
        value: formatSignedPercent(Number(metrics.cagr ?? 0)),
        detail: "Compound annual growth rate from the persisted trend tearsheet.",
        tone: metricTone(Number(metrics.cagr ?? 0)),
      },
      {
        label: "Trend Sharpe",
        value: formatNumber(Number(metrics.sharpe ?? 0)),
        detail: "Risk-adjusted return from the persisted trend replay.",
        tone: metricTone(Number(metrics.sharpe ?? 0)),
      },
      {
        label: "Trend max drawdown",
        value: formatSignedPercent(Number(metrics.max_drawdown ?? 0)),
        detail: "Worst drawdown observed in the persisted trend replay window.",
        tone: "negative",
      },
      {
        label: "Trend win rate",
        value: formatPercent(Number(metrics.win_rate ?? 0)),
        detail: "Closed-event accuracy from the persisted trend replay.",
        tone: metricTone(Number(metrics.win_rate ?? 0) - 0.5),
      },
      {
        label: "Trend event count",
        value: formatInteger(Number(metrics.trade_count ?? 0)),
        detail: "Closed events emitted by the replay harness.",
        tone: "neutral",
      },
    ];
  }

  if (strategyKey === "volatility") {
    return [
      {
        label: "Vol total return",
        value: formatSignedPercent(Number(metrics.total_return ?? 0)),
        detail: `Real historical replay output from ${artifact.window.start} to ${artifact.window.end}.`,
        tone: metricTone(Number(metrics.total_return ?? 0)),
      },
      {
        label: "Vol regime accuracy",
        value: formatPercent(Number(metrics.classification_accuracy ?? 0)),
        detail: "Forward regime-classification accuracy from the persisted volatility replay.",
        tone: metricTone(Number(metrics.classification_accuracy ?? 0) - 0.5),
      },
      {
        label: "Vol Sharpe",
        value: formatNumber(Number(metrics.sharpe ?? 0)),
        detail: "Risk-adjusted return from the persisted volatility replay.",
        tone: metricTone(Number(metrics.sharpe ?? 0)),
      },
      {
        label: "Vol max drawdown",
        value: formatSignedPercent(Number(metrics.max_drawdown ?? 0)),
        detail: "Worst drawdown observed in the persisted volatility replay window.",
        tone: "negative",
      },
      {
        label: "Vol win rate",
        value: formatPercent(Number(metrics.win_rate ?? 0)),
        detail: "Closed-event accuracy from the persisted volatility replay.",
        tone: metricTone(Number(metrics.win_rate ?? 0) - 0.5),
      },
      {
        label: "Vol event count",
        value: formatInteger(Number(metrics.trade_count ?? 0)),
        detail: "Closed events emitted by the volatility replay harness.",
        tone: "neutral",
      },
    ];
  }

  return [
    {
      label: "StatArb benchmark",
      value: "Unavailable",
      detail:
        "No committed statistical-arbitrage benchmark artifact exists yet, so Quant Lab is showing the real package and commit history only.",
      tone: "neutral",
    },
  ];
}

function buildStrategyKpiChecks(
  strategyKey: BenchmarkStrategyKey,
  artifact: BenchmarkArtifact | null
): DashboardQuantLabKpiCheck[] {
  if (!artifact) {
    return [];
  }

  const metrics = artifact.metrics;

  const checks: DashboardQuantLabKpiCheck[] = [
    {
      label: `${strategyDefinitionForKey(strategyKey).label} positive return`,
      target: "> 0%",
      actual: formatSignedPercent(Number(metrics.total_return ?? 0)),
      status: kpiStatusFromBoolean(Number(metrics.total_return ?? 0) > 0),
    },
    {
      label: `${strategyDefinitionForKey(strategyKey).label} positive Sharpe`,
      target: "> 0",
      actual: formatNumber(Number(metrics.sharpe ?? 0)),
      status: kpiStatusFromBoolean(Number(metrics.sharpe ?? 0) > 0),
    },
    {
      label: `${strategyDefinitionForKey(strategyKey).label} event sample`,
      target: "> 0 events",
      actual: formatInteger(Number(metrics.trade_count ?? 0)),
      status: kpiStatusFromBoolean(Number(metrics.trade_count ?? 0) > 0),
    },
  ];

  if (strategyKey === "volatility") {
    checks.push({
      label: "Vol regime accuracy edge",
      target: "> 50%",
      actual: formatPercent(Number(metrics.classification_accuracy ?? 0)),
      status: kpiStatusFromBoolean(Number(metrics.classification_accuracy ?? 0) > 0.5),
    });
  }

  return checks;
}

function benchmarkHighlightsForStrategies(
  touchedStrategies: StrategyKey[],
  artifacts: BenchmarkArtifactMap
) {
  const strategyOnly = touchedStrategies.filter(
    isBenchmarkStrategyKey
  );

  if (strategyOnly.length === 0) {
    return ["Execution surface", "No benchmark artifact"];
  }

  if (strategyOnly.length === 1) {
    const strategyKey = strategyOnly[0];
    const artifact = artifacts[strategyKey] ?? null;

    if (!artifact) {
      return ["No persisted metrics", "Backtest entrypoint"];
    }

    if (strategyKey === "trend") {
      return [
        `Sharpe ${formatNumber(Number(artifact.metrics.sharpe ?? 0))}`,
        `CAGR ${formatSignedPercent(Number(artifact.metrics.cagr ?? 0))}`,
        `DD ${formatSignedPercent(Number(artifact.metrics.max_drawdown ?? 0))}`,
      ];
    }

    if (strategyKey === "volatility") {
      return [
        `Sharpe ${formatNumber(Number(artifact.metrics.sharpe ?? 0))}`,
        `Regime acc ${formatPercent(Number(artifact.metrics.classification_accuracy ?? 0))}`,
        `DD ${formatSignedPercent(Number(artifact.metrics.max_drawdown ?? 0))}`,
      ];
    }

    return ["No persisted metrics", "Backtest entrypoint"];
  }

  const artifactCount = strategyOnly.filter((strategyKey) => artifacts[strategyKey]).length;
  const missingCount = strategyOnly.length - artifactCount;

  return [
    `${strategyOnly.length} sleeves touched`,
    `${artifactCount} benchmark artifact${artifactCount === 1 ? "" : "s"}`,
    missingCount > 0 ? `${missingCount} missing feed${missingCount === 1 ? "" : "s"}` : "All feeds present",
  ];
}

function learningEvidenceFromFiles(files: string[]) {
  const evidence: string[] = [];
  const backtestFiles = files.filter((file) => file.endsWith("backtest.py"));
  const testFiles = files.filter((file) => file.includes("/tests/"));
  const runtimeFiles = files.filter((file) =>
    file.includes("runtime.ts") ||
    file.includes("python-trading.ts") ||
    file.includes("python-runtime.ts") ||
    file.includes("repository.ts") ||
    file.includes("learning.ts")
  );

  if (backtestFiles.length > 0) {
    evidence.push(
      `Touches committed backtest harness files: ${backtestFiles
        .slice(0, 3)
        .map(compactPath)
        .join(", ")}.`
    );
  }

  if (testFiles.length > 0) {
    evidence.push(
      `Touches committed validation files: ${testFiles
        .slice(0, 3)
        .map(compactPath)
        .join(", ")}.`
    );
  }

  if (runtimeFiles.length > 0) {
    evidence.push(
      `Touches runtime or persistence surfaces: ${runtimeFiles
        .slice(0, 3)
        .map(compactPath)
        .join(", ")}.`
    );
  }

  if (evidence.length === 0) {
    evidence.push("This change only touches the tracked code surface itself; no benchmark, test, or persistence files changed in the same commit.");
  }

  return evidence;
}

async function buildStrategyCards(
  commits: GitCommitRecord[],
  summaries: Record<BenchmarkStrategyKey, string>,
  artifacts: BenchmarkArtifactMap
) {
  return Promise.all(
    STRATEGIES.map(async (strategy) => {
      const latestCommit = commits.find((commit) =>
        commit.files.some((file) =>
          strategy.trackedPaths.some((trackedPath) => file.startsWith(trackedPath))
        )
      );
      const latestSnapshotTime = latestCommit?.timestamp ?? new Date().toISOString();
      const checks = buildStrategyKpiChecks(strategy.id, artifacts[strategy.id] ?? null);

      return {
        id: strategy.id,
        label: strategy.label,
        ownerName: strategy.ownerName,
        ownerAgentId: strategy.ownerAgentId,
        stage: strategy.stage,
        benchmarkStatus: benchmarkStatusFromChecks(checks),
        latestCommitId: latestCommit?.shortHash ?? `${strategy.id}-snapshot`,
        latestCommitHash: latestCommit?.shortHash ?? "snapshot",
        latestTitle: latestCommit?.subject ?? `Current ${strategy.label.toLowerCase()} repository snapshot`,
        summary: `${summaries[strategy.id]} Latest tracked update: ${new Date(
          latestSnapshotTime
        ).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}.`,
      } satisfies DashboardQuantLabStrategyCard;
    })
  );
}

function summaryMetricsFromData(
  commits: DashboardQuantLabCommitRow[],
  strategies: DashboardQuantLabStrategyCard[],
  artifacts: BenchmarkArtifactMap
): DashboardQuantLabSummaryMetric[] {
  const benchmarkBackedSleeves = STRATEGIES.filter((strategy) => artifacts[strategy.id]).length;
  const passRate =
    strategies.length > 0
      ? `${Math.round(
          (strategies.filter((strategy) => strategy.benchmarkStatus === "pass").length /
            strategies.length) *
            100
        )}%`
      : "0%";

  return [
    {
      label: "Tracked Strategies",
      value: String(strategies.length),
      detail: "Real strategy sleeves currently represented in the repository.",
      tone: "neutral",
    },
    {
      label: "Surfaced Commits",
      value: String(commits.length),
      detail: "Recent real repository commits touching quant strategy or research workflow surfaces.",
      tone: "neutral",
    },
    {
      label: "Benchmark Pass Rate",
      value: passRate,
      detail: "Share of tracked sleeves whose committed benchmark artifacts clear the minimal real-data checks.",
      tone: "neutral",
    },
    {
      label: "Runtime-Wired Sleeves",
      value: String(STRATEGIES.length),
      detail: "Python research sleeves configured into the research runtime.",
      tone: "neutral",
    },
    {
      label: "Benchmark-Backed Sleeves",
      value: String(benchmarkBackedSleeves),
      detail: "Sleeves with a committed real benchmark artifact that Quant Lab can display.",
      tone: "neutral",
    },
  ];
}

async function buildGitCommitEntries(
  summaries: Record<BenchmarkStrategyKey, string>,
  artifacts: BenchmarkArtifactMap
): Promise<InternalCommitEntry[]> {
  const commits = await loadRelevantGitCommits();

  return Promise.all(
    commits.map(async (commit) => {
      const touchedStrategies = touchedStrategiesForFiles(commit.files);
      const relevantStrategies: StrategyKey[] =
        touchedStrategies.length > 0 ? touchedStrategies : ["platform"];
      const strategyKey = primaryStrategyKey(relevantStrategies);
      const benchmarkStrategies = relevantStrategies.filter(isBenchmarkStrategyKey);
      const benchmarkMetrics = relevantStrategies
        .filter(isBenchmarkStrategyKey)
        .flatMap((key) => buildStrategyArtifactMetrics(key, artifacts[key] ?? null));
      const kpiChecks = relevantStrategies
        .filter(isBenchmarkStrategyKey)
        .flatMap((key) => buildStrategyKpiChecks(key, artifacts[key] ?? null));
      const sourceFiles = sourceFilesForCommit(commit.files);
      const snippetTargets =
        sourceFiles.length > 0
          ? sourceFiles.slice(0, 2)
          : strategyDefinitionForKey(strategyKey).preferredSnippetPaths.slice(0, 2);
      const codeSnippets = await Promise.all(
        snippetTargets.map((filePath) => readCommitPatchSnippet(commit.fullHash, filePath))
      );
      const usedKnowledgeBase =
        /memory|learning|artifact|repository/iu.test(commit.subject) ||
        commit.files.some((file) => file.includes("repository.ts") || file.includes("learning.ts"));
      const learnedFromPastIterations =
        /memory/iu.test(commit.subject) ||
        commit.files.some((file) => file.endsWith("backtest.py") || file.includes("/tests/"));
      const learnedFromDeployments = commit.files.some(
        (file) =>
          file.includes("runtime.ts") ||
          file.includes("python-trading.ts") ||
          file.includes("python-runtime.ts") ||
          file.includes("repository.ts")
      );

      return {
        benchmarkHighlights: benchmarkHighlightsForStrategies(relevantStrategies, artifacts),
        benchmarkMetrics,
        codeSnippets,
        codeSummary: `This real commit changes ${commit.files.length} tracked file${
          commit.files.length === 1 ? "" : "s"
        }, including ${commit.files.slice(0, 4).map(compactPath).join(", ")}.`,
        commit: {
          id: commit.shortHash,
          commitHash: commit.shortHash,
          timestamp: new Date(commit.timestamp).toISOString(),
          category: inferCommitCategory(commit.files, relevantStrategies),
          title: commit.subject,
          agentId:
            relevantStrategies.length === 1
              ? strategyDefinitionForKey(strategyKey).ownerAgentId
              : "MULTI-SLEEVE",
          agentName: commit.authorName,
          agentRole: inferAgentRole(commit.files, relevantStrategies),
          strategyLabel: commitStrategyLabel(relevantStrategies),
          status: inferCommitStatus(commit.files, relevantStrategies),
          summary: `Real repository commit touching ${commit.files.length} tracked file${
            commit.files.length === 1 ? "" : "s"
          }, including ${commit.files.slice(0, 3).map(compactPath).join(", ")}.`,
          benchmarkHighlights: benchmarkHighlightsForStrategies(relevantStrategies, artifacts),
          learnedFromPastIterations,
          learnedFromDeployments,
        },
        deploymentNote:
          benchmarkMetrics.length > 0
            ? "Committed benchmark artifacts exist for at least part of this scope and are surfaced below."
            : "No committed benchmark artifact exists for this scope yet, so Quant Lab is showing the real code and repository history only.",
        deploymentStage:
          strategyKey === "platform"
            ? "Research-runtime workflow surface"
            : inferCommitStatus(commit.files, relevantStrategies) === "research"
              ? "Historical replay / research change"
              : "Research sleeve change",
        fullHash: commit.fullHash,
        intent: `Commit intent from the repository history: ${commit.subject}`,
        kpiChecks,
        learnedFromDeployments,
        learnedFromPastIterations,
        learningEvidence: learningEvidenceFromFiles(commit.files),
        relatedCommitIds: [],
        strategyKey,
        strategySummary:
          strategyKey === "platform"
            ? "Real research-runtime infrastructure for Potato Chips AI's research stack."
            : benchmarkStrategies.length > 1
              ? `This real commit touches multiple sleeves in one change set: ${benchmarkStrategies
                  .map((key) => strategyDefinitionForKey(key).label)
                  .join(", ")}.`
              : summaries[strategyKey],
        touchedStrategies: relevantStrategies,
        usedKnowledgeBase,
      } satisfies InternalCommitEntry;
    })
  );
}

async function buildSnapshotEntries(
  summaries: Record<BenchmarkStrategyKey, string>,
  artifacts: BenchmarkArtifactMap
): Promise<InternalCommitEntry[]> {
  return Promise.all(
    STRATEGIES.map(async (strategy) => {
      const checks = buildStrategyKpiChecks(strategy.id, artifacts[strategy.id] ?? null);
      const benchmarkMetrics = buildStrategyArtifactMetrics(strategy.id, artifacts[strategy.id] ?? null);
      const snippetTargets = strategy.preferredSnippetPaths.slice(0, 2);
      const codeSnippets = await Promise.all(snippetTargets.map(readCurrentFileSnippet));

      return {
        benchmarkHighlights: benchmarkHighlightsForStrategies([strategy.id], artifacts),
        benchmarkMetrics,
        codeSnippets,
        codeSummary: `Current repository snapshot for ${strategy.label.toLowerCase()}, using ${snippetTargets
          .map(compactPath)
          .join(", ")}.`,
        commit: {
          id: `${strategy.id}-snapshot`,
          commitHash: "snapshot",
          timestamp: new Date().toISOString(),
          category: "repository-state",
          title: `Current ${strategy.label.toLowerCase()} repository snapshot`,
          agentId: strategy.ownerAgentId,
          agentName: strategy.ownerName,
          agentRole: "Current tracked surface",
          strategyLabel: strategy.label,
          status: strategy.stage,
          summary: `Git history is unavailable in this environment, so Quant Lab is showing the current committed ${strategy.label.toLowerCase()} surface.`,
          benchmarkHighlights: benchmarkHighlightsForStrategies([strategy.id], artifacts),
          learnedFromPastIterations: false,
          learnedFromDeployments: false,
        },
        deploymentNote:
          benchmarkMetrics.length > 0
            ? "Committed benchmark artifacts exist for this sleeve and are surfaced below."
            : "No committed benchmark artifact exists for this sleeve yet.",
        deploymentStage: "Current tracked sleeve snapshot",
        fullHash: null,
        intent: `Current tracked ${strategy.label.toLowerCase()} surface.`,
        kpiChecks: checks,
        learnedFromDeployments: false,
        learnedFromPastIterations: false,
        learningEvidence: [
          "Git history is unavailable in this environment, so Quant Lab is falling back to the current committed file set only.",
        ],
        relatedCommitIds: [],
        strategyKey: strategy.id,
        strategySummary: summaries[strategy.id],
        touchedStrategies: [strategy.id],
        usedKnowledgeBase: false,
      } satisfies InternalCommitEntry;
    })
  );
}

async function buildCommitEntries(
  summaries: Record<Exclude<StrategyKey, "platform">, string>,
  artifacts: BenchmarkArtifactMap
) {
  const gitEntries = await buildGitCommitEntries(summaries, artifacts);

  if (gitEntries.length > 0) {
    const byId = new Map(gitEntries.map((entry) => [entry.commit.id, entry]));

    for (const entry of gitEntries) {
      entry.relatedCommitIds = gitEntries
        .filter(
          (candidate) =>
            candidate.commit.id !== entry.commit.id &&
            candidate.touchedStrategies.some((key) => entry.touchedStrategies.includes(key))
        )
        .slice(0, 3)
        .map((candidate) => candidate.commit.id);
    }

    return Array.from(byId.values()).sort((left, right) =>
      right.commit.timestamp.localeCompare(left.commit.timestamp)
    );
  }

  return buildSnapshotEntries(summaries, artifacts);
}

function downloadFileNameForSnippet(entry: InternalCommitEntry, filePath: string) {
  const extension = path.extname(filePath);
  const baseName = path.basename(filePath, extension);
  const suffix = entry.fullHash ? `-${entry.commit.commitHash}` : "";

  return `${baseName}${suffix}${extension}`;
}

async function getWorkspaceRuntimeStatus() {
  try {
    const [{ stdout: headShortHash }, { stdout: statusOutput }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: process.cwd(),
      }),
      execFileAsync("git", ["status", "--short", "--untracked-files=no"], {
        cwd: process.cwd(),
      }),
    ]);
    const changedFilesCount = statusOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length;
    const trimmedHead = headShortHash.trim() || null;
    const headline =
      changedFilesCount > 0
        ? "Live workspace sync active"
        : "Repository synced to a clean checkpoint";
    const detail = trimmedHead
      ? changedFilesCount > 0
        ? `Head ${trimmedHead} with ${changedFilesCount} tracked workspace change${
            changedFilesCount === 1 ? "" : "s"
          } still in flight.`
        : `Head ${trimmedHead} with no tracked workspace drift right now.`
      : "Git metadata unavailable for this runtime.";

    return {
      headline,
      detail,
      headShortHash: trimmedHead,
      changedFilesCount,
    };
  } catch {
    return {
      headline: "Repository snapshot active",
      detail:
        "Git metadata is unavailable in this environment, so Quant Lab is showing the current committed strategy surfaces and any committed benchmark artifacts it can read.",
      headShortHash: null,
      changedFilesCount: null,
    };
  }
}

export async function getDashboardQuantLabDataInternal(): Promise<DashboardQuantLabData> {
  const checkedAt = new Date().toISOString();
  const runtimeStatus = await getWorkspaceRuntimeStatus();
  const summaries = await loadStrategySummaries();
  const artifacts = await loadBenchmarkArtifacts();
  const commitEntries = await buildCommitEntries(summaries, artifacts);
  const strategies = await buildStrategyCards(
    await loadRelevantGitCommits(),
    summaries,
    artifacts
  );

  return {
    checkedAt,
    runtimeStatus,
    summaryMetrics: summaryMetricsFromData(
      commitEntries.map((entry) => entry.commit),
      strategies,
      artifacts
    ),
    strategies,
    commits: commitEntries.map((entry) => entry.commit),
  };
}

export async function getDashboardQuantLabCommitDetailDataInternal(
  commitId: string
): Promise<DashboardQuantLabCommitDetailData> {
  const checkedAt = new Date().toISOString();
  const summaries = await loadStrategySummaries();
  const artifacts = await loadBenchmarkArtifacts();
  const commitEntries = await buildCommitEntries(summaries, artifacts);
  const match = commitEntries.find((entry) => entry.commit.id === commitId) ?? null;

  if (!match) {
    return {
      checkedAt,
      commit: null,
      strategySummary: "",
      codeSummary: "",
      intent: "",
      deploymentStage: "",
      deploymentNote: "",
      usedKnowledgeBase: false,
      learnedFromPastIterations: false,
      learnedFromDeployments: false,
      learningEvidence: [],
      benchmarkMetrics: [],
      kpiChecks: [],
      codeSnippets: [],
      relatedCommits: [],
    };
  }

  const relatedCommits = match.relatedCommitIds
    .map((id) => commitEntries.find((entry) => entry.commit.id === id))
    .filter((entry): entry is InternalCommitEntry => Boolean(entry))
    .map((entry) => entry.commit);

  return {
    checkedAt,
    commit: match.commit,
    strategySummary: match.strategySummary,
    codeSummary: match.codeSummary,
    intent: match.intent,
    deploymentStage: match.deploymentStage,
    deploymentNote: match.deploymentNote,
    usedKnowledgeBase: match.usedKnowledgeBase,
    learnedFromPastIterations: match.learnedFromPastIterations,
    learnedFromDeployments: match.learnedFromDeployments,
    learningEvidence: match.learningEvidence,
    benchmarkMetrics: match.benchmarkMetrics,
    kpiChecks: match.kpiChecks,
    codeSnippets: match.codeSnippets,
    relatedCommits,
  };
}

export async function getDashboardQuantLabSnippetDownloadData(
  commitId: string,
  filePath: string
): Promise<null | { content: string; fileName: string }> {
  const summaries = await loadStrategySummaries();
  const artifacts = await loadBenchmarkArtifacts();
  const commitEntries = await buildCommitEntries(summaries, artifacts);
  const match = commitEntries.find((entry) => entry.commit.id === commitId) ?? null;

  if (!match) {
    return null;
  }

  const snippet = match.codeSnippets.find((item) => item.path === filePath) ?? null;

  if (!snippet) {
    return null;
  }

  const fileName = downloadFileNameForSnippet(match, filePath);

  if (!match.fullHash) {
    const content = await readTextFileSafe(filePath);

    return {
      content: content ?? snippet.code,
      fileName,
    };
  }

  const content =
    (await safeGit(["show", `${match.fullHash}:${filePath}`])) ??
    (await readTextFileSafe(filePath)) ??
    snippet.code;

  return {
    content,
    fileName,
  };
}

export function getQuantLabKpiTone(status: KpiStatus) {
  if (status === "pass") {
    return "positive" as const;
  }

  if (status === "miss") {
    return "negative" as const;
  }

  return "neutral" as const;
}

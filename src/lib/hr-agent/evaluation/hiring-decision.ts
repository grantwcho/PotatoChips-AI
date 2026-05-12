import type {
  AgentApplication,
  HrHiringDecision,
} from "@/lib/hr-agent/models/agent-application";
import { getDecisionModelRouteConfig } from "@/lib/agents/model-routing";
import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

function hasBlockingSecurityFinding(application: AgentApplication) {
  return (
    application.intakeReport.security.flaggedDependencies.length > 0 ||
    application.intakeReport.security.suspiciousPatterns.length > 0 ||
    application.intakeReport.security.networkCallAttempts.length > 0 ||
    application.intakeReport.security.syscallFindings.length > 0 ||
    application.intakeReport.security.hardcodedCredentialFindings.length > 0 ||
    application.intakeReport.security.stateIsolationFindings.length > 0 ||
    application.intakeReport.security.excessivePermissionRequests.length > 0
  );
}

function synthesizeHiringDecision(application: AgentApplication): HrHiringDecision {
  const metrics =
    application.probationReport.metrics.totalSignalsGenerated > 0
      ? application.probationReport.metrics
      : application.sandboxReport.metrics;
  const overlapScore = application.portfolioFitReport.overlapScore ?? 100;
  const drawdown = metrics.maxDrawdownPct ?? 100;
  const sharpe = metrics.sharpeRatio ?? 0;
  const netReturn = metrics.netReturnPct ?? -100;
  const marginalSharpeDelta = application.portfolioFitReport.marginalSharpeDelta ?? -1;
  const securityBlocked = hasBlockingSecurityFinding(application);
  const adversarialBlocked = application.adversarialReport.blockingIssues.length > 0;
  const severeUnderperformance =
    metrics.totalSignalsGenerated === 0 ||
    sharpe < 0.1 ||
    drawdown > 18 ||
    (metrics.cvar95Pct ?? 0) < -4.5 ||
    netReturn < -3;
  const goodButNotReady =
    sharpe < 1 ||
    drawdown > 12 ||
    overlapScore > 75 ||
    marginalSharpeDelta <= 0 ||
    (metrics.cvar95Pct ?? 0) < -2.5;
  const recommendation =
    securityBlocked || adversarialBlocked || severeUnderperformance
      ? "Reject"
      : goodButNotReady
        ? "Backburner"
        : "Hire";

  const reasons = [
    securityBlocked
      ? "intake found blocking dependency, credential, syscall, or network-call concerns"
      : "intake found no blocking security findings",
    adversarialBlocked
      ? "adversarial stress testing exposed blocking failure modes"
      : "adversarial stress testing did not expose blocking failure modes",
    `Sharpe is ${sharpe.toFixed(2)}`,
    `max drawdown is ${drawdown.toFixed(1)}%`,
    `ensemble overlap score is ${overlapScore.toFixed(1)}`,
    `marginal Sharpe delta is ${marginalSharpeDelta.toFixed(2)}`,
  ];

  return {
    recommendation,
    reasoning: `AI HR recommends ${recommendation.toLowerCase()} because ${reasons.join(", ")}.`,
    generatedAt: new Date().toISOString(),
    humanDecision: null,
    humanDecisionAt: null,
    humanNote: null,
  };
}

function buildDecisionPrompt(application: AgentApplication) {
  const metrics =
    application.probationReport.metrics.totalSignalsGenerated > 0
      ? application.probationReport.metrics
      : application.sandboxReport.metrics;

  return `You are Potato Chips AI's AI HR reviewer.

Return strict JSON with keys:
- recommendation: "Hire", "Backburner", or "Reject"
- reasoning: string

Decide whether this submitted research agent should be hired. Use only the evidence below.

Application:
${JSON.stringify(
  {
    agentName: application.agentName,
    type: application.type,
    description: application.description,
    claimedEdge: application.claimedEdge,
    packageType: application.packageType,
  },
  null,
  2
)}

Security:
${JSON.stringify(application.intakeReport, null, 2)}

Sandbox:
${JSON.stringify(application.sandboxReport, null, 2)}

Adversarial:
${JSON.stringify(application.adversarialReport, null, 2)}

Ensemble fit:
${JSON.stringify(application.portfolioFitReport, null, 2)}

Probation:
${JSON.stringify(application.probationReport, null, 2)}

Recent stage summaries:
${JSON.stringify(
  Object.values(application.stageResults)
    .filter(Boolean)
    .map((stage) => ({
      stageKey: stage!.stageKey,
      summary: stage!.summary,
      failureReason: stage!.failureReason,
    })),
  null,
  2
)}

Decision guidance:
- Reject if intake found blocking security or structural concerns.
- Reject if adversarial testing exposed brittle behavior.
- Reject if risk-adjusted performance is weak, tail risk is ugly, or drawdown is excessive.
- Choose Backburner when the submission is promising but not yet differentiated, robust, or ensemble-ready enough for immediate onboarding.
- Hire only when the agent is operationally safe, differentiated, interpretable, and economically interesting right now.

Metrics to pay special attention to:
${JSON.stringify(
  {
    sharpeRatio: metrics.sharpeRatio,
    sortinoRatio: metrics.sortinoRatio,
    maxDrawdownPct: metrics.maxDrawdownPct,
    cvar95Pct: metrics.cvar95Pct,
    dailyVolatilityPct: metrics.dailyVolatilityPct,
    weeklyVolatilityPct: metrics.weeklyVolatilityPct,
    winRatePct: metrics.winRatePct,
    totalSignalsGenerated: metrics.totalSignalsGenerated,
    correlationWithExistingAgents: metrics.correlationWithExistingAgents,
    overlapScore: application.portfolioFitReport.overlapScore,
    marginalSharpeDelta: application.portfolioFitReport.marginalSharpeDelta,
    resilienceScore: application.adversarialReport.resilienceScore,
  },
  null,
  2
)}`;
}

function parseModelDecision(text: string) {
  try {
    const parsed = JSON.parse(text) as {
      recommendation?: string;
      reasoning?: string;
    };

    if (
      (parsed.recommendation === "Hire" ||
        parsed.recommendation === "Backburner" ||
        parsed.recommendation === "Reject") &&
      typeof parsed.reasoning === "string" &&
      parsed.reasoning.trim()
    ) {
      return {
        recommendation: parsed.recommendation,
        reasoning: parsed.reasoning.trim(),
      } satisfies Pick<HrHiringDecision, "recommendation" | "reasoning">;
    }
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return parseModelDecision(text.slice(firstBrace, lastBrace + 1));
    }
  }

  return null;
}

async function tryAnthropicDecision(application: AgentApplication) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const startedAt = Date.now();
  const requestHeaders = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  const routeConfig = getDecisionModelRouteConfig("hr");
  const requestPayload = {
    model: routeConfig.anthropicModel,
    max_tokens: 400,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: buildDecisionPrompt(application),
      },
    ],
  };
  let statusCode: number | null = null;
  let responseHeaders: Headers | null = null;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestPayload),
    });
    statusCode = response.status;
    responseHeaders = response.headers;
    const payload = (await response.json().catch(() => ({}))) as {
      content?: Array<{ type?: string; text?: string }>;
      error?: { message?: string };
    };

    await recordApiActivityEventSafe({
      service: "ANTHROPIC",
      category: "HR",
      operation: "messages",
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      statusCode,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload,
      responseHeaders,
      responsePayload: payload,
      errorMessage: response.ok ? null : payload.error?.message ?? null,
      metadata: {
        purpose: "hr-hiring-decision",
        applicationId: application.id,
        route: "hr",
      },
    });

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Anthropic returned HTTP ${response.status}.`);
    }

    const text = payload.content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim();

    return text ? parseModelDecision(text) : null;
  } catch (error) {
    if (statusCode === null) {
      await recordApiActivityEventSafe({
        service: "ANTHROPIC",
        category: "HR",
        operation: "messages",
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        durationMs: Date.now() - startedAt,
        requestHeaders,
        requestPayload,
        responseHeaders,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Anthropic request failed unexpectedly.",
        metadata: {
          purpose: "hr-hiring-decision",
          applicationId: application.id,
          route: "hr",
        },
      });
    }

    throw error;
  }
}

async function tryOpenAiDecision(application: AgentApplication) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const startedAt = Date.now();
  const requestHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  const routeConfig = getDecisionModelRouteConfig("hr");
  const requestPayload = {
    model: routeConfig.openAiModel,
    temperature: 0,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: buildDecisionPrompt(application),
      },
    ],
  };
  let statusCode: number | null = null;
  let responseHeaders: Headers | null = null;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestPayload),
    });
    statusCode = response.status;
    responseHeaders = response.headers;
    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
      error?: { message?: string };
    };

    await recordApiActivityEventSafe({
      service: "OPENAI",
      category: "HR",
      operation: "chat.completions",
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions",
      statusCode,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload,
      responseHeaders,
      responsePayload: payload,
      errorMessage: response.ok ? null : payload.error?.message ?? null,
      metadata: {
        purpose: "hr-hiring-decision",
        applicationId: application.id,
        route: "hr",
      },
    });

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI returned HTTP ${response.status}.`);
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    return content ? parseModelDecision(content) : null;
  } catch (error) {
    if (statusCode === null) {
      await recordApiActivityEventSafe({
        service: "OPENAI",
        category: "HR",
        operation: "chat.completions",
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        durationMs: Date.now() - startedAt,
        requestHeaders,
        requestPayload,
        responseHeaders,
        errorMessage:
          error instanceof Error ? error.message : "OpenAI request failed unexpectedly.",
        metadata: {
          purpose: "hr-hiring-decision",
          applicationId: application.id,
          route: "hr",
        },
      });
    }

    throw error;
  }
}

export async function synthesizeHiringDecisionWithClaude(
  application: AgentApplication
): Promise<HrHiringDecision> {
  const generatedAt = new Date().toISOString();

  try {
    const routeConfig = getDecisionModelRouteConfig("hr");
    let modelDecision:
      | Pick<HrHiringDecision, "recommendation" | "reasoning">
      | null = null;

    for (const provider of routeConfig.providerOrder) {
      modelDecision =
        provider === "anthropic"
          ? await tryAnthropicDecision(application)
          : await tryOpenAiDecision(application);

      if (modelDecision) {
        break;
      }
    }

    if (modelDecision) {
      return {
        recommendation: modelDecision.recommendation,
        reasoning: modelDecision.reasoning,
        generatedAt,
        humanDecision: null,
        humanDecisionAt: null,
        humanNote: null,
      };
    }
  } catch {
    // Fall through to grounded local synthesis.
  }

  const fallback = synthesizeHiringDecision(application);
  return {
    ...fallback,
    generatedAt,
  };
}

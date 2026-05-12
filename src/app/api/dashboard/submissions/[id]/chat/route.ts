import Anthropic from "@anthropic-ai/sdk";
import { getCurrentAppUser } from "@/lib/auth/session";
import { getDashboardSubmissionRequirementsData } from "@/lib/dashboard/tool-access";
import {
  getSubmissionChatHistory,
  normalizePersistableChatMessages,
  persistSubmissionChatMessages,
  toModelChatMessages,
} from "@/lib/submissions/chat-history";

type NonStreamingMessage = Awaited<ReturnType<Anthropic["messages"]["create"]>> & {
  content: Array<{ text?: string; type: string }>;
};

const SUBMISSION_TEST_MODEL = "claude-sonnet-4-5";

function truncate(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}…`;
}

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }

  return new Anthropic({ apiKey });
}

function buildSubmissionContext(
  data: NonNullable<Awaited<ReturnType<typeof getDashboardSubmissionRequirementsData>>>
) {
  const parsedSubmission = data.submission?.parsedSubmission;
  const fileTree = parsedSubmission?.fileTree ?? [];
  const keyFilePaths = parsedSubmission?.keyFiles.map((file) => file.path) ?? [];
  const manifest = parsedSubmission?.manifest ?? null;
  const manifestValidation = manifest
    ? manifest.validation.valid
      ? "valid"
      : `invalid (${manifest.validation.errors.join("; ") || "no parser error details"})`
    : "not found";
  const executableFiles = fileTree.filter((filePath) =>
    /(?:^|\/)(?:agent|main|run|strategy)\.py$|(?:^|\/)(?:index|main)\.(?:js|ts)$/i.test(filePath)
  );
  const sourceExtractionSummary = parsedSubmission
    ? [
        "Source extraction: parsed submitted repository source.",
        `Recovered files: ${fileTree.length}.`,
        `Key review files: ${keyFilePaths.join(", ") || "(none extracted)"}.`,
        `Manifest: ${manifest?.path ?? "(none found)"}.`,
        `Manifest validation: ${manifestValidation}.`,
        `Manifest entry point: ${manifest?.entrypoint ?? "(not declared)"}.`,
        `Executable file signal: ${executableFiles.join(", ") || "(none detected)"}.`,
      ].join("\n")
    : "Source extraction: not available for this submission.";
  const interpretedEntryPoint =
    data.submission?.card?.entryPoint ||
    manifest?.entrypoint ||
    data.application.intakeReport.executionTarget ||
    "(not extracted)";
  const interpretedExecutionMode =
    data.submission?.card?.executionMode ||
    (manifest?.runtime ? `runtime:${manifest.runtime}` : null) ||
    (manifest?.responseFormats.includes("freeform") ? "QUERY_RESPONSE" : null) ||
    "(unknown)";
  const platformInterface = [
    "The admin chat can inspect and reason about submitted source as soon as source extraction succeeds; it does not require stage-1 quarantine or adapter generation to answer source-grounded questions.",
    "For executable testing, the preferred native contract is: expose a runnable command or entry point, read one JSON query envelope from stdin, and write one response to stdout.",
    'Query envelope shape: { "query_id": string, "prompt": string, "response_format": "freeform", "context": object, "metrics": string[] }.',
    "Direct Run implementation note: when the Run Agent path executes a submitted process, the platform writes that JSON query envelope to stdin and then closes stdin. Do not infer missing stdin from a timeout unless concrete execution logs say stdin was absent.",
    'For the current template SDK, an agent can implement `freeform(query: AgentQuery) -> str`; the platform can wrap that text for display or stricter downstream schemas.',
    "A manifest is routing metadata, not business logic. It is useful when auto-discovery cannot safely infer the command, runtime, working directory, or supported response formats.",
    "Adapter generation is only needed when the submitted code does not already speak the platform contract. Stage-1 quarantine is a safety and smoke-test gate before production execution, not a prerequisite for chat inspection.",
  ].join("\n");
  const keyFiles = parsedSubmission?.keyFiles
    ?.slice(0, 4)
    .map(
      (file) =>
        `## ${file.path}\n\`\`\`${file.language}\n${truncate(file.content, 2200)}\n\`\`\``
    )
    .join("\n\n");

  const requirementSummary =
    data.requirements.length === 0
      ? "(none extracted)"
      : data.requirements
          .map((requirement) => {
            const envVars =
              requirement.envVars.length === 0
                ? "no operator-managed env vars"
                : requirement.envVars
                    .map(
                      (envVar) => {
                        const alias =
                          envVar.satisfiedByEnvVarName
                            ? ` via ${envVar.satisfiedByEnvVarName}`
                            : "";
                        return `${envVar.envVarName}${alias} (${envVar.source}, ${envVar.syncState})`;
                      }
                    )
                    .join(", ");

            return `- ${requirement.label} [${requirement.typeLabel}] — ${requirement.summary}. Access: ${requirement.accessLabel}. Env vars: ${envVars}.`;
          })
          .join("\n");

  const recentEvents =
    data.application.recentEvents.length === 0
      ? "(none)"
      : data.application.recentEvents
          .slice(0, 5)
          .map(
            (event) =>
              `- ${event.createdAt}: ${event.eventType} — ${truncate(event.summary, 280)}`
          )
          .join("\n");

  return `# Submission profile
Agent name: ${data.application.agentName}
Submitter: ${data.application.submitter}
Status: ${data.application.status}
Current stage: ${data.application.currentStage}
Package type: ${data.application.packageType}
Package reference: ${data.application.packageReference}
Documentation reference: ${data.application.documentationReference}
Submitted at: ${data.application.submittedAt}
Updated at: ${data.application.updatedAt}

# Strategy and intake
Description: ${data.application.description || "(none provided)"}
Claimed edge: ${data.application.claimedEdge || "(none provided)"}
Data sources required: ${data.application.dataSourcesRequired || "(none provided)"}
Intake summary: ${data.application.intakeReport.summary || "(none provided)"}
Execution target: ${data.application.intakeReport.executionTarget || "(not declared)"}
Dependency declaration: ${data.application.intakeReport.dependencyDeclaration || "(not declared)"}
Intake notes:
${data.application.intakeReport.notes.join("\n") || "(none)"}

# Submission interpretation card
Entry point: ${interpretedEntryPoint}
Execution mode: ${interpretedExecutionMode}
Kill switch behavior: ${data.submission?.card?.killSwitchBehavior || "(not extracted)"}
Decision cadence: ${data.submission?.card?.decisionCadence || "(not extracted)"}
Timeframe: ${data.submission?.card?.timeframe || "(not extracted)"}
Asset universe: ${data.submission?.card?.assetUniverse || "(not extracted)"}
AI HR notes: ${data.submission?.card?.aiHrNotes || "(none)"}

# Adapter rationale
${data.submission?.adapter?.rationale || "(no adapter rationale generated yet)"}

# Runtime requirements
${requirementSummary}

# Source extraction status
${sourceExtractionSummary}

# Platform query interface
${platformInterface}

# Parsed repository signal
Detected env vars:
${parsedSubmission?.detectedEnvVars.join("\n") || "(none detected)"}

Detected imports:
${parsedSubmission?.detectedImports.join("\n") || "(none detected)"}

Detected URLs:
${parsedSubmission?.detectedUrls.join("\n") || "(none detected)"}

File tree:
${parsedSubmission?.fileTree.slice(0, 80).join("\n") || "(not available)"}

# Key files
${keyFiles || "(no extracted key files available)"}

# Recent application events
${recentEvents}`;
}

function buildSystemPrompt(context: string) {
  return `You are the admin-side interactive test harness for a submitted research agent. Your job is to help internal reviewers pressure-test whether the submission is coherent and likely to work.

Stay grounded in the submission context below. Never invent code, data feeds, tools, or runtime behavior that are not supported by the provided package metadata.

When an admin asks you to "test" something:
- reason from the submitted code, extracted files, adapter, and intake artifacts
- simulate expected behavior step by step
- be explicit about missing inputs, fragile assumptions, or broken execution paths
- never claim you actually executed code, published research events, hit APIs, or observed live market data unless the context explicitly contains those outputs

Source and verdict rules:
- Treat the file tree, source extraction status, and key files as authoritative. Do not claim files, manifests, requirements, or implementation code are missing when they appear there.
- Treat missing adapter generation, an incomplete intake stage, or lack of live execution output as "needs runtime verification" unless the context shows a concrete missing file, invalid manifest, failed smoke test, or execution error. Do not list adapter generation or stage-1 quarantine as reasons the chat harness itself cannot work.
- Do not say a proper manifest.yaml is categorically required. If the manifest or auto-discovery exposes a command or entry point, call that out; if it does not, explain the missing executable contract specifically.
- Do not label optional model-selection env vars such as ANTHROPIC_MODEL as missing credentials. The platform can supply house-managed API credentials separately from submitted code.
- Do not present speculative timeout explanations as execution traces. In particular, do not say the platform failed to pipe a query envelope, did not provide stdin, or ran python3 agent.py with no stdin unless the provided context explicitly contains that exact execution evidence. If all you know is that there was no stdout before timeout, say that the process timed out before producing stdout and list plausible causes separately.

Respond as if the admin is interrogating the submitted agent itself, but break character immediately if you need to call out uncertainty or a likely implementation gap. Prefer concise, concrete answers over generic theory. If helpful, end with a one-line verdict such as "Likely coherent", "Needs runtime verification", or "Broken / incomplete".

Submission context:
${context}`;
}

function extractTextContent(
  response: NonStreamingMessage
) {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      messages?: unknown;
      sessionId?: unknown;
    };
    const clientMessages = normalizePersistableChatMessages(body.messages);
    const messages = toModelChatMessages(clientMessages);

    if (messages.length === 0) {
      return Response.json({ error: "Enter a prompt first." }, { status: 400 });
    }

    const data = await getDashboardSubmissionRequirementsData(id);

    if (!data) {
      return Response.json({ error: "Submission not found." }, { status: 404 });
    }

    if (!data.submission) {
      return Response.json(
        { error: "This application is not linked to a submitted agent." },
        { status: 404 }
      );
    }

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: SUBMISSION_TEST_MODEL,
      max_tokens: 900,
      stream: false,
      system: buildSystemPrompt(buildSubmissionContext(data)),
      messages,
    }) as NonStreamingMessage;
    const message = extractTextContent(response);

    if (!message) {
      throw new Error("The test harness returned an empty response.");
    }

    const history = await persistSubmissionChatMessages({
      messages: [
        ...clientMessages,
        {
          content: message,
          role: "assistant",
        },
      ],
      sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
      submissionId: data.submission.id,
      surface: "DASHBOARD",
    });

    return Response.json({
      activeSessionId: history.activeSessionId,
      message,
      messages: history.messages,
      sessions: history.sessions,
    });
  } catch (error) {
    console.error("[submission-deep-dive-chat]", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to test this submission right now.";

    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const data = await getDashboardSubmissionRequirementsData(id);

    if (!data?.submission) {
      return Response.json({ error: "Submission not found." }, { status: 404 });
    }

    const url = new URL(request.url);
    const history = await getSubmissionChatHistory({
      sessionId: url.searchParams.get("sessionId"),
      submissionId: data.submission.id,
      surface: "DASHBOARD",
    });

    return Response.json(history);
  } catch (error) {
    console.error("[submission-deep-dive-chat-history]", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to load chat history right now.";

    return Response.json({ error: message }, { status: 500 });
  }
}

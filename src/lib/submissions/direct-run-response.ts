import "server-only";

import {
  normalizePersistableChatMessages,
  persistSubmissionChatMessages,
  type SubmissionChatSurface,
} from "@/lib/submissions/chat-history";
import {
  buildDirectRunChatContent,
  runSubmittedAgentDirectly,
  type DirectAgentRunResult,
} from "@/lib/submissions/direct-run";
import { getSubmittedAgentLlmGatewayBaseUrl } from "@/lib/submissions/llm-gateway";

type DirectRunRequestBody = {
  chatSessionId?: unknown;
  context?: unknown;
  injectManagedCredentials?: unknown;
  messages?: unknown;
  metrics?: unknown;
  prompt?: unknown;
};

type DirectRunStreamEvent =
  | {
      text: string;
      type: "stdout";
    }
  | {
      activeSessionId: string | null;
      messages: Awaited<ReturnType<typeof persistSubmissionChatMessages>>["messages"];
      result: DirectAgentRunResult;
      sessions: Awaited<ReturnType<typeof persistSubmissionChatMessages>>["sessions"];
      type: "done";
    }
  | {
      error: string;
      type: "error";
    };

function truncateConversationContent(value: string, maxLength = 4_000) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function toDirectRunConversationMessages(
  messages: ReturnType<typeof normalizePersistableChatMessages>
) {
  const normalizedMessages = messages
    .map((message) => ({
      content: truncateConversationContent(message.content),
      role: message.role,
    }))
    .filter((message) => message.content);
  const firstUserMessageIndex = normalizedMessages.findIndex(
    (message) => message.role === "user"
  );

  if (firstUserMessageIndex === -1) {
    return [];
  }

  // Drop synthetic leading assistant greetings; submitted agents need the real turn history.
  return normalizedMessages.slice(firstUserMessageIndex).slice(-24);
}

function wantsStreamingResponse(request: Request) {
  return request.headers
    .get("accept")
    ?.toLowerCase()
    .split(",")
    .some((value) => value.trim().startsWith("application/x-ndjson")) === true;
}

function readErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to run this submitted agent right now.";
}

async function runAndPersistSubmittedAgent(input: {
  body: DirectRunRequestBody;
  llmGatewayBaseUrl: string;
  onStdoutChunk?: (chunk: string) => void;
  submissionId: string;
  surface: SubmissionChatSurface;
}) {
  const clientMessages = normalizePersistableChatMessages(input.body.messages);
  const result = await runSubmittedAgentDirectly({
    conversationMessages: toDirectRunConversationMessages(clientMessages),
    context: input.body.context,
    injectManagedCredentials: input.body.injectManagedCredentials === true,
    llmGatewayBaseUrl: input.llmGatewayBaseUrl,
    metrics: input.body.metrics,
    onStdoutChunk: input.onStdoutChunk,
    prompt: input.body.prompt,
    submissionId: input.submissionId,
  });
  const assistantMessage = buildDirectRunChatContent(result);
  const history = await persistSubmissionChatMessages({
    messages: [
      ...clientMessages,
      {
        content: assistantMessage,
        role: "assistant",
        tone: result.execution.exitCode === 0 ? "default" : "error",
      },
    ],
    sessionId:
      typeof input.body.chatSessionId === "string"
        ? input.body.chatSessionId
        : null,
    submissionId: input.submissionId,
    surface: input.surface,
  });

  return {
    activeSessionId: history.activeSessionId,
    messages: history.messages,
    result,
    sessions: history.sessions,
  };
}

function createStreamingDirectRunResponse(input: {
  body: DirectRunRequestBody;
  llmGatewayBaseUrl: string;
  submissionId: string;
  surface: SubmissionChatSurface;
}) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: DirectRunStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const payload = await runAndPersistSubmittedAgent({
          ...input,
          onStdoutChunk: (chunk) => {
            enqueue({
              text: chunk,
              type: "stdout",
            });
          },
        });

        enqueue({
          ...payload,
          type: "done",
        });
      } catch (error) {
        enqueue({
          error: readErrorMessage(error),
          type: "error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}

export async function createSubmittedAgentDirectRunResponse(input: {
  body: DirectRunRequestBody;
  request: Request;
  submissionId: string;
  surface: SubmissionChatSurface;
}) {
  const llmGatewayBaseUrl = getSubmittedAgentLlmGatewayBaseUrl(input.request);

  if (wantsStreamingResponse(input.request)) {
    return createStreamingDirectRunResponse({
      body: input.body,
      llmGatewayBaseUrl,
      submissionId: input.submissionId,
      surface: input.surface,
    });
  }

  return Response.json(
    await runAndPersistSubmittedAgent({
      body: input.body,
      llmGatewayBaseUrl,
      submissionId: input.submissionId,
      surface: input.surface,
    })
  );
}

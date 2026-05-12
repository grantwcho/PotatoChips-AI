"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { EnvironmentVariablesEditor } from "@/components/dashboard/environment-variables-editor";
import type { DashboardToolRequirement } from "@/lib/dashboard/tool-access";
import type { DeveloperSubmissionDeepDiveData } from "@/lib/developer/deep-dive";
import { readDirectRunStream } from "@/lib/submissions/direct-run-client";

type ChatRole = "assistant" | "user";

type ChatMessage = {
  content: string;
  createdAt?: string;
  id: string;
  role: ChatRole;
  tone?: "default" | "error";
};

type ChatSessionSummary = {
  createdAt: string;
  id: string;
  messageCount: number;
  preview: string;
  title: string;
  updatedAt: string;
};

type ChatHistoryResponse = {
  activeSessionId?: string | null;
  messages?: ChatMessage[];
  sessions?: ChatSessionSummary[];
};

type DirectAgentRunResult = {
  execution: {
    command: string;
    credentialsInjected: boolean;
    descriptor: string;
    durationMs: number;
    exitCode: number;
    injectedEnvVarNames: string[];
    llmGatewayProviders: string[];
    networkEnabled: boolean;
    networkPolicy: string;
    proxiedEnvVarNames: string[];
    sandboxed: boolean;
    timeoutMs: number;
    withheldEnvVarNames: string[];
  };
  parsedResponse: unknown;
  stderr: string;
  stdout: string;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatChatHistoryTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function accessBadgeClass(status: DashboardToolRequirement["accessStatus"]) {
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

function buildInitialMessage(data: DeveloperSubmissionDeepDiveData): ChatMessage {
  const agentName = data.submission.agentName || "this submission";
  const entryPoint =
    data.submission.card?.entryPoint ??
    data.submission.parsedSubmission?.manifest?.entrypoint ??
    "an undeclared entry point";

  return {
    id: "initial",
    role: "assistant",
    tone: "default",
    content: `I’m ready to pressure-test ${agentName}. Ask me to walk through a market scenario, explain how I produce signals, or highlight where the implementation still looks brittle. I’ll stay grounded in the submitted code, metadata, and extracted entry point (${entryPoint}).`,
  };
}

function formatJsonBlock(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function buildDirectRunMessage(result: DirectAgentRunResult) {
  const parsedResponse = result.parsedResponse
    ? `\n\n**Parsed response**\n\`\`\`json\n${formatJsonBlock(result.parsedResponse)}\n\`\`\``
    : "";
  const stdout = result.stdout || "(empty)";
  const stderr = result.stderr
    ? `\n\n**stderr**\n\`\`\`text\n${result.stderr}\n\`\`\``
    : "";
  const withheldEnvVarNames = result.execution.withheldEnvVarNames ?? [];
  const proxiedEnvVarNames = result.execution.proxiedEnvVarNames ?? [];
  const llmGatewayProviders = result.execution.llmGatewayProviders ?? [];
  const withheld =
    withheldEnvVarNames.length > 0
      ? `- Withheld operator-only keys: ${withheldEnvVarNames
          .map((envVarName) => `\`${envVarName}\``)
          .join(", ")}`
      : null;
  const proxied =
    llmGatewayProviders.length > 0
      ? `- Managed LLM gateway: ${llmGatewayProviders.join(", ")} (${proxiedEnvVarNames
          .map((envVarName) => `\`${envVarName}\``)
          .join(", ")})`
      : null;

  return [
    "**Direct agent run**",
    `- Command: \`${result.execution.command}\``,
    `- Descriptor: ${result.execution.descriptor}`,
    `- Exit code: \`${result.execution.exitCode}\``,
    `- Duration: ${result.execution.durationMs}ms`,
    `- Managed credentials: ${result.execution.credentialsInjected ? "injected" : "not injected"}`,
    proxied,
    withheld,
    `- Network: ${result.execution.networkEnabled ? "enabled" : "disabled"}`,
    parsedResponse,
    `\n\n**stdout**\n\`\`\`text\n${stdout}\n\`\`\``,
    stderr,
  ].filter(Boolean).join("\n");
}

function mapHistoryMessages(
  data: DeveloperSubmissionDeepDiveData,
  messages: ChatMessage[] | undefined
) {
  return messages && messages.length > 0
    ? messages
    : [buildInitialMessage(data)];
}

function getLatestAssistantMessageId(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "assistant" && message.tone !== "error") {
      return message.id;
    }
  }

  return null;
}

export function DeveloperSubmissionWorkbench({
  data,
}: {
  data: DeveloperSubmissionDeepDiveData;
}) {
  const [draft, setDraft] = useState("");
  const [injectManagedCredentials, setInjectManagedCredentials] = useState(true);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isRunningAgent, setIsRunningAgent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([buildInitialMessage(data)]);
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasPlacedInitialScrollRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasConfigurableEnvVars = data.requirements.some(
    (requirement) => requirement.envVars.length > 0
  );

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior) => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }, []);

  const loadChatHistory = useCallback(async (sessionId?: string | null) => {
    setAnimatedMessageId(null);
    hasPlacedInitialScrollRef.current = false;
    setIsHistoryLoading(true);

    try {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      const response = await fetch(
        `/api/developer/submissions/${data.submission.id}/chat${query}`,
        {
          cache: "no-store",
        }
      );
      const body = (await response.json().catch(() => ({}))) as ChatHistoryResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load chat history.");
      }

      setActiveSessionId(body.activeSessionId ?? null);
      setChatSessions(body.sessions ?? []);
      setMessages(mapHistoryMessages(data, body.messages));
    } catch {
      setActiveSessionId(null);
      setMessages([buildInitialMessage(data)]);
    } finally {
      setIsHistoryLoading(false);
    }
  }, [data]);

  useEffect(() => {
    void loadChatHistory();
  }, [loadChatHistory]);

  useLayoutEffect(() => {
    if (isHistoryLoading || hasPlacedInitialScrollRef.current) {
      return;
    }

    hasPlacedInitialScrollRef.current = true;
    scrollChatToBottom("auto");
  }, [isHistoryLoading, messages.length, scrollChatToBottom]);

  useEffect(() => {
    if (!hasPlacedInitialScrollRef.current) {
      return;
    }

    scrollChatToBottom("smooth");
  }, [messages, isRunningAgent, isSending, scrollChatToBottom]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [draft]);

  useEffect(() => {
    if (!isDetailsOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDetailsOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isDetailsOpen]);

  async function sendPrompt(rawPrompt: string) {
    const prompt = rawPrompt.trim();

    if (!prompt || isSending || isRunningAgent) {
      return;
    }

    const nextMessages = [
      ...messages,
      {
        id: `user-${Date.now()}`,
        role: "user" as const,
        content: prompt,
      },
    ];

    setDraft("");
    setIsSending(true);
    setAnimatedMessageId(null);
    setMessages(nextMessages);

    try {
      const response = await fetch(`/api/developer/submissions/${data.submission.id}/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionId: activeSessionId,
          messages: nextMessages.map((message) => ({
            content: message.content,
            role: message.role,
            tone: message.tone,
          })),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        activeSessionId?: string | null;
        error?: string;
        message?: string;
        messages?: ChatMessage[];
        sessions?: ChatSessionSummary[];
      };

      if (!response.ok || !body.message) {
        throw new Error(body.error ?? "Unable to test this submission right now.");
      }

      setActiveSessionId(body.activeSessionId ?? activeSessionId);
      setChatSessions(body.sessions ?? chatSessions);
      const nextRenderedMessages: ChatMessage[] =
        body.messages && body.messages.length > 0
          ? body.messages
          : [
              ...nextMessages,
              {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: body.message,
              },
            ];

      setAnimatedMessageId(getLatestAssistantMessageId(nextRenderedMessages));
      setMessages(nextRenderedMessages);
    } catch (error) {
      const fallback =
        error instanceof Error ? error.message : "Unable to test this submission right now.";

      setAnimatedMessageId(null);
      setMessages([
        ...nextMessages,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          tone: "error",
          content: fallback,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  async function runAgent(rawPrompt: string) {
    const prompt = rawPrompt.trim();

    if (!prompt || isSending || isRunningAgent) {
      return;
    }

    const nextMessages = [
      ...messages,
      {
        id: `user-${Date.now()}`,
        role: "user" as const,
        content: prompt,
      },
    ];

    const assistantMessageId = `assistant-run-${Date.now()}`;

    setDraft("");
    setIsRunningAgent(true);
    setAnimatedMessageId(null);
    setMessages([
      ...nextMessages,
      {
        id: assistantMessageId,
        role: "assistant" as const,
        content: "",
      },
    ]);

    try {
      const response = await fetch(`/api/developer/submissions/${data.submission.id}/run`, {
        method: "POST",
        headers: {
          accept: "application/x-ndjson",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          chatSessionId: activeSessionId,
          injectManagedCredentials,
          messages: nextMessages.map((message) => ({
            content: message.content,
            role: message.role,
            tone: message.tone,
          })),
          prompt,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        throw new Error(body.error ?? "Unable to run this submitted agent right now.");
      }

      let didFinish = false;

      await readDirectRunStream<ChatMessage, ChatSessionSummary, DirectAgentRunResult>(
        response,
        (event) => {
          if (event.type === "stdout") {
            setMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: `${message.content}${event.text}`,
                    }
                  : message
              )
            );
            return;
          }

          if (event.type === "error") {
            throw new Error(event.error ?? "Unable to run this submitted agent right now.");
          }

          didFinish = true;
          setActiveSessionId(event.activeSessionId ?? activeSessionId);
          setChatSessions(event.sessions ?? chatSessions);

          const nextRenderedMessages: ChatMessage[] =
            event.messages && event.messages.length > 0
              ? event.messages
              : event.result
                ? [
                    ...nextMessages,
                    {
                      id: assistantMessageId,
                      role: "assistant",
                      content: buildDirectRunMessage(event.result),
                      tone: event.result.execution.exitCode === 0 ? "default" : "error",
                    },
                  ]
                : nextMessages;

          setAnimatedMessageId(null);
          setMessages(nextRenderedMessages);
        }
      );

      if (!didFinish) {
        throw new Error("The agent stream ended before the run completed.");
      }
    } catch (error) {
      const fallback =
        error instanceof Error
          ? error.message
          : "Unable to run this submitted agent right now.";

      setAnimatedMessageId(null);
      setMessages([
        ...nextMessages,
        {
          id: `assistant-run-error-${Date.now()}`,
          role: "assistant",
          tone: "error",
          content: fallback,
        },
      ]);
    } finally {
      setIsRunningAgent(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAgent(draft);
  }

  function handleDraftKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void runAgent(draft);
    }
  }

  function startNewChat() {
    setActiveSessionId(null);
    setDraft("");
    setAnimatedMessageId(null);
    setMessages([buildInitialMessage(data)]);
  }

  const repoHref = data.submission.sourceViewUrl ?? null;
  const agentName = data.submission.agentName || "Submitted agent";
  const submitter =
    data.submission.user.name ||
    data.submission.user.githubLogin ||
    data.submission.user.email ||
    "Unknown submitter";
  const entryPoint =
    data.submission.card?.entryPoint ??
    data.submission.parsedSubmission?.manifest?.entrypoint ??
    "Not declared";
  const executionMode =
    data.submission.card?.executionMode ??
    data.submission.parsedSubmission?.manifest?.runtime ??
    "Not declared";
  const latestMessage = messages[messages.length - 1];
  const isStreamingAssistantText =
    isRunningAgent &&
    latestMessage?.role === "assistant" &&
    latestMessage.content.trim().length > 0;
  const showTypingIndicator =
    (isSending || isRunningAgent) && !isStreamingAssistantText;

  return (
    <>
      <div className="flex h-[calc(100svh-4.5rem)] min-h-0 flex-col gap-6">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Link
              href="/developer/applications"
              className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:text-foreground"
            >
              <span aria-hidden="true">←</span>
              <span>Back to submissions</span>
            </Link>
            <h1>{agentName}</h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsDetailsOpen(true)}
              className="rounded border border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:border-black hover:text-foreground"
            >
              View details
            </button>
          </div>
        </section>

        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-border bg-surface-1">
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside className="flex max-h-48 shrink-0 flex-col border-b border-border bg-surface-0 md:max-h-none md:w-64 md:border-b-0 md:border-r">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
                  Chat history
                </p>
                <button
                  type="button"
                  onClick={startNewChat}
                  className="rounded border border-border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted transition-colors hover:border-black hover:text-foreground"
                >
                  New
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {isHistoryLoading ? (
                  <p className="px-2 py-3 text-xs text-muted">Loading chats…</p>
                ) : chatSessions.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted">No saved chats yet.</p>
                ) : (
                  <div className="space-y-1">
                    {chatSessions.map((session) => {
                      const isActive = session.id === activeSessionId;

                      return (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => void loadChatHistory(session.id)}
                          className={`w-full rounded px-3 py-2 text-left transition-colors ${
                            isActive
                              ? "bg-foreground text-background"
                              : "text-foreground hover:bg-black/[0.04]"
                          }`}
                        >
                          <span className="block truncate text-sm">{session.title}</span>
                          <span
                            className={`mt-1 block truncate text-[11px] ${
                              isActive ? "text-background/70" : "text-muted"
                            }`}
                          >
                            {formatChatHistoryTime(session.updatedAt)}
                            {session.messageCount > 0 ? ` · ${session.messageCount}` : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-surface-1 via-surface-1/85 to-transparent" />
              <div
                ref={scrollContainerRef}
                className="chat-message-copy min-h-0 flex-1 overflow-y-auto px-5 pb-0 pt-6"
              >
                <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end">
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <ChatBubble
                        key={message.id}
                        animate={message.id === animatedMessageId}
                        message={message}
                      />
                    ))}

                    {showTypingIndicator ? (
                      <ChatTypingIndicator />
                    ) : null}
                  </div>
                </div>
              </div>

              <form
                onSubmit={handleSubmit}
                className="shrink-0 bg-surface-1 px-4 pb-4 pt-0"
              >
                <div className="mx-auto max-w-3xl">
                  <div className="overflow-hidden rounded-[24px] border border-border bg-surface-1 shadow-sm">
                    <textarea
                      ref={textareaRef}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={handleDraftKeyDown}
                      rows={1}
                      placeholder={`Ask ${agentName} how it would react to a market scenario, explain its signal logic, or reveal where it might fail.`}
                      className="min-h-[104px] max-h-[240px] w-full resize-none bg-transparent px-4 py-4 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-3 pt-0">
                      <label className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                        <input
                          type="checkbox"
                          checked={injectManagedCredentials}
                          onChange={(event) => setInjectManagedCredentials(event.target.checked)}
                          className="h-4 w-4 accent-foreground"
                        />
                        <span>Use managed data keys</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={isSending || isRunningAgent || !draft.trim()}
                          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isRunningAgent ? "Running…" : "Run agent"}
                        </button>
                        <button
                          type="button"
                          disabled={isSending || isRunningAgent || !draft.trim()}
                          onClick={() => void sendPrompt(draft)}
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-foreground transition-colors hover:border-black disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isSending ? "Asking…" : "Ask harness"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </section>
      </div>

      {isDetailsOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close details panel"
            onClick={() => setIsDetailsOpen(false)}
            className="absolute inset-0 bg-black/30"
          />

          <aside className="absolute inset-y-0 right-0 flex w-full max-w-[36rem] flex-col border-l border-border bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted">View details</p>
                <h2 className="mt-2 text-2xl font-semibold text-foreground">{agentName}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Everything attached to your signed submission lives here.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailsOpen(false)}
                className="rounded border border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:border-black hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              <section className="grid gap-3 sm:grid-cols-2">
                <DetailCard
                  label="Repository"
                  value={data.submission.githubRepoFullName ?? "Manual submission"}
                />
                <DetailCard label="Branch" value={data.submission.githubBranch ?? "—"} />
                <DetailCard
                  label="Commit"
                  value={data.submission.githubCommitSha?.slice(0, 12) ?? "—"}
                  monospace
                />
                <DetailCard label="Submitted" value={formatDateTime(data.submission.createdAt)} />
                <DetailCard label="Updated" value={formatDateTime(data.submission.updatedAt)} />
                <DetailCard label="Submitter" value={submitter} />
              </section>

              <section className="space-y-3 border border-border bg-white p-5">
                <PanelTitle
                  eyebrow="Submission Summary"
                  title="What you submitted"
                  detail="This consolidates the signed submission record, extracted card, and package metadata."
                />
                <dl className="space-y-3 text-sm text-muted">
                  <DetailRow
                    label="Description"
                    value={data.submission.description || "No description provided."}
                    multiline
                  />
                  <DetailRow
                    label="Claimed edge"
                    value={data.submission.card?.claimedEdge || "Not declared."}
                    multiline
                  />
                  <DetailRow
                    label="Entry point"
                    value={entryPoint}
                  />
                  <DetailRow
                    label="Execution mode"
                    value={executionMode}
                  />
                  <DetailRow
                    label="Timeframe"
                    value={data.submission.card?.timeframe || "Not declared"}
                  />
                  <DetailRow
                    label="Asset universe"
                    value={data.submission.card?.assetUniverse || "Not declared"}
                    multiline
                  />
                </dl>
                {repoHref ? (
                  <Link
                    href={repoHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-[10px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:text-foreground"
                  >
                    View repository
                  </Link>
                ) : null}
              </section>

              <section className="space-y-4 border border-border bg-white p-5">
                <PanelTitle
                  eyebrow="Requirements"
                  title="Environment variables"
                  detail="Configure the container variables this submission needs at runtime."
                />

                {!hasConfigurableEnvVars ? (
                  <p className="text-sm text-muted">
                    No user-configurable environment variables were extracted from this submission yet.
                  </p>
                ) : (
                  <EnvironmentVariablesEditor
                    requirements={data.requirements}
                    saveEndpoint={`/api/developer/submissions/${data.submission.id}/environment`}
                  />
                )}
              </section>

              {data.requirements.length > 0 ? (
                <section className="space-y-4 border border-border bg-white p-5">
                  <PanelTitle
                    eyebrow="Sources"
                    title="Detected requirement sources"
                    detail="External services and tools that requested the environment variables above."
                  />

                  <div className="space-y-3">
                    {data.requirements.map((requirement) => (
                      <section key={requirement.key} className="rounded border border-black/8 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">
                            {requirement.label}
                          </h3>
                          <span className="rounded bg-neutral-100 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-muted">
                            {requirement.typeLabel}
                          </span>
                          <span
                            className={`rounded px-2 py-1 text-[11px] uppercase tracking-[0.14em] ${accessBadgeClass(
                              requirement.accessStatus
                            )}`}
                          >
                            {requirement.accessLabel}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted">{requirement.summary}</p>
                        {requirement.envVars.length > 0 ? (
                          <p className="mt-2 font-mono text-xs text-muted">
                            {requirement.envVars.map((envVar) => envVar.envVarName).join(", ")}
                          </p>
                        ) : null}
                      </section>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function ChatBubble({
  animate = false,
  message,
}: {
  animate?: boolean;
  message: ChatMessage;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end pt-2">
        <div className="max-w-[72%] rounded-2xl rounded-br-md bg-foreground px-4 py-3 text-sm leading-relaxed text-background shadow-sm">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  const toneClass =
    message.tone === "error"
      ? "text-rose-900 dark:text-rose-100"
      : "text-foreground";

  return (
    <div className="flex justify-start pt-2">
      <div className={`max-w-[min(48rem,88%)] px-1 py-2 ${toneClass}`}>
        <ChatMarkdown
          animate={animate}
          className="text-sm leading-relaxed"
          content={message.content}
        />
      </div>
    </div>
  );
}

function ChatTypingIndicator() {
  return (
    <div className="flex justify-start pt-2">
      <p className="chat-thinking-shimmer max-w-[min(42rem,80%)] px-1 py-2 text-sm font-medium">
        Thinking
      </p>
    </div>
  );
}

function PanelTitle({
  detail,
  eyebrow,
  title,
}: {
  detail: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{eyebrow}</p>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-6 text-muted">{detail}</p>
    </div>
  );
}

function DetailCard({
  label,
  monospace = false,
  value,
}: {
  label: string;
  monospace?: boolean;
  value: string;
}) {
  return (
    <div className="border border-border bg-white p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className={`mt-2 text-sm text-foreground ${monospace ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function DetailRow({
  label,
  multiline = false,
  value,
}: {
  label: string;
  multiline?: boolean;
  value: string;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className={multiline ? "leading-6 text-foreground" : "text-foreground"}>{value}</dd>
    </div>
  );
}

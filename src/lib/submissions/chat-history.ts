import "server-only";

import { prisma } from "@/lib/prisma";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";

export type SubmissionChatSurface = "DASHBOARD" | "DEVELOPER";
export type SubmissionChatRole = "assistant" | "user";
export type SubmissionChatTone = "default" | "error";

export type SubmissionChatMessageView = {
  content: string;
  createdAt?: string;
  id: string;
  role: SubmissionChatRole;
  tone?: SubmissionChatTone;
};

export type PersistableSubmissionChatMessage = {
  content: string;
  role: SubmissionChatRole;
  tone?: SubmissionChatTone;
};

export type SubmissionChatSessionSummary = {
  createdAt: string;
  id: string;
  messageCount: number;
  preview: string;
  title: string;
  updatedAt: string;
};

export type SubmissionChatHistoryPayload = {
  activeSessionId: string | null;
  messages: SubmissionChatMessageView[];
  sessions: SubmissionChatSessionSummary[];
};

const MAX_STORED_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 20_000;
const UNTITLED_CHAT = "Untitled chat";

function truncate(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeSurface(value: SubmissionChatSurface) {
  return value === "DEVELOPER" ? "DEVELOPER" : "DASHBOARD";
}

export function normalizePersistableChatMessages(
  value: unknown
): PersistableSubmissionChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): PersistableSubmissionChatMessage | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as {
        content?: unknown;
        role?: unknown;
        tone?: unknown;
      };
      const role =
        record.role === "assistant" || record.role === "user" ? record.role : null;
      const content =
        typeof record.content === "string"
          ? truncate(record.content, MAX_MESSAGE_CHARS)
          : "";
      const tone =
        record.tone === "error" || record.tone === "default" ? record.tone : undefined;

      if (!role || !content) {
        return null;
      }

      return {
        content,
        role,
        tone,
      };
    })
    .filter((entry): entry is PersistableSubmissionChatMessage => entry !== null)
    .slice(-MAX_STORED_MESSAGES);
}

export function toModelChatMessages(
  messages: Array<{
    content: string;
    role: SubmissionChatRole;
  }>
) {
  return messages
    .map((message) => ({
      content: truncate(message.content, 4000),
      role: message.role,
    }))
    .slice(-12);
}

function deriveSessionTitle(
  messages: Array<{
    content: string;
    role: SubmissionChatRole;
  }>
) {
  const firstUserMessage = messages.find((message) => message.role === "user");

  return firstUserMessage
    ? truncate(firstUserMessage.content.replace(/\s+/g, " "), 64)
    : UNTITLED_CHAT;
}

function mapMessageRecord(record: {
  content: string;
  createdAt: Date;
  id: string;
  role: string;
  tone: string | null;
}): SubmissionChatMessageView {
  return {
    content: record.content,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    role: record.role === "user" ? "user" : "assistant",
    tone: record.tone === "error" ? "error" : "default",
  };
}

async function listSessionSummaries(input: {
  submissionId: string;
  surface: SubmissionChatSurface;
}) {
  const surface = normalizeSurface(input.surface);
  const sessions = await prisma.submissionChatSession.findMany({
    where: {
      submissionId: input.submissionId,
      surface,
    },
    include: {
      _count: {
        select: {
          messages: true,
        },
      },
      messages: {
        orderBy: {
          sortOrder: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 50,
  });

  return sessions.map((session) => ({
    createdAt: session.createdAt.toISOString(),
    id: session.id,
    messageCount: session._count.messages,
    preview: truncate(session.messages[0]?.content ?? "", 92),
    title: session.title || UNTITLED_CHAT,
    updatedAt: session.updatedAt.toISOString(),
  }));
}

export async function getSubmissionChatHistory(input: {
  sessionId?: string | null;
  submissionId: string;
  surface: SubmissionChatSurface;
}): Promise<SubmissionChatHistoryPayload> {
  await ensureSubmissionSchema();

  const surface = normalizeSurface(input.surface);
  const sessions = await listSessionSummaries({
    submissionId: input.submissionId,
    surface,
  });
  const activeSessionId =
    sessions.some((session) => session.id === input.sessionId)
      ? input.sessionId!
      : sessions[0]?.id ?? null;

  if (!activeSessionId) {
    return {
      activeSessionId: null,
      messages: [],
      sessions,
    };
  }

  const messages = await prisma.submissionChatMessage.findMany({
    where: {
      session: {
        id: activeSessionId,
        submissionId: input.submissionId,
        surface,
      },
    },
    orderBy: {
      sortOrder: "asc",
    },
  });

  return {
    activeSessionId,
    messages: messages.map(mapMessageRecord),
    sessions,
  };
}

export async function persistSubmissionChatMessages(input: {
  messages: Array<{
    content: string;
    role: SubmissionChatRole;
    tone?: SubmissionChatTone;
  }>;
  sessionId?: string | null;
  submissionId: string;
  surface: SubmissionChatSurface;
}) {
  await ensureSubmissionSchema();

  const messages = normalizePersistableChatMessages(input.messages);

  if (messages.length === 0) {
    return getSubmissionChatHistory(input);
  }

  const surface = normalizeSurface(input.surface);
  const existingSession = input.sessionId
    ? await prisma.submissionChatSession.findFirst({
        where: {
          id: input.sessionId,
          submissionId: input.submissionId,
          surface,
        },
      })
    : null;
  const title = existingSession?.title || deriveSessionTitle(messages);
  const session = existingSession
    ? await prisma.submissionChatSession.update({
        where: {
          id: existingSession.id,
        },
        data: {
          title,
        },
      })
    : await prisma.submissionChatSession.create({
        data: {
          submissionId: input.submissionId,
          surface,
          title,
        },
      });

  await prisma.$transaction(async (tx) => {
    await tx.submissionChatMessage.deleteMany({
      where: {
        sessionId: session.id,
      },
    });

    await tx.submissionChatMessage.createMany({
      data: messages.map((message, index) => ({
        content: message.content,
        role: message.role,
        sessionId: session.id,
        sortOrder: index,
        tone: message.tone ?? null,
      })),
    });

    await tx.submissionChatSession.update({
      where: {
        id: session.id,
      },
      data: {
        title,
      },
    });
  });

  return getSubmissionChatHistory({
    sessionId: session.id,
    submissionId: input.submissionId,
    surface,
  });
}

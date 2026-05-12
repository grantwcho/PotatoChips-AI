import "server-only";

import { prisma } from "@/lib/prisma";

declare global {
  var __gptCapitalSubmissionSchemaReady: boolean | undefined;
  var __gptCapitalSubmissionSchemaPromise: Promise<void> | undefined;
  var __gptCapitalSubmissionSchemaVersion: number | undefined;
}

const SUBMISSION_SCHEMA_VERSION = 4;

const SQLITE_BOOTSTRAP_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "submission_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "name" TEXT,
    "githubId" TEXT,
    "githubLogin" TEXT,
    "accessToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "environment_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "envVarName" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "googleSecretName" TEXT,
    "syncState" TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
    "syncMessage" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "submissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "githubRepoFullName" TEXT,
    "githubCommitSha" TEXT,
    "githubBranch" TEXT,
    "uploadContentHash" TEXT,
    "storagePath" TEXT NOT NULL,
    "agentName" TEXT,
    "description" TEXT NOT NULL,
    "linkedinProfileUrl" TEXT,
    "documentationPath" TEXT,
    "parsedSubmissionSnapshot" TEXT,
    "publicationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "publicAgentSlug" TEXT,
    "publicAgentSnapshot" TEXT,
    "reviewedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "processingStage" TEXT,
    "processingStageMessage" TEXT,
    "processingError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "submissions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "submission_users" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "interpretation_cards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "strategyClassification" TEXT NOT NULL,
    "assetUniverse" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "decisionCadence" TEXT NOT NULL,
    "capitalRangeMin" REAL,
    "capitalRangeMax" REAL,
    "claimedEdge" TEXT NOT NULL,
    "killSwitchBehavior" TEXT NOT NULL,
    "entryPoint" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL,
    "riskEnvelope" TEXT NOT NULL,
    "aiHrNotes" TEXT NOT NULL,
    "originalSnapshot" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "interpretation_cards_submissionId_fkey"
      FOREIGN KEY ("submissionId") REFERENCES "submissions" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "dependencies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "dependencies_cardId_fkey"
      FOREIGN KEY ("cardId") REFERENCES "interpretation_cards" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "adapters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'python',
    "rationale" TEXT NOT NULL,
    "originalCode" TEXT NOT NULL,
    "originalRationale" TEXT NOT NULL,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "adapters_submissionId_fkey"
      FOREIGN KEY ("submissionId") REFERENCES "submissions" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "attestations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "attestationText" TEXT NOT NULL,
    "agreedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "attestations_submissionId_fkey"
      FOREIGN KEY ("submissionId") REFERENCES "submissions" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "submission_chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'DASHBOARD',
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "submission_chat_sessions_submissionId_fkey"
      FOREIGN KEY ("submissionId") REFERENCES "submissions" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "submission_chat_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tone" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_chat_messages_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "submission_chat_sessions" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "submission_users_email_key" ON "submission_users"("email")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "submission_users_githubId_key" ON "submission_users"("githubId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "environment_secrets_envVarName_key" ON "environment_secrets"("envVarName")`,
  `CREATE INDEX IF NOT EXISTS "environment_secrets_updatedAt_idx" ON "environment_secrets"("updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "submissions_userId_createdAt_idx" ON "submissions"("userId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "submissions_status_createdAt_idx" ON "submissions"("status", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "submissions_source_createdAt_idx" ON "submissions"("source", "createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "submissions_publicAgentSlug_key" ON "submissions"("publicAgentSlug")`,
  `CREATE INDEX IF NOT EXISTS "submissions_publicationStatus_updatedAt_idx" ON "submissions"("publicationStatus", "updatedAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "interpretation_cards_submissionId_key" ON "interpretation_cards"("submissionId")`,
  `CREATE INDEX IF NOT EXISTS "dependencies_cardId_sortOrder_idx" ON "dependencies"("cardId", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "adapters_submissionId_key" ON "adapters"("submissionId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "attestations_submissionId_key" ON "attestations"("submissionId")`,
  `CREATE INDEX IF NOT EXISTS "submission_chat_sessions_submissionId_surface_updatedAt_idx" ON "submission_chat_sessions"("submissionId", "surface", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "submission_chat_messages_sessionId_sortOrder_idx" ON "submission_chat_messages"("sessionId", "sortOrder")`,
];

const POSTGRES_BOOTSTRAP_STATEMENTS = [
  `DO $$ BEGIN
      CREATE TYPE "SubmissionSource" AS ENUM ('GITHUB', 'UPLOAD');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$`,
  `DO $$ BEGIN
      CREATE TYPE "SubmissionStatus" AS ENUM ('CREATED', 'PROCESSING', 'READY_FOR_REVIEW', 'SIGNED', 'FAILED');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$`,
  `DO $$ BEGIN
      CREATE TYPE "SubmissionProcessingStage" AS ENUM ('SOURCE_ACQUISITION', 'PARSING_FILES', 'GENERATING_INTERPRETATION', 'GENERATING_ADAPTER');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$`,
  `DO $$ BEGIN
      CREATE TYPE "ExecutionMode" AS ENUM ('STREAMING', 'SCHEDULED', 'BACKTEST_ONLY', 'UNKNOWN');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$`,
  `DO $$ BEGIN
      CREATE TYPE "DependencyType" AS ENUM ('LLM_API', 'DATA_API', 'MODEL_WEIGHTS', 'PLATFORM_TOOL', 'CUSTOM');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$`,
  `CREATE TABLE IF NOT EXISTS "submission_users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "githubId" TEXT,
    "githubLogin" TEXT,
    "accessToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "submission_users_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "environment_secrets" (
    "id" TEXT NOT NULL,
    "envVarName" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "googleSecretName" TEXT,
    "syncState" TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
    "syncMessage" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "environment_secrets_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "submissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "SubmissionSource" NOT NULL,
    "githubRepoFullName" TEXT,
    "githubCommitSha" TEXT,
    "githubBranch" TEXT,
    "uploadContentHash" TEXT,
    "storagePath" TEXT NOT NULL,
    "agentName" TEXT,
    "description" TEXT NOT NULL,
    "linkedinProfileUrl" TEXT,
    "documentationPath" TEXT,
    "parsedSubmissionSnapshot" TEXT,
    "publicationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "publicAgentSlug" TEXT,
    "publicAgentSnapshot" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "status" "SubmissionStatus" NOT NULL DEFAULT 'CREATED',
    "processingStage" "SubmissionProcessingStage",
    "processingStageMessage" TEXT,
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "interpretation_cards" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "strategyClassification" TEXT NOT NULL,
    "assetUniverse" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "decisionCadence" TEXT NOT NULL,
    "capitalRangeMin" DOUBLE PRECISION,
    "capitalRangeMax" DOUBLE PRECISION,
    "claimedEdge" TEXT NOT NULL,
    "killSwitchBehavior" TEXT NOT NULL,
    "entryPoint" TEXT NOT NULL,
    "executionMode" "ExecutionMode" NOT NULL,
    "riskEnvelope" TEXT NOT NULL,
    "aiHrNotes" TEXT NOT NULL,
    "originalSnapshot" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "interpretation_cards_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "dependencies" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "dependencies_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "adapters" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'python',
    "rationale" TEXT NOT NULL,
    "originalCode" TEXT NOT NULL,
    "originalRationale" TEXT NOT NULL,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "adapters_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "attestations" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "attestationText" TEXT NOT NULL,
    "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "attestations_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "submission_chat_sessions" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'DASHBOARD',
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "submission_chat_sessions_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "submission_chat_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tone" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_chat_messages_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "submission_users_email_key" ON "submission_users"("email")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "submission_users_githubId_key" ON "submission_users"("githubId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "environment_secrets_envVarName_key" ON "environment_secrets"("envVarName")`,
  `CREATE INDEX IF NOT EXISTS "environment_secrets_updatedAt_idx" ON "environment_secrets"("updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "submissions_userId_createdAt_idx" ON "submissions"("userId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "submissions_status_createdAt_idx" ON "submissions"("status", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "submissions_source_createdAt_idx" ON "submissions"("source", "createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "submissions_publicAgentSlug_key" ON "submissions"("publicAgentSlug")`,
  `CREATE INDEX IF NOT EXISTS "submissions_publicationStatus_updatedAt_idx" ON "submissions"("publicationStatus", "updatedAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "interpretation_cards_submissionId_key" ON "interpretation_cards"("submissionId")`,
  `CREATE INDEX IF NOT EXISTS "dependencies_cardId_sortOrder_idx" ON "dependencies"("cardId", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "adapters_submissionId_key" ON "adapters"("submissionId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "attestations_submissionId_key" ON "attestations"("submissionId")`,
  `CREATE INDEX IF NOT EXISTS "submission_chat_sessions_submissionId_surface_updatedAt_idx" ON "submission_chat_sessions"("submissionId", "surface", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "submission_chat_messages_sessionId_sortOrder_idx" ON "submission_chat_messages"("sessionId", "sortOrder")`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'submissions_userId_fkey'
      ) THEN
        ALTER TABLE "submissions"
        ADD CONSTRAINT "submissions_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "submission_users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'interpretation_cards_submissionId_fkey'
      ) THEN
        ALTER TABLE "interpretation_cards"
        ADD CONSTRAINT "interpretation_cards_submissionId_fkey"
        FOREIGN KEY ("submissionId") REFERENCES "submissions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'dependencies_cardId_fkey'
      ) THEN
        ALTER TABLE "dependencies"
        ADD CONSTRAINT "dependencies_cardId_fkey"
        FOREIGN KEY ("cardId") REFERENCES "interpretation_cards"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'adapters_submissionId_fkey'
      ) THEN
        ALTER TABLE "adapters"
        ADD CONSTRAINT "adapters_submissionId_fkey"
        FOREIGN KEY ("submissionId") REFERENCES "submissions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attestations_submissionId_fkey'
      ) THEN
        ALTER TABLE "attestations"
        ADD CONSTRAINT "attestations_submissionId_fkey"
        FOREIGN KEY ("submissionId") REFERENCES "submissions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'submission_chat_sessions_submissionId_fkey'
      ) THEN
        ALTER TABLE "submission_chat_sessions"
        ADD CONSTRAINT "submission_chat_sessions_submissionId_fkey"
        FOREIGN KEY ("submissionId") REFERENCES "submissions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'submission_chat_messages_sessionId_fkey'
      ) THEN
        ALTER TABLE "submission_chat_messages"
        ADD CONSTRAINT "submission_chat_messages_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "submission_chat_sessions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
];

const SQLITE_CHAT_HISTORY_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "submission_chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'DASHBOARD',
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "submission_chat_sessions_submissionId_fkey"
      FOREIGN KEY ("submissionId") REFERENCES "submissions" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "submission_chat_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tone" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_chat_messages_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "submission_chat_sessions" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "submission_chat_sessions_submissionId_surface_updatedAt_idx" ON "submission_chat_sessions"("submissionId", "surface", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "submission_chat_messages_sessionId_sortOrder_idx" ON "submission_chat_messages"("sessionId", "sortOrder")`,
];

const POSTGRES_CHAT_HISTORY_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "submission_chat_sessions" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'DASHBOARD',
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "submission_chat_sessions_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "submission_chat_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tone" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_chat_messages_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "submission_chat_sessions_submissionId_surface_updatedAt_idx" ON "submission_chat_sessions"("submissionId", "surface", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "submission_chat_messages_sessionId_sortOrder_idx" ON "submission_chat_messages"("sessionId", "sortOrder")`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'submission_chat_sessions_submissionId_fkey'
      ) THEN
        ALTER TABLE "submission_chat_sessions"
        ADD CONSTRAINT "submission_chat_sessions_submissionId_fkey"
        FOREIGN KEY ("submissionId") REFERENCES "submissions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'submission_chat_messages_sessionId_fkey'
      ) THEN
        ALTER TABLE "submission_chat_messages"
        ADD CONSTRAINT "submission_chat_messages_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "submission_chat_sessions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
];

function isSqliteDatabaseUrl(databaseUrl: string | undefined | null) {
  return Boolean(databaseUrl?.trim().startsWith("file:"));
}

function isMissingSubmissionSchemaError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("P2021") ||
    error.message.includes("TableDoesNotExist") ||
    error.message.includes("submission_users") ||
    error.message.includes("submissions")
  );
}

async function hasSubmissionSchema() {
  try {
    await prisma.user.count();
    return true;
  } catch (error) {
    if (isMissingSubmissionSchemaError(error)) {
      return false;
    }

    throw error;
  }
}

async function bootstrapSubmissionSchema() {
  const statements = isSqliteDatabaseUrl(process.env.DATABASE_URL)
    ? SQLITE_BOOTSTRAP_STATEMENTS
    : POSTGRES_BOOTSTRAP_STATEMENTS;

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function hasColumn(tableName: string, columnName: string) {
  if (isSqliteDatabaseUrl(process.env.DATABASE_URL)) {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `PRAGMA table_info("${tableName}")`
    );

    return rows.some((row) => row.name === columnName);
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = '${tableName}'
        AND column_name = '${columnName}'
    `
  );

  return rows.length > 0;
}

async function ensureSubmissionColumns() {
  const textColumns = [
    "linkedinProfileUrl",
    "parsedSubmissionSnapshot",
    "publicAgentSlug",
    "publicAgentSnapshot",
  ];

  for (const columnName of textColumns) {
    if (!(await hasColumn("submissions", columnName))) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "submissions" ADD COLUMN "${columnName}" TEXT`
      );
    }
  }

  if (!(await hasColumn("submissions", "publicationStatus"))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "submissions" ADD COLUMN "publicationStatus" TEXT NOT NULL DEFAULT 'PENDING'`
    );
  }

  if (!(await hasColumn("submissions", "reviewedAt"))) {
    const columnType = isSqliteDatabaseUrl(process.env.DATABASE_URL)
      ? "DATETIME"
      : "TIMESTAMP(3)";

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "submissions" ADD COLUMN "reviewedAt" ${columnType}`
    );
  }

  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "submissions_publicAgentSlug_key" ON "submissions"("publicAgentSlug")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "submissions_publicationStatus_updatedAt_idx" ON "submissions"("publicationStatus", "updatedAt")`
  );
}

async function ensureSubmissionChatHistoryTables() {
  const statements = isSqliteDatabaseUrl(process.env.DATABASE_URL)
    ? SQLITE_CHAT_HISTORY_STATEMENTS
    : POSTGRES_CHAT_HISTORY_STATEMENTS;

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

export async function ensureSubmissionSchema() {
  if (
    global.__gptCapitalSubmissionSchemaReady &&
    global.__gptCapitalSubmissionSchemaVersion === SUBMISSION_SCHEMA_VERSION
  ) {
    return;
  }

  if (await hasSubmissionSchema()) {
    await ensureSubmissionColumns();
    await ensureSubmissionChatHistoryTables();
    global.__gptCapitalSubmissionSchemaReady = true;
    global.__gptCapitalSubmissionSchemaVersion = SUBMISSION_SCHEMA_VERSION;
    return;
  }

  if (!global.__gptCapitalSubmissionSchemaPromise) {
    global.__gptCapitalSubmissionSchemaPromise = (async () => {
      await bootstrapSubmissionSchema();
      await ensureSubmissionColumns();
      await ensureSubmissionChatHistoryTables();
      global.__gptCapitalSubmissionSchemaReady = true;
      global.__gptCapitalSubmissionSchemaVersion = SUBMISSION_SCHEMA_VERSION;
    })().finally(() => {
      global.__gptCapitalSubmissionSchemaPromise = undefined;
    });
  }

  await global.__gptCapitalSubmissionSchemaPromise;
}

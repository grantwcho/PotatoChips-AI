-- CreateTable
CREATE TABLE "submission_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "name" TEXT,
    "githubId" TEXT,
    "githubLogin" TEXT,
    "accessToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "submissions" (
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
    "documentationPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "processingStage" TEXT,
    "processingStageMessage" TEXT,
    "processingError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "submission_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "interpretation_cards" (
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
    CONSTRAINT "interpretation_cards_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "dependencies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "dependencies_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "interpretation_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "adapters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'python',
    "rationale" TEXT NOT NULL,
    "originalCode" TEXT NOT NULL,
    "originalRationale" TEXT NOT NULL,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "adapters_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attestations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "attestationText" TEXT NOT NULL,
    "agreedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "attestations_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "submission_users_email_key" ON "submission_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "submission_users_githubId_key" ON "submission_users"("githubId");

-- CreateIndex
CREATE INDEX "submissions_userId_createdAt_idx" ON "submissions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "submissions_status_createdAt_idx" ON "submissions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "submissions_source_createdAt_idx" ON "submissions"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "interpretation_cards_submissionId_key" ON "interpretation_cards"("submissionId");

-- CreateIndex
CREATE INDEX "dependencies_cardId_sortOrder_idx" ON "dependencies"("cardId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "adapters_submissionId_key" ON "adapters"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "attestations_submissionId_key" ON "attestations"("submissionId");

ALTER TABLE "submissions" ADD COLUMN "publicationStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "submissions" ADD COLUMN "publicAgentSlug" TEXT;
ALTER TABLE "submissions" ADD COLUMN "publicAgentSnapshot" TEXT;
ALTER TABLE "submissions" ADD COLUMN "reviewedAt" DATETIME;

CREATE UNIQUE INDEX "submissions_publicAgentSlug_key" ON "submissions"("publicAgentSlug");
CREATE INDEX "submissions_publicationStatus_updatedAt_idx" ON "submissions"("publicationStatus", "updatedAt");

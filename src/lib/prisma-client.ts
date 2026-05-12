export {
  DependencyType,
  ExecutionMode,
  Prisma,
  PrismaClient as PrismaPostgresClient,
  SubmissionProcessingStage,
  SubmissionSource,
  SubmissionStatus,
} from "@/generated/prisma-postgres";
export type {
  Adapter,
  Attestation,
  InterpretationCard,
} from "@/generated/prisma-postgres";
export { PrismaClient as PrismaSqliteClient } from "@/generated/prisma-sqlite";

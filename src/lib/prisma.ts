import "server-only";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaPostgresClient,
  PrismaSqliteClient,
  type Prisma,
} from "@/lib/prisma-client";

type SubmissionPrismaClient = PrismaPostgresClient;

declare global {
  var __gptCapitalPrisma: SubmissionPrismaClient | undefined;
}

function getOrCreatePrismaClient() {
  if (global.__gptCapitalPrisma) {
    return global.__gptCapitalPrisma;
  }

  const client = createPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    global.__gptCapitalPrisma = client;
  }

  return client;
}

export function getPrisma() {
  return getOrCreatePrismaClient();
}

export const prisma = new Proxy({} as SubmissionPrismaClient, {
  get(_target, property) {
    const client = getOrCreatePrismaClient();
    const value = Reflect.get(client as object, property, client);

    return typeof value === "function" ? value.bind(client) : value;
  },
}) as SubmissionPrismaClient;

function createPrismaClient() {
  const log: Prisma.LogLevel[] =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  if (isSqliteDatabaseUrl(process.env.DATABASE_URL)) {
    return new PrismaSqliteClient({
      adapter: createPrismaAdapter(),
      log,
    }) as unknown as SubmissionPrismaClient;
  }

  return new PrismaPostgresClient({
    adapter: createPrismaAdapter(),
    log,
  });
}

function createPrismaAdapter() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL.");
  }

  if (isSqliteDatabaseUrl(databaseUrl)) {
    return new PrismaBetterSqlite3({
      url: databaseUrl.slice("file:".length),
    });
  }

  return new PrismaPg(databaseUrl);
}

function isSqliteDatabaseUrl(databaseUrl: string | undefined | null) {
  return Boolean(databaseUrl?.trim().startsWith("file:"));
}

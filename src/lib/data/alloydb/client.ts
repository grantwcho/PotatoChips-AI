import "server-only";

import { Pool, type PoolConfig } from "pg";

declare global {
  var __gptCapitalAlloyDbPool: Pool | undefined;
}

function getAlloyDbConfig(): PoolConfig {
  const connectionString =
    process.env.ALLOYDB_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error(
      "Missing ALLOYDB_DATABASE_URL or DATABASE_URL. Set a PostgreSQL connection string before using APP_USER_STORE_BACKEND=alloydb."
    );
  }

  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new Error(
      "AlloyDB requires a PostgreSQL connection string. Set ALLOYDB_DATABASE_URL when DATABASE_URL is reserved for Prisma local development."
    );
  }

  return {
    connectionString,
    max: 10,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
  };
}

export function getAlloyDbPool() {
  if (!global.__gptCapitalAlloyDbPool) {
    global.__gptCapitalAlloyDbPool = new Pool(getAlloyDbConfig());
  }

  return global.__gptCapitalAlloyDbPool;
}

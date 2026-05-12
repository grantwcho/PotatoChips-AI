import "server-only";

import { getAlloyDbPool } from "@/lib/data/alloydb/client";

declare global {
  var __correlationZeroIdentitySchemaReady: boolean | undefined;
  var __correlationZeroIdentitySchemaPromise: Promise<void> | undefined;
}

const IDENTITY_SCHEMA_STATEMENTS = [
  `DO $$ BEGIN
      CREATE TYPE app_user_role AS ENUM ('ADMIN', 'INVESTOR', 'OPERATOR');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$`,
  `CREATE TABLE IF NOT EXISTS app_users (
    id uuid PRIMARY KEY,
    identity_subject text NOT NULL UNIQUE,
    email text NOT NULL UNIQUE,
    email_verified boolean NOT NULL DEFAULT false,
    display_name text,
    avatar_url text,
    role app_user_role NOT NULL DEFAULT 'INVESTOR',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS app_users_role_idx ON app_users (role)`,
];

async function bootstrapIdentitySchema() {
  const pool = getAlloyDbPool();

  for (const statement of IDENTITY_SCHEMA_STATEMENTS) {
    await pool.query(statement);
  }
}

export async function ensureIdentitySchema() {
  if (global.__correlationZeroIdentitySchemaReady) {
    return;
  }

  if (!global.__correlationZeroIdentitySchemaPromise) {
    global.__correlationZeroIdentitySchemaPromise = bootstrapIdentitySchema()
      .then(() => {
        global.__correlationZeroIdentitySchemaReady = true;
      })
      .finally(() => {
        global.__correlationZeroIdentitySchemaPromise = undefined;
      });
  }

  await global.__correlationZeroIdentitySchemaPromise;
}

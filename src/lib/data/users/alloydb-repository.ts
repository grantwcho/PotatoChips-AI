import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { UserRepository } from "@/lib/data/users/repository";
import { getAlloyDbPool } from "@/lib/data/alloydb/client";
import {
  type AppUser,
  type AuthIdentityClaims,
  DEFAULT_USER_ROLE,
  type UserRole,
} from "@/lib/auth/types";
import { ensureIdentitySchema } from "@/lib/data/users/alloydb-schema";

type AlloyDbUserRow = QueryResultRow & {
  avatar_url: string | null;
  display_name: string | null;
  email: string;
  email_verified: boolean;
  id: string;
  identity_subject: string;
  role: UserRole;
};

function normalizeUserRole(role: unknown): UserRole | null {
  if (typeof role !== "string") {
    return null;
  }

  switch (role.toUpperCase()) {
    case "ADMIN":
      return "ADMIN";
    case "INVESTOR":
      return "INVESTOR";
    case "OPERATOR":
      return "OPERATOR";
    default:
      return null;
  }
}

function getAuthUid(claims: AuthIdentityClaims): string | null {
  return claims.uid ?? claims.user_id ?? claims.sub ?? null;
}

function buildInsertRole(claims: AuthIdentityClaims) {
  return normalizeUserRole(claims.role) ?? DEFAULT_USER_ROLE;
}

function mapRowToAppUser(row: AlloyDbUserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    image: row.avatar_url,
    role: row.role,
  };
}

export const alloyDbUserRepository: UserRepository = {
  async syncIdentityUser(claims) {
    const identitySubject = getAuthUid(claims);
    const email = claims.email;

    if (!identitySubject || !email) {
      throw new Error("Authenticated identity is missing an email address.");
    }

    await ensureIdentitySchema();

    const pool = getAlloyDbPool();
    const result = await pool.query<AlloyDbUserRow>(
      `
        insert into app_users (
          id,
          identity_subject,
          email,
          email_verified,
          display_name,
          avatar_url,
          role
        )
        values ($1, $2, $3, $4, $5, $6, $7::app_user_role)
        on conflict (identity_subject) do update
        set
          email = excluded.email,
          email_verified = excluded.email_verified,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          updated_at = now()
        returning id, identity_subject, email, email_verified, display_name, avatar_url, role
      `,
      [
        randomUUID(),
        identitySubject,
        email,
        Boolean(claims.email_verified),
        claims.name ?? null,
        claims.picture ?? null,
        buildInsertRole(claims),
      ]
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error("Failed to persist the authenticated user in AlloyDB.");
    }

    return mapRowToAppUser(row);
  },
};

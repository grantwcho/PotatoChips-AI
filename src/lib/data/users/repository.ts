import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import {
  type AppUser,
  type AuthIdentityClaims,
  DEFAULT_USER_ROLE,
  type StoredUserRecord,
  type UserRole,
} from "@/lib/auth/types";
import { alloyDbUserRepository } from "@/lib/data/users/alloydb-repository";
import { firestoreCompatibilityDb } from "@/lib/data/firestore/admin";

const USERS_COLLECTION = "users";

export type UserRepository = {
  syncIdentityUser(claims: AuthIdentityClaims): Promise<AppUser>;
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

function buildAppUser(
  uid: string,
  claims: AuthIdentityClaims,
  storedUser?: StoredUserRecord
): AppUser {
  return {
    id: uid,
    email: storedUser?.email ?? claims.email ?? "",
    name:
      typeof storedUser?.name === "string"
        ? storedUser.name
        : claims.name ?? null,
    image:
      typeof storedUser?.image === "string"
        ? storedUser.image
        : claims.picture ?? null,
    role:
      normalizeUserRole(storedUser?.role) ??
      normalizeUserRole(claims.role) ??
      DEFAULT_USER_ROLE,
  };
}

const firestoreCompatibilityUserRepository: UserRepository = {
  async syncIdentityUser(claims) {
    const uid = getAuthUid(claims);
    const email = claims.email;

    if (!uid || !email) {
      throw new Error("Authenticated identity is missing an email address.");
    }

    const userRef = firestoreCompatibilityDb.collection(USERS_COLLECTION).doc(uid);
    const snapshot = await userRef.get();
    const storedUser = snapshot.data() as StoredUserRecord | undefined;
    const nextUser = buildAppUser(uid, claims, storedUser);
    const emailVerified = Boolean(claims.email_verified);

    const needsWrite =
      !snapshot.exists ||
      storedUser?.email !== nextUser.email ||
      storedUser?.name !== nextUser.name ||
      storedUser?.image !== nextUser.image ||
      storedUser?.emailVerified !== emailVerified ||
      normalizeUserRole(storedUser?.role) !== nextUser.role;

    if (needsWrite) {
      await userRef.set(
        {
          email: nextUser.email,
          emailVerified,
          image: nextUser.image,
          name: nextUser.name,
          role: nextUser.role,
          updatedAt: FieldValue.serverTimestamp(),
          ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true }
      );
    }

    return nextUser;
  },
};

export function getUserRepository(): UserRepository {
  const backend = process.env.APP_USER_STORE_BACKEND ?? "firestore";

  if (backend === "alloydb") {
    return alloyDbUserRepository;
  }

  return firestoreCompatibilityUserRepository;
}

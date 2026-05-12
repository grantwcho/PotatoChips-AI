export type UserRole = "ADMIN" | "INVESTOR" | "OPERATOR";

export const DEFAULT_USER_ROLE: UserRole = "INVESTOR";

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
};

export type AuthIdentityClaims = {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  role?: unknown;
  sub?: string;
  uid?: string;
  user_id?: string;
};

export type StoredUserRecord = {
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  name?: string | null;
  role?: unknown;
};

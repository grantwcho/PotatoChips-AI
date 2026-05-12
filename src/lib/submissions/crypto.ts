import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSubmissionAuthSecret } from "@/lib/submissions/auth-secret";

function getEncryptionKey() {
  const secret = getSubmissionAuthSecret();

  if (!secret) {
    throw new Error("Missing submission auth secret.");
  }

  return createHash("sha256").update(secret).digest();
}

type EncodedPayload = {
  ciphertext: string;
  iv: string;
  tag: string;
};

export function encryptSecretValue(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncodedPayload = {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decryptSecretValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const decoded = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8")
  ) as Partial<EncodedPayload>;

  if (!decoded.ciphertext || !decoded.iv || !decoded.tag) {
    throw new Error("Invalid encrypted secret payload.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(decoded.iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(decoded.tag, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(decoded.ciphertext, "base64url")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

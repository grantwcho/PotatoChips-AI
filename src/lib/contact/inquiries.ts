import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type {
  ContactInquiry,
  ContactInquiryInput,
  ContactInquirySummary,
} from "@/lib/contact/types";

type ContactInquiryRecord = {
  company: string | null;
  createdAt: Date | string;
  email: string;
  id: string;
  ipAddress: string | null;
  message: string;
  name: string;
  phone: string | null;
  reason: string;
  status: string;
  updatedAt: Date | string;
  userAgent: string | null;
};

declare global {
  var __correlationZeroContactInquirySchemaPromise: Promise<void> | undefined;
  var __correlationZeroContactInquirySchemaReady: boolean | undefined;
}

const CONTACT_INQUIRIES_TABLE =
  'CREATE TABLE IF NOT EXISTS "contact_inquiries" (' +
  '"id" TEXT NOT NULL PRIMARY KEY, ' +
  '"name" TEXT NOT NULL, ' +
  '"company" TEXT, ' +
  '"email" TEXT NOT NULL, ' +
  '"phone" TEXT, ' +
  '"reason" TEXT NOT NULL, ' +
  '"message" TEXT NOT NULL, ' +
  '"status" TEXT NOT NULL DEFAULT \'NEW\', ' +
  '"ipAddress" TEXT, ' +
  '"userAgent" TEXT, ' +
  '"createdAt" TIMESTAMP NOT NULL, ' +
  '"updatedAt" TIMESTAMP NOT NULL' +
  ")";

const CONTACT_INQUIRIES_INDEXES = [
  'CREATE INDEX IF NOT EXISTS "contact_inquiries_createdAt_idx" ON "contact_inquiries"("createdAt" DESC)',
  'CREATE INDEX IF NOT EXISTS "contact_inquiries_email_idx" ON "contact_inquiries"("email")',
  'CREATE INDEX IF NOT EXISTS "contact_inquiries_status_createdAt_idx" ON "contact_inquiries"("status", "createdAt" DESC)',
];

function toIsoString(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value);

  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

function normalizePayload(input: ContactInquiryInput) {
  return {
    company: input.company.trim(),
    email: input.email.trim(),
    message: input.message.trim(),
    name: input.name.trim(),
    phone: input.phone.trim(),
    reason: input.reason.trim(),
  };
}

function getMessagePreview(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();

  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117)}...`;
}

function mapContactInquiry(row: ContactInquiryRecord): ContactInquiry {
  return {
    company: row.company ?? "",
    createdAt: toIsoString(row.createdAt),
    email: row.email,
    id: row.id,
    ipAddress: row.ipAddress,
    message: row.message,
    name: row.name,
    phone: row.phone ?? "",
    reason: row.reason,
    status: row.status,
    updatedAt: toIsoString(row.updatedAt),
    userAgent: row.userAgent,
  };
}

function mapContactInquirySummary(row: ContactInquiryRecord): ContactInquirySummary {
  return {
    company: row.company ?? "",
    createdAt: toIsoString(row.createdAt),
    email: row.email,
    id: row.id,
    messagePreview: getMessagePreview(row.message),
    name: row.name,
    phone: row.phone ?? "",
    reason: row.reason,
    status: row.status,
  };
}

export async function ensureContactInquirySchema() {
  if (global.__correlationZeroContactInquirySchemaReady) {
    return;
  }

  if (!global.__correlationZeroContactInquirySchemaPromise) {
    global.__correlationZeroContactInquirySchemaPromise = (async () => {
      await prisma.$executeRawUnsafe(CONTACT_INQUIRIES_TABLE);

      for (const statement of CONTACT_INQUIRIES_INDEXES) {
        await prisma.$executeRawUnsafe(statement);
      }

      global.__correlationZeroContactInquirySchemaReady = true;
    })();
  }

  await global.__correlationZeroContactInquirySchemaPromise;
}

export async function createContactInquiry(
  input: ContactInquiryInput,
  metadata: {
    ipAddress?: string | null;
    userAgent?: string | null;
  } = {}
) {
  await ensureContactInquirySchema();

  const payload = normalizePayload(input);
  const now = new Date();
  const id = randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "contact_inquiries" (
      "id",
      "name",
      "company",
      "email",
      "phone",
      "reason",
      "message",
      "status",
      "ipAddress",
      "userAgent",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${payload.name},
      ${payload.company || null},
      ${payload.email},
      ${payload.phone || null},
      ${payload.reason},
      ${payload.message},
      ${"NEW"},
      ${metadata.ipAddress ?? null},
      ${metadata.userAgent ?? null},
      ${now},
      ${now}
    )
  `;

  return {
    ...payload,
    company: payload.company,
    createdAt: now.toISOString(),
    id,
    ipAddress: metadata.ipAddress ?? null,
    phone: payload.phone,
    status: "NEW",
    updatedAt: now.toISOString(),
    userAgent: metadata.userAgent ?? null,
  } satisfies ContactInquiry;
}

export async function listContactInquiries(limit = 100) {
  await ensureContactInquirySchema();

  const rows = await prisma.$queryRaw<ContactInquiryRecord[]>`
    SELECT
      "id",
      "name",
      "company",
      "email",
      "phone",
      "reason",
      "message",
      "status",
      "ipAddress",
      "userAgent",
      "createdAt",
      "updatedAt"
    FROM "contact_inquiries"
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `;

  return rows.map(mapContactInquirySummary);
}

export async function getContactInquiry(id: string) {
  await ensureContactInquirySchema();

  const rows = await prisma.$queryRaw<ContactInquiryRecord[]>`
    SELECT
      "id",
      "name",
      "company",
      "email",
      "phone",
      "reason",
      "message",
      "status",
      "ipAddress",
      "userAgent",
      "createdAt",
      "updatedAt"
    FROM "contact_inquiries"
    WHERE "id" = ${id}
    LIMIT 1
  `;

  const row = rows[0];

  return row ? mapContactInquiry(row) : null;
}

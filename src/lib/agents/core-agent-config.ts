import "server-only";

export const CORE_DESK_AGENT_IDS = [
  "AGT-CIO",
  "AGT-RESEARCH",
  "AGT-QR-001",
  "AGT-EXEC-001",
] as const;

export type CoreDeskAgentId = (typeof CORE_DESK_AGENT_IDS)[number];

export function isCoreDeskAgentId(value: string): value is CoreDeskAgentId {
  return (CORE_DESK_AGENT_IDS as readonly string[]).includes(value);
}

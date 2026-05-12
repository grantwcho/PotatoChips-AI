import { getAgentApplicationStatus } from "@/lib/hr-agent/repository";

export async function getHrApplicationStatus(applicationId?: string) {
  return getAgentApplicationStatus(applicationId);
}

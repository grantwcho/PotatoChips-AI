import "server-only";

export function isAgentSwarmDecommissioned() {
  const raw = process.env.AGENT_SWARM_DECOMMISSIONED?.trim().toLowerCase();

  if (raw === "false") {
    return false;
  }

  return true;
}

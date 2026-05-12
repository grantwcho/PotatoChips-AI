import type { QuickstartTerminalTab } from "@/components/quickstart-terminal";

const STARTER_AGENT_REVIEW_PROMPT =
  "Read README.md, QUICKSTART.md, docs/platform_contract.md, docs/submission_guide.md, manifest.yaml, agent.py, and the examples/ directory. Don't write any code yet. Tell me: (1) what the single platform response format is, (2) which example is closest to the kind of agent I should build given my background, (3) the exact files I need to edit and in what order, (4) how I run the validator to check my work.";

const CLONE_AGENT_REPO =
  "git clone https://github.com/Potato-Chips-AI/potato-chips-ai-agent-template.git my-agent";
const COPY_MINIMAL_EXAMPLE =
  "cp examples/01-minimal/agent.py examples/01-minimal/manifest.yaml .";
const COPY_MINIMAL_EXAMPLE_WINDOWS =
  "Copy-Item examples/01-minimal/agent.py, examples/01-minimal/manifest.yaml .";

export const QUICKSTART_TERMINAL_TABS: QuickstartTerminalTab[] = [
  {
    label: "Codex",
    commands: [
      CLONE_AGENT_REPO,
      "cd my-agent",
      "./setup.sh",
      COPY_MINIMAL_EXAMPLE,
      "./tools/test_agent.sh",
      `codex "${STARTER_AGENT_REVIEW_PROMPT}"`,
    ],
    windowsCommands: [
      CLONE_AGENT_REPO,
      "cd my-agent",
      ".\\setup.ps1",
      COPY_MINIMAL_EXAMPLE_WINDOWS,
      ".\\tools\\test_agent.ps1",
      `codex "${STARTER_AGENT_REVIEW_PROMPT}"`,
    ],
  },
  {
    label: "Claude Code",
    commands: [
      CLONE_AGENT_REPO,
      "cd my-agent",
      "./setup.sh",
      COPY_MINIMAL_EXAMPLE,
      "./tools/test_agent.sh",
      `claude "${STARTER_AGENT_REVIEW_PROMPT}"`,
    ],
    windowsCommands: [
      CLONE_AGENT_REPO,
      "cd my-agent",
      ".\\setup.ps1",
      COPY_MINIMAL_EXAMPLE_WINDOWS,
      ".\\tools\\test_agent.ps1",
      `claude "${STARTER_AGENT_REVIEW_PROMPT}"`,
    ],
  },
  {
    label: "Cursor",
    commands: [
      CLONE_AGENT_REPO,
      "cd my-agent",
      "./setup.sh",
      COPY_MINIMAL_EXAMPLE,
      "./tools/test_agent.sh",
      `cursor-agent "${STARTER_AGENT_REVIEW_PROMPT}"`,
    ],
    windowsCommands: [
      CLONE_AGENT_REPO,
      "cd my-agent",
      ".\\setup.ps1",
      COPY_MINIMAL_EXAMPLE_WINDOWS,
      ".\\tools\\test_agent.ps1",
      `cursor-agent "${STARTER_AGENT_REVIEW_PROMPT}"`,
    ],
  },
];

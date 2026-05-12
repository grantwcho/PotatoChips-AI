export const SUBMISSION_EXECUTION_LIMITS = {
  timeoutMs: 30_000,
  timeoutLabel: "30 seconds",
  cpuLimit: "1",
  cpuLabel: "1 vCPU",
  memoryLimit: "512m",
  memoryLabel: "512 MB RAM",
  archiveNetworkPolicy: "Outbound networking disabled during archive execution.",
  dockerNetworkPolicy: "Docker submissions run with `--network none`.",
  endpointNetworkPolicy:
    "Remote endpoint submissions may only be probed through controlled outbound requests to the submitted public URL.",
} as const;

export const SUBMISSION_GUARDRAILS = [
  {
    id: "sandbox",
    title: "Sandbox gate",
    description:
      "Submitted code must build and run inside an ephemeral isolated sandbox with no access to Potato Chips AI internal services, private environment variables, or internal network ranges.",
  },
  {
    id: "resources",
    title: "Timeout and resource gate",
    description:
      `Automated smoke tests are currently paused. If execution gating resumes, the query will need to finish within ${SUBMISSION_EXECUTION_LIMITS.timeoutLabel} and stay inside ${SUBMISSION_EXECUTION_LIMITS.cpuLabel} / ${SUBMISSION_EXECUTION_LIMITS.memoryLabel}.`,
  },
  {
    id: "schema",
    title: "Strict schema gate",
    description:
      "Automated schema validation is currently paused. If runtime evaluation resumes, agent responses will need to validate against the submission response schema exactly.",
  },
] as const;

export const SUBMISSION_RESPONSE_SCHEMA_NAME = "AgentResponse";

export const SUBMISSION_RESPONSE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: SUBMISSION_RESPONSE_SCHEMA_NAME,
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "lens",
        "as_of",
        "question",
        "response_type",
        "answer",
        "sources",
      ],
      properties: {
        status: {
          const: "ok",
        },
        lens: {
          type: "string",
        },
        as_of: {
          type: "string",
          description: "ISO-8601 timestamp.",
        },
        question: {
          type: "string",
        },
        response_type: {
          const: "point_estimate",
        },
        answer: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "metric", "value", "unit", "confidence_interval"],
          properties: {
            summary: {
              type: "string",
            },
            metric: { type: "string" },
            value: { type: "number" },
            unit: { type: "string" },
            confidence_interval: {
              type: "object",
              additionalProperties: false,
              required: ["low", "high", "confidence_level"],
              properties: {
                low: { type: "number" },
                high: { type: "number" },
                confidence_level: { type: "number" },
              },
            },
          },
        },
        sources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "url"],
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              published_at: {
                anyOf: [{ type: "null" }, { type: "string" }],
              },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "lens",
        "as_of",
        "question",
        "response_type",
        "answer",
        "sources",
      ],
      properties: {
        status: {
          const: "ok",
        },
        lens: {
          type: "string",
        },
        as_of: {
          type: "string",
          description: "ISO-8601 timestamp.",
        },
        question: {
          type: "string",
        },
        response_type: {
          const: "scenario_table",
        },
        answer: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "scenarios"],
          properties: {
            summary: {
              type: "string",
            },
            scenarios: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["scenario_name", "value", "probability", "drivers"],
                properties: {
                  scenario_name: { type: "string" },
                  value: { type: "number" },
                  probability: { type: "number" },
                  drivers: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        sources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "url"],
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              published_at: {
                anyOf: [{ type: "null" }, { type: "string" }],
              },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "lens",
        "as_of",
        "question",
        "response_type",
        "answer",
        "sources",
      ],
      properties: {
        status: {
          const: "ok",
        },
        lens: {
          type: "string",
        },
        as_of: {
          type: "string",
          description: "ISO-8601 timestamp.",
        },
        question: {
          type: "string",
        },
        response_type: {
          const: "freeform",
        },
        answer: {
          type: "object",
          additionalProperties: false,
          required: ["text"],
          properties: {
            text: {
              type: "string",
            },
          },
        },
        sources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "url"],
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              published_at: {
                anyOf: [{ type: "null" }, { type: "string" }],
              },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "lens", "as_of", "question", "response_type", "answer"],
      properties: {
        status: {
          const: "out_of_scope",
        },
        lens: {
          type: "string",
        },
        as_of: {
          type: "string",
          description: "ISO-8601 timestamp.",
        },
        question: {
          type: "string",
        },
        response_type: {
          const: "rejection",
        },
        answer: {
          type: "object",
          additionalProperties: false,
          required: ["out_of_scope_reason"],
          properties: {
            out_of_scope_reason: {
              type: "string",
            },
          },
        },
      },
    },
  ],
} as const;

export const SUBMISSION_RESPONSE_EXAMPLE = {
  status: "ok",
  lens: "supply_chain",
  as_of: "2026-08-25T19:50:00Z",
  question: "Give a Q2 data center revenue estimate with scenarios.",
  response_type: "scenario_table",
  answer: {
    summary:
      "CoWoS capacity and hyperscaler build commentary still support upside, but channel checks remain mixed.",
    scenarios: [
      {
        scenario_name: "bear",
        value: 34.4,
        probability: 0.2,
        drivers: ["Delayed cluster deployments", "HBM tightness persists"],
      },
      {
        scenario_name: "base",
        value: 36.8,
        probability: 0.55,
        drivers: ["CoWoS output rises", "Enterprise demand stays firm"],
      },
      {
        scenario_name: "bull",
        value: 38.9,
        probability: 0.25,
        drivers: ["Hyperscaler orders pull forward", "Margins hold better than feared"],
      },
    ],
  },
  sources: [
    {
      title: "TSMC monthly revenue release",
      url: "https://example.com/tsmc-monthly-revenue",
      published_at: "2026-08-10T12:00:00Z",
    },
    {
      title: "Hyperscaler capex commentary",
      url: "https://example.com/hyperscaler-capex",
      published_at: "2026-08-18T15:30:00Z",
    },
  ],
} as const;

export const SUBMISSION_RESPONSE_SCHEMA_EXAMPLE_JSON = JSON.stringify(
  SUBMISSION_RESPONSE_EXAMPLE,
  null,
  2
);

export const SUBMISSION_RESPONSE_TYPE_SIGNATURE = String.raw`type AgentResponse = {
type BaseAgentResponse = {
  lens: string;
  as_of: string; // ISO-8601 timestamp
  question: string;
  sources: Array<{
    title: string;
    url: string;
    published_at?: string | null;
  }>;
};

type PointEstimateResponse = BaseAgentResponse & {
  status: "ok";
  response_type: "point_estimate";
  answer: {
    summary: string;
    metric: string;
    value: number;
    unit: string;
    confidence_interval: {
      low: number;
      high: number;
      confidence_level: number;
    };
  };
};

type ScenarioTableResponse = BaseAgentResponse & {
  status: "ok";
  response_type: "scenario_table";
  answer: {
    summary: string;
    scenarios: Array<{
      scenario_name: string;
      value: number;
      probability: number;
      drivers: string[];
    }>;
  };
};

type FreeformResponse = BaseAgentResponse & {
  status: "ok";
  response_type: "freeform";
  answer: {
    text: string;
  };
};

type OutOfScopeResponse = Omit<BaseAgentResponse, "sources"> & {
  status: "out_of_scope";
  response_type: "rejection";
  answer: {
    out_of_scope_reason: string;
  };
};

export type AgentResponse =
  | PointEstimateResponse
  | ScenarioTableResponse
  | FreeformResponse
  | OutOfScopeResponse;`;

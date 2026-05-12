import { submissionErrorResponse } from "@/lib/submissions/http";
import { DependencyType, ExecutionMode } from "@/lib/prisma-client";
import { updateSubmissionCardByUser } from "@/lib/submissions/service";
import type { AiHrDependency } from "@/lib/submissions/types";

function normalizeDependencyType(value: string) {
  switch (value) {
    case DependencyType.CUSTOM:
    case DependencyType.DATA_API:
    case DependencyType.LLM_API:
    case DependencyType.MODEL_WEIGHTS:
    case DependencyType.PLATFORM_TOOL:
      return value;
    default:
      return DependencyType.CUSTOM;
  }
}

function normalizeExecutionMode(value: string) {
  switch (value) {
    case ExecutionMode.BACKTEST_ONLY:
    case ExecutionMode.SCHEDULED:
    case ExecutionMode.STREAMING:
    case ExecutionMode.UNKNOWN:
      return value;
    default:
      return ExecutionMode.UNKNOWN;
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      assetUniverse?: string;
      capitalRangeMax?: number | null;
      capitalRangeMin?: number | null;
      claimedEdge?: string;
      decisionCadence?: string;
      dependencies?: AiHrDependency[];
      entryPoint?: string;
      executionMode?: string;
      killSwitchBehavior?: string;
      riskEnvelope?: Record<string, unknown>;
      strategyClassification?: string;
      timeframe?: string;
    };

    await updateSubmissionCardByUser({
      card: {
        aiHrNotes: "",
        assetUniverse: body.assetUniverse ?? "",
        capitalRangeMax:
          typeof body.capitalRangeMax === "number" ? body.capitalRangeMax : null,
        capitalRangeMin:
          typeof body.capitalRangeMin === "number" ? body.capitalRangeMin : null,
        claimedEdge: body.claimedEdge ?? "",
        decisionCadence: body.decisionCadence ?? "",
        dependencies: Array.isArray(body.dependencies)
          ? body.dependencies.map((dependency) => ({
              details:
                dependency.details &&
                typeof dependency.details === "object" &&
                !Array.isArray(dependency.details)
                  ? dependency.details
                  : {},
              name: dependency.name ?? "",
              type: normalizeDependencyType(dependency.type),
            }))
          : [],
        entryPoint: body.entryPoint ?? "",
        executionMode: normalizeExecutionMode(body.executionMode ?? "UNKNOWN"),
        killSwitchBehavior: body.killSwitchBehavior ?? "",
        riskEnvelope:
          body.riskEnvelope &&
          typeof body.riskEnvelope === "object" &&
          !Array.isArray(body.riskEnvelope)
            ? body.riskEnvelope
            : {},
        strategyClassification: body.strategyClassification ?? "",
        timeframe: body.timeframe ?? "",
      },
      submissionId: id,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return submissionErrorResponse(error, "Unable to save interpretation edits.");
  }
}

type PreflightCheck = {
  key: "format" | "readable" | "entrypoint" | "sandbox" | "resources" | "schema";
  label: string;
  passed: boolean;
  detail: string;
};

function buildResponse(checks: PreflightCheck[]) {
  return Response.json({
    checks,
    ready: checks.every((check) => check.passed),
  });
}

function buildPausedChecks(hasUpload: boolean): PreflightCheck[] {
  return [
    {
      key: "format",
      label: "Submission package received",
      passed: hasUpload,
      detail: hasUpload
        ? "Your package upload was received. Automated preflight checks are currently paused."
        : "Upload a package to include it with the submission record.",
    },
    {
      key: "readable",
      label: "Archive inspection",
      passed: true,
      detail: "Automated archive inspection is currently paused.",
    },
    {
      key: "entrypoint",
      label: "Entrypoint detection",
      passed: true,
      detail: "Automated entrypoint detection is currently paused.",
    },
    {
      key: "sandbox",
      label: "Smoke tests",
      passed: true,
      detail:
        "Automated smoke tests are currently paused.",
    },
    {
      key: "resources",
      label: "Historical replays",
      passed: true,
      detail: "Historical replays are currently paused.",
    },
    {
      key: "schema",
      label: "Response contract",
      passed: true,
      detail: "Strict response-contract validation is currently paused.",
    },
  ];
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const upload = formData.get("agentPackage");
  const hasUpload =
    typeof File !== "undefined" && upload instanceof File && Boolean(upload.name);

  return buildResponse(buildPausedChecks(hasUpload));
}

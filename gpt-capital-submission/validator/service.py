from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Callable

from .client import SubmissionClient
from .config import ValidationConfig
from .gates.activity_rate import evaluate_activity_rate
from .gates.introspection_coverage import evaluate_introspection_coverage
from .gates.liveness import evaluate_liveness
from .gates.responsiveness import evaluate_responsiveness
from .gates.schema_conformance import evaluate_schema_conformance
from .packaging.client import AnthropicJsonClient
from .packaging.evaluator import PackagingEvaluator
from .replay.loader import load_replay
from .replay.runner import run_replay
from .runtime import SubmissionRuntime
from .scorecard import (
    DifferentiationResult,
    FaithfulnessResult,
    InformativenessResult,
    PackagingScorecard,
    SchemaConformanceResult,
    StabilityResult,
    SubmissionScorecard,
    Verdict,
    ViabilityScorecard,
)


def validate_runtime(
    runtime: SubmissionRuntime,
    *,
    config: ValidationConfig | None = None,
    cheap: bool = False,
    persona_prompt: str | None = None,
    packaging_evaluator: PackagingEvaluator | None = None,
    progress: Callable[[str], None] | None = None,
) -> SubmissionScorecard:
    active_config = config or ValidationConfig()
    replay_events = load_replay(active_config.replay_path)
    _emit(progress, "starting runtime")
    boot_s = runtime.start()
    client = SubmissionClient(runtime)
    try:
        _emit(progress, "running schema conformance")
        schema = evaluate_schema_conformance(client, replay_events)
        if not schema.pass_:
            viability = _viability_with_defaults(
                schema=schema,
                boot_s=boot_s,
            )
            packaging = _skipped_packaging(reason="skipped due to schema failure")
            return SubmissionScorecard(
                submission_id=runtime.submission_id,
                verdict=Verdict.REJECT,
                viability=viability,
                packaging=packaging,
                sample_commentary=[],
            )

        _emit(progress, "running replay and liveness")
        trace = run_replay(
            client,
            runtime,
            replay_events,
            stability_checkpoint_ids=active_config.stability_checkpoint_ids,
        )
        liveness = evaluate_liveness(
            boot_s=boot_s,
            endpoint_latencies_ms=trace.endpoint_latencies_ms,
            runtime_stats=runtime.get_stats(),
            boot_limit_s=active_config.boot_timeout_s,
            p99_limit_ms=active_config.p99_latency_limit_ms,
        )
        activity_rate = evaluate_activity_rate(
            trace,
            flag_threshold=active_config.activity_flag_threshold,
        )
        introspection_coverage = evaluate_introspection_coverage(
            [step.positioning for step in trace.steps]
        )
        responsiveness = evaluate_responsiveness(trace)
        viability = ViabilityScorecard(
            schema_conformance=schema,
            liveness=liveness,
            activity_rate=activity_rate,
            introspection_coverage=introspection_coverage,
            responsiveness=responsiveness,
        )
        if not liveness.pass_ or not responsiveness.pass_:
            packaging = _skipped_packaging(
                reason="skipped due to viability hard failure"
            )
            return SubmissionScorecard(
                submission_id=runtime.submission_id,
                verdict=Verdict.REJECT,
                viability=viability,
                packaging=packaging,
                sample_commentary=[],
            )

        _emit(progress, "running packaging evaluation")
        evaluator = packaging_evaluator or PackagingEvaluator(
            llm_client=AnthropicJsonClient(
                model=active_config.anthropic_model,
                cache_dir=active_config.llm_cache_dir,
            ),
            persona_prompt=persona_prompt or packaging_evaluator_default_persona(),
            checkpoint_count=active_config.packaging_checkpoint_count,
        )
        packaging, sample_commentary = evaluator.evaluate(
            client=client,
            trace=trace,
            cheap=cheap,
        )
        verdict = _determine_verdict(
            viability=viability,
            packaging=packaging,
            cheap=cheap,
            config=active_config,
        )
        return SubmissionScorecard(
            submission_id=runtime.submission_id,
            verdict=verdict,
            viability=viability,
            packaging=packaging,
            sample_commentary=sample_commentary,
        )
    finally:
        runtime.stop()


def with_cache_dir(config: ValidationConfig, cache_dir: str | None) -> ValidationConfig:
    if cache_dir is None:
        return config
    return replace(config, llm_cache_dir=Path(cache_dir))


def packaging_evaluator_default_persona() -> str:
    return (
        "You are a generic portfolio analyst summarizing "
        "a trading agent for Potato Chips AI."
    )


def _viability_with_defaults(
    *,
    schema: SchemaConformanceResult,
    boot_s: float,
) -> ViabilityScorecard:
    return ViabilityScorecard.model_validate(
        {
            "schema_conformance": schema.model_dump(by_alias=True),
            "liveness": {
                "pass": False,
                "boot_s": round(boot_s, 4),
                "p99_ms": 0.0,
                "details": "skipped due to schema failure",
            },
            "activity_rate": {"score": 0.0, "flag": False},
            "introspection_coverage": {"score": 0.0, "per_field": {}},
            "responsiveness": {
                "pass": False,
                "details": "skipped due to schema failure",
            },
        }
    )


def _skipped_packaging(*, reason: str) -> PackagingScorecard:
    return PackagingScorecard(
        faithfulness=FaithfulnessResult.model_validate(
            {"pass": True, "ungrounded_claims": []}
        ),
        differentiation=DifferentiationResult(score=0.0),
        informativeness=InformativenessResult(
            score=0.0,
            template_fills={
                "position": reason,
                "conviction": reason,
                "thesis": reason,
                "key_risks": reason,
                "disconfirming_evidence": reason,
            },
        ),
        stability=StabilityResult.model_validate({"pass": True, "details": reason}),
    )


def _determine_verdict(
    *,
    viability: ViabilityScorecard,
    packaging: PackagingScorecard,
    cheap: bool,
    config: ValidationConfig,
) -> Verdict:
    if not viability.schema_conformance.pass_:
        return Verdict.REJECT
    if not viability.liveness.pass_:
        return Verdict.REJECT
    if not viability.responsiveness.pass_:
        return Verdict.REJECT
    if not packaging.stability.pass_:
        return Verdict.REJECT
    if not cheap and not packaging.faithfulness.pass_:
        return Verdict.REJECT
    if cheap:
        return Verdict.REVIEW
    if (
        viability.activity_rate.score < config.accept_activity_rate
        or viability.introspection_coverage.score < config.accept_introspection_coverage
        or packaging.differentiation.score < config.accept_differentiation
        or packaging.informativeness.score < config.accept_informativeness
    ):
        return Verdict.REVIEW
    return Verdict.ACCEPT


def _emit(progress: Callable[[str], None] | None, message: str) -> None:
    if progress is not None:
        progress(message)

from __future__ import annotations

from fastapi import FastAPI

from sdk.python.examples.example_flickering.app import FlickeringStrategy
from sdk.python.examples.example_hallucinogenic.app import HallucinogenicStrategy
from sdk.python.examples.example_momentum.app import MomentumStrategy
from sdk.python.examples.example_silent.app import SilentStrategy
from sdk.python.examples.example_static_introspection.app import (
    StaticIntrospectionStrategy,
)
from sdk.python.gptcap import build_app
from validator.packaging.evaluator import PackagingEvaluator
from validator.runtime import InProcessRuntime
from validator.scorecard import SubmissionScorecard, Verdict
from validator.service import validate_runtime

from .fakes import DeterministicPackagingLLM


def _validate(
    app: FastAPI, submission_id: str, *, cheap: bool = False
) -> SubmissionScorecard:
    runtime = InProcessRuntime(app, submission_id)
    evaluator = PackagingEvaluator(llm_client=DeterministicPackagingLLM())
    return validate_runtime(
        runtime,
        cheap=cheap,
        packaging_evaluator=evaluator,
    )


def test_example_momentum_is_accepted() -> None:
    scorecard = _validate(build_app(MomentumStrategy()), "example_momentum")
    assert scorecard.verdict == Verdict.ACCEPT
    assert scorecard.viability.schema_conformance.pass_
    assert scorecard.viability.liveness.pass_
    assert scorecard.viability.responsiveness.pass_
    assert scorecard.packaging.stability.pass_
    assert scorecard.packaging.faithfulness.pass_


def test_example_silent_is_reviewed_for_low_activity() -> None:
    scorecard = _validate(build_app(SilentStrategy()), "example_silent")
    assert scorecard.verdict == Verdict.REVIEW
    assert scorecard.viability.activity_rate.flag is True
    assert scorecard.viability.activity_rate.score == 0.0


def test_example_static_introspection_is_rejected_for_responsiveness() -> None:
    scorecard = _validate(
        build_app(StaticIntrospectionStrategy()),
        "example_static_introspection",
    )
    assert scorecard.verdict == Verdict.REJECT
    assert scorecard.viability.responsiveness.pass_ is False


def test_example_flickering_is_rejected_for_stability() -> None:
    scorecard = _validate(build_app(FlickeringStrategy()), "example_flickering")
    assert scorecard.verdict == Verdict.REJECT
    assert scorecard.packaging.stability.pass_ is False


def test_example_hallucinogenic_is_rejected_for_faithfulness() -> None:
    scorecard = _validate(
        build_app(HallucinogenicStrategy()),
        "example_hallucinogenic",
    )
    assert scorecard.verdict == Verdict.REJECT
    assert scorecard.packaging.faithfulness.pass_ is False
    assert len(scorecard.packaging.faithfulness.ungrounded_claims) > 0


def test_cheap_mode_skips_packaging_and_returns_review() -> None:
    scorecard = _validate(build_app(MomentumStrategy()), "example_momentum", cheap=True)
    assert scorecard.verdict == Verdict.REVIEW
    assert scorecard.packaging.stability.pass_ is True
    assert scorecard.sample_commentary == []

from __future__ import annotations

import json
from typing import Any, TypeVar

from pydantic import BaseModel

ModelT = TypeVar("ModelT", bound=BaseModel)


class DeterministicPackagingLLM:
    def complete_json(
        self,
        *,
        task_name: str,
        system_prompt: str,
        user_payload: dict[str, Any],
        response_model: type[ModelT],
        max_tokens: int,
    ) -> ModelT:
        del system_prompt
        del max_tokens
        if task_name == "day_in_life":
            checkpoints = {
                item["checkpoint_id"]: item
                for item in user_payload["available_checkpoints"]
            }
            commentary = []
            for slot in user_payload["required_slots"]:
                checkpoint = checkpoints[slot["checkpoint_id"]]
                positioning = checkpoint["positioning"]
                factor_name = positioning["active_factors"][0]["name"]
                if slot.get("signal_id") is not None:
                    text = (
                        f"Checkpoint {slot['checkpoint_id']} attributes signal "
                        f"{slot['signal_id']} to {factor_name}. "
                        f"{positioning['regime_view']}"
                    )
                else:
                    text = (
                        f"Checkpoint {slot['checkpoint_id']} emphasizes {factor_name}. "
                        f"{positioning['regime_view']}"
                    )
                commentary.append(
                    {
                        "checkpoint_id": slot["checkpoint_id"],
                        "kind": slot["kind"],
                        "text": text,
                        "signal_id": slot.get("signal_id"),
                    }
                )
            return response_model.model_validate({"commentary": commentary})

        if task_name == "faithfulness_judge":
            checkpoints = {
                item["checkpoint_id"]: item
                for item in user_payload["available_checkpoints"]
            }
            explanations = user_payload["decision_explanations"]
            judgments = []
            for sentence in user_payload["sentences"]:
                checkpoint = checkpoints[sentence["checkpoint_id"]]
                factor_names = [
                    factor["name"].lower()
                    for factor in checkpoint["positioning"]["active_factors"]
                ]
                sentence_text = sentence["sentence"].lower()
                mentioned_factors = [
                    factor_name
                    for factor_name in factor_names
                    if factor_name in sentence_text
                ]
                verdict = "grounded"
                field = "regime_view"
                rationale = "Sentence matches checkpoint state."
                if sentence["signal_id"] is not None:
                    explanation_blob = json.dumps(
                        explanations.get(sentence["signal_id"], {})
                    ).lower()
                    if any(
                        factor_name not in explanation_blob
                        for factor_name in mentioned_factors
                    ):
                        verdict = "ungrounded"
                        field = "references"
                        rationale = (
                            "Decision explanation does not support the cited factor."
                        )
                judgments.append(
                    {
                        "checkpoint_id": sentence["checkpoint_id"],
                        "sentence": sentence["sentence"],
                        "verdict": verdict,
                        "field": field,
                        "rationale": rationale,
                    }
                )
            return response_model.model_validate({"judgments": judgments})

        if task_name == "informativeness":
            commentary_text = str(user_payload["commentary"]).lower()
            if "unknown" in commentary_text:
                payload = {
                    "position": "unknown",
                    "conviction": "unknown",
                    "thesis": "unknown",
                    "key_risks": "unknown",
                    "disconfirming_evidence": "unknown",
                }
            else:
                payload = {
                    "position": "risk-on with tactical trims during shocks",
                    "conviction": "moderate to high depending on regime",
                    "thesis": (
                        "price momentum drives positioning "
                        "when liquidity is intact"
                    ),
                    "key_risks": "liquidity stress and abrupt reversals",
                    "disconfirming_evidence": "trend failures and spread widening",
                }
            return response_model.model_validate(payload)

        raise AssertionError(f"Unexpected task_name: {task_name}")

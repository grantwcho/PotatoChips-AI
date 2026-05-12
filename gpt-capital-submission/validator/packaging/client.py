from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Protocol, TypeVar, cast

import httpx
from pydantic import BaseModel

ModelT = TypeVar("ModelT", bound=BaseModel)


class JsonLLMClient(Protocol):
    def complete_json(
        self,
        *,
        task_name: str,
        system_prompt: str,
        user_payload: dict[str, Any],
        response_model: type[ModelT],
        max_tokens: int,
    ) -> ModelT:
        """Return a validated JSON response."""


class AnthropicJsonClient:
    def __init__(
        self,
        *,
        model: str,
        cache_dir: Path,
        api_key: str | None = None,
        timeout_s: float = 60.0,
    ) -> None:
        self.model = model
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self.timeout_s = timeout_s

    def complete_json(
        self,
        *,
        task_name: str,
        system_prompt: str,
        user_payload: dict[str, Any],
        response_model: type[ModelT],
        max_tokens: int,
    ) -> ModelT:
        request_payload = {
            "task_name": task_name,
            "model": self.model,
            "system_prompt": system_prompt,
            "user_payload": user_payload,
            "response_schema": response_model.model_json_schema(),
            "max_tokens": max_tokens,
        }
        cache_path = self.cache_dir / f"{_hash_request(request_payload)}.json"
        if cache_path.exists():
            with cache_path.open("r", encoding="utf-8") as handle:
                cached = json.load(handle)
            return response_model.model_validate(cached["response"])

        if not self.api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set and no cached packaging "
                "response was found."
            )

        prompt = _build_json_prompt(
            user_payload=user_payload,
            response_schema=response_model.model_json_schema(),
        )
        response = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": self.model,
                "max_tokens": max_tokens,
                "temperature": 0,
                "system": system_prompt,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=self.timeout_s,
        )
        response.raise_for_status()
        response_payload = response.json()
        text_blocks = [
            block.get("text", "")
            for block in response_payload.get("content", [])
            if block.get("type") == "text"
        ]
        parsed_json = _extract_json_payload("\n".join(text_blocks))
        validated = response_model.model_validate(parsed_json)
        with cache_path.open("w", encoding="utf-8") as handle:
            json.dump(
                {
                    "request": request_payload,
                    "response": validated.model_dump(mode="json"),
                },
                handle,
                indent=2,
                sort_keys=True,
            )
        return validated


def _build_json_prompt(
    *,
    user_payload: dict[str, Any],
    response_schema: dict[str, Any],
) -> str:
    return (
        "Return JSON only. Do not use markdown fences. "
        "Do not add prose before or after the JSON.\n\n"
        f"Target schema:\n{json.dumps(response_schema, indent=2, sort_keys=True)}\n\n"
        f"Input data:\n{json.dumps(user_payload, indent=2, sort_keys=True)}"
    )


def _hash_request(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _extract_json_payload(text: str) -> dict[str, Any]:
    stripped = text.strip()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise RuntimeError(f"Model did not return JSON: {text}") from exc
        parsed = json.loads(stripped[start : end + 1])
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Model did not return a JSON object: {text}")
    return cast(dict[str, Any], parsed)

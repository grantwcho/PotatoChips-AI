from __future__ import annotations

import argparse
from pathlib import Path

from rich.console import Console

from .config import ValidationConfig
from .runtime import DockerRuntime
from .scorecard import render_scorecard
from .service import validate_runtime, with_cache_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate a Potato Chips AI submission image."
    )
    parser.add_argument("image", help="Docker image reference to validate.")
    parser.add_argument(
        "--cheap",
        action="store_true",
        help="Skip LLM-based packaging evaluation for fast iteration.",
    )
    parser.add_argument(
        "--persona-prompt",
        default=None,
        help="Override the default packaging persona prompt.",
    )
    parser.add_argument(
        "--cache-dir",
        default=None,
        help="Directory for cached Anthropic responses.",
    )
    parser.add_argument(
        "--json-out",
        default=None,
        help="Optional path to write the scorecard JSON.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    console = Console()
    config = with_cache_dir(ValidationConfig(), args.cache_dir)
    runtime = DockerRuntime(args.image)
    scorecard = validate_runtime(
        runtime,
        config=config,
        cheap=args.cheap,
        persona_prompt=args.persona_prompt,
        progress=lambda message: console.print(f"[cyan]{message}[/cyan]"),
    )
    render_scorecard(scorecard, console=console)
    if args.json_out:
        output_path = Path(args.json_out)
        output_path.write_text(scorecard.to_json() + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

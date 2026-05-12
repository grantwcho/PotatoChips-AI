from __future__ import annotations

import json
import shutil
import socket
import subprocess
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient


@dataclass(frozen=True)
class RuntimeResponse:
    status_code: int
    payload: Any
    latency_ms: float


@dataclass
class RuntimeStats:
    memory_samples_mb: list[float] = field(default_factory=list)
    crashed: bool = False
    oom_killed: bool = False

    @property
    def max_memory_mb(self) -> float:
        if not self.memory_samples_mb:
            return 0.0
        return max(self.memory_samples_mb)


class SubmissionRuntime(ABC):
    submission_id: str

    @abstractmethod
    def start(self) -> float:
        """Start the runtime and return boot time in seconds."""

    @abstractmethod
    def request(
        self,
        *,
        method: str,
        path: str,
        json_body: dict[str, Any] | None = None,
    ) -> RuntimeResponse:
        """Issue one HTTP request against the submission."""

    @abstractmethod
    def sample_stats(self) -> None:
        """Record runtime stats after a validation step."""

    @abstractmethod
    def get_stats(self) -> RuntimeStats:
        """Return collected runtime stats."""

    @abstractmethod
    def stop(self) -> None:
        """Stop the runtime."""


class InProcessRuntime(SubmissionRuntime):
    def __init__(self, app: FastAPI, submission_id: str) -> None:
        self.app = app
        self.submission_id = submission_id
        self._client: TestClient | None = None
        self._stats = RuntimeStats()

    def start(self) -> float:
        started_at = time.perf_counter()
        self._client = TestClient(self.app)
        response = self._client.get("/healthz")
        if response.status_code >= 400:
            raise RuntimeError(f"Health check failed with HTTP {response.status_code}.")
        return time.perf_counter() - started_at

    def request(
        self,
        *,
        method: str,
        path: str,
        json_body: dict[str, Any] | None = None,
    ) -> RuntimeResponse:
        if self._client is None:
            raise RuntimeError("Runtime has not been started.")
        started_at = time.perf_counter()
        response = self._client.request(method=method, url=path, json=json_body)
        latency_ms = (time.perf_counter() - started_at) * 1000.0
        payload = response.json() if response.content else {}
        return RuntimeResponse(
            status_code=response.status_code,
            payload=payload,
            latency_ms=latency_ms,
        )

    def sample_stats(self) -> None:
        return None

    def get_stats(self) -> RuntimeStats:
        return self._stats

    def stop(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None


class DockerRuntime(SubmissionRuntime):
    def __init__(self, image: str, container_port: int = 8080) -> None:
        self.image = image
        self.container_port = container_port
        self.submission_id = image
        self._host_port = self._reserve_port()
        self._client = httpx.Client(base_url=f"http://127.0.0.1:{self._host_port}")
        self._container_id: str | None = None
        self._stats = RuntimeStats()

    def start(self) -> float:
        if shutil.which("docker") is None:
            raise RuntimeError("Docker is not installed or not available on PATH.")
        started_at = time.perf_counter()
        command = [
            "docker",
            "run",
            "--rm",
            "-d",
            "-e",
            f"PORT={self.container_port}",
            "-p",
            f"127.0.0.1:{self._host_port}:{self.container_port}",
            self.image,
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or completed.stdout.strip())
        self._container_id = completed.stdout.strip()
        self._wait_for_healthz(timeout_s=60.0)
        return time.perf_counter() - started_at

    def request(
        self,
        *,
        method: str,
        path: str,
        json_body: dict[str, Any] | None = None,
    ) -> RuntimeResponse:
        started_at = time.perf_counter()
        response = self._client.request(method=method, url=path, json=json_body)
        latency_ms = (time.perf_counter() - started_at) * 1000.0
        payload = response.json() if response.content else {}
        return RuntimeResponse(
            status_code=response.status_code,
            payload=payload,
            latency_ms=latency_ms,
        )

    def sample_stats(self) -> None:
        if self._container_id is None:
            return
        command = [
            "docker",
            "stats",
            "--no-stream",
            "--format",
            "{{json .}}",
            self._container_id,
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
        )
        if completed.returncode != 0 or not completed.stdout.strip():
            return
        try:
            payload = json.loads(completed.stdout.strip())
            usage = str(payload.get("MemUsage", "0MiB / 0MiB")).split("/")[0].strip()
            self._stats.memory_samples_mb.append(_parse_memory_to_mb(usage))
        except (ValueError, KeyError, json.JSONDecodeError):
            return

    def get_stats(self) -> RuntimeStats:
        if self._container_id is None:
            return self._stats
        command = [
            "docker",
            "inspect",
            self._container_id,
            "--format",
            "{{json .State}}",
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
        )
        if completed.returncode == 0 and completed.stdout.strip():
            state = json.loads(completed.stdout.strip())
            self._stats.crashed = (
                not bool(state.get("Running", False))
                and int(state.get("ExitCode", 0)) != 0
            )
            self._stats.oom_killed = bool(state.get("OOMKilled", False))
        return self._stats

    def stop(self) -> None:
        if self._container_id is not None:
            subprocess.run(
                ["docker", "rm", "-f", self._container_id],
                capture_output=True,
                check=False,
                text=True,
            )
            self._container_id = None
        self._client.close()

    def _wait_for_healthz(self, timeout_s: float) -> None:
        deadline = time.time() + timeout_s
        last_error: Exception | None = None
        while time.time() < deadline:
            try:
                response = self._client.get("/healthz", timeout=1.0)
                if response.status_code == 200:
                    return
            except httpx.HTTPError as exc:
                last_error = exc
            time.sleep(0.25)
        raise RuntimeError(f"Timed out waiting for /healthz: {last_error!r}")

    @staticmethod
    def _reserve_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            return int(sock.getsockname()[1])


def _parse_memory_to_mb(value: str) -> float:
    units = {
        "b": 1 / (1024 * 1024),
        "kib": 1 / 1024,
        "kb": 1 / 1000,
        "mib": 1.0,
        "mb": 1.0,
        "gib": 1024.0,
        "gb": 1000.0,
    }
    lower = value.strip().lower()
    for suffix, multiplier in units.items():
        if lower.endswith(suffix):
            number = float(lower[: -len(suffix)].strip())
            return number * multiplier
    return float(lower)

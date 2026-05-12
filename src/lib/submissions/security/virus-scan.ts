import "server-only";

import net from "node:net";
import { SubmissionHttpError } from "@/lib/submissions/service";

const DEFAULT_CLAMAV_PORT = 3310;
const DEFAULT_TIMEOUT_MS = 20_000;
const STREAM_CHUNK_SIZE = 64 * 1024;

type ClamAvConfig = {
  enabled: boolean;
  host: string | null;
  port: number;
  required: boolean;
  timeoutMs: number;
};

type ScanResult =
  | { status: "clean" }
  | { signature: string; status: "infected" };

function readBoolean(value: string | undefined, fallback = false) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readNumber(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getClamAvConfig(): ClamAvConfig {
  const host = process.env.SUBMISSIONS_CLAMAV_HOST?.trim() || null;
  const enabled = readBoolean(process.env.SUBMISSIONS_VIRUS_SCAN_ENABLED, Boolean(host));

  return {
    enabled,
    host,
    port: readNumber(process.env.SUBMISSIONS_CLAMAV_PORT, DEFAULT_CLAMAV_PORT),
    required: readBoolean(process.env.SUBMISSIONS_VIRUS_SCAN_REQUIRED, enabled),
    timeoutMs: readNumber(process.env.SUBMISSIONS_CLAMAV_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

function parseClamAvResponse(response: string): ScanResult {
  const normalized = response.replace(/\0/g, "").trim();

  if (!normalized) {
    throw new Error("ClamAV returned an empty response.");
  }

  if (normalized.endsWith(" OK")) {
    return { status: "clean" };
  }

  const foundMarker = " FOUND";

  if (normalized.endsWith(foundMarker)) {
    const [, signaturePart = "malware"] = normalized.split(":");
    return {
      signature: signaturePart.replace(foundMarker, "").trim() || "malware",
      status: "infected",
    };
  }

  throw new Error(normalized);
}

async function scanBufferWithClamAv(input: {
  bytes: Buffer;
  config: ClamAvConfig;
}): Promise<ScanResult> {
  const { bytes, config } = input;

  return new Promise<ScanResult>((resolve, reject) => {
    const socket = net.createConnection({
      host: config.host ?? "127.0.0.1",
      port: config.port,
    });
    const responseChunks: Buffer[] = [];

    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      callback();
    };

    socket.setTimeout(config.timeoutMs);

    socket.on("timeout", () => {
      finish(() => {
        socket.destroy();
        reject(new Error("ClamAV scan timed out."));
      });
    });

    socket.on("error", (error) => {
      finish(() => {
        socket.destroy();
        reject(error);
      });
    });

    socket.on("data", (chunk) => {
      responseChunks.push(chunk);
    });

    socket.on("end", () => {
      finish(() => {
        try {
          resolve(parseClamAvResponse(Buffer.concat(responseChunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });

    socket.on("connect", () => {
      socket.write("zINSTREAM\0");

      for (let offset = 0; offset < bytes.length; offset += STREAM_CHUNK_SIZE) {
        const chunk = bytes.subarray(offset, offset + STREAM_CHUNK_SIZE);
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32BE(chunk.length, 0);
        socket.write(lengthBuffer);
        socket.write(chunk);
      }

      socket.write(Buffer.alloc(4));
      socket.end();
    });
  });
}

export async function scanUploadBufferForMalware(input: {
  bytes: Buffer;
  fileName: string;
}) {
  const config = getClamAvConfig();

  if (!config.enabled) {
    return;
  }

  if (!config.host) {
    if (config.required) {
      throw new SubmissionHttpError(
        "Upload security scanning is not configured. Please try again later.",
        503
      );
    }

    return;
  }

  try {
    const result = await scanBufferWithClamAv({
      bytes: input.bytes,
      config,
    });

    if (result.status === "infected") {
      throw new SubmissionHttpError(
        `Upload blocked by security scan (${input.fileName}: ${result.signature}).`,
        422
      );
    }
  } catch (error) {
    if (error instanceof SubmissionHttpError) {
      throw error;
    }

    if (config.required) {
      throw new SubmissionHttpError(
        "Upload security scan is unavailable right now. Please try again shortly.",
        503
      );
    }

    console.error("ClamAV scan skipped after scanner failure.", error);
  }
}

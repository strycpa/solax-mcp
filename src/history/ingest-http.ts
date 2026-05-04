import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppConfig } from "../config.js";
import { loadBigQueryHistoryConfig } from "./bigquery-config.js";
import { ingestPvSample } from "./ingest-pv-sample.js";

export async function handleBigQueryIngestRequest(
  config: AppConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!isAuthorizedIngestRequest(config, req)) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    const result = await ingestPvSample(
      {
        ...config,
        PV_DATA_SOURCE: "cloud",
      },
      loadBigQueryHistoryConfig(),
    );

    writeJson(res, 200, result);
  } catch (error: unknown) {
    console.error("Error handling BigQuery ingest request:", formatError(error));
    writeJson(res, 500, { error: "BigQuery ingest failed." });
  }
}

function isAuthorizedIngestRequest(
  config: AppConfig,
  req: IncomingMessage,
): boolean {
  const expectedToken = config.INGEST_AUTH_TOKEN;

  if (expectedToken === undefined) {
    return false;
  }

  const authorizationHeader = getHeader(req, "authorization");
  const bearerPrefix = "Bearer ";

  if (
    authorizationHeader === undefined ||
    !authorizationHeader.startsWith(bearerPrefix)
  ) {
    return false;
  }

  const actualToken = authorizationHeader.slice(bearerPrefix.length);
  const expectedTokenBuffer = Buffer.from(expectedToken);
  const actualTokenBuffer = Buffer.from(actualToken);

  return (
    expectedTokenBuffer.length === actualTokenBuffer.length &&
    timingSafeEqual(expectedTokenBuffer, actualTokenBuffer)
  );
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  data: object,
): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function formatError(error: unknown): object {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return { error };
}

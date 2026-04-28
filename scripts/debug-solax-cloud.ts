import "dotenv/config";

import { loadConfig } from "../src/config.js";
import { SolaxCloudClient } from "../src/cloud/solax-cloud-client.js";
import { SolaxService } from "../src/solax-service.js";

interface RawCloudCallResult {
  request: {
    url: string;
    method: "POST";
    headers: {
      contentType: string;
      tokenId: string;
    };
    body: {
      wifiSn: string | undefined;
    };
  };
  response: {
    ok: boolean;
    status: number;
    statusText: string;
    bodyText: string;
    bodyJson?: unknown;
  };
}

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    PV_DATA_SOURCE: "cloud",
  });

  printSection("Configuration");
  console.log(
    JSON.stringify(
      {
        PV_DATA_SOURCE: config.PV_DATA_SOURCE,
        SOLAX_CLOUD_BASE_URL: config.SOLAX_CLOUD_BASE_URL,
        SOLAX_CLOUD_TOKEN_ID: redactSecret(config.SOLAX_CLOUD_TOKEN_ID),
        SOLAX_CLOUD_WIFI_SN: redactIdentifier(config.SOLAX_CLOUD_WIFI_SN),
        SOLAX_CLOUD_TIMEOUT_MS: config.SOLAX_CLOUD_TIMEOUT_MS,
      },
      null,
      2,
    ),
  );

  printSection("Raw SolaX Cloud HTTP Call");
  const rawResult = await callRawRealtimeInfo(config);
  console.log(JSON.stringify(rawResult, null, 2));

  printSection("SolaXCloudClient.getRealtimeInfo()");
  try {
    const client = new SolaxCloudClient(config);
    const result = await client.getRealtimeInfo();
    console.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    console.error(formatError(error));
  }

  printSection("SolaxService.readStatus()");
  try {
    const service = new SolaxService(config);
    const status = await service.readStatus();
    console.log(JSON.stringify(status, null, 2));
  } catch (error: unknown) {
    console.error(formatError(error));
  }
}

async function callRawRealtimeInfo(
  config: ReturnType<typeof loadConfig>,
): Promise<RawCloudCallResult> {
  const url = new URL(
    "/api/v2/dataAccess/realtimeInfo/get",
    config.SOLAX_CLOUD_BASE_URL,
  );
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    config.SOLAX_CLOUD_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        tokenId: config.SOLAX_CLOUD_TOKEN_ID ?? "",
      },
      body: JSON.stringify({
        wifiSn: config.SOLAX_CLOUD_WIFI_SN,
      }),
      signal: abortController.signal,
    });
    const bodyText = await response.text();

    return {
      request: {
        url: url.toString(),
        method: "POST",
        headers: {
          contentType: "application/json",
          tokenId: redactSecret(config.SOLAX_CLOUD_TOKEN_ID),
        },
        body: {
          wifiSn: redactIdentifier(config.SOLAX_CLOUD_WIFI_SN),
        },
      },
      response: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        bodyText,
        bodyJson: parseJsonOrUndefined(bodyText),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonOrUndefined(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function redactSecret(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return "<missing>";
  }

  if (value.length <= 8) {
    return "<redacted>";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactIdentifier(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return "<missing>";
  }

  if (value.length <= 6) {
    return "<redacted>";
  }

  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function printSection(title: string): void {
  console.log(`\n## ${title}`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return JSON.stringify(
      {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      null,
      2,
    );
  }

  return JSON.stringify({ error }, null, 2);
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exit(1);
});

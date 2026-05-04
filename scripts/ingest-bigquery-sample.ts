import "dotenv/config";

import { loadConfig } from "../src/config.js";
import { loadBigQueryHistoryConfig } from "../src/history/bigquery-config.js";
import { ingestPvSample } from "../src/history/ingest-pv-sample.js";

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    PV_DATA_SOURCE: "cloud",
  });
  const bigQueryConfig = loadBigQueryHistoryConfig();
  const result = await ingestPvSample(config, bigQueryConfig);

  console.log(
    JSON.stringify(
      {
        table: result.table,
        insertId: result.insertId,
        sampledAt: result.sampledAt,
        sourceProvider: result.sourceProvider,
        batterySocPercent: result.batterySocPercent,
        pvPowerTotalW: result.pvPowerTotalW,
        gridImportPowerW: result.gridImportPowerW,
        gridExportPowerW: result.gridExportPowerW,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exit(1);
});

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return JSON.stringify(
      {
        name: error.name,
        message: error.message,
        partialFailureErrors: getPartialFailureErrors(error),
      },
      null,
      2,
    );
  }

  return JSON.stringify({ error }, null, 2);
}

function getPartialFailureErrors(error: Error): unknown {
  if (!("errors" in error)) {
    return undefined;
  }

  return error.errors;
}

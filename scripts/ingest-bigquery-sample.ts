import "dotenv/config";

import { loadConfig } from "../src/config.js";
import { loadBigQueryHistoryConfig } from "../src/history/bigquery-config.js";
import { BigQueryPvHistoryWriter } from "../src/history/bigquery-pv-history-writer.js";
import {
  pvSampleInsertId,
  toPvSampleRow,
} from "../src/history/pv-sample-row.js";
import { SolaxService } from "../src/solax-service.js";

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    PV_DATA_SOURCE: "cloud",
  });
  const bigQueryConfig = loadBigQueryHistoryConfig();
  const solaxService = new SolaxService(config);
  const status = await solaxService.readStatus();
  const row = toPvSampleRow(status);
  const writer = new BigQueryPvHistoryWriter(bigQueryConfig);
  const result = await writer.insertSample(row);

  console.log(
    JSON.stringify(
      {
        table: result.table,
        insertId: result.insertId,
        sampledAt: row.sampled_at,
        sourceProvider: row.source_provider,
        batterySocPercent: row.battery_soc_percent,
        pvPowerTotalW: row.pv_power_total_w,
        gridImportPowerW: row.grid_import_power_w,
        gridExportPowerW: row.grid_export_power_w,
        expectedInsertId: pvSampleInsertId(row),
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

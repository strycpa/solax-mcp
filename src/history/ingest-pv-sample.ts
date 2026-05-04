import type { AppConfig } from "../config.js";
import { SolaxService } from "../solax-service.js";
import type { BigQueryHistoryConfig } from "./bigquery-config.js";
import { BigQueryPvHistoryWriter } from "./bigquery-pv-history-writer.js";
import { toPvSampleRow } from "./pv-sample-row.js";

export interface IngestPvSampleResult {
  table: string;
  insertId: string;
  sampledAt: string;
  sourceProvider: string;
  batterySocPercent?: number;
  pvPowerTotalW?: number;
  gridImportPowerW?: number;
  gridExportPowerW?: number;
}

export async function ingestPvSample(
  appConfig: AppConfig,
  bigQueryConfig: BigQueryHistoryConfig,
): Promise<IngestPvSampleResult> {
  const solaxService = new SolaxService(appConfig);
  const status = await solaxService.readStatus();
  const row = toPvSampleRow(status);
  const writer = new BigQueryPvHistoryWriter(bigQueryConfig);
  const result = await writer.insertSample(row);

  return {
    table: result.table,
    insertId: result.insertId,
    sampledAt: row.sampled_at,
    sourceProvider: row.source_provider,
    batterySocPercent: row.battery_soc_percent,
    pvPowerTotalW: row.pv_power_total_w,
    gridImportPowerW: row.grid_import_power_w,
    gridExportPowerW: row.grid_export_power_w,
  };
}

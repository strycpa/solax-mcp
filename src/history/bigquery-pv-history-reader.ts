import { BigQuery, type JobResponse } from "@google-cloud/bigquery";

import type { BigQueryHistoryConfig } from "./bigquery-config.js";

export interface PvHistoryQueryResult {
  rows: Record<string, unknown>[];
  jobId: string;
  totalBytesProcessed: string | null;
}

/** Hard cap on billed bytes per agent query (override via env if needed). */
const DEFAULT_MAXIMUM_BYTES_BILLED = 512 * 1024 * 1024;

function parseMaximumBytesBilled(): number {
  const raw = process.env.BIGQUERY_HISTORY_MAX_BYTES_BILLED;

  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_MAXIMUM_BYTES_BILLED;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAXIMUM_BYTES_BILLED;
  }

  return parsed;
}

export class BigQueryPvHistoryReader {
  private readonly bigQuery: BigQuery;

  public constructor(private readonly config: BigQueryHistoryConfig) {
    this.bigQuery = new BigQuery({
      projectId: config.projectId,
    });
  }

  public async query(sql: string): Promise<PvHistoryQueryResult> {
    const maximumBytesBilled = parseMaximumBytesBilled();

    const queryJobResponse = (await this.bigQuery.createQueryJob({
      query: sql,
      location: this.config.location,
      maximumBytesBilled: String(maximumBytesBilled),
      labels: {
        source: "solax_mcp_pv_history",
      },
    })) as JobResponse;

    const job = queryJobResponse[0];

    const [rows] = await job.getQueryResults();
    const metadata = job.metadata;
    const statistics = metadata.statistics;
    const totalBytesProcessed =
      statistics?.totalBytesProcessed !== undefined
        ? String(statistics.totalBytesProcessed)
        : null;

    return {
      rows: rows as Record<string, unknown>[],
      jobId: job.id ?? "",
      totalBytesProcessed,
    };
  }
}

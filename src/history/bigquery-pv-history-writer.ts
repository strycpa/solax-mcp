import { BigQuery } from "@google-cloud/bigquery";

import type { BigQueryHistoryConfig } from "./bigquery-config.js";
import {
  pvSampleInsertId,
  type PvSampleRow,
} from "./pv-sample-row.js";

export interface InsertPvSampleResult {
  insertId: string;
  table: string;
}

export class BigQueryPvHistoryWriter {
  private readonly bigQuery: BigQuery;

  public constructor(private readonly config: BigQueryHistoryConfig) {
    this.bigQuery = new BigQuery({
      projectId: config.projectId,
    });
  }

  public async insertSample(row: PvSampleRow): Promise<InsertPvSampleResult> {
    const insertId = pvSampleInsertId(row);
    const table = this.bigQuery
      .dataset(this.config.datasetId)
      .table(this.config.samplesTableId);

    await table.insert(
      {
        insertId,
        json: row,
      },
      {
        raw: true,
      },
    );

    return {
      insertId,
      table: `${this.config.projectId}.${this.config.datasetId}.${this.config.samplesTableId}`,
    };
  }
}

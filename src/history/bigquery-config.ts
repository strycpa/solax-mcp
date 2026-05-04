import { z } from "zod";

const bigQueryConfigSchema = z.object({
  BIGQUERY_PROJECT_ID: z.string().min(1),
  BIGQUERY_DATASET_ID: z.string().min(1),
  BIGQUERY_LOCATION: z.string().min(1),
  BIGQUERY_SAMPLES_TABLE_ID: z.string().min(1),
});

export interface BigQueryHistoryConfig {
  projectId: string;
  datasetId: string;
  location: string;
  samplesTableId: string;
}

export function loadBigQueryHistoryConfig(
  env: NodeJS.ProcessEnv = process.env,
): BigQueryHistoryConfig {
  const config = bigQueryConfigSchema.parse(env);

  return {
    projectId: config.BIGQUERY_PROJECT_ID,
    datasetId: config.BIGQUERY_DATASET_ID,
    location: config.BIGQUERY_LOCATION,
    samplesTableId: config.BIGQUERY_SAMPLES_TABLE_ID,
  };
}

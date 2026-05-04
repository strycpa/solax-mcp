# BigQuery PV History

This project stores historical photovoltaic samples in BigQuery.

## Dataset

```text
Project: solax-mcp
Dataset: pv_history
Location: EU
Table: pv_samples
```

`pv_samples` is partitioned by `sampled_date` and clustered by `source_provider`.
Historical MCP tools should always require an explicit time range so BigQuery can prune partitions.

## Setup

Enable BigQuery:

```bash
gcloud services enable bigquery.googleapis.com
```

Configure the explicit migration target:

```bash
BIGQUERY_PROJECT_ID=solax-mcp
BIGQUERY_DATASET_ID=pv_history
BIGQUERY_LOCATION=EU
BIGQUERY_SAMPLES_TABLE_ID=pv_samples
```

Run schema migrations:

```bash
pnpm migrate:bigquery
```

The migration runner reads `bigquery/migrations/*.sql`, applies pending migrations in filename order, and records applied migrations in:

```text
solax-mcp.pv_history.schema_migrations
```

Applied migration files are immutable. If a migration was already applied and its filename or checksum changes, the runner fails and the developer must repair the state manually or create a new migration.

The current table schema is also available as `bigquery/pv_samples.schema.json` for inspection and `bq mk` compatibility.

The migration runner requires `BIGQUERY_PROJECT_ID`, `BIGQUERY_DATASET_ID`, and `BIGQUERY_LOCATION` and intentionally does not fall back to implicit defaults.

## Manual Ingest

Run one SolaX Cloud sample ingestion locally:

```bash
pnpm ingest:bigquery
```

Local ingestion uses Google Application Default Credentials through the BigQuery Node client. If local BigQuery authentication fails, refresh ADC:

```bash
gcloud auth application-default login
```

Cloud Run will use the runtime service account instead.

The script forces `PV_DATA_SOURCE=cloud`, reads the current normalized `PvStatus`, rounds `sampled_at` down to the current minute, and streams one row into `BIGQUERY_SAMPLES_TABLE_ID`.

The streaming insert uses an insert ID in this format:

```text
<source_provider>:<sampled_at>
```

BigQuery streaming inserts use insert IDs for best-effort deduplication. The scheduled ingestion step should still tolerate occasional duplicate rows in downstream queries.

## Scheduled Ingest

HTTP mode exposes a protected endpoint for scheduled ingestion:

```text
POST /internal/ingest/bigquery
Authorization: Bearer <INGEST_AUTH_TOKEN>
```

The endpoint uses the same ingestion code as `pnpm ingest:bigquery`, forces `PV_DATA_SOURCE=cloud`, and writes one current sample to BigQuery.

Cloud Run needs:

```bash
BIGQUERY_PROJECT_ID=solax-mcp
BIGQUERY_DATASET_ID=pv_history
BIGQUERY_LOCATION=EU
BIGQUERY_SAMPLES_TABLE_ID=pv_samples
INGEST_AUTH_TOKEN=...
```

Cloud Scheduler can call the endpoint every minute:

```bash
gcloud scheduler jobs create http solax-mcp-ingest-minute \
  --location=europe-west1 \
  --schedule="* * * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://solax-mcp-nanpthbczq-ew.a.run.app/internal/ingest/bigquery" \
  --http-method=POST \
  --headers="Authorization=Bearer <INGEST_AUTH_TOKEN>"
```

Keep the scheduler paused until the Cloud Run revision containing `/internal/ingest/bigquery` is deployed:

```bash
gcloud scheduler jobs pause solax-mcp-ingest-minute --location=europe-west1
gcloud scheduler jobs resume solax-mcp-ingest-minute --location=europe-west1
```

## Runtime IAM

The Cloud Run runtime service account needs permission to create query/load jobs and write rows:

```bash
gcloud projects add-iam-policy-binding solax-mcp \
  --member="serviceAccount:solax-mcp-runner@solax-mcp.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

gcloud projects add-iam-policy-binding solax-mcp \
  --member="serviceAccount:solax-mcp-runner@solax-mcp.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor"
```

`roles/bigquery.dataEditor` is currently project-scoped because dataset-level IAM via `bq add-iam-policy-binding` was not available in this environment. We can tighten this later with dataset access entries if needed.

## Sample Shape

Each row is one normalized PV snapshot:

- `sampled_at`: timestamp assigned to the sample.
- `sampled_date`: UTC date used for partitioning.
- summary columns such as `battery_soc_percent`, `pv_power_total_w`, `grid_import_power_w`.
- `raw_status`: full normalized `PvStatus` JSON for diagnostics and future backfills.

The next implementation step is a periodic Cloud Run ingestion unit that calls SolaX Cloud once per minute and inserts a row into `pv_history.pv_samples`.

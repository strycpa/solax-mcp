/** Markdown-friendly JSON for MCP resource `pv://history-guide`. */

const PV_HISTORY_COLUMNS = [
  {
    name: "sampled_at",
    type: "TIMESTAMP",
    description: "Instant assigned to the measurement.",
    use_for:
      "Primary time axis for intraday curves and ORDER BY. Combine with sampled_date in WHERE.",
  },
  {
    name: "sampled_date",
    type: "DATE",
    description: "UTC calendar date derived from sampled_at.",
    use_for:
      "Required partition predicate (WHERE sampled_date = … or BETWEEN …). Always filter on it.",
  },
  {
    name: "ingested_at",
    type: "TIMESTAMP",
    description: "When the row landed in BigQuery.",
    use_for:
      "Latency or pipeline debugging only — not for PV physics unless investigating ingest skew.",
  },
  {
    name: "source_provider",
    type: "STRING",
    description: "Data path: cloud vs modbus.",
    use_for:
      "Filter rows when comparing providers or validating ingestion source.",
  },
  {
    name: "inverter_model",
    type: "STRING",
    description: "Configured inverter model string.",
    use_for:
      "Metadata when explaining context; rarely needed for aggregates.",
  },
  {
    name: "cloud_base_url",
    type: "STRING",
    description: "SolaX Cloud API host used when sampled.",
    use_for:
      "Diagnostics only if multiple endpoints ever appear.",
  },
  {
    name: "cloud_wifi_sn",
    type: "STRING",
    description: "Cloud dongle / registration id for the sampled site.",
    use_for:
      "Filter a specific site when a table ever holds multiple SNs.",
  },
  {
    name: "battery_soc_percent",
    type: "FLOAT64",
    description: "Battery state of charge in percent.",
    use_for:
      "SOC trends, daily min/max/mean SOC, SOC at a given hour — use this name exactly (not battery_soc).",
  },
  {
    name: "battery_power_w",
    type: "FLOAT64",
    description: "Battery DC power (charge/discharge sign per SolaX convention).",
    use_for:
      "How hard the battery is charging/discharging alongside SOC and PV.",
  },
  {
    name: "battery_voltage_v",
    type: "FLOAT64",
    description: "Battery voltage.",
    use_for:
      "Electrical context with current; optional for deep diagnostics.",
  },
  {
    name: "battery_current_a",
    type: "FLOAT64",
    description: "Battery current.",
    use_for:
      "Pairs with voltage; optional for diagnostics.",
  },
  {
    name: "pv_power_total_w",
    type: "FLOAT64",
    description: "Total PV generation power.",
    use_for:
      "Solar harvest shape by time-of-day, cloudy spells, sizing overnight recharge expectations.",
  },
  {
    name: "grid_export_power_w",
    type: "FLOAT64",
    description: "Power exported to grid.",
    use_for:
      "Feed-in episodes and surplus periods.",
  },
  {
    name: "grid_import_power_w",
    type: "FLOAT64",
    description: "Power imported from grid.",
    use_for:
      "Grid reliance overnight or low-PV stretches; off-grid viability hints vs imports.",
  },
  {
    name: "home_load_power_w",
    type: "FLOAT64",
    description: "Estimated household consumption.",
    use_for:
      "Baseline vs spikes for appliance detection (washing machine, dryer), duty-cycle length estimates.",
  },
  {
    name: "inverter_power_w",
    type: "FLOAT64",
    description: "Inverter AC output context.",
    use_for:
      "Relates AC power flow when tying PV/battery/grid narratives together.",
  },
  {
    name: "inverter_temperature_c",
    type: "FLOAT64",
    description: "Inverter heatsink / internal temperature.",
    use_for:
      "Thermal stress after heavy cycles or summer production peaks.",
  },
  {
    name: "inverter_voltage_v",
    type: "FLOAT64",
    description: "AC voltage at inverter.",
    use_for:
      "Grid-quality context when relevant.",
  },
  {
    name: "inverter_frequency_hz",
    type: "FLOAT64",
    description: "AC frequency.",
    use_for:
      "Rare diagnostics on grid stability.",
  },
  {
    name: "raw_status",
    type: "JSON",
    description: "Full normalized snapshot.",
    use_for:
      "Fallback when an answer needs fields not flattened into scalar columns — prefer scalars first.",
  },
] as const;

/** Injected into chat system prompt so the OpenAI agent picks correct identifiers without reading resources. */
export const PV_HISTORY_COLUMN_USAGE_FOR_MODEL = PV_HISTORY_COLUMNS.map(
  (column) => `- ${column.name}: ${column.use_for}`,
).join("\n");

/**
 * Minimizes inflated SUMs over power columns when the model drafts BigQuery for chat or MCP clients
 * that do not load pv://history-guide.
 */
export const PV_HISTORY_AGGREGATION_GUIDANCE_FOR_MODEL = [
  "Minute grain: sampled_at is truncated to whole UTC minutes on ingest, but repeated polls or re-ingestion can still produce multiple rows with the same sampled_at.",
  "Before SUM over *_w power columns across long windows, deduplicate to one row per minute bucket — e.g. QUALIFY ROW_NUMBER() OVER (PARTITION BY sampled_at ORDER BY ingested_at DESC) = 1 — or use AVG(...) inside GROUP BY sampled_at (or TIMESTAMP_TRUNC(sampled_at, MINUTE)) instead of summing every raw row.",
  "Values are instantaneous power (W), not energy (Wh). Approximate energy for a bucket needs mean (or integrated) power times duration in hours; summing every duplicate minute sample inflates totals by about the average number of rows per minute.",
].join("\n");

export const PV_HISTORY_GUIDE_TEXT = JSON.stringify(
  {
    query_tool: "query_pv_history",
    table_alias: "pv_samples",
    partition_column:
      "sampled_date — required in WHERE so BigQuery can prune partitions (table uses require_partition_filter).",
    grain_minutes: 1,
    critical_sql_identifiers: [
      "Use schema-exact column names only. SOC is stored as battery_soc_percent — there is no battery_soc column.",
      "Timestamps use sampled_at (TIMESTAMP); partitioning uses sampled_date (DATE), usually as UTC calendar date.",
      "Multiple rows may share the same sampled_at; dedupe or AVG before SUM over *_w columns so report totals are not multiplied by samples-per-minute.",
    ],
    interpretation_hints: [
      "Compare sustained home_load_power_w spikes vs quiet baseline to infer large appliance runs (for example laundry cycles).",
      "Combine rolling SOC with PV generation (pv_power_total_w, battery_power_w) and grid import/export for off-grid feasibility sketches.",
      "Always pair historical aggregates with get_pv_status for current conditions.",
      "For energy-style questions, treat *_w as power: deduplicate per sampled_at (or average per bucket) then combine with elapsed time; raw SUM(watts) over duplicated minutes is not watthours.",
    ],
    columns: PV_HISTORY_COLUMNS,
  },
  null,
  2,
);

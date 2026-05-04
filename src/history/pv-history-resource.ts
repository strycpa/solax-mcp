/** Markdown-friendly JSON for MCP resource `pv://history-guide`. */
export const PV_HISTORY_GUIDE_TEXT = JSON.stringify(
  {
    query_tool: "query_pv_history",
    table_alias: "pv_samples",
    partition_column:
      "sampled_date — required in WHERE so BigQuery can prune partitions (table uses require_partition_filter).",
    grain_minutes: 1,
    interpretation_hints: [
      "Compare sustained home_load_power_w spikes vs quiet baseline to infer large appliance runs (for example laundry cycles).",
      "Combine rolling SOC with PV generation (pv_power_total_w, battery_power_w) and grid import/export for off-grid feasibility sketches.",
      "Always pair historical aggregates with get_pv_status for current conditions.",
    ],
    columns: [
      { name: "sampled_at", type: "TIMESTAMP", description: "Sample instant." },
      {
        name: "sampled_date",
        type: "DATE",
        description: "UTC date partition key derived from sampled_at.",
      },
      {
        name: "battery_soc_percent",
        type: "FLOAT64",
        description: "Battery state of charge percent.",
      },
      {
        name: "battery_power_w",
        type: "FLOAT64",
        description: "Battery power (charge/discharge).",
      },
      {
        name: "pv_power_total_w",
        type: "FLOAT64",
        description: "Total PV DC-side reported power.",
      },
      {
        name: "grid_import_power_w",
        type: "FLOAT64",
        description: "Grid import power.",
      },
      {
        name: "grid_export_power_w",
        type: "FLOAT64",
        description: "Grid export power.",
      },
      {
        name: "home_load_power_w",
        type: "FLOAT64",
        description: "Estimated home load useful for appliance spike detection.",
      },
      {
        name: "raw_status",
        type: "JSON",
        description: "Full normalized snapshot payload for deeper diagnostics.",
      },
    ],
  },
  null,
  2,
);

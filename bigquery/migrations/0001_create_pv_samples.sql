CREATE SCHEMA IF NOT EXISTS `solax-mcp.pv_history`
OPTIONS (
  location = "EU",
  description = "SolaX PV historical measurements"
);

CREATE TABLE IF NOT EXISTS `solax-mcp.pv_history.pv_samples`
(
  sampled_at TIMESTAMP NOT NULL OPTIONS(description = "Timestamp reported or assigned to the PV sample."),
  sampled_date DATE NOT NULL OPTIONS(description = "UTC date derived from sampled_at for partition pruning."),
  ingested_at TIMESTAMP NOT NULL OPTIONS(description = "Timestamp when the sample was written to BigQuery."),
  source_provider STRING NOT NULL OPTIONS(description = "Data source provider, for example cloud or modbus."),
  inverter_model STRING OPTIONS(description = "Configured inverter model."),
  cloud_base_url STRING OPTIONS(description = "SolaX Cloud API base URL used for the sample."),
  cloud_wifi_sn STRING OPTIONS(description = "SolaX Cloud WiFi/dongle serial number used for the sample."),
  battery_soc_percent FLOAT64 OPTIONS(description = "Battery state of charge in percent."),
  battery_power_w FLOAT64 OPTIONS(description = "Battery power in watts."),
  battery_voltage_v FLOAT64 OPTIONS(description = "Battery voltage in volts."),
  battery_current_a FLOAT64 OPTIONS(description = "Battery current in amperes."),
  pv_power_total_w FLOAT64 OPTIONS(description = "Total PV power in watts."),
  grid_export_power_w FLOAT64 OPTIONS(description = "Grid export power in watts."),
  grid_import_power_w FLOAT64 OPTIONS(description = "Grid import power in watts."),
  home_load_power_w FLOAT64 OPTIONS(description = "Estimated home load power in watts."),
  inverter_power_w FLOAT64 OPTIONS(description = "Inverter AC power in watts."),
  inverter_temperature_c FLOAT64 OPTIONS(description = "Inverter temperature in degrees Celsius."),
  inverter_voltage_v FLOAT64 OPTIONS(description = "Inverter voltage in volts."),
  inverter_frequency_hz FLOAT64 OPTIONS(description = "Inverter frequency in hertz."),
  raw_status JSON OPTIONS(description = "Full normalized PvStatus payload for future backfills and diagnostics.")
)
PARTITION BY sampled_date
CLUSTER BY source_provider
OPTIONS (
  description = "Minute-level SolaX PV historical samples",
  require_partition_filter = TRUE
);

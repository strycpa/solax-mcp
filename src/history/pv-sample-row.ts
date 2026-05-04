import type { PvStatus } from "../solax-service.js";

export interface PvSampleRow {
  sampled_at: string;
  sampled_date: string;
  ingested_at: string;
  source_provider: string;
  inverter_model?: string;
  cloud_base_url?: string;
  cloud_wifi_sn?: string;
  battery_soc_percent?: number;
  battery_power_w?: number;
  battery_voltage_v?: number;
  battery_current_a?: number;
  pv_power_total_w?: number;
  grid_export_power_w?: number;
  grid_import_power_w?: number;
  home_load_power_w?: number;
  inverter_power_w?: number;
  inverter_temperature_c?: number;
  inverter_voltage_v?: number;
  inverter_frequency_hz?: number;
  raw_status: string;
}

export function toPvSampleRow(
  status: PvStatus,
  ingestedAt: Date = new Date(),
): PvSampleRow {
  const sampledAt = floorToMinute(new Date(status.timestamp));

  return {
    sampled_at: sampledAt.toISOString(),
    sampled_date: toDateString(sampledAt),
    ingested_at: ingestedAt.toISOString(),
    source_provider: status.source.provider,
    inverter_model: status.source.inverterModel,
    cloud_base_url: status.source.cloudBaseUrl,
    cloud_wifi_sn: status.source.cloudWifiSn,
    battery_soc_percent: status.summary.batterySocPercent,
    battery_power_w: status.summary.batteryPowerW,
    battery_voltage_v: status.summary.batteryVoltageV,
    battery_current_a: status.summary.batteryCurrentA,
    pv_power_total_w: status.summary.pvPowerTotalW,
    grid_export_power_w: status.summary.gridExportPowerW,
    grid_import_power_w: status.summary.gridImportPowerW,
    home_load_power_w: status.summary.homeLoadPowerW,
    inverter_power_w: status.summary.inverterPowerW,
    inverter_temperature_c: status.summary.inverterTemperatureC,
    inverter_voltage_v: status.summary.inverterVoltageV,
    inverter_frequency_hz: status.summary.inverterFrequencyHz,
    raw_status: JSON.stringify(status),
  };
}

export function pvSampleInsertId(row: PvSampleRow): string {
  return `${row.source_provider}:${row.sampled_at}`;
}

function floorToMinute(date: Date): Date {
  const result = new Date(date);
  result.setUTCSeconds(0, 0);
  return result;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

import type { AppConfig } from "./config.js";
import {
  getRegisterDefinition,
  SOLAX_DEFAULT_REGISTER_MAP,
  type SolaxFieldKey,
} from "./modbus/register-map.js";
import { SolaxModbusClient } from "./modbus/solax-modbus-client.js";

export interface FieldReading {
  key: string;
  name: string;
  description: string;
  value: number;
  unit?: string;
  rawRegisters: number[];
  register: {
    address: number;
    addressHex: string;
    type: string;
    dataType: string;
    scale: number;
  };
}

export interface PvStatus {
  timestamp: string;
  source: {
    inverterModel: string;
    host: string;
    port: number;
    unitId: number;
  };
  summary: {
    batterySocPercent?: number;
    batteryPowerW?: number;
    batteryVoltageV?: number;
    batteryCurrentA?: number;
    pvPowerTotalW?: number;
    gridExportPowerW?: number;
    gridImportPowerW?: number;
    homeLoadPowerW?: number;
    inverterPowerW?: number;
    inverterTemperatureC?: number;
    inverterVoltageV?: number;
    inverterFrequencyHz?: number;
  };
  readings: FieldReading[];
}

export class SolaxService {
  public constructor(private readonly config: AppConfig) {}

  public async readStatus(): Promise<PvStatus> {
    const client = new SolaxModbusClient(this.config);

    try {
      const readings: FieldReading[] = [];

      for (const definition of SOLAX_DEFAULT_REGISTER_MAP) {
        const result = await client.readDefinition(definition);
        readings.push(toFieldReading(result));
      }

      return {
        timestamp: new Date().toISOString(),
        source: {
          inverterModel: this.config.SOLAX_INVERTER_MODEL,
          host: this.config.SOLAX_MODBUS_HOST,
          port: this.config.SOLAX_MODBUS_PORT,
          unitId: this.config.SOLAX_MODBUS_UNIT_ID,
        },
        summary: buildSummary(readings),
        readings,
      };
    } finally {
      await client.close();
    }
  }

  public async readBatterySoc(): Promise<FieldReading> {
    return this.readField("battery_capacity");
  }

  public async readField(key: SolaxFieldKey): Promise<FieldReading> {
    const client = new SolaxModbusClient(this.config);

    try {
      const result = await client.readDefinition(getRegisterDefinition(key));
      return toFieldReading(result);
    } finally {
      await client.close();
    }
  }
}

function toFieldReading(result: Awaited<ReturnType<SolaxModbusClient["readDefinition"]>>): FieldReading {
  const { definition } = result;

  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    value: result.value,
    unit: definition.unit,
    rawRegisters: result.rawRegisters,
    register: {
      address: definition.address,
      addressHex: `0x${definition.address.toString(16).toUpperCase()}`,
      type: definition.registerType,
      dataType: definition.dataType,
      scale: definition.scale ?? 1,
    },
  };
}

function buildSummary(readings: readonly FieldReading[]): PvStatus["summary"] {
  const values = new Map(readings.map((reading) => [reading.key, reading.value]));
  const pvPowerTotalW = sumDefined(values.get("pv_power_1"), values.get("pv_power_2"));
  const measuredPowerW = values.get("measured_power");
  const batteryPowerW = values.get("battery_power_charge");

  return {
    batterySocPercent: values.get("battery_capacity"),
    batteryPowerW,
    batteryVoltageV: values.get("battery_voltage_charge"),
    batteryCurrentA: values.get("battery_current_charge"),
    pvPowerTotalW,
    gridExportPowerW:
      measuredPowerW === undefined ? undefined : Math.max(0, measuredPowerW),
    gridImportPowerW:
      measuredPowerW === undefined ? undefined : Math.max(0, -measuredPowerW),
    homeLoadPowerW: calculateHomeLoadPower(
      pvPowerTotalW,
      batteryPowerW,
      measuredPowerW,
    ),
    inverterPowerW: values.get("inverter_power"),
    inverterTemperatureC: values.get("inverter_temperature"),
    inverterVoltageV: values.get("inverter_voltage"),
    inverterFrequencyHz: values.get("inverter_frequency"),
  };
}

function sumDefined(...values: readonly (number | undefined)[]): number | undefined {
  const definedValues = values.filter((value) => value !== undefined);

  if (definedValues.length === 0) {
    return undefined;
  }

  return definedValues.reduce((sum, value) => sum + value, 0);
}

function calculateHomeLoadPower(
  pvPowerTotalW: number | undefined,
  batteryPowerW: number | undefined,
  measuredPowerW: number | undefined,
): number | undefined {
  if (
    pvPowerTotalW === undefined ||
    batteryPowerW === undefined ||
    measuredPowerW === undefined
  ) {
    return undefined;
  }

  return pvPowerTotalW - batteryPowerW - measuredPowerW;
}

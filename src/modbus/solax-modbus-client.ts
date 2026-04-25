import { createRequire } from "node:module";

import type { AppConfig } from "../config.js";
import type {
  RegisterDataType,
  RegisterDefinition,
  RegisterType,
} from "./register-map.js";

interface ReadRegisterResult {
  data: number[];
}

interface ModbusRTUClient {
  isOpen: boolean;
  close(callback: () => void): void;
  connectTCP(host: string, options: { port: number }): Promise<void>;
  readHoldingRegisters(address: number, length: number): Promise<ReadRegisterResult>;
  readInputRegisters(address: number, length: number): Promise<ReadRegisterResult>;
  setID(id: number): void;
  setTimeout(duration: number): void;
}

interface ModbusRTUConstructor {
  new (): ModbusRTUClient;
}

const require = createRequire(import.meta.url);
const ModbusRTU: ModbusRTUConstructor = require("modbus-serial");

export interface RegisterReadResult {
  definition: RegisterDefinition;
  rawRegisters: number[];
  value: number;
}

export interface RawRegisterReadResult {
  address: number;
  registerType: RegisterType;
  dataType: RegisterDataType;
  rawRegisters: number[];
  value: number;
}

export class SolaxModbusClient {
  private readonly client = new ModbusRTU();

  public constructor(private readonly config: AppConfig) {
    this.client.setID(config.SOLAX_MODBUS_UNIT_ID);
    this.client.setTimeout(config.SOLAX_MODBUS_TIMEOUT_MS);
  }

  public async readDefinition(
    definition: RegisterDefinition,
  ): Promise<RegisterReadResult> {
    const rawRegisters = await this.readRegisters(
      definition.address,
      wordLength(definition.dataType),
      definition.registerType,
    );
    const rawValue = decodeRegisters(rawRegisters, definition.dataType);
    const value = scaleValue(
      rawValue,
      definition.scale ?? 1,
      definition.precision,
    );

    return {
      definition,
      rawRegisters,
      value,
    };
  }

  public async readRawRegister(
    address: number,
    registerType: RegisterType,
    dataType: RegisterDataType,
    scale: number,
    precision?: number,
  ): Promise<RawRegisterReadResult> {
    const rawRegisters = await this.readRegisters(
      address,
      wordLength(dataType),
      registerType,
    );
    const rawValue = decodeRegisters(rawRegisters, dataType);

    return {
      address,
      registerType,
      dataType,
      rawRegisters,
      value: scaleValue(rawValue, scale, precision),
    };
  }

  public async close(): Promise<void> {
    if (!this.client.isOpen) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.client.close(() => resolve());
    });
  }

  private async readRegisters(
    address: number,
    length: number,
    registerType: RegisterType,
  ): Promise<number[]> {
    await this.ensureConnected();

    const result =
      registerType === "input"
        ? await this.client.readInputRegisters(address, length)
        : await this.client.readHoldingRegisters(address, length);

    return result.data;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }

    await this.client.connectTCP(this.config.SOLAX_MODBUS_HOST, {
      port: this.config.SOLAX_MODBUS_PORT,
    });
    this.client.setID(this.config.SOLAX_MODBUS_UNIT_ID);
    this.client.setTimeout(this.config.SOLAX_MODBUS_TIMEOUT_MS);
  }
}

function wordLength(dataType: RegisterDataType): number {
  switch (dataType) {
    case "u16":
    case "s16":
      return 1;
    case "u32":
    case "s32":
      return 2;
  }
}

function decodeRegisters(
  registers: readonly number[],
  dataType: RegisterDataType,
): number {
  switch (dataType) {
    case "u16":
      return registers[0] ?? 0;
    case "s16":
      return toSigned16(registers[0] ?? 0);
    case "u32":
      return toUnsigned32(registers);
    case "s32":
      return toSigned32(toUnsigned32(registers));
  }
}

function toSigned16(value: number): number {
  return value > 0x7fff ? value - 0x10000 : value;
}

function toUnsigned32(registers: readonly number[]): number {
  const high = registers[0] ?? 0;
  const low = registers[1] ?? 0;

  return high * 0x10000 + low;
}

function toSigned32(value: number): number {
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function scaleValue(value: number, scale: number, precision?: number): number {
  const scaled = value * scale;

  if (precision === undefined) {
    return scaled;
  }

  const factor = 10 ** precision;
  return Math.round(scaled * factor) / factor;
}

import "dotenv/config";

import { loadConfig } from "../src/config.js";
import {
  SOLAX_DEFAULT_REGISTER_MAP,
  type RegisterDataType,
} from "../src/modbus/register-map.js";
import { SolaxModbusClient } from "../src/modbus/solax-modbus-client.js";
import { SolaxService } from "../src/solax-service.js";

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    PV_DATA_SOURCE: "modbus",
  });

  printSection("Configuration");
  console.log(
    JSON.stringify(
      {
        PV_DATA_SOURCE: config.PV_DATA_SOURCE,
        SOLAX_MODBUS_HOST: config.SOLAX_MODBUS_HOST,
        SOLAX_MODBUS_PORT: config.SOLAX_MODBUS_PORT,
        SOLAX_MODBUS_UNIT_ID: config.SOLAX_MODBUS_UNIT_ID,
        SOLAX_MODBUS_TIMEOUT_MS: config.SOLAX_MODBUS_TIMEOUT_MS,
      },
      null,
      2,
    ),
  );

  printSection("Default Register Map Reads");
  await printDefaultRegisterMapReads(config);

  printSection("Measured Power Decode Variants");
  await printMeasuredPowerDecodeVariants(config);

  printSection("SolaxService.readStatus()");
  try {
    const service = new SolaxService(config);
    const status = await service.readStatus();
    console.log(JSON.stringify(status, null, 2));
  } catch (error: unknown) {
    console.error(formatError(error));
  }
}

async function printDefaultRegisterMapReads(
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  const client = new SolaxModbusClient(config);

  try {
    const rows = [];

    for (const definition of SOLAX_DEFAULT_REGISTER_MAP) {
      try {
        const result = await client.readDefinition(definition);
        rows.push({
          key: definition.key,
          name: definition.name,
          address: definition.address,
          addressHex: `0x${definition.address.toString(16).toUpperCase()}`,
          type: definition.registerType,
          dataType: definition.dataType,
          scale: definition.scale ?? 1,
          rawRegisters: result.rawRegisters,
          value: result.value,
          unit: definition.unit,
        });
      } catch (error: unknown) {
        rows.push({
          key: definition.key,
          name: definition.name,
          address: definition.address,
          addressHex: `0x${definition.address.toString(16).toUpperCase()}`,
          type: definition.registerType,
          dataType: definition.dataType,
          error: formatError(error),
        });
      }
    }

    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await client.close();
  }
}

async function printMeasuredPowerDecodeVariants(
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  const client = new SolaxModbusClient(config);

  try {
    const variants: RegisterDataType[] = ["s16", "u16", "s32", "s32-swap", "u32"];
    const rows = [];

    for (const dataType of variants) {
      try {
        const result = await client.readRawRegister(
          0x46,
          "input",
          dataType,
          1,
        );
        rows.push(result);
      } catch (error: unknown) {
        rows.push({
          address: 0x46,
          registerType: "input",
          dataType,
          error: formatError(error),
        });
      }
    }

    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await client.close();
  }
}

function printSection(title: string): void {
  console.log(`\n## ${title}`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return JSON.stringify(
      {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      null,
      2,
    );
  }

  return JSON.stringify({ error }, null, 2);
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exit(1);
});

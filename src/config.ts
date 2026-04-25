import { z } from "zod";

const configSchema = z.object({
  SOLAX_INVERTER_MODEL: z.string().min(1).default("SolaX Hybrid G4 10k"),
  SOLAX_MODBUS_HOST: z.string().min(1).default("192.168.68.121"),
  SOLAX_MODBUS_PORT: z.coerce.number().int().min(1).max(65535).default(502),
  SOLAX_MODBUS_UNIT_ID: z.coerce.number().int().min(1).max(247).default(1),
  SOLAX_MODBUS_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(env);
}

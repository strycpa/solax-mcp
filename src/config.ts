import { z } from "zod";

const configSchema = z
  .object({
    MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
    MCP_HTTP_HOST: z.string().min(1).default("127.0.0.1"),
    MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    MCP_HTTP_PATH: z.string().min(1).default("/mcp"),
    MCP_HTTP_AUTH_TOKEN: z.string().min(16).optional(),
    CHAT_AUTH_TOKEN: z.string().min(16).optional(),
    CHAT_MCP_URL: z.string().url().optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
    PV_DATA_SOURCE: z.enum(["modbus", "cloud"]).default("modbus"),
    SOLAX_INVERTER_MODEL: z.string().min(1).default("SolaX Hybrid G4 10k"),
    SOLAX_MODBUS_HOST: z.string().min(1).default("192.168.68.121"),
    SOLAX_MODBUS_PORT: z.coerce.number().int().min(1).max(65535).default(502),
    SOLAX_MODBUS_UNIT_ID: z.coerce.number().int().min(1).max(247).default(1),
    SOLAX_MODBUS_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
    SOLAX_CLOUD_BASE_URL: z
      .string()
      .url()
      .default("https://global.solaxcloud.com"),
    SOLAX_CLOUD_TOKEN_ID: z.string().optional(),
    SOLAX_CLOUD_WIFI_SN: z.string().optional(),
    SOLAX_CLOUD_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
  })
  .superRefine((config, ctx) => {
    if (
      config.MCP_TRANSPORT === "http" &&
      config.MCP_HTTP_AUTH_TOKEN === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["MCP_HTTP_AUTH_TOKEN"],
        message: "MCP_HTTP_AUTH_TOKEN is required when MCP_TRANSPORT=http.",
      });
    }

    if (config.PV_DATA_SOURCE !== "cloud") {
      return;
    }

    if (config.SOLAX_CLOUD_TOKEN_ID === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["SOLAX_CLOUD_TOKEN_ID"],
        message: "SOLAX_CLOUD_TOKEN_ID is required when PV_DATA_SOURCE=cloud.",
      });
    }

    if (config.SOLAX_CLOUD_WIFI_SN === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["SOLAX_CLOUD_WIFI_SN"],
        message: "SOLAX_CLOUD_WIFI_SN is required when PV_DATA_SOURCE=cloud.",
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    ...env,
    MCP_HTTP_PORT: env.MCP_HTTP_PORT ?? env.PORT,
  });
}

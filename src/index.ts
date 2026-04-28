import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import {
  SOLAX_DEFAULT_REGISTER_MAP,
  type SolaxFieldKey,
} from "./modbus/register-map.js";
import { SolaxModbusClient } from "./modbus/solax-modbus-client.js";
import { SolaxService } from "./solax-service.js";

const config = loadConfig();
const solaxService = new SolaxService(config);

const server = new McpServer({
  name: "solax-mcp",
  version: "0.0.1",
});

server.registerTool(
  "get_pv_status",
  {
    title: "Get PV Status",
    description:
      "Read the current photovoltaic system status from the configured SolaX data source.",
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async () => jsonToolResult(await solaxService.readStatus()),
);

server.registerTool(
  "get_battery_soc",
  {
    title: "Get Battery SOC",
    description:
      "Read the current PV battery state of charge from the configured SolaX data source.",
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async () => jsonToolResult(await solaxService.readBatterySoc()),
);

server.registerTool(
  "read_pv_field",
  {
    title: "Read PV Field",
    description:
      "Read one known field from the default SolaX register map, for example battery_capacity.",
    inputSchema: {
      key: z
        .enum(registerKeys())
        .describe("Known field key from the default SolaX register map."),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ key }) => jsonToolResult(await solaxService.readField(key)),
);

server.registerTool(
  "read_pv_register",
  {
    title: "Read PV Register",
    description:
      "Read an arbitrary Modbus register for diagnostics when verifying the inverter-specific map. This tool always uses Modbus TCP.",
    inputSchema: {
      address: z
        .number()
        .int()
        .min(0)
        .describe("Zero-based Modbus register address, e.g. 28 for 0x1C."),
      registerType: z.enum(["input", "holding"]).default("input"),
      dataType: z
        .enum(["u16", "s16", "u32", "s32", "s32-swap"])
        .default("u16"),
      scale: z.number().default(1),
      precision: z.number().int().min(0).max(6).optional(),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ address, registerType, dataType, scale, precision }) => {
    const client = new SolaxModbusClient(config);

    try {
      const result = await client.readRawRegister(
        address,
        registerType,
        dataType,
        scale,
        precision,
      );
      return jsonToolResult(result);
    } finally {
      await client.close();
    }
  },
);

server.registerResource(
  "pv_register_map",
  "pv://register-map",
  {
    title: "PV Register Map",
    description: "Default SolaX register map used by this MCP server.",
    mimeType: "application/json",
  },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(SOLAX_DEFAULT_REGISTER_MAP, null, 2),
      },
    ],
  }),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `solax-mcp listening on stdio; provider ${config.PV_DATA_SOURCE}`,
  );
}

function jsonToolResult(data: object): CallToolResult {
  return {
    structuredContent: Object.fromEntries(Object.entries(data)),
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function registerKeys(): [SolaxFieldKey, ...SolaxFieldKey[]] {
  const firstRegister = SOLAX_DEFAULT_REGISTER_MAP[0];

  if (firstRegister === undefined) {
    throw new Error("SolaX register map must contain at least one field.");
  }

  return [
    firstRegister.key,
    ...SOLAX_DEFAULT_REGISTER_MAP.slice(1).map((register) => register.key),
  ];
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

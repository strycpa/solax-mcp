import "dotenv/config";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { handleChatRequest, writeChatPage } from "./chat.js";
import { loadConfig, type AppConfig } from "./config.js";
import {
  SOLAX_DEFAULT_REGISTER_MAP,
  type SolaxFieldKey,
} from "./modbus/register-map.js";
import { SolaxModbusClient } from "./modbus/solax-modbus-client.js";
import { SolaxService } from "./solax-service.js";

const config = loadConfig();

interface HttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

function createSolaxMcpServer(config: AppConfig): McpServer {
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

  if (config.PV_DATA_SOURCE === "modbus") {
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
  }

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

  return server;
}

async function main(): Promise<void> {
  if (config.MCP_TRANSPORT === "http") {
    await runHttpServer(config);
    return;
  }

  await runStdioServer(config);
}

async function runStdioServer(config: AppConfig): Promise<void> {
  const server = createSolaxMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `solax-mcp listening on stdio; provider ${config.PV_DATA_SOURCE}`,
  );
}

async function runHttpServer(config: AppConfig): Promise<void> {
  const sessions = new Map<string, HttpSession>();
  const httpServer = createServer(async (req, res) => {
    try {
      await handleHttpRequest(config, sessions, req, res);
    } catch (error: unknown) {
      console.error("Error handling HTTP MCP request:", error);
      writeJsonRpcError(res, 500, -32603, "Internal server error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  console.error(
    `solax-mcp listening on http://${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}${config.MCP_HTTP_PATH}; provider ${config.PV_DATA_SOURCE}`,
  );

  const shutdown = async (): Promise<void> => {
    httpServer.close();

    for (const [sessionId, session] of sessions) {
      await session.server.close();
      sessions.delete(sessionId);
    }
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

async function handleHttpRequest(
  config: AppConfig,
  sessions: Map<string, HttpSession>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const requestPath = getRequestPath(req);

  if (requestPath === "/health" || requestPath === "/healthz") {
    writeJson(res, 200, { status: "ok" });
    return;
  }

  if (requestPath === "/chat" && req.method === "GET") {
    writeChatPage(res);
    return;
  }

  if (requestPath === "/api/chat" && req.method === "POST") {
    await handleChatRequest(config, req, res);
    return;
  }

  if (requestPath !== config.MCP_HTTP_PATH) {
    writeText(res, 404, "Not found");
    return;
  }

  if (!isAuthorizedHttpRequest(config, req)) {
    writeUnauthorized(res);
    return;
  }

  if (req.method === "POST") {
    await handleMcpPost(config, sessions, req, res);
    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    await handleMcpSessionRequest(sessions, req, res);
    return;
  }

  writeText(res, 405, "Method not allowed");
}

async function handleMcpPost(
  config: AppConfig,
  sessions: Map<string, HttpSession>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const sessionId = getHeader(req, "mcp-session-id");
  const parsedBody = await readJsonBody(req);

  if (sessionId !== undefined) {
    const session = sessions.get(sessionId);

    if (session === undefined) {
      writeJsonRpcError(res, 404, -32000, "Session not found");
      return;
    }

    await session.transport.handleRequest(req, res, parsedBody);
    return;
  }

  if (!isInitializeRequest(parsedBody)) {
    writeJsonRpcError(
      res,
      400,
      -32000,
      "Bad Request: no valid session ID provided",
    );
    return;
  }

  const session = await createHttpSession(config, sessions);
  await session.transport.handleRequest(req, res, parsedBody);
}

async function handleMcpSessionRequest(
  sessions: Map<string, HttpSession>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const sessionId = getHeader(req, "mcp-session-id");

  if (sessionId === undefined) {
    writeText(res, 400, "Missing MCP session ID");
    return;
  }

  const session = sessions.get(sessionId);

  if (session === undefined) {
    writeText(res, 404, "Session not found");
    return;
  }

  await session.transport.handleRequest(req, res);
}

async function createHttpSession(
  config: AppConfig,
  sessions: Map<string, HttpSession>,
): Promise<HttpSession> {
  let pendingSession: HttpSession | undefined;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      if (pendingSession === undefined) {
        throw new Error("HTTP MCP session initialized before server connection.");
      }

      sessions.set(sessionId, pendingSession);
    },
    onsessionclosed: async (sessionId) => {
      const session = sessions.get(sessionId);

      if (session === undefined) {
        return;
      }

      sessions.delete(sessionId);
      await session.server.close();
    },
  });
  const server = createSolaxMcpServer(config);
  pendingSession = { server, transport };

  await server.connect(transport);

  return pendingSession;
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

function getRequestPath(req: IncomingMessage): string {
  const baseUrl = `http://${req.headers.host ?? "localhost"}`;
  return new URL(req.url ?? "/", baseUrl).pathname;
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function isAuthorizedHttpRequest(
  config: AppConfig,
  req: IncomingMessage,
): boolean {
  const expectedToken = config.MCP_HTTP_AUTH_TOKEN;

  if (expectedToken === undefined) {
    return false;
  }

  const authorizationHeader = getHeader(req, "authorization");
  const bearerPrefix = "Bearer ";

  if (
    authorizationHeader === undefined ||
    !authorizationHeader.startsWith(bearerPrefix)
  ) {
    return false;
  }

  const actualToken = authorizationHeader.slice(bearerPrefix.length);
  const expectedTokenBuffer = Buffer.from(expectedToken);
  const actualTokenBuffer = Buffer.from(actualToken);

  return (
    expectedTokenBuffer.length === actualTokenBuffer.length &&
    timingSafeEqual(expectedTokenBuffer, actualTokenBuffer)
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const body = Buffer.concat(chunks).toString("utf8");

  if (body.trim().length === 0) {
    return undefined;
  }

  const parsed: unknown = JSON.parse(body);
  return parsed;
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  data: object,
): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function writeJsonRpcError(
  res: ServerResponse,
  statusCode: number,
  code: number,
  message: string,
): void {
  writeJson(res, statusCode, {
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  });
}

function writeUnauthorized(res: ServerResponse): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(401, {
    "content-type": "application/json",
    "www-authenticate": 'Bearer realm="solax-mcp"',
  });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized",
      },
      id: null,
    }),
  );
}

function writeText(
  res: ServerResponse,
  statusCode: number,
  text: string,
): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

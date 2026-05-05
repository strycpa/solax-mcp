import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import { PV_HISTORY_COLUMN_USAGE_FOR_MODEL } from "./history/pv-history-resource.js";

const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const toolArgumentsSchema = z.record(z.string(), z.unknown());

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({
                  name: z.string(),
                  arguments: z.string(),
                }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
});

type ChatCompletion = z.infer<typeof chatCompletionSchema>;
type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: NonNullable<ChatCompletion["choices"][number]["message"]["tool_calls"]>;
  tool_call_id?: string;
};

interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: false;
    };
  };
}

const baseChatTools: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "get_pv_status",
      description:
        "Read the current PV system status, including battery, PV power, grid import/export and home load.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_battery_soc",
      description: "Read only the current battery state of charge.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_pv_field",
      description: "Read one normalized PV field by key.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "Normalized field key, for example battery_capacity, pv_power_1, pv_power_2 or measured_power.",
          },
        },
        required: ["key"],
        additionalProperties: false,
      },
    },
  },
];

const queryPvHistoryChatTool: ChatTool = {
  type: "function",
  function: {
    name: "query_pv_history",
    description:
      "Run a constrained BigQuery SELECT over minute-level pv_samples for trends and historical analytics. SQL must reference pv_samples only and MUST include sampled_date in WHERE (partition requirement). SOC column must be battery_soc_percent exactly — never battery_soc. Use column meanings from the system message (same list as MCP resource pv://history-guide). Do not use semicolons, backticks, comments, or UNION. Prefer aggregates by hour/day and filters on sampled_at ranges inside valid sampled_date windows. Combine results with get_pv_status for current conditions.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description:
            "BigQuery Standard SQL SELECT on pv_samples with sampled_date predicate; use exact column names described in the system message.",
        },
      },
      required: ["sql"],
      additionalProperties: false,
    },
  },
};

const chatTools: ChatTool[] = [...baseChatTools, queryPvHistoryChatTool];

export async function handleChatRequest(
  config: AppConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!isAuthorizedChatRequest(config, req)) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (config.OPENAI_API_KEY === undefined) {
    writeJson(res, 503, {
      error: "OPENAI_API_KEY is required to use the mobile chat.",
    });
    return;
  }

  const parsedBody = chatRequestSchema.safeParse(await readJsonBody(req));

  if (!parsedBody.success) {
    writeJson(res, 400, { error: "Message is required." });
    return;
  }

  try {
    const answer = await answerChatMessage(config, req, parsedBody.data.message);
    writeJson(res, 200, { answer });
  } catch (error: unknown) {
    console.error("Error handling chat request:", error);
    writeJson(res, 500, { error: "Chat request failed." });
  }
}

export function handleChatAuthRequest(
  config: AppConfig,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!isAuthorizedChatRequest(config, req)) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }

  writeJson(res, 200, { status: "ok" });
}

export function writeChatPage(res: ServerResponse): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(chatPageHtml);
}

async function answerChatMessage(
  config: AppConfig,
  req: IncomingMessage,
  message: string,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a concise home photovoltaic assistant. Answer in Czech. Use the available MCP tools when the user asks about current PV, battery, grid or inverter state. When the question depends on trends across hours or days (for example laundry timing from typical load spikes, how many overnight cycles might fit, or rough multi-day off-grid outlooks), call query_pv_history with descriptive aggregates over pv_samples inside explicit sampled_date bounds, then reconcile with get_pv_status for up-to-date measurements. In historical SQL use exact BigQuery column names from the schema (especially battery_soc_percent for SOC — there is no battery_soc column). If a tool returns an error message, quote or explain it briefly instead of claiming data does not exist. Explain values in practical household terms and spell out uncertainty where data is incomplete.",
        "",
        "pv_samples columns — what each is for when writing query_pv_history SQL:",
        PV_HISTORY_COLUMN_USAGE_FOR_MODEL,
      ].join("\n"),
    },
    {
      role: "user",
      content: message,
    },
  ];

  const firstResponse = await createChatCompletion(config, messages, chatTools);
  const firstMessage = firstResponse.choices[0]?.message;

  if (firstMessage === undefined) {
    throw new Error("OpenAI response did not contain a message.");
  }

  if (firstMessage.tool_calls === undefined || firstMessage.tool_calls.length === 0) {
    return firstMessage.content ?? "";
  }

  messages.push({
    role: "assistant",
    content: firstMessage.content ?? null,
    tool_calls: firstMessage.tool_calls,
  });

  const mcpClient = await createMcpClient(config, req);

  try {
    for (const toolCall of firstMessage.tool_calls) {
      const result = await callMcpTool(
        mcpClient,
        toolCall.function.name,
        toolCall.function.arguments,
      );
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  } finally {
    await mcpClient.close();
  }

  const finalResponse = await createChatCompletion(config, messages);
  const finalMessage = finalResponse.choices[0]?.message;

  if (finalMessage === undefined) {
    throw new Error("OpenAI response did not contain a final message.");
  }

  return finalMessage.content ?? "";
}

async function createChatCompletion(
  config: AppConfig,
  messages: readonly ChatMessage[],
  tools?: readonly ChatTool[],
): Promise<ChatCompletion> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.OPENAI_API_KEY ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      messages,
      tools,
      tool_choice: tools === undefined ? undefined : "auto",
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed with HTTP ${response.status}: ${errorText}`);
  }

  const body: unknown = await response.json();
  return chatCompletionSchema.parse(body);
}

async function createMcpClient(
  config: AppConfig,
  req: IncomingMessage,
): Promise<Client> {
  const mcpUrl = getChatMcpUrl(config, req);
  const client = new Client({
    name: "solax-mobile-chat-agent",
    version: "0.0.1",
  });
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: {
      headers: {
        authorization: `Bearer ${config.MCP_HTTP_AUTH_TOKEN ?? ""}`,
      },
    },
  });

  await client.connect(transport);
  return client;
}

async function callMcpTool(
  client: Client,
  name: string,
  rawArguments: string,
): Promise<object> {
  const parsedArguments: unknown = JSON.parse(rawArguments);
  const result = await client.callTool({
    name,
    arguments: toolArgumentsSchema.parse(parsedArguments),
  });

  return result;
}

function getChatMcpUrl(config: AppConfig, req: IncomingMessage): URL {
  if (config.CHAT_MCP_URL !== undefined) {
    return new URL(config.CHAT_MCP_URL);
  }

  const forwardedProto = getHeader(req, "x-forwarded-proto");
  const proto = forwardedProto ?? "http";
  const host = req.headers.host ?? `${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}`;
  return new URL(config.MCP_HTTP_PATH, `${proto}://${host}`);
}

function isAuthorizedChatRequest(
  config: AppConfig,
  req: IncomingMessage,
): boolean {
  const expectedToken = config.CHAT_AUTH_TOKEN ?? config.MCP_HTTP_AUTH_TOKEN;

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

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
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

const chatPageHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SolaX Chat</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      body {
        margin: 0;
      }
      main {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        min-height: 100dvh;
        padding: 1rem;
      }
      h1 {
        font-size: 1.3rem;
        margin: 0;
      }
      #messages {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 0.75rem;
        overflow-y: auto;
      }
      .message {
        border-radius: 1rem;
        line-height: 1.45;
        padding: 0.75rem 0.9rem;
        white-space: pre-wrap;
      }
      .user {
        align-self: flex-end;
        background: #2563eb;
        color: white;
      }
      .assistant {
        align-self: flex-start;
        background: #1e293b;
      }
      .hidden {
        display: none;
      }
      form {
        display: flex;
        gap: 0.5rem;
      }
      input,
      button {
        border: 0;
        border-radius: 999px;
        font: inherit;
        padding: 0.85rem 1rem;
      }
      input {
        background: #1e293b;
        color: #e2e8f0;
        flex: 1;
        min-width: 0;
      }
      button {
        background: #22c55e;
        color: #052e16;
        font-weight: 700;
      }
      button:disabled {
        opacity: 0.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>SolaX Chat</h1>
      <section id="auth">
        <div class="message assistant">Enter access token to open the chat.</div>
        <form id="auth-form">
          <input id="token" autocomplete="off" inputmode="text" placeholder="Access token" />
          <button id="auth-send" type="submit">Unlock</button>
        </form>
      </section>
      <section id="chat" class="hidden">
      <section id="messages">
        <div class="message assistant">Ahoj. Zeptej se na baterku, výrobu, spotřebu nebo import/export ze sítě.</div>
      </section>
      <form id="form">
        <input id="message" autocomplete="off" placeholder="Jak jsme na tom s baterkou?" />
        <button id="send" type="submit">Send</button>
      </form>
      </section>
    </main>
    <script>
      const tokenKey = "solax-chat-token";
      let token = localStorage.getItem(tokenKey);

      const auth = document.getElementById("auth");
      const authForm = document.getElementById("auth-form");
      const tokenInput = document.getElementById("token");
      const authSend = document.getElementById("auth-send");
      const chat = document.getElementById("chat");
      const form = document.getElementById("form");
      const input = document.getElementById("message");
      const send = document.getElementById("send");
      const messages = document.getElementById("messages");

      function addMessage(kind, text) {
        const element = document.createElement("div");
        element.className = "message " + kind;
        element.textContent = text;
        messages.appendChild(element);
        element.scrollIntoView({ behavior: "smooth", block: "end" });
      }

      function showLogin(message) {
        token = null;
        localStorage.removeItem(tokenKey);
        chat.classList.add("hidden");
        auth.classList.remove("hidden");

        if (message) {
          addAuthMessage(message);
        }

        tokenInput.focus();
      }

      function showChat() {
        auth.classList.add("hidden");
        chat.classList.remove("hidden");
        input.focus();
      }

      function addAuthMessage(text) {
        const element = document.createElement("div");
        element.className = "message assistant";
        element.textContent = text;
        auth.insertBefore(element, authForm);
      }

      async function verifyToken(candidateToken) {
        const response = await fetch("/api/chat/auth", {
          method: "POST",
          headers: {
            authorization: "Bearer " + candidateToken,
            "content-type": "application/json",
          },
        });

        if (response.status === 401) {
          return false;
        }

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Token verification failed");
        }

        return true;
      }

      async function unlock(candidateToken) {
        authSend.disabled = true;

        try {
          const isValid = await verifyToken(candidateToken);

          if (!isValid) {
            showLogin("Invalid token. Try again.");
            return;
          }

          token = candidateToken;
          localStorage.setItem(tokenKey, candidateToken);
          showChat();
        } catch (error) {
          addAuthMessage("Verification failed: " + error.message);
        } finally {
          authSend.disabled = false;
        }
      }

      authForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const candidateToken = tokenInput.value.trim();

        if (!candidateToken) {
          return;
        }

        void unlock(candidateToken);
      });

      if (token) {
        void unlock(token);
      } else {
        showLogin();
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = input.value.trim();

        if (!text || !token) {
          return;
        }

        addMessage("user", text);
        input.value = "";
        send.disabled = true;

        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
              authorization: "Bearer " + token,
              "content-type": "application/json",
            },
            body: JSON.stringify({ message: text }),
          });
          const data = await response.json();

          if (response.status === 401) {
            showLogin("Invalid token. Try again.");
            return;
          }

          if (!response.ok) {
            throw new Error(data.error || "Request failed");
          }

          addMessage("assistant", data.answer || "(bez odpovědi)");
        } catch (error) {
          addMessage("assistant", "Chyba: " + error.message);
        } finally {
          send.disabled = false;
          input.focus();
        }
      });
    </script>
  </body>
</html>`;

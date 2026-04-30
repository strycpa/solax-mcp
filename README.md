# solax-mcp

`solax-mcp` is a TypeScript [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for reading live **photovoltaic (PV)** data from a **SolaX Hybrid G4 10k** inverter.

The server is intentionally read-only. It does not persist measurements and every tool call reads current values from the configured data source: local Modbus TCP or SolaX Cloud API.

## Capabilities

- Read the current battery state of charge.
- Read a compact PV system summary suitable for agents.
- Use local Modbus TCP when the inverter is reachable on LAN.
- Use SolaX Cloud API when running outside the inverter network.
- Read any known normalized field from the configured data source.
- Read arbitrary Modbus registers for diagnostics and mapping verification.
- Expose the active register map as an MCP resource.

## Requirements

- [Node.js](https://nodejs.org/) 20+ (see `.nvmrc` for the suggested version)
- [pnpm](https://pnpm.io/) 9+ (see `packageManager` in `package.json`; [Corepack](https://nodejs.org/api/corepack.html) can pin it for you)

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm build
```

Edit `.env` for your preferred data source. The `.env` file is ignored by git.

## Scripts

| Script           | Description                       |
| ---------------- | --------------------------------- |
| `pnpm dev`       | Run the MCP server from TypeScript |
| `pnpm build`     | Compile TypeScript to `dist/`     |
| `pnpm debug:cloud` | Debug SolaX Cloud API connectivity without MCP transport |
| `pnpm debug:modbus` | Debug local Modbus connectivity without MCP transport |
| `pnpm start`     | Run the compiled MCP server       |
| `pnpm typecheck` | Typecheck without emitting files  |

## Configuration

Default values target the local SolaX inverter over Modbus:

```bash
MCP_TRANSPORT=stdio
PV_DATA_SOURCE=modbus
SOLAX_INVERTER_MODEL="SolaX Hybrid G4 10k"
SOLAX_MODBUS_HOST=192.168.68.121
SOLAX_MODBUS_PORT=502
SOLAX_MODBUS_UNIT_ID=1
SOLAX_MODBUS_TIMEOUT_MS=5000
```

To use SolaX Cloud API instead:

```bash
MCP_TRANSPORT=stdio
PV_DATA_SOURCE=cloud
SOLAX_CLOUD_BASE_URL=https://global.solaxcloud.com
SOLAX_CLOUD_TOKEN_ID=...
SOLAX_CLOUD_WIFI_SN=...
SOLAX_CLOUD_TIMEOUT_MS=10000
```

`SOLAX_CLOUD_TOKEN_ID` is generated in SolaX Cloud and is sent as the `tokenId` request header. `SOLAX_CLOUD_WIFI_SN` is the registration number of the communication module/dongle (`wifiSn` in the API body), not necessarily the inverter serial number.

SolaX Cloud documents a request limit of roughly 10 calls per minute and 10,000 calls per day for `getRealtimeInfo`. Avoid aggressive polling from clients.

### MCP Transport

Local MCP clients should keep the default stdio transport:

```bash
MCP_TRANSPORT=stdio
```

For remote or containerized deployments, use the Streamable HTTP transport:

```bash
MCP_TRANSPORT=http
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3000
MCP_HTTP_PATH=/mcp
MCP_HTTP_AUTH_TOKEN=...
```

When `MCP_HTTP_PORT` is not set, the server uses the platform `PORT` value. This matches Google Cloud Run's runtime contract.

The HTTP server also exposes `GET /health` for container health checks and `GET /healthz` as a Kubernetes-style alias. The health endpoints are public, but the MCP endpoint requires:

```http
Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>
```

When `PV_DATA_SOURCE=cloud`, the Modbus-only diagnostic tool `read_pv_register` is not registered because Cloud Run cannot reach the inverter on the home LAN.

### Mobile Chat

HTTP mode also exposes a simple mobile-friendly chat UI at:

```text
https://<cloud-run-service-url>/chat
```

The browser UI stores an access token in local storage and calls `POST /api/chat`. The API requires a bearer token. Set `CHAT_AUTH_TOKEN` to use a separate mobile-chat token, or omit it to reuse `MCP_HTTP_AUTH_TOKEN`.

The chat backend uses OpenAI Chat Completions as the agent brain and calls PV tools through the public Streamable HTTP MCP endpoint. By default it connects back to this service's `MCP_HTTP_PATH`; set `CHAT_MCP_URL` to point it at a different public MCP endpoint.

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
# Optional; defaults to this service's /mcp endpoint.
CHAT_MCP_URL=https://<cloud-run-service-url>/mcp
# Optional; falls back to MCP_HTTP_AUTH_TOKEN.
CHAT_AUTH_TOKEN=...
```

### Separate Cloud Run Chat Service

For a cleaner demo topology, run the chat agent as a separate Cloud Run service that talks to the public MCP service:

```text
Mobile browser
  -> solax-mcp-chat /chat
  -> solax-mcp-chat /api/chat
  -> OpenAI Chat Completions
  -> solax-mcp /mcp
  -> SolaX Cloud
```

This repository includes `cloudbuild.chat.yaml` for the `solax-mcp-chat` service. The configured service uses:

```bash
MCP_TRANSPORT=http
PV_DATA_SOURCE=modbus
CHAT_MCP_URL=https://solax-mcp-nanpthbczq-ew.a.run.app/mcp
OPENAI_MODEL=gpt-4.1-mini
```

And these Secret Manager values:

```bash
MCP_HTTP_AUTH_TOKEN=solax-mcp-http-auth-token:latest
CHAT_AUTH_TOKEN=solax-chat-auth-token:latest
# Required before the chat can answer:
OPENAI_API_KEY=openai-api-key:latest
```

`MCP_HTTP_AUTH_TOKEN` is used by the chat agent to call the public MCP endpoint. `CHAT_AUTH_TOKEN` is the mobile browser access token.

## Google Cloud Run

This repository includes a Dockerfile for Cloud Run. The container defaults to HTTP MCP on `0.0.0.0` and reads Cloud Run's `PORT` automatically.

Build and deploy from the repository root:

```bash
gcloud run deploy solax-mcp \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars MCP_TRANSPORT=http,PV_DATA_SOURCE=cloud,SOLAX_CLOUD_BASE_URL=https://global.solaxcloud.com,OPENAI_MODEL=gpt-4.1-mini \
  --set-secrets MCP_HTTP_AUTH_TOKEN=solax-mcp-http-auth-token:latest,SOLAX_CLOUD_TOKEN_ID=solax-cloud-token-id:latest,SOLAX_CLOUD_WIFI_SN=solax-cloud-wifi-sn:latest,OPENAI_API_KEY=openai-api-key:latest
```

The MCP endpoint will be available at:

```text
https://<cloud-run-service-url>/mcp
```

Store `MCP_HTTP_AUTH_TOKEN`, `SOLAX_CLOUD_TOKEN_ID`, `SOLAX_CLOUD_WIFI_SN`, `OPENAI_API_KEY`, and optionally `CHAT_AUTH_TOKEN` in Secret Manager instead of plain environment variables.

To debug SolaX Cloud API connectivity without the MCP transport, run:

```bash
pnpm debug:cloud
```

The script loads `.env`, prints a redacted request summary, calls the raw HTTP API, and then calls the same cloud client/service classes used by the MCP tools.

To debug local Modbus connectivity without the MCP transport, run:

```bash
pnpm debug:modbus
```

The script loads `.env`, forces the Modbus provider, reads the default register map, compares decode variants for the grid meter register, and then calls the same service class used by the MCP tools.

## MCP Client Configuration

Build the project and point your MCP client at the compiled server:

```json
{
  "mcpServers": {
    "solax-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/solax-mcp/dist/index.js"],
      "env": {
        "SOLAX_INVERTER_MODEL": "SolaX Hybrid G4 10k",
        "PV_DATA_SOURCE": "modbus",
        "SOLAX_MODBUS_HOST": "192.168.68.121",
        "SOLAX_MODBUS_PORT": "502",
        "SOLAX_MODBUS_UNIT_ID": "1",
        "SOLAX_MODBUS_TIMEOUT_MS": "5000"
      }
    }
  }
}
```

Use `pnpm dev` for local development only. For MCP clients, prefer the compiled `dist/index.js` entry so stdout is reserved for MCP JSON-RPC messages.

### Codex CLI

This repository includes a project-local Codex configuration in `.codex/config.toml`. Codex can use it when started in this workspace:

```bash
pnpm build
codex -C /Users/strycpa/git/mcp/solax-mcp
```

Codex loads project-local `.codex/config.toml` only for trusted projects. If the MCP server does not appear in `/mcp`, mark this repository as trusted in `~/.codex/config.toml`:

```toml
[projects."/Users/strycpa/git/mcp/solax-mcp"]
trust_level = "trusted"
```

The MCP server process uses the repository root as its working directory, so `dotenv/config` loads local values from `.env`.

The project Codex configuration uses `workspace-write` sandbox mode with network access enabled because the MCP server must open a TCP connection to either the inverter (`SOLAX_MODBUS_HOST:SOLAX_MODBUS_PORT`) or SolaX Cloud API.

## MCP Interface

### Tools

- `get_pv_status`: reads the configured data source and returns a current system summary.
- `get_battery_soc`: reads only the battery state of charge (`battery_capacity`).
- `read_pv_field`: reads one known normalized field from the configured data source.
- `read_pv_register`: reads an arbitrary Modbus register for diagnostics. This tool always uses Modbus TCP.

### Resources

- `pv://register-map`: JSON representation of the default register map used by the server.

## Data Model

`get_pv_status` returns:

- `source`: provider, inverter model and connection metadata.
- `summary`: agent-friendly values such as battery SOC, PV power, grid import/export, home load, inverter voltage and inverter frequency.
- `readings`: field readings with decoded values. Modbus readings include register metadata and raw Modbus words; cloud readings include the SolaX Cloud API field name.

For example, an agent can call `get_battery_soc` to answer: "What is the current SOC of my PV battery?"

## Register Map

The default Modbus map targets **SolaX Hybrid G4 10k** and follows the SolaX hybrid GEN4 entities from [`wills106/homeassistant-solax-modbus`](https://github.com/wills106/homeassistant-solax-modbus), especially `custom_components/solax_modbus/plugin_solax.py`.

Key defaults:

| Field | Register | Type | Unit |
| --- | --- | --- | --- |
| Battery SOC | `0x1C` (`28`) | input `u16` | `%` |
| Battery power | `0x16` (`22`) | input `s16` | `W` |
| PV power 1 | `0x0A` (`10`) | input `u16` | `W` |
| PV power 2 | `0x0B` (`11`) | input `u16` | `W` |
| Measured grid power | `0x46` (`70`) | input `s32-swap` | `W` |
| Inverter voltage | `0x00` (`0`) | input `u16`, scale `0.1` | `V` |
| Inverter frequency | `0x07` (`7`) | input `u16`, scale `0.01` | `Hz` |

If a value does not match your inverter firmware, use `read_pv_register` to verify the raw register and then update `src/modbus/register-map.ts`.

For SolaX Cloud API, the server currently maps these response fields into the same normalized names:

| Normalized field | SolaX Cloud field |
| --- | --- |
| `battery_capacity` | `soc` |
| `battery_power_charge` | `batPower` |
| `pv_power_1` | `powerdc1` |
| `pv_power_2` | `powerdc2` |
| `inverter_power` | `acpower` |
| `measured_power` | `feedinpower` |

## Logging

The MCP transport uses stdout. Human-readable diagnostics must be written to stderr.

## License

This project is private (`"private": true` in `package.json`). Add a `LICENSE` file before publishing.

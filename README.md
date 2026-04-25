# solax-mcp

`solax-mcp` is a TypeScript [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for reading live **photovoltaic (PV)** data from a **SolaX Hybrid G4 10k** inverter over Modbus TCP.

The server is intentionally read-only. It does not persist measurements and every tool call reads current values directly from the inverter.

## Capabilities

- Read the current battery state of charge.
- Read a compact PV system summary suitable for agents.
- Read any known field from the default SolaX register map.
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

Edit `.env` if your Modbus endpoint differs from the defaults. The `.env` file is ignored by git.

## Scripts

| Script           | Description                       |
| ---------------- | --------------------------------- |
| `pnpm dev`       | Run the MCP server from TypeScript |
| `pnpm build`     | Compile TypeScript to `dist/`     |
| `pnpm start`     | Run the compiled MCP server       |
| `pnpm typecheck` | Typecheck without emitting files  |

## Configuration

Default values target the local SolaX inverter:

```bash
SOLAX_INVERTER_MODEL="SolaX Hybrid G4 10k"
SOLAX_MODBUS_HOST=192.168.68.121
SOLAX_MODBUS_PORT=502
SOLAX_MODBUS_UNIT_ID=1
SOLAX_MODBUS_TIMEOUT_MS=5000
```

## MCP Client Configuration

Build the project and point your MCP client at the compiled server:

```json
{
  "mcpServers": {
    "solax-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/solax-mcp/dist/index.js"],
      "env": {
        "SOLAX_MODBUS_HOST": "192.168.68.121",
        "SOLAX_INVERTER_MODEL": "SolaX Hybrid G4 10k",
        "SOLAX_MODBUS_PORT": "502",
        "SOLAX_MODBUS_UNIT_ID": "1",
        "SOLAX_MODBUS_TIMEOUT_MS": "5000"
      }
    }
  }
}
```

Use `pnpm dev` for local development only. For MCP clients, prefer the compiled `dist/index.js` entry so stdout is reserved for MCP JSON-RPC messages.

## MCP Interface

### Tools

- `get_pv_status`: reads the default register set and returns a current system summary.
- `get_battery_soc`: reads only the battery state of charge (`battery_capacity`).
- `read_pv_field`: reads one known field from the default register map.
- `read_pv_register`: reads an arbitrary Modbus register for diagnostics.

### Resources

- `pv://register-map`: JSON representation of the default register map used by the server.

## Data Model

`get_pv_status` returns:

- `source`: inverter model, host, port and Modbus unit ID.
- `summary`: agent-friendly values such as battery SOC, PV power, grid import/export, home load, inverter voltage and inverter frequency.
- `readings`: raw field readings with register address, data type, scale, decoded value and raw Modbus words.

For example, an agent can call `get_battery_soc` to answer: "What is the current SOC of my PV battery?"

## Register Map

The default map targets **SolaX Hybrid G4 10k** and follows the SolaX hybrid GEN4 entities from [`wills106/homeassistant-solax-modbus`](https://github.com/wills106/homeassistant-solax-modbus), especially `custom_components/solax_modbus/plugin_solax.py`.

Key defaults:

| Field | Register | Type | Unit |
| --- | --- | --- | --- |
| Battery SOC | `0x1C` (`28`) | input `u16` | `%` |
| Battery power | `0x16` (`22`) | input `s16` | `W` |
| PV power 1 | `0x0A` (`10`) | input `u16` | `W` |
| PV power 2 | `0x0B` (`11`) | input `u16` | `W` |
| Measured grid power | `0x46` (`70`) | input `s32` | `W` |
| Inverter voltage | `0x00` (`0`) | input `u16`, scale `0.1` | `V` |
| Inverter frequency | `0x07` (`7`) | input `u16`, scale `0.01` | `Hz` |

If a value does not match your inverter firmware, use `read_pv_register` to verify the raw register and then update `src/modbus/register-map.ts`.

## Logging

The MCP transport uses stdout. Human-readable diagnostics must be written to stderr.

## License

This project is private (`"private": true` in `package.json`). Add a `LICENSE` file before publishing.

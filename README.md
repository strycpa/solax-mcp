# solax-mcp

Repository for a future **TypeScript** [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that will expose **photovoltaic (FVE)** data to AI agents. This initial commit only adds project scaffolding (pnpm, TypeScript, env template, gitignore). MCP dependencies and server code will follow in later work.

## Requirements

- [Node.js](https://nodejs.org/) 20+ (see `.nvmrc` for the suggested version)
- [pnpm](https://pnpm.io/) 9+ (see `packageManager` in `package.json`; [Corepack](https://nodejs.org/api/corepack.html) can pin it for you)

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env — real credentials stay local only; .env is never committed
```

## Scripts

| Script           | Description                       |
| ---------------- | --------------------------------- |
| `pnpm build`     | Compile TypeScript to `dist/`     |
| `pnpm typecheck` | Typecheck without emitting files  |

## License

Private project (`"private": true` in `package.json`). Add a `LICENSE` file when you decide how to publish.

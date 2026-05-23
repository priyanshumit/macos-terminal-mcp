#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAll } from "./tools/register.js";

// Read package.json at runtime so serverInfo.version stays in sync with the
// shipped package. Works in dev (tsx src/index.ts → ../package.json) and from
// the installed npm package (dist/index.js → ../package.json).
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

const server = new McpServer(
  { name: "macos-terminal-mcp", version: pkg.version },
  { capabilities: { tools: {} } },
);

registerAll(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[macos-terminal-mcp] server ready on stdio\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[macos-terminal-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});

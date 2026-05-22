#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAll } from "./tools/register.js";

const server = new McpServer(
  { name: "macos-terminal-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

registerAll(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[macos-terminal-mcp] server ready on stdio\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`[macos-terminal-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

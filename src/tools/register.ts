import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as clear from "./clear.js";
import * as execute from "./execute.js";
import * as list from "./list.js";
import * as newTab from "./new_tab.js";
import * as pending from "./pending.js";
import * as read from "./read.js";
import * as safety from "./safety.js";

export function registerAll(server: McpServer): void {
  list.register(server);
  read.register(server);
  execute.register(server);
  clear.register(server);
  newTab.register(server);
  safety.register(server);
  pending.register(server);
}

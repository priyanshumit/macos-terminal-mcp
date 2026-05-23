import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as audit from "./audit.js";
import * as clear from "./clear.js";
import * as closeTab from "./close_tab.js";
import * as execute from "./execute.js";
import * as list from "./list.js";
import * as newTab from "./new_tab.js";
import * as pending from "./pending.js";
import * as read from "./read.js";
import * as safety from "./safety.js";
import * as waitForIdle from "./wait_for_idle.js";

export function registerAll(server: McpServer): void {
  // Terminal interaction
  list.register(server);
  read.register(server);
  execute.register(server);
  clear.register(server);
  newTab.register(server);
  closeTab.register(server);
  waitForIdle.register(server);
  // Safety policy
  safety.register(server);
  // Async approval queue
  pending.register(server);
  // Observability
  audit.register(server);
}

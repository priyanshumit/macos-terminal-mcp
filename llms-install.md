# Installation Guide for AI Agents

This file is for AI agents (Cline, Claude Code, Cursor, etc.) installing macos-terminal-mcp on the user's behalf. It is the canonical install path — prefer this over inferring from the README.

## What this server does

Exposes 11 MCP tools that let an AI agent inspect and drive the user's macOS Terminal.app:

- **Read tools** (no env required): `terminal_list`, `terminal_read`, `safety_list`, `pending_list`
- **Write tools** (gated by `WRITE_TOOLS_ENABLED=1` env): `terminal_execute`, `terminal_clear`, `safety_add`, `safety_remove`, `safety_set_level`, `pending_approve`, `pending_deny`

## Hard prerequisites

Before installing, verify all of these:

1. **OS is macOS** — this server only works on macOS (uses AppleScript / JXA via `osascript`).
2. **Node ≥ 20** — `node --version` must return v20.0.0 or higher.
3. **Terminal.app exists** — at `/System/Applications/Utilities/Terminal.app`. Stock macOS install.

If any check fails, **stop and report to the user** — do not install.

## Installation steps

### Step 1: Add the server to the MCP client config

Add to the appropriate config file (depends on the client):

| Client | Config path |
|---|---|
| Claude Code | `~/.claude.json` or `.mcp.json` in project |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` in project |
| Cline | The MCP marketplace handles this automatically |

Insert the following under `mcpServers`:

```json
{
  "mcpServers": {
    "macos-terminal": {
      "command": "npx",
      "args": ["-y", "@priyanshumit/macos-terminal-mcp"]
    }
  }
}
```

### Step 2: Ask the user about write tools

By default, **write tools are disabled** (the server can only inspect, not modify terminals).

Ask the user:

> "Do you want to allow this MCP server to also execute commands in your terminal and clear scrollback? This requires `WRITE_TOOLS_ENABLED=1` in the env. Every write call still triggers a native macOS confirmation dialog. If unsure, leave it disabled — you can enable later."

If yes, add an `env` block to the config:

```json
{
  "mcpServers": {
    "macos-terminal": {
      "command": "npx",
      "args": ["-y", "@priyanshumit/macos-terminal-mcp"],
      "env": { "WRITE_TOOLS_ENABLED": "1" }
    }
  }
}
```

### Step 3: Notify the user about macOS permissions

The first time the server controls Terminal.app, **macOS will pop a permission dialog**:

> *"node" wants access to control "Terminal".*

Tell the user:

> "On the first tool call, macOS will ask if you want to allow 'node' to control Terminal.app. Click **OK**. This is a one-time prompt; the setting is remembered under System Settings → Privacy & Security → Automation."

If they enabled write tools, also tell them:

> "When you first use `terminal_clear`, you'll also need to grant Accessibility permission under System Settings → Privacy & Security → Accessibility."

### Step 4: Recommend scrollback setting

For `terminal_read` to return meaningful history, ask the user to set Terminal.app's scrollback to a generous size:

> "Open Terminal.app → Settings → Profiles → your profile → Window → set 'Scrollback' to 'Unlimited' or a large number (10,000+). Otherwise `terminal_read` only returns what fits in the configured scrollback cap."

### Step 5: Restart the MCP client

After config changes, the client (Claude Code, Claude Desktop, etc.) must be restarted to pick up the new server.

### Step 6: Verify the install

After restart, call `terminal_list` as a smoke test. Expected behavior:

- **First call**: macOS permission dialog appears. User clicks OK.
- **Subsequent calls**: Returns a JSON array of all open Terminal.app tabs with `windowId`, `tty`, `title`, `busy`, `processes`.

If the call returns an error mentioning "not authorized", the user needs to grant Automation permission and retry.

## Default safety policy

Write tools (when enabled) evaluate every command against a three-tier policy:

- `safe` — auto-run, no confirmation. Includes common read-only commands: `ls`, `pwd`, `cat`, `git status`, `git log`, `git diff`, `npm test`, etc.
- `requires_approval` — native macOS confirmation dialog before running. Default for any command not matching a `safe` or `forbidden` pattern.
- `forbidden` — refused outright, no dialog can override. Includes `rm -rf`, `sudo`, `git push --force`, `curl ... | bash`, anything touching `/etc/passwd`, `~/.ssh`, etc.

The policy is **highest-restriction-wins**, so composite commands like `ls && rm -rf /tmp/x` correctly classify as forbidden even though `^ls` matches the safe list.

Users can customize via `safety_add` / `safety_remove` / `safety_set_level` tools (each pops a confirmation dialog) or by editing `~/.config/macos-terminal-mcp/safety.json` directly.

## Audit log

Every write tool call appends a JSONL entry to `~/.local/state/macos-terminal-mcp/audit.log` (or `$XDG_STATE_HOME/macos-terminal-mcp/audit.log` if set). Fields: `timestamp`, `tool`, `outcome`, `tty`, `command`, `level`, `matchedPattern`, `source`. Best-effort — failures don't block tool execution.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Server doesn't start | Check `node --version` is ≥ 20. Re-run config and restart client. |
| "not authorized" error | Grant Automation permission: System Settings → Privacy & Security → Automation. |
| `terminal_clear` does nothing | Grant Accessibility permission: System Settings → Privacy & Security → Accessibility. |
| `terminal_read` returns less than expected | Increase Terminal.app's scrollback in profile settings. |
| Write tool returns "disabled" | Add `"env": {"WRITE_TOOLS_ENABLED": "1"}` to the config. |
| Command refused as "forbidden" | The pattern is intentionally non-bypassable. Either run it yourself in a real terminal, or use `safety_set_level` to downgrade (with a clear warning dialog). |

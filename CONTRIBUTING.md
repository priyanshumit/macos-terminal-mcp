# Contributing

Thanks for considering a contribution. This file describes the dev setup, branch flow, and what makes a PR easy to merge.

## Dev setup

Requirements: macOS, Node ≥ 20, Terminal.app (the stock one).

```bash
git clone https://github.com/priyanshumit/macos-terminal-mcp.git
cd macos-terminal-mcp
npm install
npm run build
```

For iterative development:

```bash
npm run dev   # tsx watch — runs the server directly from src/
```

To run the locally-built server against your MCP client, point `.mcp.json` at `dist/index.js`:

```json
{
  "mcpServers": {
    "macos-terminal": {
      "command": "node",
      "args": ["/absolute/path/to/macos-terminal-mcp/dist/index.js"],
      "env": { "WRITE_TOOLS_ENABLED": "1" }
    }
  }
}
```

Restart your MCP client after editing `.mcp.json`.

## The gate every PR has to pass

CI runs lint + typecheck + tests + build on Node 20 and Node 22. Locally:

```bash
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc + chmod +x dist/index.js
```

`prepublishOnly` runs all four — the same gate as CI.

## Branch flow

`main` is protected. Direct pushes are blocked; PRs are required.

```bash
git checkout -b fix/short-description   # or feat/..., docs/..., chore/...
# ...changes...
git push -u origin fix/short-description
gh pr create --base main --title "..." --body "..."
```

Wait for CI green, then squash-merge.

## What makes a PR easy to land

- **Scoped.** One concern per PR. Race fix + new feature + doc cleanup = three PRs.
- **Tested.** If you touch a tool's JXA, add or update a string-shape test in `tests/tools/`. If you touch handler logic, mock `runJxa` and assert on call shapes.
- **Honest CHANGELOG entry.** New section under `## [Unreleased]` describing what changed and why. We follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
- **No unrelated reformatting.** Biome auto-fixes its own style; please don't touch other code for cosmetic reasons in the same PR.

## Testing JXA changes against real Terminal.app

The unit tests mock `runJxa`, so they catch refactoring drift but not runtime behavior. If you change JXA, **live-test before opening the PR**:

1. `npm run build` to refresh `dist/`
2. Restart your MCP client so it picks up the new `dist/index.js`
3. Exercise the changed tool against real Terminal.app
4. For destructive operations (`terminal_close_tab`, `terminal_clear`): test multi-tab and single-tab windows separately

A dedicated `npm run test:integration` that drives real Terminal.app is on the roadmap (see CHANGELOG v0.6.2 "Known unfixed"). Contributions there are very welcome.

## Reporting bugs / asking for features

Use the issue templates in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/) — they're forms, not blank text areas. Free-form questions or "is this the right approach?" discussions belong in [Discussions](https://github.com/priyanshumit/macos-terminal-mcp/discussions).

## Security

If you find a vulnerability (path traversal in safety patterns, audit log permission bypass, dialog-injection escape, etc.), **please don't file a public issue**. Email the maintainer or use GitHub's private vulnerability reporting from the Security tab.

## Code of Conduct

This project follows the [Contributor Covenant v2.1](./CODE_OF_CONDUCT.md). Be kind, be specific, assume good faith.

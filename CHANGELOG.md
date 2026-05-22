# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-05-22

### Added
- **Timeouts on all `osascript` invocations** via a new `timeoutMs` option on `runJxa` / `runJxaJson` (default 30s, SIGKILL on expiry, returns `OsascriptError{timedOut: true}`).
- **Auto-dismiss for confirmation dialogs** via JXA `givingUpAfter` (default 300s, treats as denial).
- **Audit log** for every write tool call (`terminal_execute`, `terminal_clear`, `safety_add/remove/set_level`, `pending_approve/deny`). Writes JSONL entries to `~/.local/state/macos-terminal-mcp/audit.log` (or `$XDG_STATE_HOME/...`). Best-effort — log failures never block tool execution.
- **GitHub Actions CI** running lint + typecheck + tests + build on Node 20 and 22 matrix.
- **Biome 2.4.15** as the linter/formatter, with `npm run lint`, `lint:fix`, `format` scripts and enforcement via `prepublishOnly`.
- **Integration tests for the four `terminal_*` tools** in `tests/tools/` (23 tests, including a regression guard for the `$.usleep` bug fixed in this release).

### Changed
- Tool handlers extracted as standalone exported functions (`listHandler`, `readHandler`, `executeHandler`, `clearHandler`) — enables direct unit testing without going through the MCP SDK's registration machinery.
- `prepublishOnly` now runs `lint && typecheck && test && build` (previously only `test && build`).

### Fixed
- `terminal_clear` no longer uses `$.usleep` (which is not exposed by `ObjC.import("stdlib")` on current macOS). Switched to `delay()` from Standard Additions.

## [0.2.0] - 2026-05-22

### Added
- Initial public release.
- **Eleven MCP tools across three categories**:
  - `terminal_list`, `terminal_read`, `terminal_execute`, `terminal_clear`
  - `safety_list`, `safety_add`, `safety_remove`, `safety_set_level`
  - `pending_list`, `pending_approve`, `pending_deny`
- **Three-tier safety model**: `safe` (auto-run), `requires_approval` (confirmation dialog), `forbidden` (refused outright).
- **Highest-restriction-wins evaluator** to guard against composite-command bypasses like `ls && rm -rf /tmp/x`.
- **Native macOS confirmation dialogs** via JXA `displayDialog`, gated by `WRITE_TOOLS_ENABLED=1` env var.
- **Async approval queue** racing in parallel with the dialog — `terminal_execute` enqueues and can be resolved via dialog *or* `pending_approve`/`pending_deny`.
- **v1 → v2 safety config schema migration** for users with an older `safety.json`.
- **Vitest test suite** covering safety evaluator + queue lifecycle (24 tests).
- **NPM-publish-ready packaging**: scoped name `@priyanshumit/macos-terminal-mcp`, shebang preserved, executable bit set, `publishConfig.access: public`, `files: ["dist", "README.md", "LICENSE"]`.
- MIT license, comprehensive README with setup, permissions, scrollback config, three-tier safety reference, troubleshooting.

[Unreleased]: https://github.com/priyanshumit/macos-terminal-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/priyanshumit/macos-terminal-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/priyanshumit/macos-terminal-mcp/releases/tag/v0.2.0

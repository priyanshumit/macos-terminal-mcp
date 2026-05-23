# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.2] - 2026-05-23

### Fixed

- **`serverInfo.version` reflects the actual package version.** The MCP `initialize` handshake response used to report a hardcoded `"0.1.0"` regardless of the published version. Now reads from `package.json` at startup so it stays in sync automatically. Surfaced during the v0.5.1 post-publish smoke test.

## [0.5.1] - 2026-05-23

Live end-to-end testing of v0.5.0 immediately after release surfaced one shipped-broken tool and three uncovered code paths. This is the fix + regression coverage.

### Fixed

- **`terminal_new_tab` actually creates a new tab now.** v0.5.0 implemented this via `terminal.doScript("", { in: wins[0] })`, which silently no-ops on current macOS — the call returned a reference to an existing tab, whose `tty()` the handler dutifully returned. The tool claimed success while creating nothing. Patched to use System Events `Cmd+T` (or `Cmd+N` when no Terminal window exists), with a before/after snapshot of all tab ttys to identify the actually-new tab. Errors out with an Accessibility-permission hint if no new tab appears within ~2s. As a side effect, `terminal_new_tab` now also requires Accessibility permission (same as `terminal_clear`); the tool description was updated to call this out.

### Internal

- **Test coverage backfill.** Three v0.5.0 code paths shipped without tests; this release adds them:
  - `tests/applescript.test.ts` (new file): 5 tests for `runJxa`'s `AbortSignal` plumbing (pre-aborted no-spawn, mid-flight SIGKILL, normal completion with listener cleanup, post-settle abort no-op, `aborted` vs `timedOut` distinction). The reviewer-#4 fix shipped in v0.5.0 with this code path untested.
  - `tests/tools/execute.test.ts`: 2 tests for the queue/dialog race (`dialogAbort.abort()` fires when queue resolves first; signal stays untouched when the dialog wins).
  - `tests/tools/new_tab.test.ts`: 3 tests asserting the JXA uses System Events keystroke (not the broken `doScript("")`), uses the before/after-snapshot pattern, and surfaces the Accessibility-missing error. The original v0.5.0 tests mocked `runJxa` away, which is why the empty-`doScript` no-op was never caught — these tests now lock the JXA shape.
- Test count: 83 → **93** (10 new regression tests).
- Lint passes; `prepublishOnly` continues to gate on lint + typecheck + tests + build.

### Known minor issue

- **New tab sometimes opens as a new window** rather than as a tab in the frontmost window, due to a race between `terminal.activate()` and the `keystroke("t")` delivery. The returned `{tty, windowId}` is correct regardless and the agent gets a working idle tty either way, so this is cosmetic. Will be addressed in a follow-up by inserting a small post-activate delay.

## [0.5.0] - 2026-05-23

Reviewer-driven release: a real user spent an hour using v0.4.0 and reported four findings. All four are addressed here.

### Added

- **`terminal_new_tab` tool** — opens an empty tab in Terminal.app (in the front window, or a new window if none are open) and returns `{tty, windowId}` so subsequent `terminal_read` / `terminal_execute` calls can target it. Requires `WRITE_TOOLS_ENABLED=1` but does NOT pop a confirmation dialog (low blast radius — the user can close an unwanted tab). Lets agents spawn safe scratch tabs without asking the user to do it manually.
- **`terminal_execute` busy-tab check** — before running `do script`, the target tab's `busy` state is probed via JXA. If busy with a running foreground command, the call refuses by default. New `force: true` parameter bypasses the check for the rare case where you intentionally want to send stdin to a running process. Without this, `do script` would silently type into the foreground process's stdin, which the README promised would be "as if typed by the user" but in practice produced confusing results.
- **`terminal_execute` `dry_run` parameter** — when true, returns the safety verdict + what would happen as JSON, with zero side effects (no busy probe, no dialog, no enqueue, no audit log entry, no command execution). Useful for harnesses (or models) probing a call before allowing the real version.

### Fixed

- **Dialog dismisses when queue resolves out-of-band** — if `pending_approve` or `pending_deny` resolves a queued command while its native dialog is still open, the dialog now auto-dismisses (SIGKILL on the underlying osascript child) instead of dangling. The user no longer sees a stale dialog asking about an already-resolved call. Implemented via a new optional `signal: AbortSignal` on `confirmWithUser` and `runJxa`, threaded from `terminal_execute`'s queue/dialog race.

### Internal

- `OsascriptError` gains an `aborted` flag distinct from `timedOut`. `runJxa` and `runJxaJson` accept an `AbortSignal` via `RunJxaOptions.signal`.
- Test count: 73 → **83** (10 new regression tests across `tests/tools/execute.test.ts` and the new `tests/tools/new_tab.test.ts`).
- Reviewer finding #5 (regex compilability validation) was already addressed in v0.4.0 via `regexErrorReason` in `tools/safety.ts`; no code change needed.

### Not changed

- **Reviewer finding #3 (Claude Code harness permission race)** — this is mostly external. The MCP protocol doesn't expose a tool-call cancellation primitive we can listen on, and defensive measures (artificial delay before dialog, separate ack step) cost real UX latency for a corner case. The `dry_run` parameter added in this release partially addresses the reviewer's "expose a dry-run mode" suggestion by letting harnesses probe what a call would do without side effects.

## [0.4.0] - 2026-05-23

This is a security-hardening release driven by an end-to-end audit of the v0.3.0 codebase. Six findings (one HIGH, three MEDIUM, two LOW) are addressed; one LOW finding was deliberately deferred (see CHANGELOG for v0.5.x roadmap).

### Security

- **[HIGH] ReDoS guard** — `safety_add` now rejects regex patterns with catastrophic-backtracking constructs (nested quantifiers, overlapping repeats, ambiguous alternations) using the `safe-regex` npm package. `normalizeConfig` filters such patterns at load time with a stderr warning. Without this, a single malicious pattern in `safety.json` could hang the MCP server's event loop on every `terminal_execute` call.
- **[MEDIUM] Audit log permissions tightened** — `~/.local/state/macos-terminal-mcp/audit.log` is now created with mode `0o600` (owner read/write only) and its parent directory with mode `0o700`. Pre-existing wider permissions are tightened on every write. Closes a local-user information disclosure where command text (potentially containing secrets) was world-readable.
- **[MEDIUM] Dialog injection guard** — AI-supplied strings (command, pattern, description, reason, matched-pattern metadata) embedded in confirmation dialogs are now passed through a `sanitizeAiText` helper that replaces C0 control characters (newlines, CR, tabs, NUL, DEL, etc.) with spaces. Prevents a model from injecting fake "Queue id:" or "Approval: GRANTED" lines inside dialog message templates.
- **[MEDIUM] TOCTOU race fixed** — `safety_add` / `safety_remove` / `safety_set_level` now re-read the safety config from disk immediately after dialog approval, before writing. Previously, two concurrent mutators with overlapping 5-minute dialogs could silently clobber each other's changes. If the file has changed in a way that conflicts with the current change, the tool now returns an error suggesting the user re-run.
- **[LOW] Unicode homoglyph normalization** — `evaluateCommand` calls `command.normalize("NFKC")` before pattern evaluation. Closes the `ｒｍ -rf` (fullwidth Unicode) bypass of `\brm\s+-rf?\b`.
- **[LOW] Audit timestamp hardened** — `appendAudit` no longer accepts a caller-supplied timestamp (type-level removal plus spread-order ensures the server-generated timestamp wins even against type-cast bypasses).

### Deferred (not in this release)

- **[LOW] Defense-in-depth against external `safety.json` replacement** — adding a hardcoded never-overridable forbidden list. Deferred because if a local process can write to `~/.config/macos-terminal-mcp/`, it can equally write to `node_modules/`. The fix's cost (architectural complexity around "which forbidden list wins") exceeds the marginal threat-model benefit. Will revisit if threat model changes.

### Internal

- Added `safe-regex` dependency.
- Test count: 53 → **73** (20 new regression tests across `tests/safety/patterns.test.ts`, `tests/safety/audit.test.ts`, and the new `tests/safety/confirm.test.ts`).
- Lint passes; `prepublishOnly` continues to gate on lint + typecheck + tests + build.

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

[Unreleased]: https://github.com/priyanshumit/macos-terminal-mcp/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/priyanshumit/macos-terminal-mcp/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/priyanshumit/macos-terminal-mcp/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/priyanshumit/macos-terminal-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/priyanshumit/macos-terminal-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/priyanshumit/macos-terminal-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/priyanshumit/macos-terminal-mcp/releases/tag/v0.2.0

# KILLDOZER Agent Handoff

This guide describes the current working tree, including local changes, as of
2026-09-12. Read `AGENTS.md` for project instructions; use the source paths below
to verify behavior before changing it. This is an orientation guide, not a full
API reference.

## Start Here

- Use `pnpm`. The README's npm examples are older than the project guidelines.
- Inspect `git status --short` before editing; preserve existing local work.
- When codebase-memory MCP is available, confirm the project/generation with
  `list_projects` or `index_status`. Prefer `search_graph`, `trace_path`, and
  `get_code_snippet` for code discovery. Check every evidence path with
  `check_index_coverage`; read source directly for stale, excluded, or missing
  coverage. Use `rg` for literals/configuration or insufficient graph results.
- In environments configured with RTK, prefix shell commands with `rtk`;
  `rtk proxy <command>` preserves raw output. Commands below omit that wrapper.

## Run and Check

The stack is Tauri 2 / Rust, strict TypeScript, Vite, xterm.js, and Three.js.
The frontend uses direct DOM manipulation. CI uses Node 24 and pnpm 11.
Desktop builds need Rust and the platform's Tauri system dependencies; actual
connections need `ssh` on PATH and SOCKS5 proxy connections also need `ncat`.

| Task                       | Command from repo root                            |
| -------------------------- | ------------------------------------------------- |
| Install dependencies       | `pnpm install --frozen-lockfile`                  |
| Desktop development        | `pnpm tauri dev`                                  |
| Frontend server only       | `pnpm dev`                                        |
| Typecheck + frontend build | `pnpm build`                                      |
| Desktop bundle             | `pnpm tauri build`                                |
| Bridge and autologin tests | `pnpm test:basic-bridge`                          |
| Rust tests                 | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Check one document         | `pnpm exec prettier --check AGENT.md`             |

Vite uses strict port 1420, also configured in `src-tauri/tauri.conf.json`.
A browser-only server does not supply the native APIs used during app startup.
Test mode is enabled by backend `--test-server`/`test` arguments or
`VITE_TEST_SERVER=1`; it mocks connection/write behavior. Automation pause is a
separate setting in `src/core/test-mode.ts`.

`package.json` is authoritative for scripts. `pnpm format` rewrites the whole
repository; prefer formatting changed files. The pre-commit hook invokes
lint-staged for Prettier, rustfmt, and clang-format. Some local tests are ignored:
inspect `.gitignore` and actual files before assuming a clean checkout has them.
The local `tests/terminal/*.test.ts` tests run with
`node --experimental-strip-types --test tests/terminal/*.test.ts`.

## Module Map

| Area           | Entry points and responsibility                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup        | `index.html` loads `src/app/main.ts`: test mode, bridge, events, workspace, drawers, window controls, theme, updater, latency, companion, then automation.                   |
| Pane model     | `src/terminal/pane.ts`: xterm instance, fit/resize, connection state, session ID, cheat state, and automation lock.                                                          |
| Workspace      | `src/terminal/workspace.ts`: tabs, binary split trees, focus, pane creation/removal, keyboard routing. Shared shapes are in `src/core/types.ts`.                             |
| Transport      | `src/terminal/shell.ts`: connect/write/disconnect IPC. `src/terminal/events.ts`: global PTY listeners routed to panes.                                                       |
| Shutdown       | `src/terminal/cleanup.ts` releases locks and disconnects panes; `src/app/window-shutdown.ts` waits for cleanup before destroying the window and deduplicates close requests. |
| Automation     | `src/cheat/registry.ts` defines catalog/configuration; `pencilgon.ts` discovers handlers and dispatches hooks; `input.ts` / `output.ts` provide terminal helpers.            |
| Cheat UI       | `src/cheat/ui.ts`, `dropdown.ts`, `filter.ts`: cards, configuration, search, filtering.                                                                                      |
| Profiles       | `src/profiles/profiles.ts`: named connection profiles and serialized cheat settings.                                                                                         |
| Appearance     | `src/ui/` owns chrome, drawers, theme, latency, updater. `src/css/styles.css` imports component styles; `src/ui/theme.ts` maps Base24 schemes to CSS/xterm colors.           |
| Companion      | `src/dozer/dozer.ts`: Three.js companion rendering and interaction.                                                                                                          |
| Native backend | `src-tauri/src/main.rs`: PTY sessions, SSH children, latency probing, IPC registration, save dialog, DES-crypt commands. Algorithm code lives in `src-tauri/src/descrypt/`.  |

## Session and Persistence Rules

- The target is `telehack.com:2222` in `src/core/types.ts`. Each pane owns its
  connection and cheats; use the supplied pane throughout an operation.
- `connectShell` inserts the generated session ID into `panesBySession` before
  invoking `async_create_shell`: `pty:ready` can arrive before the invoke resolves.
- Rust emits `pty:ready`, `pty:data`, `pty:latency`, `pty:exit`, and `pty:error`.
  Keep payloads consistent with `src/core/types.ts` and route by `sessionId`.
  Data is written to xterm, passed to Basic bridge, then dispatched to cheats.
- Raw `onData` runs before xterm necessarily finishes parsing. Use `onTermChange`
  for parsed-buffer inspection; the pane debounces this hook by 25 ms.
- Use `cloneConnection` / `cloneCheatState` when duplicating panes. Startup
  restores a default tab, not the previous tabs and split layout.
- localStorage keys: `shell-settings` (default proxy settings), `cheat-settings`
  (default cheat state), `connection-profiles` (named snapshots), and
  `base24-scheme` (theme). Cheat UI saves app defaults only for `pane.isDefault`.
  Credentials are currently stored in plaintext settings; avoid exposing them
  in documentation or debug output.
- Saved cheats match category, cheat name, and config label. Renaming those
  values can lose restored settings; account for compatibility explicitly.

## Add or Modify a Cheat

1. Read a neighboring implementation under `src/cheat/module/`. Current catalog
   categories are `Automation`, `Utils`, `Game`, and `Misc`.
2. Add a module and a `Cheat` declaration in `builtinCheats()` in `registry.ts`.
   Configuration supports `input`, `label`, `checker`, `radio`, `slider`, and
   `button`; standard controls are rendered automatically.
3. Export the required `CheatHandler` hooks from `pencilgon.ts`: `onToggle`,
   `onConnect`, `onDisconnect`, `onData`, `onTermChange`, `onKey`,
   `onConfigChange`, or `onTick`.
4. Modules are eagerly discovered by `import.meta.glob("./module/**/*.ts")`.
   Filename aliases are normalized; export `CHEAT_NAME` for explicit naming.
   Manual handler imports are unnecessary. Keep aliases distinct across folders.
5. For terminal transactions, acquire `pane.busy` before awaiting and release it
   in `finally`. Keep per-pane state and bounded waits; handle disable/disconnect
   for long-running work. The tick loop awaits handlers sequentially, so a slow
   handler delays other panes despite the nominal 250 ms interval.
6. Use `input.send`, `sendkey`, `type`, or `th_exec` and the output helpers.
   `send` respects Safe/Turbo modes unless `raw=true`. `th_exec` temporarily
   changes scrollback/PTY dimensions and restores them in `finally`.
   `waitFor`, `waitStill`, and `waitChange` return `false` on timeout; check it.
   Preserve `isCheatEvaluationPaused()` guards in dispatch paths.

## Basic Bridge

Read `src/cheat/basicbridge-protocol.ts` for framing and `basicbridge.ts` for the
per-pane runtime. `basicbridge-app.ts` connects it to terminal input, pause state,
and the Basic bridge toggle. Development/Test Mode exposes `window.basicBridge`
for feeding frames and inspecting snapshots/captures.

Capabilities currently live in `src/cheat/telebasic/*.ts`, exporting `entries`
with `alias` and `fn`. `basicbridge-registry.ts` discovers them with Vite and
forms IDs as `<filename>.<alias>`. It also maintains explicit fallback imports
for Node tests; update those when a new module must work outside Vite.

Keep remote requests restricted to registered capabilities. Use the context's
pane and abort signal, validate arguments, and preserve credential permission
checks. Protocol sequence numbers do not authenticate the remote program.
`tests/basic-bridge/` covers protocol, runtime, capabilities, capture, registry,
console, and autologin behavior.

`docs/telebasic-bridge.md` provides protocol examples, but its static-registration
and `.bas`-only directory guidance predates the current discovery implementation.
Use the registry and `src/cheat/telebasic/README.md` for the current layout.

## Completion and Releases

Run checks appropriate to the changed area and report results and gaps. For
transport changes, exercise connect/disconnect, pane isolation, and window close
in Tauri; frontend compilation alone does not verify SSH or native cleanup.

For releases, inspect `scripts/release.sh` and `.github/workflows/tauri.yaml`.
The workflow publishes Linux/Windows artifacts on `v*` tags. Keep versions in
`package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` aligned.
Keep generated output (`dist/`, `src-tauri/target/`, generated Tauri schemas)
out of manual edits unless the task requires regenerating it.

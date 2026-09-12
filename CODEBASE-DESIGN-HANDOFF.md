# KILLDOZER codebase design handoff

Reviewed September 12, 2026 against the current working tree, based on commit `adc2ea7`. This includes substantial existing modified and untracked work, especially Basic bridge and shutdown changes. This review adds only this document; it does not implement the recommendations.

The largest opportunity is to make session and automation lifetime explicit. Today callers must coordinate mutable pane state, locks, asynchronous hooks, terminal parsing, and reconnects themselves. The folder split provides navigation, but these shared obligations weaken module depth and locality.

## Current design and strengths

| Module                  | Current interface and ownership                                                                                    | Assessment                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Pane                    | Public terminal, DOM, connection, session ID, cheat state, and busy flag; creates xterm and performs native resize | Convenient integration point, but exposes unrelated policies to automation callers         |
| Shell and events        | Connect/write/disconnect functions plus separately registered native event callbacks                               | Session transitions and cleanup are spread across two implementations                      |
| Pencilgon               | Discovers handlers, resolves names, dispatches hooks, and scans all panes                                          | Small hook list hides significant scheduling and lifecycle obligations                     |
| Terminal input/output   | Sends text/keys and reads or polls xterm buffers                                                                   | Useful leverage, but completion, cancellation, and session identity remain caller concerns |
| Basic bridge            | Generic runtime with `ingest`, `reset`, capture access, and injected execution/output                              | Strong existing seam for testing protocol behavior; lifetime implementation needs repair   |
| Registry and profiles   | Mutable cheat catalog, label-based settings, localStorage serialization                                            | UI convenience is coupled to persisted identity and runtime types                          |
| Native session registry | Tauri commands over a shared map of PTYs and SSH children                                                          | Owns native resources, but synchronous work under a shared lock couples sessions           |

Preserve the Basic bridge runtime's dependency injection and per-pane state. Its options already support production and test adapters without requiring DOM setup. Preserve the small shutdown interface in `src/app/window-shutdown.ts:1`: callers supply disconnect and destruction operations, while the module owns ordering and duplicate requests. These provide better models for depth than creating more pass-through files.

## Prioritized findings

Priority P1 means observable incorrect lifecycle behavior or a high-impact failure mechanism. P2 means an interface/design defect worth addressing incrementally. Static risks below are distinguished from reproduced failures.

### 1. P1 — Basic bridge reset does not own the lifetime of queued calls

**Evidence:** `src/cheat/basicbridge.ts:108`, `:215`, and `:268`. Each accepted CALL creates a controller and overwrites `runtime.controller`. Reset aborts only that last controller and deletes the state map entry. Existing queue closures retain the old runtime. `finishCall` executes the capability before checking cancellation; its reply guard checks the old runtime's run ID, which reset does not invalidate.

**Reproduced:** Queue two callback calls, hold the first execution, reset the pane, then release the first. The first sends `<run|2|OK>\r` after reset; the second capability is invoked with an already-aborted signal. The new snapshot reports `idle` despite old work continuing. This was exercised through the runtime's public interface with an in-memory adapter, without changing repository code.

**Design change:** Make the runtime own one run lifetime, including all queued work. Invalidate that lifetime on reset, check it before starting a capability and before writing a response, and pass its signal through operations that can suspend. `src/cheat/telebasic/auth.ts:22` currently receives a signal but does not forward it to its autologin runner. Already-started side effects need cooperative cancellation; a response guard alone cannot stop them. Define END behavior explicitly too: it currently permits ending while execution is in flight.

**Acceptance:** Reset during two queued calls prevents the second from starting and suppresses the first reply; a subsequent run is unaffected by old completions; cancellation reaches a waiting autologin operation. Keep these tests at `BasicBridgeRuntime`'s interface.

### 2. P1 — Automation scheduling and cleanup share the wrong eligibility rules

**Evidence:** `src/cheat/pencilgon.ts:145` skips busy panes, paused evaluation, disabled cheats, and running cheats. `dispatchDisconnect` at `:259` uses this same helper. Native exit/error handlers call it from `src/terminal/events.ts:46`, but a busy pane can therefore skip its cleanup hook. Explicit disconnect in `src/terminal/shell.ts:127` clears the busy flag and resets the bridge without dispatching cheat disconnect hooks. Toggle/config dispatch at `pencilgon.ts:222` and `:237` calls potentially asynchronous handlers inside synchronous try/catch, leaving promise rejections unhandled by that catch.

The tick loop at `pencilgon.ts:172` awaits each handler across all panes. A slow handler delays unrelated panes. Autologin demonstrates a real suspending tick: `src/cheat/module/automation/autologin.ts:199` can wait for a password prompt. This is a source-confirmed scheduling mechanism; no live multi-pane timing benchmark was performed.

**Design change:** Let one automation module own per-pane scheduling, active operation cancellation, and hook error handling. Cleanup must run independently of evaluation eligibility. Schedule panes independently while serializing terminal transactions within each pane. Keep pause checks on evaluation, and define pause behavior for operations already running. Replace manual unlock-on-reload behavior with cancellation and an ownership-aware release; setting `busy=false` does not finish old work.

**Acceptance:** A held tick in pane A does not block pane B; disconnect reaches active cleanup once even while busy or paused; rejected asynchronous toggle/config hooks are reported; an old completion cannot release a newer operation's ownership.

### 3. P1 — A pane reference is not a stable session identity

**Evidence:** `src/terminal/pane.ts:60` exposes mutable `sessionId`, `state`, `busy`, terminal, DOM, and cheats. `writeToPty` in `src/terminal/shell.ts:56` reads the pane's current session ID on every write. The typing loop in `src/cheat/input.ts:122` retains only a pane across delays. Disconnect at `shell.ts:127` unlocks it but does not cancel that loop.

**Consequence:** If a pane reconnects while an older typing operation is suspended, subsequent characters can target its new session. This is a source-derived race scenario, not a live SSH reproduction. Similarly, `connectShell`'s catch at `shell.ts:114` unconditionally clears the pane's session state; it does not confirm that the failed attempt still owns the pane before mutating it.

**Design change:** Put the session seam behind a module that owns connection attempts, routing registration, termination, and a generation token. Automation transactions capture that generation and fail or cancel when it changes. Present only the terminal operations and state needed by automation; keep DOM rendering and chrome updates outside that interface. Use Tauri and in-memory transport adapters, both justified by existing production and test behavior.

**Acceptance:** Reconnect during delayed typing produces no old-generation writes; a late failure from attempt A cannot clear connected attempt B; explicit close and native exit converge on the same cleanup contract. Preserve registration before native create invocation, since ready can arrive before invocation resolves.

### 4. P2 — The native registry lock includes blocking session work

**Evidence:** `src-tauri/src/main.rs:28` defines one mutex for the session map. `async_write_to_pty` at `:364` keeps that guard during synchronous `write_all` and `flush`; resize at `:382` also holds it during native work. `create_shell_inner` at `:183` combines PTY allocation, SSH command construction, registration, reader-thread creation, and latency-prober setup.

**Consequence:** A blocked PTY write can delay access to other sessions, including termination and reader cleanup. This follows from lock scope; no native blocking-write benchmark was run. Splitting `main.rs` into files alone would not fix the ownership problem.

**Design change:** Keep the map lock limited to lookup/insert/remove of independently owned session handles. Serialize each session's I/O locally and move blocking native operations off asynchronous executor work as appropriate. A native session module should own child, reader, and prober lifetime; Tauri command functions should adapt its interface. Retain a single implementation until tests require a second adapter.

**Acceptance:** Holding one session's writer does not prevent another session from writing or terminating. Closing during creation and normal EOF have defined resource cleanup behavior. Verify with native tests and a Tauri connect/disconnect/window-close exercise.

### 5. P2 — Command helpers erase the outcomes callers need

**Evidence:** `src/terminal/shell.ts:56` resolves without sending when disconnected and catches/logs native write errors. `src/cheat/input.ts:150` exposes `th_exec` as output lines, but ignores the boolean from `waitStill` at `:189`; resize failures are also swallowed. `src/cheat/output.ts:78` detects a changed viewport becoming quiet, rather than recognizing a command-completion prompt.

**Consequence:** A caller cannot distinguish successful output from timeout/partial output or a failed write through the current interface. The caller also has to arrange locking and understand temporary scrollback/size changes. The existing `finally` restoration is useful, but it does not establish transaction ownership.

**Design change:** Deepen the existing command module into an operation that owns session identity, exclusive terminal access, temporary terminal settings, cancellation, and explicit outcomes. Return output with a completion result such as completed/timed-out/cancelled, and propagate transport errors. Define whether completion means a recognized prompt or merely quiescence. Keep timing controls internal unless callers actually need them.

**Acceptance:** Failed writes are observable; timeouts preserve partial output with a timeout outcome; temporary settings restore on every exit; ordinary resize cannot override an active transaction's size policy; delayed output is not silently classified as successful completion.

### 6. P2 — Capability discovery imports application state into the test seam

**Evidence:** `src/cheat/basicbridge-registry.ts:1` imports the workspace, eagerly imports fallback capabilities, discovers Vite modules, populates a global registry at import time, and unlocks all panes during reload. The Node fallback at `:44` only surrounds `import.meta.glob`; it cannot handle static imports failing before module evaluation.

**Observed test failures:** `pnpm test:basic-bridge` exits 1 on the installed Node v26.8.1. Seven test files pass and three fail to load:

- `capabilities.test.ts`: extensionless `./telebasic/auth` in `src/cheat/basicbridge-capabilities.ts:1`.
- `log-capture.test.ts`: extensionless `../basicbridge` in `src/cheat/telebasic/log.ts:2`.
- `registry.test.ts`: extensionless `../terminal/workspace` in `src/cheat/basicbridge-registry.ts:2`.

These are loading failures, not failed behavioral assertions. The first blocked imports do not prove the remainder of each import chain is Node-compatible.

**Design change:** Make registry construction a deterministic function over supplied capability entries, including duplicate-ID validation. Keep Vite discovery and HMR wiring in application composition. Tests provide entries directly; a production discovery check verifies the actual catalog. Use a consistent supported import convention or the project's intended test loader across the full dependency chain. Registry reload should not mutate unrelated pane ownership.

**Acceptance:** The documented test command loads every test; a registry test requires neither DOM nor workspace initialization; production discovery and the tested catalog agree; reload does not unlock an active terminal operation.

### 7. P2 — Display labels double as persisted identity and untyped configuration

**Evidence:** `src/cheat/registry.ts:156` serializes category, cheat name, and config label; `applySaved` at `:173` matches those exact strings and assigns saved values without checking option kind/range. `Cheat.getValue` at `:41` returns `any`. `src/profiles/profiles.ts:48` accepts either runtime or serialized state and detects the shape by looking for a `getValue` function.

**Consequence:** A display rename changes persistence compatibility, invalid stored values reach handlers, and callers must know serialization details. The serialization also includes all config values, including Autologin's password; shell and profile persistence likewise include proxy passwords. This is existing storage behavior, not evidence of external access.

**Design change:** Give cheats/options stable IDs separate from labels and introduce a versioned settings decoder that validates values and migrates legacy names. Accept one clearly defined snapshot shape at the profile interface. Keep storage access at one seam with localStorage and in-memory adapters. Decide credential persistence separately and represent secrets explicitly instead of treating them as ordinary presentation settings.

**Acceptance:** Renaming labels retains settings; malformed values cannot escape decoding; migration preserves existing profile behavior; profile round-trips do not require constructing UI objects. Credential policy has explicit tests.

## Suggested implementation order

1. Repair test loading and make the bridge reset reproduction a regression test. Fix run cancellation before adding bridge capabilities.
2. Centralize session-generation checks and cleanup; migrate the typing/command path first. Preserve existing local changes throughout.
3. Move automation scheduling and transaction ownership behind that seam. Add cross-pane fairness and disconnect tests, then remove redundant manual lock management as callers migrate.
4. Isolate native session I/O and verify actual desktop shutdown/connect behavior.
5. Migrate persisted IDs/schema independently, with legacy fixtures. Avoid coupling a storage migration to the lifecycle refactor.

Do not introduce a generic plugin framework, event bus, or dependency-injection container for these changes. Deepen the existing modules at the points where behavior already varies. Replace tests that only mirror old forwarding helpers once equivalent behavior is covered through the owning module's interface.

## Verification and evidence limits

- Tier 2 review using graph project `run-media-kiwi-Data-Github-killdozer`, generation `2026-09-12T08:57:00Z`. Task-directed searches and depth-one traces were completed without outstanding result pages.
- Coverage checks covered the cited source/config/test paths. Indexed paths reported metadata matches and no recorded gaps. `tests/terminal` is excluded; both test files were read directly. A clean coverage result is not proof of completeness.
- Graph traces contained false symbol resolutions, including native `invoke` resolving into network-map JSON and handler `run` into vendored Draco code. Those edges and graph-derived fan counts were not used as design evidence. Material findings use exact source reads, supplemented by the bridge reproduction.
- `rtk pnpm test:basic-bridge`: failed, seven passing test files and three import-loading failures as detailed above.
- `rtk proxy node --experimental-strip-types --test tests/terminal/shell.test.ts tests/terminal/window-shutdown.test.ts`: passed both test files. These exercise cleanup helpers and shutdown ordering; they do not establish native transport correctness.
- `.gitignore` excludes `tests/terminal`, and `package.json`'s bridge test script does not include it. Preserve these useful tests in the tracked test workflow during lifecycle work; current local success does not make them available to a fresh checkout.
- No production code was changed. Frontend build, Rust tests, live SSH, and visual testing were not run for this document-only review. UI/theme/companion internals, game solvers, DES-crypt implementation, and network-map algorithms were not deeply audited. Findings are prioritized design observations, not an exhaustive defect inventory.

## Reproduce finding 1

Run from the repository root. This uses only local code and emits no real terminal input:

```bash
rtk proxy node --experimental-strip-types --input-type=module <<'NODE'
import { BasicBridgeRuntime } from './src/cheat/basicbridge.ts';
const pane = {};
const calls = [], replies = [];
let release;
const gate = new Promise(resolve => { release = resolve; });
const runtime = new BasicBridgeRuntime({
  isEnabled: () => true,
  isPaused: () => false,
  executeCapability: async (context, capability) => {
    calls.push({ capability, aborted: context.signal.aborted });
    if (capability === 'first') await gate;
    return { ok: true };
  },
  writeResponse: async (_, response) => { replies.push(response); }
});
runtime.ingest(pane,
  '<run|1|BEGIN>\n<run|2|CALL|first|callback>\n<run|3|CALL|second|callback>\n');
await new Promise(resolve => setImmediate(resolve));
runtime.reset(pane, 'disconnect');
release();
await new Promise(resolve => setImmediate(resolve));
console.log(JSON.stringify({ calls, replies, snapshot: runtime.snapshot(pane).state }));
NODE
```

Observed result: first capability starts with `aborted:false`, second starts with `aborted:true`, replies contains `<run|2|OK>\r`, and snapshot is `idle`. After a correct repair, the second capability should not start and replies should be empty.

# Project Agent Guidelines: KILLDOZER

This document provides instructions for AI agents working on the KILLDOZER codebase, specifically detailing the architecture, cheat automation system, conventions, and step-by-step instructions for adding new cheats.

---

## 1. Project Overview & Architecture

KILLDOZER is a Tauri-based desktop terminal & automation tool targeting Telehack and BBS-style interactive environments.
* **Frontend**: TypeScript + Vite + xterm.js (`src/`)
* **Backend**: Rust + Tauri (`src-tauri/`) owning the PTY, SSH child processes, and native OS bridges.
* **Package Manager**: Always use `pnpm` (never `npm` or `yarn`).

---

## 2. Cheat System Architecture

The cheat system manages terminal interactions per pane using a multi-event lifecycle and evaluation loop.

```
src/cheat/
├── registry.ts               # Cheat definitions, configuration schema, built-in catalogs & persistence
├── pencilgon.ts              # CheatHandler interface, CHEAT_HANDLERS map, event dispatchers, and onTick loop
├── input.ts                  # Input synthesis (send, sendkey, human typing delay, th_exec)
├── output.ts                 # Terminal output inspection (getCurrentLine, getLastLines, waitFor, waitStill)
├── dropdown.ts               # Cheat search / dropdown UI
├── filter.ts                 # Cheat categorization and filtering logic
├── ui.ts                     # Dynamic UI rendering for cheat cards, controls, and configuration drawer
└── module/                   # Cheat execution implementations
    ├── automation/           # Automation cheats (e.g., autologin.ts, autovon.ts, porthack.ts)
    ├── game/                 # Game solver cheats (e.g., sudoku.ts, 2048.ts, typespeed.ts)
    └── misc/                 # Miscellaneous cheats (e.g., killdozer.ts)
```

---

## 3. CheatHandler Interface & Lifecycle Hooks

Cheats implement the `CheatHandler` interface (`src/cheat/pencilgon.ts`):

```typescript
export interface CheatHandler {
  /** Lifecycle: Triggered when user toggles the cheat on or off */
  onToggle?(pane: Pane, cheat: Cheat, enabled: boolean): Promise<void> | void;

  /** Lifecycle: Triggered when shell session connects */
  onConnect?(pane: Pane, cheat: Cheat): Promise<void> | void;

  /** Lifecycle: Triggered when shell session disconnects / exits */
  onDisconnect?(pane: Pane, cheat: Cheat): Promise<void> | void;

  /** Stream: Triggered immediately on incoming PTY output chunks */
  onData?(pane: Pane, cheat: Cheat, data: string): Promise<void> | void;

  /** Input: Triggered on user keystrokes in xterm */
  onKey?(pane: Pane, cheat: Cheat, key: string): Promise<void> | void;

  /** Config: Triggered immediately when user updates a slider, input, or toggle */
  onConfigChange?(pane: Pane, cheat: Cheat, label: string, value: any): Promise<void> | void;

  /** Periodic: Evaluated every 250ms on the orchestrator loop (skips if pane.busy) */
  onTick?(pane: Pane, cheat: Cheat): Promise<void> | void;
}
```

---

## 4. Step-by-Step: How to Append a New Cheat

Follow these exact steps whenever implementing a new cheat:

### Step 1: Create the Cheat Module File
Create `src/cheat/module/<category>/<cheat_name>.ts` (e.g., `src/cheat/module/game/sudoku.ts`).

* **Export lifecycle hooks as needed** (e.g. `onTick`, `onData`, `onToggle`, `onConfigChange`).
* **Protect Terminal Concurrency with `pane.busy`**: Set `pane.busy = true` while interacting / awaiting prompts and ensure `pane.busy = false` is restored (preferably in a `try...finally` block).
* **Inspect Terminal Output**: Use helper utilities from `src/cheat/output.ts`:
  * `stdout.getCurrentLine(pane)`: Returns the current active line text.
  * `stdout.getLastLines(pane, n)`: Returns the last `n` lines from the terminal buffer.
  * `stdout.waitFor(pane, pattern, timeout?, lineCount?, pollInterval?)`: Awaits string or regex matching in terminal.
  * `stdout.waitStill(pane, timeout?, pollInterval?)`: Awaits terminal buffer stabilization.
* **Synthesize Terminal Input**: Use helper utilities from `src/cheat/input.ts`:
  * `stdin.send(pane, text)`: Sends raw text (e.g., `"command\r"`).
  * `stdin.sendkey(pane, key, { ctrl, alt })`: Sends special keys (e.g., `"Enter"`, `"Backspace"`, `"Esc"`).
  * `stdin.type(pane, text, options)`: Types with realistic human cadence and variable delay.
  * `stdin.th_exec(pane, command)`: Sends command and collects output lines until next prompt.
* **Read Configuration Options**:
  * `cheat.getValue("Option Label")`: Retrieves config value (`string`, `number`, `boolean`).
  * `cheat.getConfigByLabel("Option Label")`: Retrieves full `ConfigOption` object.

#### Example Cheat Module (`src/cheat/module/automation/example.ts`):
```typescript
import type { Pane } from "../../../pane";
import type { Cheat } from "../../registry";
import * as stdout from "../../output";
import * as stdin from "../../input";

export async function onTick(pane: Pane, cheat: Cheat): Promise<void> {
  const currentLine = stdout.getCurrentLine(pane);

  // Check if terminal matches trigger prompt
  if (currentLine.includes("Select option:")) {
    pane.busy = true;
    try {
      const speed = (cheat.getValue("Speed") as number) ?? 50;
      await stdin.send(pane, "1\r");
      await stdout.waitFor(pane, "Done", 5000);
    } finally {
      pane.busy = false;
    }
  }
}
```

---

### Step 2: Register in Cheat Registry (`src/cheat/registry.ts`)
Add the cheat declaration into `builtinCheats()` under the appropriate category (`Automation`, `Game`, or `Misc`):

```typescript
new Cheat("ExampleCheat", "Brief description of what the cheat does.", [
  { type: "slider", label: "Speed", min: 1, max: 100, value: 50 },
  { type: "checker", label: "Auto-Restart", value: true },
  { type: "input", label: "Target", value: "guest" },
  { type: "radio", label: "Mode", options: ["Fast", "Safe"], value: "Fast" },
])
```

#### Supported `ConfigOption` Types:
* `input`: Text input field (`value: string`).
* `checker`: Boolean toggle checkbox (`value: boolean`).
* `slider`: Numeric range slider (`min`, `max`, `step`, `value: number`).
* `radio`: Option selector (`options: string[]`, `value: string`).
* `label`: Informational display row.

---

### Step 3: Registration & Hot Reload (Automatic)
* **Auto-Discovery & HMR**: All files placed under `src/cheat/module/**/*.ts` are **automatically discovered and hot-reloaded** at runtime via Vite HMR in [`src/cheat/pencilgon.ts`](file:///run/media/kiwi/Data/Github/killdozer/src/cheat/pencilgon.ts).
* **Naming Resolution**: Handlers are automatically mapped by matching the filename (e.g. `sudoku.ts` -> `Sudoku`, `safe_mode.ts` -> `Safe mode`).
* **Explicit Name (Optional)**: If the cheat registry name differs from the filename, you can export `CHEAT_NAME` or `name` in the module:
  ```typescript
  export const CHEAT_NAME = "Custom Name";
  ```
* Manual imports in `pencilgon.ts` are **not** needed.

---

### Step 4: UI & State Persistence (Automatic)
* The UI card, toggle switch, and configuration drawer are rendered dynamically by `src/cheat/ui.ts`.
* Settings and toggles are automatically serialized to `localStorage` per pane and saved across sessions by `src/cheat/registry.ts`.
* No manual HTML or CSS changes are required when adding new standard cheats.

---

## 5. Key Rules for Cheat Implementations
1. **Never block the orchestrator loop indefinitely**:
   * Always set timeouts on `waitFor` and handle potential match timeouts.
   * Release `pane.busy = false` on failure or timeout.
2. **Never cross-contaminate panes**:
   * Every operation must take `pane: Pane` and operate only on that pane's session (`pane.term`, `pane.busy`, `pane.cheats`).
3. **Respect Test Mode**:
   * `isCheatEvaluationPaused()` in `src/test-mode.ts` is checked before dispatching. Do not bypass this check.

import type { Pane } from "../pane";
import type { Cheat } from "./registry";
import { allPanes } from "../workspace";
import { sleep } from "../gadget";
import { isCheatEvaluationPaused } from "../test-mode";
export const INTERVAL = 250; // milliseconds

export interface CheatHandler {
  onToggle?(pane: Pane, cheat: Cheat, enabled: boolean): Promise<void> | void;
  onConnect?(pane: Pane, cheat: Cheat): Promise<void> | void;
  onDisconnect?(pane: Pane, cheat: Cheat): Promise<void> | void;
  onData?(pane: Pane, cheat: Cheat, data: string): Promise<void> | void;
  onTermChange?(pane: Pane, cheat: Cheat): Promise<void> | void;
  onKey?(pane: Pane, cheat: Cheat, key: string): Promise<void> | void;
  onConfigChange?(
    pane: Pane,
    cheat: Cheat,
    label: string,
    value: any,
  ): Promise<void> | void;
  onTick?(pane: Pane, cheat: Cheat): Promise<void> | void;
}

export interface CheatModuleExports extends CheatHandler {
  name?: string;
  CHEAT_NAME?: string;
  displayName?: string;
  default?: CheatHandler;
}

// Reuse handlers map across Vite HMR evaluations so ongoing loops/dispatchers keep the same object reference
export const CHEAT_HANDLERS: Record<string, CheatHandler> =
  (typeof window !== "undefined" && (window as any).__CHEAT_HANDLERS) || {};
if (typeof window !== "undefined") {
  (window as any).__CHEAT_HANDLERS = CHEAT_HANDLERS;
}

function toCanonicalKey(str: string): string {
  return str.toLowerCase().replace(/[\s_-]+/g, "");
}

/** Dynamically register or update a cheat handler at runtime */
export function registerCheatHandler(
  name: string,
  handler: CheatHandler,
): void {
  CHEAT_HANDLERS[name] = handler;
  CHEAT_HANDLERS[name.toLowerCase()] = handler;
  CHEAT_HANDLERS[toCanonicalKey(name)] = handler;
}

function registerAllModules(modules: Record<string, CheatModuleExports>): void {
  for (const key of Object.keys(CHEAT_HANDLERS)) {
    delete CHEAT_HANDLERS[key];
  }

  for (const [path, mod] of Object.entries(modules)) {
    const explicitName = mod.CHEAT_NAME || mod.name || mod.displayName;
    const filenameMatch = path.match(/\/([^/]+)\.ts$/);
    const filename = filenameMatch ? filenameMatch[1] : "";

    const handler = (
      mod.default && typeof mod.default === "object" ? mod.default : mod
    ) as CheatHandler;

    if (explicitName) {
      registerCheatHandler(explicitName, handler);
    }
    if (filename) {
      registerCheatHandler(filename, handler);
      const humanized = filename
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase());
      registerCheatHandler(humanized, handler);
    }
  }
}

// Auto-discover and eagerly load all current and future cheat scripts inside /cheat/module/**
const cheatModules = import.meta.glob<CheatModuleExports>("./module/**/*.ts", {
  eager: true,
});
registerAllModules(cheatModules);

/** Force reload all cheat modules and update CHEAT_HANDLERS in-place */
export function reloadCheatModules(): Record<string, CheatHandler> {
  const fresh = import.meta.glob<CheatModuleExports>("./module/**/*.ts", {
    eager: true,
  });
  registerAllModules(fresh);

  // Auto-unlock any pane left stuck in busy state
  for (const pane of allPanes()) {
    pane.busy = false;
  }

  const registeredKeys = Object.keys(CHEAT_HANDLERS);
  console.log(
    `[Pencilgon] Reloaded cheat modules (${registeredKeys.length} aliases registered):`,
    registeredKeys,
  );
  return CHEAT_HANDLERS;
}

export const reloadCheats = reloadCheatModules;

if (typeof window !== "undefined") {
  const w = window as any;
  w.reloadCheats = reloadCheatModules;
  w.reloadCheatModules = reloadCheatModules;
}

// Vite Hot Module Replacement (HMR) for all cheat scripts
if (import.meta.hot) {
  import.meta.hot.accept();
}

const runningCheats = new WeakSet<Cheat>();

function getHandler(cheat: Cheat): CheatHandler | undefined {
  return (
    CHEAT_HANDLERS[cheat.name] ??
    CHEAT_HANDLERS[cheat.name.toLowerCase()] ??
    CHEAT_HANDLERS[toCanonicalKey(cheat.name)]
  );
}

function disableConflictingInputMode(pane: Pane, cheat: Cheat): void {
  if (
    !cheat.enabled ||
    (cheat.name !== "Turbo mode" && cheat.name !== "Safe mode")
  )
    return;

  const conflictingName =
    cheat.name === "Turbo mode" ? "Safe mode" : "Turbo mode";
  for (const cheats of Object.values(pane.cheats)) {
    const conflictingCheat = cheats.find(
      (candidate) => candidate.name === conflictingName,
    );
    if (conflictingCheat) conflictingCheat.enabled = false;
  }
}

function forEachEnabledCheat(
  pane: Pane,
  fn: (cheat: Cheat, handler: CheatHandler) => Promise<void> | void,
): void {
  if (isCheatEvaluationPaused() || pane.busy) return;
  for (const cat of Object.keys(pane.cheats)) {
    for (const cheat of pane.cheats[cat]) {
      if (!cheat.enabled || pane.busy || runningCheats.has(cheat)) continue;
      const handler = getHandler(cheat);
      if (handler) {
        try {
          const res = fn(cheat, handler);
          if (res instanceof Promise) {
            runningCheats.add(cheat);
            res
              .catch((e) => console.error(`Error in cheat ${cheat.name}:`, e))
              .finally(() => runningCheats.delete(cheat));
          }
        } catch (e) {
          console.error(`Error in cheat ${cheat.name}:`, e);
        }
      }
    }
  }
}

/** Scans every pane; each pane's enabled cheats run onTick against that pane only. */
export async function cheatsOrchestrator(): Promise<void> {
  while (true) {
    if (!isCheatEvaluationPaused()) {
      for (const pane of allPanes()) {
        if (pane.state !== "connected" || pane.busy) continue;
        for (const cat of Object.keys(pane.cheats)) {
          for (const cheat of pane.cheats[cat]) {
            if (!cheat.enabled || pane.busy || runningCheats.has(cheat))
              continue;
            const handler = getHandler(cheat);
            const run = handler?.onTick;
            if (run) {
              runningCheats.add(cheat);
              try {
                await run(pane, cheat);
              } catch (e) {
                console.error(`Error in ${cheat.name}.onTick:`, e);
              } finally {
                runningCheats.delete(cheat);
              }
            }
          }
        }
      }
    }
    await sleep(INTERVAL);
  }
}

export function dispatchData(pane: Pane, data: string): void {
  if (pane.state !== "connected" || pane.busy) return;
  forEachEnabledCheat(pane, (cheat, handler) =>
    handler.onData?.(pane, cheat, data),
  );
}

export function dispatchTermChange(pane: Pane): void {
  if (pane.state !== "connected" || pane.busy) return;
  forEachEnabledCheat(pane, (cheat, handler) =>
    handler.onTermChange?.(pane, cheat),
  );
}

export function dispatchKey(pane: Pane, key: string): void {
  if (pane.state !== "connected" || pane.busy) return;
  forEachEnabledCheat(pane, (cheat, handler) =>
    handler.onKey?.(pane, cheat, key),
  );
}

export function dispatchToggle(
  pane: Pane,
  cheat: Cheat,
  enabled: boolean,
): void {
  if (isCheatEvaluationPaused()) return;
  disableConflictingInputMode(pane, cheat);
  const handler = getHandler(cheat);
  try {
    handler?.onToggle?.(pane, cheat, enabled);
  } catch (e) {
    console.error(`Error in ${cheat.name}.onToggle:`, e);
  }
}

export function dispatchConfigChange(
  pane: Pane,
  cheat: Cheat,
  label: string,
  value: any,
): void {
  if (isCheatEvaluationPaused()) return;
  console.log(`[ConfigChange] ${cheat.name} -> ${label} =`, value);
  const handler = getHandler(cheat);
  try {
    handler?.onConfigChange?.(pane, cheat, label, value);
  } catch (e) {
    console.error(`Error in ${cheat.name}.onConfigChange:`, e);
  }
}

export function dispatchConnect(pane: Pane): void {
  forEachEnabledCheat(pane, (cheat, handler) =>
    handler.onConnect?.(pane, cheat),
  );
}

export function dispatchDisconnect(pane: Pane): void {
  forEachEnabledCheat(pane, (cheat, handler) =>
    handler.onDisconnect?.(pane, cheat),
  );
}

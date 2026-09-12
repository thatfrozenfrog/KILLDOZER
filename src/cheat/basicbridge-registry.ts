import type { Pane } from "../terminal/pane";
import type {
  BridgeCallResult,
  BridgeCapabilityContext,
} from "./basicbridge.ts";
import * as authMod from "./telebasic/auth.ts";
import * as logMod from "./telebasic/log.ts";
import * as nmapMod from "./telebasic/nmap.ts";

export interface BridgeFunctionEntry {
  id: string;
  name?: string;
  description?: string;
  fn: (
    context: BridgeCapabilityContext<Pane>,
    arguments_: readonly string[],
  ) => Promise<BridgeCallResult>;
}

export interface CheatCapabilityEntry {
  alias: string;
  name?: string;
  description?: string;
  fn: (
    context: BridgeCapabilityContext<Pane>,
    arguments_: readonly string[],
  ) => Promise<BridgeCallResult>;
}

export type TelebasicEntry = CheatCapabilityEntry;

const fallbackModules: Record<string, any> = {
  "./telebasic/auth.ts": authMod,
  "./telebasic/log.ts": logMod,
  "./telebasic/nmap.ts": nmapMod,
};

// Preserve existing array reference across Vite HMR re-evaluations
export const BRIDGE_REGISTRY: BridgeFunctionEntry[] =
  (typeof window !== "undefined" && (window as any).__BRIDGE_REGISTRY) || [];
if (typeof window !== "undefined") {
  (window as any).__BRIDGE_REGISTRY = BRIDGE_REGISTRY;
}

/** Refreshes and updates BRIDGE_REGISTRY in-place by scanning telebasic modules */
export function reloadBridgeRegistry(): BridgeFunctionEntry[] {
  let modules: Record<string, any> = {};
  try {
    modules = import.meta.glob("./telebasic/**/*.ts", { eager: true });
  } catch {
    // Non-Vite environments (e.g. Node test runner)
  }
  if (!modules || Object.keys(modules).length === 0) {
    modules = fallbackModules;
  }

  const entries: BridgeFunctionEntry[] = [];

  for (const [path, mod] of Object.entries(modules)) {
    const filenameMatch = path.match(/\/([^/]+)\.ts$/);
    if (!filenameMatch) continue;
    const cheatName = filenameMatch[1];
    const moduleEntries: CheatCapabilityEntry[] =
      (mod as any).entries ??
      (mod as any).default?.entries ??
      (Array.isArray((mod as any).default) ? (mod as any).default : []) ??
      [];

    for (const entry of moduleEntries) {
      if (!entry.alias || typeof entry.fn !== "function") continue;
      entries.push({
        id: `${cheatName}.${entry.alias}`,
        name: entry.name,
        description: entry.description,
        fn: entry.fn,
      });
    }
  }

  BRIDGE_REGISTRY.length = 0;
  BRIDGE_REGISTRY.push(...entries);

  console.log(
    `[BasicBridge] Registry loaded/reloaded (${BRIDGE_REGISTRY.length} capabilities):`,
    BRIDGE_REGISTRY.map((e) => e.id),
  );
  return BRIDGE_REGISTRY;
}

// Initial populate
reloadBridgeRegistry();

if (typeof window !== "undefined") {
  (window as any).reloadBridgeRegistry = reloadBridgeRegistry;
}

// Vite Hot Module Replacement (HMR) to prevent full page reloads on edit
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    reloadBridgeRegistry();
  });
}

export function findBridgeFunction(
  id: string,
): BridgeFunctionEntry | undefined {
  return BRIDGE_REGISTRY.find((entry) => entry.id === id);
}

export async function executeBridgeFunction(
  context: BridgeCapabilityContext<Pane>,
  id: string,
  arguments_: readonly string[],
): Promise<BridgeCallResult> {
  const entry = findBridgeFunction(id);
  if (!entry) {
    return { ok: false, error: "unknown-capability" };
  }
  return entry.fn(context, arguments_);
}

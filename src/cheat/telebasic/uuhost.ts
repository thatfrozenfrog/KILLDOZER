import type { Pane } from "../../terminal/pane";
import type { BridgeCallResult, BridgeCapabilityContext } from "../basicbridge";
import type { CheatCapabilityEntry } from "../basicbridge-registry";
import { invoke } from "@tauri-apps/api/core";

export async function findPath(
  context: BridgeCapabilityContext<Pane>,
  arguments_: readonly string[],
): Promise<BridgeCallResult> {
  const src = arguments_[0];
  const dst = arguments_[1];

  if (!src || !dst) {
    return { ok: false, error: "invalid-state" };
  }
  if (src === dst) {
    return { ok: false, error: "same-host" };
  }

  try {
    const route = await invoke<string[]>("find_shortest_path", {
      fromHost: src,
      toHost: dst,
    });
    console.log(`[TeleBASIC] Shortest path from "${src}" to "${dst}":`, route);
    return { ok: true, data: Array.isArray(route) ? route.join("!") : route };
  } catch (error) {
    console.error(
      `[TeleBASIC] Error finding path from "${src}" to "${dst}":`,
      error,
    );
    return { ok: false, error: String(error) };
  }
}

export const entries: CheatCapabilityEntry[] = [
  { alias: "path", fn: findPath },
];

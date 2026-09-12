import type { Pane } from "../../terminal/pane";
import {
  getBasicBridgeSnapshot,
  type BridgeCallResult,
  type BridgeCapabilityContext,
} from "../basicbridge.ts";
import type { CheatCapabilityEntry } from "../basicbridge-registry";

/**
 * Bridge integration function that logs captured terminal text to console.log.
 *
 * Usage from TeleBASIC:
 *   PRINT "[[KD1|test|4|CALL|log.capture|demo]]"
 * or without arguments to log all captures:
 *   PRINT "[[KD1|test|4|CALL|log.capture]]"
 */
export async function runLogCapture(
  context: BridgeCapabilityContext<Pane>,
  arguments_: readonly string[],
): Promise<BridgeCallResult> {
  const captureName = arguments_[0];

  if (captureName) {
    const lines = context.getCapture(captureName);
    console.log(`[TeleBASIC] Capture "${captureName}":`, lines ?? []);
  } else {
    const snapshot = getBasicBridgeSnapshot(context.pane);
    console.log("[TeleBASIC] Captures:", Object.fromEntries(snapshot.captures));
  }

  return { ok: true };
}

export const entries: CheatCapabilityEntry[] = [
  { alias: "capture", fn: runLogCapture },
];

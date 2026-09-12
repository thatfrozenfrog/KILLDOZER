import type { Pane } from "../../../terminal/pane.ts";
import type { Cheat } from "../../registry.ts";
import { resetBasicBridge } from "../../basicbridge.ts";

export const CHEAT_NAME = "Basic bridge";

export function onToggle(pane: Pane, _cheat: Cheat, enabled: boolean): void {
  if (!enabled) resetBasicBridge(pane, "disabled");
}

export function onDisconnect(pane: Pane): void {
  resetBasicBridge(pane, "disconnect");
}

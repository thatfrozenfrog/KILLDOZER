import type { Pane } from "../../../terminal/pane";
import type { Cheat } from "../../registry";
import { refreshChrome } from "../../../ui/chrome";

export function onToggle(_pane: Pane, _cheat: Cheat, _enabled: boolean): void {
  refreshChrome();
}

export function onConfigChange(
  _pane: Pane,
  _cheat: Cheat,
  _label: string,
  _value: any,
): void {
  refreshChrome();
}

import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../../../pane";
import type { Cheat } from "../../registry";
import { renderCheatDrawer } from "../../ui";

export function applySpoof(pane: Pane, cheat: Cheat): void {
  if (!cheat.enabled) return;
  const rows = Math.max(2, Math.round(Number(cheat.getValue("Rows")) || 24));
  const cols = Math.max(2, Math.round(Number(cheat.getValue("Cols")) || 80));

  // Send spoofed window size to the remote backend PTY only
  if (pane.state === "connected" && pane.sessionId) {
    void invoke("async_resize_pty", {
      sessionId: pane.sessionId,
      rows,
      cols,
    }).catch(() => {});
  }
}

export function onToggle(pane: Pane, cheat: Cheat, enabled: boolean): void {
  if (enabled) {
    applySpoof(pane, cheat);
  } else {
    pane.refitNow();
  }
}

export function onConfigChange(pane: Pane, cheat: Cheat, label: string, _value: any): void {
  if (label.toLowerCase() === "set to default") {
    const dims = pane.fitAddon.proposeDimensions();
    const rows = dims?.rows && dims.rows >= 2 ? dims.rows : 24;
    const cols = dims?.cols && dims.cols >= 2 ? dims.cols : 80;

    const rowsCfg = cheat.getConfigByLabel("Rows");
    if (rowsCfg) rowsCfg.value = String(rows);
    const colsCfg = cheat.getConfigByLabel("Cols");
    if (colsCfg) colsCfg.value = String(cols);


    if (cheat.enabled) {
      applySpoof(pane, cheat);
    }
    return;
  }

  if (label === "Rows" || label === "Cols") {
    if (cheat.enabled) {
      applySpoof(pane, cheat);
    }
  }
}

export function onConnect(pane: Pane, cheat: Cheat): void {
  if (cheat.enabled) {
    applySpoof(pane, cheat);
  }
}

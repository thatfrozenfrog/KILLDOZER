import type { Pane } from "../pane";
import type { Cheat } from "./registry";
import { allPanes } from "../workspace";
import { sleep } from "../gadget";
import * as autologin from "./module/automation/autologin";

export const INTERVAL = 250; // milliseconds

/** Scans every pane; each pane's enabled cheats run against that pane only. */
export async function cheatsOrchestrator(): Promise<void> {
  console.log("[DEBUG] cheatsOrchestrator running");
  while (true) {
    for (const pane of allPanes()) {
      if (pane.state !== "connected" || pane.busy) continue;
      for (const category of Object.keys(pane.cheats)) {
        for (const cheat of pane.cheats[category]) {
          if (!cheat.enabled) continue;
          try {
            await tick(pane, cheat);
          } catch (e) {
            console.error(`Error in cheat ${cheat.name}:`, e);
          }
        }
      }
    }
    await sleep(INTERVAL);
  }
}

async function tick(pane: Pane, cheat: Cheat): Promise<void> {
  switch (cheat.name) {
    case "Autologin":
      await autologin.tick(pane, cheat);
      break;
  }
}

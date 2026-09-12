import * as stdout from "../../output";
import * as stdin from "../../input";
import type { Pane } from "../../../terminal/pane";
import type { Cheat } from "../../registry";
import { sleep } from "../../../core/gadget";

let speed: number;
export async function onConfigChange(
  pane: Pane,
  cheat: Cheat,
  label: string,
  value: any,
): Promise<void> {
  if (label === "Speed") {
    speed = Number(value);
    console.log("[porthack]: Speed set to", speed);
  }
}

export async function onTick(pane: Pane, cheat: Cheat): Promise<void> {
  if (pane.busy || pane.state !== "connected") return;

  if (stdout.getCurrentLine(pane).trim().includes("port to try?")) {
    console.log("[porthack]: Sending port request...");
    pane.busy = true;
    try {
      let lines = stdout.getLastLines(pane, 1);
      let nport = 1;

      while (nport < 20 && !lines.some((l) => l.includes("port service"))) {
        nport++;
        lines = stdout.getLastLines(pane, nport);
      }
      console.log("[porthack]: Found port service lines:", lines);

      const ports = lines
        .map((l) => l.trim().match(/^(\d+)\s+[a-z]/i)?.[1])
        .filter(Boolean) as string[];

      console.log("[porthack]: Found ports:", ports);
      ports.sort((a, b) => {
        const priority: Record<string, number> = { 513: 1 };
        const pa = priority[a] || 999;
        const pb = priority[b] || 999;
        if (pa !== pb) return pa - pb;
        return Number(a) - Number(b);
      });
      for (const port of ports) {
        console.log(`[porthack]: Trying port ${port}...`);
        await stdout.waitFor(
          pane,
          /port to try\?/i,
          5000,
          1,
          pane.latency ?? 400,
        );
        await sleep(speed ?? 1000);
        await stdin.send(pane, `${port}\r`);
        await stdout.waitChange(pane, 5000);
        await sleep(speed ?? 1000);
        await stdout.waitFor(
          pane,
          /%porthack error|security compromised/i,
          5000,
          4,
          pane.latency ?? 400,
        );
        if (
          stdout
            .getLastLines(pane, 5)
            .some((l) => l.toLowerCase().includes("security compromised"))
        ) {
          console.log(`[porthack]: Port ${port} successful!`);
          break;
        }

        await stdout.waitFor(
          pane,
          "port to try?",
          5000,
          1,
          pane.latency ?? 400,
        );
      }
    } finally {
      pane.busy = false;
    }
  }

  if (
    stdout.getCurrentLine(pane).trim().includes("Automated or Manual scan? [A]")
  ) {
    console.log("[porthack]: porthack v2");
    pane.busy = true;
    await stdin.send(pane, "A\r");
    pane.busy = false;
  }
}

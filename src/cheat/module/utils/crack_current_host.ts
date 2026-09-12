import * as stdout from "../../output";
import * as stdin from "../../input";
import type { Pane } from "../../../terminal/pane";
import { saveDefaultCheats, type Cheat } from "../../registry";
import { renderCheatDrawer } from "../../ui";
import * as crack from "../glob/hashcrack";

import { LOGIN_PROMPT_REGEX, sendCredentials } from "../automation/autologin";

export async function onToggle(
  pane: Pane,
  cheat: Cheat,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    console.log(
      "[crack-current-host]: Enabled. Attempting to crack current host...",
    );
    await crackCurrentHost(pane, cheat);
    cheat.enabled = false;
    if (pane.isDefault) saveDefaultCheats(pane.cheats);
    renderCheatDrawer(pane);
  }
}

async function crackCurrentHost(pane: Pane, cheat: Cheat): Promise<void> {
  var [rawhash, host] = await stdin.th_exec(
    pane,
    "cat /etc/passwd | cut -f1-2 -d: | grep -v :x | tail -1",
  );
  host = host.slice(0, host.indexOf("$"));
  host = host.trim();
  host = host.split(" ")[0];
  host = host.replace(/[^a-zA-Z0-9\.\-]/g, "");

  console.log(
    "[crack-current-host]: cracking host",
    host + " with hash ",
    rawhash,
  );
  var user = rawhash.split(":")[0];
  var hash = rawhash.split(":")[1];
  var cracked = await crack.crack(hash, hash.length > 13);
  console.log(
    "[crack-current-host]: cracked user",
    user,
    " hash: ",
    cracked ? new TextDecoder().decode(cracked) : "not found",
  );
  if (cracked) {
    pane.busy = true;
    var state = pane.cheats.Automation.selectID("Autologin").enabled;
    pane.cheats.Automation.selectID("Autologin").enabled = false;
    try {
      await stdin.send(pane, "exit");
      await stdin.sendkey(pane, "Enter");
      await stdout.waitStill(pane, 2000);
      //await stdin.sendkey(pane, "D", { ctrl: true, alt: false }); // ^D
      await stdin.th_exec(pane, `telnet ${host}`);

      const sawLoginPrompt = await stdout.waitFor(
        pane,
        LOGIN_PROMPT_REGEX,
        4000,
        8,
      );
      if (!sawLoginPrompt) {
        console.warn("[crack-current-host]: Telnet login prompt not found");
        return;
      }

      await sendCredentials(pane, user, new TextDecoder().decode(cracked));
      await stdout.waitFor(pane, /[@#>]|ftp>/, 4000, 5);
    } finally {
      pane.busy = false;
      pane.cheats.Automation.selectID("Autologin").enabled = state;
    }
  }
}

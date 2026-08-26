import * as stdout from "../../output";
import * as stdin from "../../input";
import type { Pane } from "../../../pane";
import type { Cheat } from "../../registry";
import { sleep } from "../../../gadget";

async function sendCred(pane: Pane, guest: boolean, cheat: Cheat): Promise<void> {
  pane.busy = true;
  const username = (cheat.getConfigByLabel("username")?.value ?? "") as string;
  const password = (cheat.getConfigByLabel("password")?.value ?? "") as string;
  const asGuest = cheat.getValue("As Guest?") as boolean;

  if (guest && asGuest) {
    await stdin.send(pane, "guest\r");
  } else {
    if (username === "" || username === "guest" || password === "") {
      console.log("Autologin: Missing username or password, aborting");
      pane.busy = false;
      return;
    }
    await stdin.send(pane, username + "\r" + password + "\r");
  }

  pane.busy = false;
}

export async function tick(pane: Pane, cheat: Cheat): Promise<void> {
  const currentLine = stdout.getCurrentLine(pane);
  const previousLine = stdout.getLastLines(pane, 2)[0] || "";
  const guestMode = cheat.getValue("As Guest?") as boolean;

  if (
    previousLine.includes(
      "Type NEWUSER to create an account. Press control-C to interrupt any command."
    )
  ) {
    await stdin.send(pane, "login ");
    await sendCred(pane, false, cheat);
    await stdout.waitFor(pane, "@", 10000);
    return;
  }

  if (currentLine.match(/^Name \(.+:.+\):/)) {
    await sendCred(pane, false, cheat);
    await stdout.waitFor(pane, "ftp>");
    return;
  }

  if ([/Login:/i, /Username:/i, /USERID:/i].some((prompt) => prompt.test(currentLine))) {
    if (guestMode && !currentLine.includes("USERID:")) {
      await stdin.send(pane, "guest");
      await stdin.sendkey(pane, "Enter");
    } else {
      await sendCred(pane, false, cheat);
    }
    await sleep(1000);
    return;
  }

  if (currentLine.includes("Press any key to continue =>")) {
    await stdin.sendkey(pane, " ");
    await stdout.waitFor(pane, "Username>");
    if (guestMode) {
      await stdin.send(pane, "guest");
      await stdin.sendkey(pane, "Enter");
    } else {
      await sendCred(pane, false, cheat);
    }
  }
}

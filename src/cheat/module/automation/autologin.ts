import * as stdout from "../../output";
import * as stdin from "../../input";
import type { Pane } from "../../../pane";
import type { Cheat } from "../../registry";

// Modular lowercase prompt keywords
const LOGIN_KEYWORDS = ["login", "username", "userid"] as const;

export const LOGIN_PROMPT_REGEX = new RegExp(
  `(?:(?:^|\\b)(?:${LOGIN_KEYWORDS.join("|")})\\s*(?::|===>)\\s*$)|^name\\s*\\(.*?\\)\\s*:\\s*$`,
  "i"
);

export function isLoginPrompt(line: string): boolean {
  return LOGIN_PROMPT_REGEX.test(line);
}

async function loginSequence(pane: Pane, cheat: Cheat): Promise<void> {
  const asGuest = Boolean(cheat.getValue("As Guest?"));
  const username = ((cheat.getValue("Username") as string) ?? "").trim();
  const password = ((cheat.getValue("Password") as string) ?? "").trim();

  if (asGuest || !username || username.toLowerCase() === "guest") {
    await stdin.send(pane, "guest\r");
    return;
  }

  await stdin.send(pane, `${username}\r`);
  const sawPassword = await stdout.waitFor(pane, /(?:^|\b)password\s*(?::|===>)\s*$/i, 3000, 5);
  if (sawPassword && password) {
    await stdin.send(pane, `${password}\r`);
  }
}

export async function onTermChange(pane: Pane, cheat: Cheat): Promise<void> {
  if (pane.busy || pane.state !== "connected") return;

  // Retrieve the latest non-empty terminal lines (handling blank line separators and cursor offsets)
  const recentLines = stdout.getLastLines(pane, 6).map((l) => l.trim()).filter(Boolean);
  const line = recentLines[recentLines.length - 1] || "";
  const prev = recentLines[recentLines.length - 2] || "";

  if (!line && !prev) return;

  // 1. Telehack root welcome banner (only when sitting at initial command prompt '.' or blank)
  if (prev.includes("Type NEWUSER to create an account") && (line === "." || line === "")) {
    pane.busy = true;
    try {
      const asGuest = Boolean(cheat.getValue("As Guest?"));
      const username = ((cheat.getValue("Username") as string) ?? "").trim();
      const password = ((cheat.getValue("Password") as string) ?? "").trim();

      if (asGuest || !username || username.toLowerCase() === "guest") {
        await stdin.send(pane, "newuser\r");
      } else {
        await stdin.send(pane, `login ${username}\r`);
        if (await stdout.waitFor(pane, /(?:^|\b)password\s*(?::|===>)\s*$/i, 3000, 5)) {
          if (password) await stdin.send(pane, `${password}\r`);
        }
      }
      await stdout.waitFor(pane, /[@#>]|ftp>/, 4000, 5);
    } finally {
      pane.busy = false;
    }
    return;
  }

  // 2. Press any key to continue pager (must end at the prompt)
  if (/Press any key to continue\s*=>\s*$/i.test(line)) {
    pane.busy = true;
    try {
      await stdin.sendkey(pane, " ");
      if (await stdout.waitFor(pane, LOGIN_PROMPT_REGEX, 3000, 5)) {
        await loginSequence(pane, cheat);
        await stdout.waitFor(pane, /[@#>]|ftp>/, 4000, 5);
      }
    } finally {
      pane.busy = false;
    }
    return;
  }

  // 3. Standard Login / Userid prompt (supports ':' and '===>')
  if (isLoginPrompt(line)) {
    pane.busy = true;
    try {
      await loginSequence(pane, cheat);
      await stdout.waitFor(pane, /[@#>]|ftp>/, 4000, 5);
    } finally {
      pane.busy = false;
    }
    return;
  }

  // 4. Standalone Password prompt fallback (supports ':' and '===>')
  if (/(?:^|\b)password\s*(?::|===>)\s*$/i.test(line)) {
    pane.busy = true;
    try {
      const password = ((cheat.getValue("Password") as string) ?? "").trim();
      if (password) await stdin.send(pane, `${password}\r`);
      await stdout.waitFor(pane, /[@#>]|ftp>/, 4000, 5);
    } finally {
      pane.busy = false;
    }
  }
}

export const onTick = onTermChange;
export const tick = onTick;

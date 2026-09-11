import type { Pane } from "../../../terminal/pane";
import type { Cheat } from "../../registry";
import * as stdin from "../../input";
import * as stdout from "../../output";

const LOGIN_KEYWORDS = ["login", "username", "userid", "username?"] as const;
const PASSWORD_PROMPT_REGEX = /(?:^|\b)password\s*(?::|===>|>)\s*$/i;
const PAGER_PROMPT_REGEX = /Press any key to continue\s*=>\s*$/i;

export const LOGIN_PROMPT_REGEX = new RegExp(
  `(?:(?:^|\\b)(?:${LOGIN_KEYWORDS.join("|")})\\s*(?::|===>|>)\\s*$)|^name\\s*\\(.*?\\)\\s*:\\s*$`,
  "i",
);

type PromptKind = "root" | "pager" | "login" | "password";

const handledPrompts = new WeakMap<Pane, Map<PromptKind, string>>();
const queuedPasswords = new WeakSet<Pane>();

function currentPromptKey(pane: Pane): string {
  const buffer = pane.term.buffer.active;
  const row = buffer.baseY + buffer.cursorY;
  return `${row}:${stdout.getCurrentLine(pane).trim()}`;
}

function markPromptHandled(pane: Pane, kind: PromptKind): void {
  let prompts = handledPrompts.get(pane);
  if (!prompts) {
    prompts = new Map();
    handledPrompts.set(pane, prompts);
  }
  prompts.set(kind, currentPromptKey(pane));
}

function claimPrompt(pane: Pane, kind: PromptKind): boolean {
  const key = currentPromptKey(pane);
  if (handledPrompts.get(pane)?.get(kind) === key) return false;
  markPromptHandled(pane, kind);
  return true;
}

function isPasswordPrompt(line: string): boolean {
  return PASSWORD_PROMPT_REGEX.test(line);
}

export function isLoginPrompt(line: string): boolean {
  return LOGIN_PROMPT_REGEX.test(line);
}

async function waitForCurrentPrompt(
  pane: Pane,
  pattern: RegExp,
  timeout: number,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pattern.test(stdout.getCurrentLine(pane).trim())) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

export async function sendCredentials(
  pane: Pane,
  account: string,
  password: string | null,
): Promise<void> {
  markPromptHandled(pane, "login");
  const payload =
    password === null ? `${account}\r` : `${account}\r${password}\r`;
  await stdin.send(pane, payload, true);
  if (password === null) return;
  queuedPasswords.add(pane);
  setTimeout(() => queuedPasswords.delete(pane), 5000);
}

function getCredentials(cheat: Cheat): {
  account: string;
  password: string | null;
} {
  const asGuest = Boolean(cheat.getValue("As Guest?"));
  const username = ((cheat.getValue("Username") as string) ?? "").trim();
  const password = ((cheat.getValue("Password") as string) ?? "").trim();
  const account =
    asGuest || !username || username.toLowerCase() === "guest"
      ? "guest"
      : username;

  return { account, password: account === "guest" ? null : password || null };
}

function getMainAccountCredentials(cheat: Cheat): {
  account: string;
  password: string | null;
} | null {
  const account = ((cheat.getValue("Username") as string) ?? "").trim();
  if (!account) return null;

  const password = ((cheat.getValue("Password") as string) ?? "").trim();
  return { account, password: password || null };
}

async function loginSequence(pane: Pane, cheat: Cheat): Promise<void> {
  const { account, password } = getCredentials(cheat);
  await sendCredentials(pane, account, password);
}

async function withPaneBusy(
  pane: Pane,
  action: () => Promise<void>,
): Promise<void> {
  pane.busy = true;
  try {
    await action();
  } finally {
    pane.busy = false;
  }
}

export async function onTermChange(pane: Pane, cheat: Cheat): Promise<void> {
  if (pane.busy || pane.state !== "connected") return;

  const recentLines = stdout
    .getLastLines(pane, 6)
    .map((recentLine) => recentLine.trim())
    .filter(Boolean);
  const line = recentLines.at(-1) ?? "";
  const previousLine = recentLines.at(-2) ?? "";

  if (
    previousLine.includes("Type NEWUSER to create an account") &&
    line === "." &&
    claimPrompt(pane, "root")
  ) {
    await withPaneBusy(pane, async () => {
      const credentials = getMainAccountCredentials(cheat);
      if (!credentials) return;

      console.log("[autologin]: Attempting to log in as", credentials.account);
      await sendCredentials(
        pane,
        `login ${credentials.account}`,
        credentials.password,
      );
    });
    return;
  }

  if (PAGER_PROMPT_REGEX.test(line) && claimPrompt(pane, "pager")) {
    await withPaneBusy(pane, async () => {
      await stdin.sendkey(pane, " ");
      if (await waitForCurrentPrompt(pane, LOGIN_PROMPT_REGEX, 3000)) {
        await loginSequence(pane, cheat);
      }
    });
    return;
  }

  if (isLoginPrompt(line) && claimPrompt(pane, "login")) {
    await withPaneBusy(pane, async () => {
      await loginSequence(pane, cheat);
    });
    return;
  }

  if (isPasswordPrompt(line) && claimPrompt(pane, "password")) {
    if (queuedPasswords.delete(pane)) return;

    await withPaneBusy(pane, async () => {
      const password = ((cheat.getValue("Password") as string) ?? "").trim();
      if (password) await stdin.send(pane, `${password}\r`);
    });
  }
}

export const onTick = onTermChange;
export const tick = onTick;

import type { Pane } from "../../../terminal/pane";
import type { Cheat } from "../../registry";
import * as stdin from "../../input";
import * as stdout from "../../output";
import { findAutologinPromptLine } from "./autologin-prompt.ts";
import { sendMainAccountLogin } from "./autologin-flow.ts";
import { AutologinPromptState } from "./autologin-state.ts";

const LOGIN_KEYWORDS = ["login", "username", "userid", "username?"] as const;
const PASSWORD_PROMPT_REGEX = /(?:^|\b)password\s*(?::|===>|>)\s*$/i;
const PAGER_PROMPT_REGEX = /Press any key to continue\s*=>\s*$/i;
const PASSWORD_PROMPT_TIMEOUT_MS = 5000;

export const LOGIN_PROMPT_REGEX = new RegExp(
  `(?:(?:^|\\b)(?:${LOGIN_KEYWORDS.join("|")})\\s*(?::|===>|>)\\s*$)|^name\\s*\\(.*?\\)\\s*:\\s*$`,
  "i",
);

type PromptKind = "root" | "pager" | "login" | "password";

const promptState = new AutologinPromptState<Pane, PromptKind>();

function currentPromptKey(pane: Pane): string {
  const buffer = pane.term.buffer.active;
  const row = buffer.baseY + buffer.cursorY;
  return `${row}:${stdout.getCurrentLine(pane).trim()}`;
}

function markPromptHandled(pane: Pane, kind: PromptKind): void {
  promptState.mark(pane, kind, currentPromptKey(pane));
}

function claimPrompt(pane: Pane, kind: PromptKind): boolean {
  return promptState.claim(pane, kind, currentPromptKey(pane));
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

type LoginCallback = () => void;
const submissionListeners = new WeakMap<Pane, Set<LoginCallback>>();

export function notifyLoginSubmitted(pane: Pane): void {
  const listeners = submissionListeners.get(pane);
  if (listeners) {
    for (const callback of [...listeners]) {
      callback();
    }
  }
}

export function onLoginSubmitted(
  pane: Pane,
  callback: LoginCallback,
): () => void {
  let listeners = submissionListeners.get(pane);
  if (!listeners) {
    listeners = new Set();
    submissionListeners.set(pane, listeners);
  }
  listeners.add(callback);
  return () => {
    const list = submissionListeners.get(pane);
    list?.delete(callback);
  };
}

export async function sendCredentials(
  pane: Pane,
  account: string,
  password: string | null,
): Promise<void> {
  markPromptHandled(pane, "login");
  if (password === null) {
    await stdin.send(pane, `${account}\r`, true);
    notifyLoginSubmitted(pane);
    return;
  }

  const result = await sendMainAccountLogin(account, password, {
    command: `${account}\r`,
    sendLogin: async (command) => {
      await stdin.send(pane, command, true);
    },
    waitForPassword: () =>
      waitForCurrentPrompt(
        pane,
        PASSWORD_PROMPT_REGEX,
        PASSWORD_PROMPT_TIMEOUT_MS,
      ),
    sendPassword: async (secret) => {
      markPromptHandled(pane, "password");
      await stdin.send(pane, secret);
    },
  });
  if (result === "submitted") notifyLoginSubmitted(pane);
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

export type AutologinResult = "submitted" | "wrong-prompt" | "timeout";

export async function runAutologinAtCurrentPrompt(
  pane: Pane,
  cheat: Cheat,
  timeoutMs = 20_000,
): Promise<AutologinResult> {
  const wasEnabled = cheat.enabled;
  cheat.enabled = true;
  promptState.clear(pane);

  try {
    return await new Promise<AutologinResult>((resolve) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve("timeout");
      }, timeoutMs);

      const cleanup = onLoginSubmitted(pane, () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        cleanup();
        resolve("submitted");
      });

      // Check immediately in case prompt is already visible on terminal
      void onTermChange(pane, cheat);
    });
  } finally {
    cheat.enabled = wasEnabled;
  }
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

export function onToggle(pane: Pane): void {
  promptState.clear(pane);
}

export async function onTermChange(pane: Pane, cheat: Cheat): Promise<void> {
  if (pane.busy || pane.state !== "connected") return;

  const recentLines = stdout
    .getLastLines(pane, 6)
    .map((recentLine) => recentLine.trim())
    .filter(Boolean);
  const line = recentLines.at(-1) ?? "";
  const previousLine = recentLines.at(-2) ?? "";
  const isRootPrompt =
    previousLine.includes("Type NEWUSER to create an account") && line === ".";
  const isPagerPrompt = PAGER_PROMPT_REGEX.test(line);
  const isCurrentLoginPrompt = isLoginPrompt(line);
  const isCurrentPasswordPrompt = isPasswordPrompt(line);

  const activePrompts: PromptKind[] = [];
  if (isRootPrompt) activePrompts.push("root");
  if (isPagerPrompt) activePrompts.push("pager");
  if (isCurrentLoginPrompt) activePrompts.push("login");
  if (isCurrentPasswordPrompt) activePrompts.push("password");
  promptState.retain(pane, activePrompts);

  if (isRootPrompt && claimPrompt(pane, "root")) {
    await withPaneBusy(pane, async () => {
      const credentials = getMainAccountCredentials(cheat);
      if (!credentials) return;

      console.log("[autologin]: Attempting to log in as", credentials.account);
      if (credentials.password === null) {
        await sendCredentials(pane, `login ${credentials.account}`, null);
      } else {
        markPromptHandled(pane, "login");
        const result = await sendMainAccountLogin(
          credentials.account,
          credentials.password,
          {
            sendLogin: async (command) => {
              await stdin.send(pane, command, true);
            },
            waitForPassword: () =>
              waitForCurrentPrompt(
                pane,
                PASSWORD_PROMPT_REGEX,
                PASSWORD_PROMPT_TIMEOUT_MS,
              ),
            sendPassword: async (secret) => {
              markPromptHandled(pane, "password");
              await stdin.send(pane, secret);
            },
          },
        );
        if (result === "submitted") notifyLoginSubmitted(pane);
      }
    });
    return;
  }

  if (isPagerPrompt && claimPrompt(pane, "pager")) {
    await withPaneBusy(pane, async () => {
      await stdin.sendkey(pane, " ");
      if (await waitForCurrentPrompt(pane, LOGIN_PROMPT_REGEX, 3000)) {
        await loginSequence(pane, cheat);
      }
    });
    return;
  }

  if (isCurrentLoginPrompt && claimPrompt(pane, "login")) {
    await withPaneBusy(pane, async () => {
      await loginSequence(pane, cheat);
    });
    return;
  }

  if (isCurrentPasswordPrompt && claimPrompt(pane, "password")) {
    await withPaneBusy(pane, async () => {
      const password = ((cheat.getValue("Password") as string) ?? "").trim();
      if (password) {
        await stdin.send(pane, `${password}\r`);
        notifyLoginSubmitted(pane);
      }
    });
  }
}

export const onTick = onTermChange;
export const tick = onTick;

import type { Pane } from "../../terminal/pane";
import type { Cheat } from "../registry";
import type {
  BridgeCallResult,
  BridgeCapabilityContext,
} from "../basicbridge.ts";
import type { CheatCapabilityEntry } from "../basicbridge-registry.ts";

type AutologinResult = "submitted" | "wrong-prompt" | "timeout";

export type AutologinRunner = (
  pane: Pane,
  cheat: Cheat,
  timeoutMs?: number,
) => Promise<AutologinResult>;

function findCheat(pane: Pane, name: string): Cheat | undefined {
  return Object.values(pane.cheats)
    .flat()
    .find((cheat) => cheat.name === name);
}

export async function runAuthLogin(
  context: BridgeCapabilityContext<Pane>,
  arguments_: readonly string[],
  runAutologin?: AutologinRunner,
  timeoutMs = 20_000,
): Promise<BridgeCallResult> {
  if (context.signal.aborted) return { ok: false, error: "internal" };
  if (arguments_.length !== 0) return { ok: false, error: "malformed" };
  console.debug(`[bridge] auth.login called for pane ${context.pane.id}`);
  const bridge = findCheat(context.pane, "Basic bridge");
  if (!bridge?.enabled) {
    console.debug(
      "[bridge] auth.login rejected: 'Basic bridge' is disabled on this pane.",
    );
    return { ok: false, error: "credentials-disabled" };
  }
  if (!Boolean(bridge.getValue("Allow credentials"))) {
    console.debug(
      "[bridge] auth.login rejected: 'Allow credentials' is OFF in the Basic bridge cheat config.",
    );
    return { ok: false, error: "credentials-disabled" };
  }

  const autologin = findCheat(context.pane, "Autologin");
  if (!autologin) {
    console.debug(
      "[bridge] auth.login rejected: Autologin cheat was not found.",
    );
    return { ok: false, error: "internal" };
  }
  if (context.pane.busy) {
    console.debug("[bridge] auth.login rejected: pane is currently busy.");
    return { ok: false, error: "invalid-state" };
  }

  let timer: any;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    const runner =
      runAutologin ??
      (await import("../module/automation/autologin.ts"))
        .runAutologinAtCurrentPrompt;
    const outcome = await Promise.race([
      runner(context.pane, autologin, timeoutMs),
      timeoutPromise,
    ]);
    clearTimeout(timer);
    console.debug(`[bridge] auth.login runner outcome: ${outcome}`);
    if (outcome === "timeout") {
      context.pane.busy = false;
      return { ok: false, error: "timeout" };
    }
    return outcome === "submitted"
      ? { ok: true }
      : { ok: false, error: outcome };
  } catch {
    clearTimeout(timer);
    context.pane.busy = false;
    return { ok: false, error: "internal" };
  }
}

export const entries: CheatCapabilityEntry[] = [
  { alias: "login", fn: runAuthLogin },
];

import assert from "node:assert/strict";
import test from "node:test";

import { Cheat } from "../../src/cheat/registry.ts";
import { runAuthLogin } from "../../src/cheat/basicbridge-capabilities.ts";

function createPane(allowCredentials: boolean) {
  const pane = {
    id: "pane-1",
    busy: false,
    cheats: {
      Automation: [
        new Cheat("Basic bridge", "", [
          {
            type: "checker",
            label: "Allow credentials",
            value: allowCredentials,
          },
        ]),
        new Cheat("Autologin", "", [
          { type: "input", label: "Username", value: "local-user" },
          { type: "input", label: "Password", value: "local-password" },
          { type: "checker", label: "As Guest?", value: false },
        ]),
      ],
    },
  };
  pane.cheats.Automation[0].enabled = true;
  return pane;
}

function context(pane: ReturnType<typeof createPane>) {
  return {
    pane: pane as never,
    runId: "run",
    requestSequence: 2,
    getCapture: () => undefined,
    signal: new AbortController().signal,
  };
}

test("blocks auth.login when local credential permission is disabled", async () => {
  let invoked = false;
  const runner = async () => {
    invoked = true;
    return "submitted" as const;
  };
  const result = await runAuthLogin(context(createPane(false)), [], runner);

  assert.deepEqual(result, { ok: false, error: "credentials-disabled" });
  assert.equal(invoked, false);
});

test("auth.login uses the pane Autologin cheat", async () => {
  const pane = createPane(true);
  let observedUsername = "";
  const runner = async (
    receivedPane: Parameters<typeof runAuthLogin>[0]["pane"],
    cheat: Cheat,
  ) => {
    assert.equal(receivedPane, pane);
    observedUsername = String(cheat.getValue("Username"));
    return "submitted" as const;
  };

  const result = await runAuthLogin(context(pane), [], runner);

  assert.deepEqual(result, { ok: true });
  assert.equal(observedUsername, "local-user");
  assert.equal(pane.busy, false);
});

test("auth.login refuses wire arguments instead of treating them as credentials", async () => {
  let invoked = false;
  const runner = async () => {
    invoked = true;
    return "submitted" as const;
  };
  const result = await runAuthLogin(
    context(createPane(true)),
    ["attacker", "password"],
    runner,
  );

  assert.deepEqual(result, { ok: false, error: "malformed" });
  assert.equal(invoked, false);
});

test("maps Autologin prompt and timeout outcomes to bridge errors", async () => {
  for (const [outcome, error] of [
    ["wrong-prompt", "wrong-prompt"],
    ["timeout", "timeout"],
  ] as const) {
    const runner = async () => outcome;
    const result = await runAuthLogin(context(createPane(true)), [], runner);
    assert.deepEqual(result, { ok: false, error });
  }
});

test("bounds a credential operation that does not finish in time", async () => {
  const pane = createPane(true);
  const runner = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return "submitted" as const;
  };

  const result = await runAuthLogin(context(pane), [], runner, 5);

  assert.deepEqual(result, { ok: false, error: "timeout" });
  assert.equal(pane.busy, false);
});

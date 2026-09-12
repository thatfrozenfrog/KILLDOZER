import assert from "node:assert/strict";
import test from "node:test";

import {
  BRIDGE_REGISTRY,
  executeBridgeFunction,
  findBridgeFunction,
} from "../../src/cheat/basicbridge-registry.ts";
import { Cheat } from "../../src/cheat/registry.ts";

function createMockPane() {
  return {
    id: "pane-1",
    busy: false,
    cheats: {
      Automation: [
        new Cheat("Basic bridge", "", [
          { type: "checker", label: "Allow credentials", value: true },
        ]),
        new Cheat("Autologin", "", [
          { type: "input", label: "Username", value: "guest" },
          { type: "input", label: "Password", value: "" },
          { type: "checker", label: "As Guest?", value: true },
        ]),
      ],
    },
  };
}

test("registry contains dynamically exported capabilities", () => {
  for (const id of ["auth.login", "log.capture", "nmap.push", "nmap.done"]) {
    const entry = findBridgeFunction(id);
    assert.ok(entry, `Expected capability ${id} to be registered`);
    assert.equal(entry.id, id);
    assert.ok(BRIDGE_REGISTRY.some((item) => item.id === id));
  }
});

test("nmap.push collects caller buffer and nmap.done logs collected buffer", async () => {
  const logs: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };

  try {
    const context = {
      pane: createMockPane() as never,
      runId: "scanner-1",
      requestSequence: 2,
      getCapture: (name: string) =>
        name === "buf" ? ["port 80 open", "port 443 open"] : undefined,
      signal: new AbortController().signal,
    };

    const pushResult = await executeBridgeFunction(context, "nmap.push", [
      "target-host",
    ]);
    assert.deepEqual(pushResult, { ok: true });

    const doneResult = await executeBridgeFunction(context, "nmap.done", [
      "target-host",
    ]);
    assert.deepEqual(doneResult, { ok: true });
    assert.ok(logs.length >= 1);
    const lastLog = logs[logs.length - 1];
    assert.equal(lastLog[0], '[nmap] Collected buffer of "target-host":');
    assert.deepEqual(lastLog[1], ["port 80 open", "port 443 open"]);
  } finally {
    console.log = originalLog;
  }
});

test("doDone formats buffer and passes text to file saver", async () => {
  let savedContent = "";
  let savedFilename = "";
  const customSaver = (content: string, filename: string) => {
    savedContent = content;
    savedFilename = filename;
  };

  const context = {
    pane: createMockPane() as never,
    runId: "scanner-saver",
    requestSequence: 3,
    getCapture: (name: string) =>
      name === "buf" ? ["22/tcp open ssh", "80/tcp open http"] : undefined,
    signal: new AbortController().signal,
  };

  const { doPush, doDone } = await import("../../src/cheat/telebasic/nmap.ts");
  await doPush(context, ["host-b"]);
  await doDone(context, ["host-b"], customSaver);

  assert.equal(savedFilename, "host-b.txt");
  assert.equal(savedContent, "22/tcp open ssh\n80/tcp open http");
});

test("rejects unregistered capability IDs", async () => {
  const result = await executeBridgeFunction(
    {
      pane: createMockPane() as never,
      runId: "run-1",
      requestSequence: 1,
      getCapture: () => undefined,
      signal: new AbortController().signal,
    },
    "unknown.capability",
    [],
  );

  assert.deepEqual(result, { ok: false, error: "unknown-capability" });
});

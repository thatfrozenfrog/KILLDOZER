import assert from "node:assert/strict";
import test from "node:test";

import { runLogCapture } from "../../src/cheat/telebasic/log.ts";
import { executeBridgeFunction } from "../../src/cheat/basicbridge-registry.ts";

test("runLogCapture prints specific capture to console.log", async () => {
  const logs: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };

  try {
    const context = {
      pane: {} as never,
      runId: "testlog",
      requestSequence: 4,
      getCapture: (name: string) =>
        name === "demo" ? ["Hello from TeleBASIC!", "Line 2"] : undefined,
      signal: new AbortController().signal,
    };

    const result = await runLogCapture(context, ["demo"]);
    assert.deepEqual(result, { ok: true });
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[TeleBASIC] Capture "demo":');
    assert.deepEqual(logs[0][1], ["Hello from TeleBASIC!", "Line 2"]);
  } finally {
    console.log = originalLog;
  }
});

test("dispatching log.capture through executeBridgeFunction works", async () => {
  const logs: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };

  try {
    const context = {
      pane: {} as never,
      runId: "testlog",
      requestSequence: 4,
      getCapture: (name: string) =>
        name === "sample" ? ["captured text"] : undefined,
      signal: new AbortController().signal,
    };

    const result = await executeBridgeFunction(context, "log.capture", [
      "sample",
    ]);
    assert.deepEqual(result, { ok: true });
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[TeleBASIC] Capture "sample":');
    assert.deepEqual(logs[0][1], ["captured text"]);
  } finally {
    console.log = originalLog;
  }
});

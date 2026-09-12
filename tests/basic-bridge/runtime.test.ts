import assert from "node:assert/strict";
import test from "node:test";

import {
  BasicBridgeRuntime,
  configureBasicBridgeRuntime,
  getBasicBridgeCapture,
  getBasicBridgeSnapshot,
  ingestBasicBridgeData,
  resetBasicBridge,
  type BridgeCallResult,
} from "../../src/cheat/basicbridge.ts";

interface TestPane {
  id: string;
  enabled: boolean;
}

function createHarness() {
  const replies: string[] = [];
  const calls: Array<{ paneId: string; capability: string; args: string[] }> =
    [];
  const runtime = new BasicBridgeRuntime<TestPane>({
    isEnabled: (pane) => pane.enabled,
    isPaused: () => false,
    executeCapability: async (_context, capability, args) => {
      calls.push({ paneId: _context.pane.id, capability, args: [...args] });
      return { ok: true } satisfies BridgeCallResult;
    },
    writeResponse: async (_pane, response) => {
      replies.push(response);
    },
  });
  return { runtime, replies, calls };
}

test("captures plain logical lines independently for each pane", () => {
  const { runtime } = createHarness();
  const first = { id: "first", enabled: true };
  const second = { id: "second", enabled: true };

  runtime.ingest(
    first,
    "<run-a|1|BEGIN>\r\n<run-a|2|CAPTURE_BEGIN|files>\r\nalpha\r\n\u001b[31mbeta\u001b[0m\r\n<run-a|3|CAPTURE_END|files>\r\n",
  );
  runtime.ingest(
    second,
    "<run-b|1|BEGIN>\r\n<run-b|2|CAPTURE_BEGIN|files>\r\ngamma\r\n<run-b|3|CAPTURE_END|files>\r\n",
  );

  assert.deepEqual(runtime.getCapture(first, "files"), ["alpha", "beta"]);
  assert.deepEqual(runtime.getCapture(second, "files"), ["gamma"]);
});

test("replaces a completed capture when its name is reused", () => {
  const { runtime } = createHarness();
  const pane = { id: "pane", enabled: true };

  runtime.ingest(
    pane,
    "<run|1|BEGIN>\n<run|2|CAPTURE_BEGIN|same>\none\n<run|3|CAPTURE_END|same>\n<run|4|CAPTURE_BEGIN|same>\ntwo\n<run|5|CAPTURE_END|same>\n",
  );

  assert.deepEqual(runtime.getCapture(pane, "same"), ["two"]);
});

test("rejects skipped sequences and invalid state transitions", () => {
  const { runtime } = createHarness();
  const pane = { id: "pane", enabled: true };

  runtime.ingest(
    pane,
    "<run|1|BEGIN>\n<run|3|CAPTURE_BEGIN|bad>\n<run|2|CAPTURE_END|bad>\n",
  );

  const snapshot = runtime.snapshot(pane);
  assert.equal(snapshot.state, "running");
  assert.equal(snapshot.lastSequence, 1);
  assert.equal(runtime.getCapture(pane, "bad"), undefined);
});

test("dispatches an allowlisted call and writes completion response only when callback is specified", async () => {
  const { runtime, calls, replies } = createHarness();
  const pane = { id: "pane", enabled: true };

  // Without callback: executes but writes no reply
  runtime.ingest(pane, "<run|1|BEGIN>\n<run|2|CALL|auth.login>\n");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [
    { paneId: "pane", capability: "auth.login", args: [] },
  ]);
  assert.deepEqual(replies, []);
  assert.equal(runtime.snapshot(pane).state, "running");

  // With callback: executes and writes reply
  runtime.ingest(pane, "<run|3|CALL|auth.login|callback>\n");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [
    { paneId: "pane", capability: "auth.login", args: [] },
    { paneId: "pane", capability: "auth.login", args: [] },
  ]);
  assert.deepEqual(replies, ["<run|3|OK>\r"]);
  assert.equal(runtime.snapshot(pane).state, "running");
});

test("handles back-to-back pipelined calls without dropping frames", async () => {
  const { runtime, calls } = createHarness();
  const pane = { id: "pane", enabled: true };

  runtime.ingest(
    pane,
    "<run|1|BEGIN>\n<run|2|CALL|nmap.push|ls>\n<run|3|CALL|auth.login>\n",
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(calls, [
    { paneId: "pane", capability: "nmap.push", args: ["ls"] },
    { paneId: "pane", capability: "auth.login", args: [] },
  ]);
  assert.equal(runtime.snapshot(pane).state, "running");
});

test("does nothing while disabled or paused and reset clears captures", () => {
  const disabled = { id: "disabled", enabled: false };
  const paused = { id: "paused", enabled: true };
  const runtime = new BasicBridgeRuntime<TestPane>({
    isEnabled: (pane) => pane.enabled,
    isPaused: () => true,
    executeCapability: async () => ({ ok: true }),
    writeResponse: async () => {},
  });

  runtime.ingest(disabled, "<run|1|BEGIN>\n");
  runtime.ingest(paused, "<run|1|BEGIN>\n");

  assert.equal(runtime.snapshot(disabled).state, "idle");
  assert.equal(runtime.snapshot(paused).state, "idle");

  const { runtime: activeRuntime } = createHarness();
  const active = { id: "active", enabled: true };
  activeRuntime.ingest(
    active,
    "<run|1|BEGIN>\n<run|2|CAPTURE_BEGIN|x>\nvalue\n<run|3|CAPTURE_END|x>\n",
  );
  activeRuntime.reset(active, "test");
  assert.equal(activeRuntime.getCapture(active, "x"), undefined);
  assert.equal(activeRuntime.snapshot(active).state, "idle");
});

test("the application facade delegates to its configured runtime", () => {
  const { runtime } = createHarness();
  const pane = { id: "facade", enabled: true };
  configureBasicBridgeRuntime(runtime as never);

  ingestBasicBridgeData(
    pane as never,
    "<run|1|BEGIN>\n<run|2|CAPTURE_BEGIN|data>\nvalue\n<run|3|CAPTURE_END|data>\n",
  );

  assert.deepEqual(getBasicBridgeCapture(pane as never, "data"), ["value"]);
  assert.equal(getBasicBridgeSnapshot(pane as never).runId, "run");
  resetBasicBridge(pane as never, "test");
  assert.equal(getBasicBridgeSnapshot(pane as never).state, "idle");
});

test("reset during queued calls suppresses reply and prevents second call from starting", async () => {
  const pane = { id: "pane", enabled: true };
  const calls: Array<{ capability: string; aborted: boolean }> = [];
  const replies: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const runtime = new BasicBridgeRuntime<TestPane>({
    isEnabled: () => true,
    isPaused: () => false,
    executeCapability: async (context, capability) => {
      calls.push({ capability, aborted: context.signal.aborted });
      if (capability === "first") await gate;
      return { ok: true };
    },
    writeResponse: async (_, response) => {
      replies.push(response);
    },
  });

  runtime.ingest(
    pane,
    "<run|1|BEGIN>\n<run|2|CALL|first|callback>\n<run|3|CALL|second|callback>\n",
  );
  await new Promise((resolve) => setTimeout(resolve, 5));

  runtime.reset(pane, "disconnect");
  release();
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(calls, [{ capability: "first", aborted: false }]);
  assert.deepEqual(replies, []);
  assert.equal(runtime.snapshot(pane).state, "idle");
});

test("buffers function return value and writes it to buffer ending with Enter upon RET frame", async () => {
  const replies: string[] = [];
  const calls: unknown[] = [];
  const pane = { id: "pane", enabled: true };

  const runtime = new BasicBridgeRuntime<TestPane>({
    isEnabled: (p) => p.enabled,
    isPaused: () => false,
    executeCapability: async (context, capability, args) => {
      calls.push({ capability, args });
      if (capability === "uuhost.path") {
        return { ok: true, data: "csdev!att!uunet" };
      }
      return { ok: true };
    },
    writeResponse: async (p, resp) => {
      replies.push(resp);
    },
  });

  // Example from user (where input prompt finishes the frame without a trailing newline):
  // print "<path|1|BEGIN>"
  // print "<path|2|CALL|uuhost.path|srchost|desthost>"
  // print "<path|3|RET|uuhost.path" : input ">", retr$
  runtime.ingest(
    pane,
    "<path|1|BEGIN>\n" +
      "<path|2|CALL|uuhost.path|srchost|desthost>\n" +
      "<path|3|RET|uuhost.path>",
  );

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(calls, [
    { capability: "uuhost.path", args: ["srchost", "desthost"] },
  ]);
  assert.deepEqual(replies, ["csdev!att!uunet\r"]);

  // Also verify alias access and standard <... > format
  runtime.ingest(pane, "<path|4|RET|path>\n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(replies, ["csdev!att!uunet\r", "csdev!att!uunet\r"]);

  // End run
  runtime.ingest(pane, "<path|5|END>\n");
  assert.equal(runtime.snapshot(pane).state, "idle");
});

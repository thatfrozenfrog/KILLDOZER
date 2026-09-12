import assert from "node:assert/strict";
import test from "node:test";

import { BasicBridgeRuntime } from "../../src/cheat/basicbridge.ts";
import { createBasicBridgeDevConsole } from "../../src/cheat/basicbridge-devconsole.ts";

interface TestPane {
  id: string;
  connected: boolean;
  enabled: boolean;
}

test("targets the focused pane and exposes defensive capture copies", () => {
  const pane = { id: "pane-1", connected: true, enabled: true };
  const runtime = new BasicBridgeRuntime<TestPane>({
    isEnabled: (candidate) => candidate.enabled,
    isPaused: () => false,
    executeCapability: async () => ({ ok: true }),
    writeResponse: async () => {},
  });
  const api = createBasicBridgeDevConsole({
    runtime,
    allPanes: () => [pane],
    focusedPane: () => pane,
    capabilityIds: () => ["auth.login"],
    isConnected: (candidate) => candidate.connected,
    isBridgeEnabled: (candidate) => candidate.enabled,
  });

  api.feed("<console|1|BEGIN>\n");
  api.feed("<console|2|CAPTURE_BEGIN|demo>\nalpha\n");
  api.feed("<console|3|CAPTURE_END|demo>\n");

  const capture = api.capture("demo");
  assert.deepEqual(capture, ["alpha"]);
  capture?.push("mutation");
  assert.deepEqual(api.capture("demo"), ["alpha"]);
  assert.deepEqual(api.capabilities(), ["auth.login"]);
  assert.deepEqual(api.panes(), [
    { paneId: "pane-1", connected: true, bridgeEnabled: true },
  ]);
});

test("resolves explicit pane IDs and rejects unknown panes", () => {
  const first = { id: "first", connected: true, enabled: true };
  const second = { id: "second", connected: false, enabled: true };
  const runtime = new BasicBridgeRuntime<TestPane>({
    isEnabled: (pane) => pane.enabled,
    isPaused: () => false,
    executeCapability: async () => ({ ok: true }),
    writeResponse: async () => {},
  });
  const api = createBasicBridgeDevConsole({
    runtime,
    allPanes: () => [first, second],
    focusedPane: () => first,
    capabilityIds: () => [],
    isConnected: (pane) => pane.connected,
    isBridgeEnabled: (pane) => pane.enabled,
  });

  api.feed("<second-run|1|BEGIN>\n", "second");
  assert.equal(api.snapshot("second").runId, "second-run");
  assert.throws(() => api.snapshot("missing"), /Unknown pane: missing/);
});

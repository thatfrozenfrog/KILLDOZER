import assert from "node:assert/strict";
import test from "node:test";

import {
  BasicBridgeRuntime,
  configureBasicBridgeRuntime,
} from "../../src/cheat/basicbridge.ts";
import { onToggle } from "../../src/cheat/module/automation/basic_bridge.ts";

test("registers Basic bridge with only the credential permission", async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  const { defaultCheatState } = await import("../../src/cheat/registry.ts");

  const bridge = defaultCheatState().Automation.find(
    (cheat) => cheat.name === "Basic bridge",
  );
  assert.ok(bridge);
  assert.deepEqual(bridge.config, [
    { type: "checker", label: "Allow credentials", value: false },
  ]);
});

test("disabling the cheat resets its pane runtime", () => {
  const pane = { id: "pane", enabled: true };
  const runtime = new BasicBridgeRuntime<typeof pane>({
    isEnabled: (candidate) => candidate.enabled,
    isPaused: () => false,
    executeCapability: async () => ({ ok: true }),
    writeResponse: async () => {},
  });
  configureBasicBridgeRuntime(runtime as never);
  runtime.ingest(pane, "<run|1|BEGIN>\n");

  onToggle(pane as never, {} as never, false);

  assert.equal(runtime.snapshot(pane).state, "idle");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createWindowShutdown } from "../../src/app/window-shutdown.ts";

test("window destruction waits for all pane disconnects and runs once", async () => {
  const events: string[] = [];
  let releaseDisconnects!: () => void;
  const disconnects = new Promise<void>((resolve) => {
    releaseDisconnects = resolve;
  });
  const shutdown = createWindowShutdown(
    async () => {
      events.push("disconnect");
      await disconnects;
    },
    async () => {
      events.push("destroy");
    },
  );

  const first = shutdown();
  const second = shutdown();
  assert.deepEqual(events, ["disconnect"]);

  releaseDisconnects();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["disconnect", "destroy"]);
});

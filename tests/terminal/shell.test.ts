import assert from "node:assert/strict";
import test from "node:test";

test("releases a pane automation lock", async () => {
  const { releasePaneBusy } = await import("../../src/terminal/cleanup.ts");
  const pane = { busy: true };

  releasePaneBusy(pane);

  assert.equal(pane.busy, false);
});

test("disconnects every pane before shutdown completes", async () => {
  const { disconnectAllPanes } = await import("../../src/terminal/cleanup.ts");
  const panes = [{ busy: true }, { busy: true }];
  const disconnected: object[] = [];
  const finishDisconnects: Array<() => void> = [];

  const shutdown = disconnectAllPanes(panes, async (pane) => {
    disconnected.push(pane);
    await new Promise<void>((resolve) => {
      finishDisconnects.push(resolve);
    });
  });

  let completed = false;
  void shutdown.then(() => {
    completed = true;
  });
  await Promise.resolve();

  assert.deepEqual(disconnected, panes);
  assert.equal(completed, false);
  for (const finishDisconnect of finishDisconnects) finishDisconnect();
  await shutdown;

  assert.deepEqual(
    panes.map((pane) => pane.busy),
    [false, false],
  );
});

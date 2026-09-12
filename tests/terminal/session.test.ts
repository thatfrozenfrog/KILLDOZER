import assert from "node:assert/strict";
import test from "node:test";
import {
  beginSessionAttempt,
  failSessionAttempt,
  terminateSession,
  isSessionCurrent,
  type SessionPane,
} from "../../src/terminal/session.ts";
import { waitStill } from "../../src/cheat/output.ts";

test("beginSessionAttempt increments generation and assigns session state", () => {
  const pane: SessionPane = {
    sessionId: null,
    sessionGeneration: 0,
    state: "disconnected",
    busy: false,
  };

  const { generation, sessionId } = beginSessionAttempt(pane, "session-1");
  assert.equal(generation, 1);
  assert.equal(pane.sessionGeneration, 1);
  assert.equal(pane.sessionId, "session-1");
  assert.equal(pane.state, "connecting");
});

test("late connection failure does not clobber a newer connection attempt", () => {
  const pane: SessionPane = {
    sessionId: null,
    sessionGeneration: 0,
    state: "disconnected",
    busy: false,
  };

  // Attempt 1 starts
  const attempt1 = beginSessionAttempt(pane, "session-1");
  assert.equal(attempt1.generation, 1);

  // Attempt 2 starts before Attempt 1 finishes (e.g. user retried or reconnected)
  const attempt2 = beginSessionAttempt(pane, "session-2");
  assert.equal(attempt2.generation, 2);
  pane.state = "connected";

  // Attempt 1 now fails late
  let rolledBack = false;
  const didRollback = failSessionAttempt(pane, attempt1.generation, () => {
    rolledBack = true;
  });

  assert.equal(didRollback, false);
  assert.equal(rolledBack, false);
  assert.equal(pane.sessionGeneration, 2);
  assert.equal(pane.sessionId, "session-2");
  assert.equal(pane.state, "connected");

  // Attempt 2 failure would succeed if it fails
  const didRollback2 = failSessionAttempt(pane, attempt2.generation, () => {
    rolledBack = true;
  });
  assert.equal(didRollback2, true);
  assert.equal(rolledBack, true);
  assert.equal(pane.sessionId, null);
  assert.equal(pane.state, "disconnected");
});

test("terminateSession increments generation and resets session state", () => {
  const pane: SessionPane = {
    sessionId: "active-123",
    sessionGeneration: 5,
    state: "connected",
    busy: true,
  };

  let cleanedUp = false;
  terminateSession(pane, () => {
    cleanedUp = true;
  });

  assert.equal(pane.sessionGeneration, 6);
  assert.equal(pane.busy, false);
  assert.equal(pane.sessionId, null);
  assert.equal(pane.state, "disconnected");
  assert.equal(cleanedUp, true);
});

test("session generation prevents stale delayed typing from targeting new session", async () => {
  const pane: SessionPane = {
    sessionId: "old-session",
    sessionGeneration: 1,
    state: "connected",
    busy: true,
  };

  const writes: Array<{ char: string; generation: number }> = [];

  // Simulated typing function mirroring type() logic
  async function simulateType(
    targetPane: SessionPane,
    text: string,
    initialGen: number,
  ): Promise<boolean> {
    for (const char of text) {
      if (!isSessionCurrent(targetPane, initialGen)) return false;
      writes.push({ char, generation: initialGen });
      // simulated delay
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (!isSessionCurrent(targetPane, initialGen)) return false;
    }
    return true;
  }

  const typingPromise = simulateType(
    pane,
    "secret-command",
    pane.sessionGeneration,
  );

  // Reconnect happens mid-typing
  await new Promise((resolve) => setTimeout(resolve, 35));
  terminateSession(pane);
  beginSessionAttempt(pane, "new-session");

  const completed = await typingPromise;
  assert.equal(completed, false);

  // Assert that no writes were emitted after generation bumped
  assert.ok(writes.length < "secret-command".length);
  for (const w of writes) {
    assert.equal(w.generation, 1);
  }
});

test("waitStill stabilizes when output was already present without hanging until timeout", async () => {
  const mockBuffer = ["line 1", "line 2", "csdev:~$ "];
  const mockPane = {
    latency: 10,
    term: {
      rows: 24,
      buffer: {
        active: {
          baseY: 0,
          getLine: (i: number) => ({
            translateToString: () => mockBuffer[i] ?? "",
          }),
        },
      },
    },
  } as any;

  const start = Date.now();
  // With 2 required matches and 20ms poll interval, should complete in ~40-60ms, well below 500ms timeout
  const still = await waitStill(mockPane, 500, 20, 2);
  const duration = Date.now() - start;

  assert.equal(still, true);
  assert.ok(duration < 350, `Expected fast resolution but took ${duration}ms`);
});

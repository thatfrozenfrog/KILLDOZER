import assert from "node:assert/strict";
import test from "node:test";

import { sendMainAccountLogin } from "../../src/cheat/module/automation/autologin-flow.ts";

test("waits for a password prompt before sending the main account password", async () => {
  const events: string[] = [];

  const result = await sendMainAccountLogin("alice", "secret", {
    sendLogin: async (command) => events.push(`send:${command}`),
    waitForPassword: async () => {
      events.push("wait:password");
      return true;
    },
    sendPassword: async (password) => events.push(`send:${password}`),
  });

  assert.equal(result, "submitted");
  assert.deepEqual(events, [
    "send:login alice\r",
    "wait:password",
    "send:secret\r",
  ]);
});

test("does not send the password when its prompt never arrives", async () => {
  const sent: string[] = [];

  const result = await sendMainAccountLogin("alice", "secret", {
    sendLogin: async (command) => sent.push(command),
    waitForPassword: async () => false,
    sendPassword: async (password) => sent.push(password),
  });

  assert.equal(result, "timeout");
  assert.deepEqual(sent, ["login alice\r"]);
});

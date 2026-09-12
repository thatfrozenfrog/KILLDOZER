import assert from "node:assert/strict";
import test from "node:test";

test("clearing a pane's Autologin prompt state permits retrying its current prompt", async () => {
  const { AutologinPromptState } =
    await import("../../src/cheat/module/automation/autologin-state.ts");
  const prompts = new AutologinPromptState<object, "login">();
  const pane = {};

  assert.equal(prompts.claim(pane, "login", "42:login:"), true);
  assert.equal(prompts.claim(pane, "login", "42:login:"), false);

  prompts.clear(pane);

  assert.equal(prompts.claim(pane, "login", "42:login:"), true);
});

test("leaving a login prompt permits a later host to reuse the same terminal row", async () => {
  const { AutologinPromptState } =
    await import("../../src/cheat/module/automation/autologin-state.ts");
  const prompts = new AutologinPromptState<object, "login">();
  const pane = {};

  assert.equal(prompts.claim(pane, "login", "42:login:"), true);
  assert.equal(prompts.claim(pane, "login", "42:login:"), false);

  prompts.retain(pane, []);

  assert.equal(prompts.claim(pane, "login", "42:login:"), true);
});

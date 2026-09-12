import assert from "node:assert/strict";
import test from "node:test";

import { findAutologinPromptLine } from "../../src/cheat/module/automation/autologin-prompt.ts";

test("uses the prompt before a bridge control line", () => {
  assert.equal(
    findAutologinPromptLine([
      "banner",
      "login: ",
      "[[KD1|massnet|4|CALL|auth.login]]",
    ]),
    "login:",
  );
});

test("returns the latest ordinary non-empty line", () => {
  assert.equal(
    findAutologinPromptLine(["login:", "", "Password: "]),
    "Password:",
  );
});

test("can select an actionable prompt behind a BASIC input line", () => {
  assert.equal(
    findAutologinPromptLine(
      ["login:", "[[KD1|massnet|4|CALL|auth.login]]", "? "],
      (line) => /^(?:login|password):$/i.test(line),
    ),
    "login:",
  );
});

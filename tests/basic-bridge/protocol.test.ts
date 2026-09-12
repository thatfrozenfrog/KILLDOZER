import assert from "node:assert/strict";
import test from "node:test";

import {
  BasicBridgeLineParser,
  parseBridgeFrame,
} from "../../src/cheat/basicbridge-protocol.ts";

test("parses a complete frame in <id|number|OPCODE|args> format", () => {
  assert.deepEqual(parseBridgeFrame("<massnet|4|CALL|auth.login>"), {
    runId: "massnet",
    sequence: 4,
    operation: "CALL",
    arguments: ["auth.login"],
  });
});

test("parses a frame with callback flag", () => {
  assert.deepEqual(
    parseBridgeFrame("<dirmap|2|CALL|log.capture|out|callback>"),
    {
      runId: "dirmap",
      sequence: 2,
      operation: "CALL",
      arguments: ["log.capture", "out", "callback"],
    },
  );
});

test("parses RET frames with and without trailing closing bracket", () => {
  assert.deepEqual(parseBridgeFrame("<dirmap|5|RET|func.alias>"), {
    runId: "dirmap",
    sequence: 5,
    operation: "RET",
    arguments: ["func.alias"],
  });

  assert.deepEqual(parseBridgeFrame("<path|3|RET|uuhost.path"), {
    runId: "path",
    sequence: 3,
    operation: "RET",
    arguments: ["uuhost.path"],
  });
});

test("decodes percent-encoded frame arguments", () => {
  assert.deepEqual(parseBridgeFrame("<run-1|2|CAPTURE_BEGIN|host%20one>"), {
    runId: "run-1",
    sequence: 2,
    operation: "CAPTURE_BEGIN",
    arguments: ["host one"],
  });
});

test("rejects embedded, malformed, ANSI-decorated, and oversized frames", () => {
  assert.equal(parseBridgeFrame("prefix <run|1|BEGIN>"), null);
  assert.equal(parseBridgeFrame("<bad run|1|BEGIN>"), null);
  assert.equal(parseBridgeFrame("\u001b[31m<run|1|BEGIN>\u001b[0m"), null);
  assert.equal(parseBridgeFrame(`<run|1|CALL|${"a".repeat(1024)}>`), null);
  assert.equal(parseBridgeFrame("<run|1>"), null);
});

test("reassembles fragmented chunks and preserves ordinary lines", () => {
  const parser = new BasicBridgeLineParser();

  assert.deepEqual(parser.push("<run|1|BE"), []);
  assert.deepEqual(parser.push("GIN>\r\nalpha\r\nbeta"), [
    {
      line: "<run|1|BEGIN>",
      frame: {
        runId: "run",
        sequence: 1,
        operation: "BEGIN",
        arguments: [],
      },
    },
    { line: "alpha", frame: null },
  ]);
  assert.deepEqual(parser.push("\r\n"), [{ line: "beta", frame: null }]);
});

test("handles carriage-return-only and line-feed-only output", () => {
  const parser = new BasicBridgeLineParser();
  assert.deepEqual(parser.push("one\rtwo\n"), [
    { line: "one", frame: null },
    { line: "two", frame: null },
  ]);
});

test("immediately emits complete frame without waiting for newline", () => {
  const parser = new BasicBridgeLineParser();

  // Closed frame with no newline
  assert.deepEqual(parser.push("<path|3|RET|uuhost.path>"), [
    {
      line: "<path|3|RET|uuhost.path>",
      frame: {
        runId: "path",
        sequence: 3,
        operation: "RET",
        arguments: ["uuhost.path"],
      },
    },
  ]);

  // Frame followed by prompt text without newline
  assert.deepEqual(parser.push("<path|4|RET|uuhost.path> > "), [
    {
      line: "<path|4|RET|uuhost.path>",
      frame: {
        runId: "path",
        sequence: 4,
        operation: "RET",
        arguments: ["uuhost.path"],
      },
    },
  ]);

  // Next chunk finishes line
  assert.deepEqual(parser.push("input_val\r\n"), [
    { line: " > input_val", frame: null },
  ]);

  // Frame formed across chunk boundaries where '>' arrives with prompt
  assert.deepEqual(parser.push("<path|5|RET|uuhost.path"), []);
  assert.deepEqual(parser.push(">"), [
    {
      line: "<path|5|RET|uuhost.path>",
      frame: {
        runId: "path",
        sequence: 5,
        operation: "RET",
        arguments: ["uuhost.path"],
      },
    },
  ]);
});

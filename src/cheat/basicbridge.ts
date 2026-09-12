import {
  BasicBridgeLineParser,
  type BridgeFrame,
} from "./basicbridge-protocol.ts";
import type { Pane } from "../terminal/pane";

export type BridgeState = "idle" | "running" | "capturing" | "executing";

export type StandardBridgeErrorCode =
  | "credentials-disabled"
  | "malformed"
  | "bad-sequence"
  | "invalid-state"
  | "unknown-capability"
  | "wrong-prompt"
  | "timeout"
  | "capture-limit"
  | "internal";

export type BridgeErrorCode = StandardBridgeErrorCode | (string & {});

export type BridgeCallResult =
  { ok: true; data?: any } | { ok: false; error: BridgeErrorCode; data?: any };

export interface BridgeSnapshot {
  state: BridgeState;
  runId: string | null;
  lastSequence: number;
  activeCapture: string | null;
  captures: ReadonlyMap<string, readonly string[]>;
}

export interface BridgeCapabilityContext<PaneType extends object> {
  pane: PaneType;
  runId: string;
  requestSequence: number;
  getCapture(name: string): readonly string[] | undefined;
  signal: AbortSignal;
}

export interface BasicBridgeRuntimeOptions<PaneType extends object> {
  isEnabled(pane: PaneType): boolean;
  isPaused(): boolean;
  executeCapability(
    context: BridgeCapabilityContext<PaneType>,
    capability: string,
    arguments_: readonly string[],
  ): Promise<BridgeCallResult>;
  writeResponse(pane: PaneType, response: string): Promise<void>;
}

interface ActiveCapture {
  name: string;
  lines: string[];
}

interface BridgeRuntimeState {
  parser: BasicBridgeLineParser;
  state: BridgeState;
  runId: string | null;
  lastSequence: number;
  activeCapture: ActiveCapture | null;
  captures: Map<string, string[]>;
  returnValues: Map<string, string>;
  runController: AbortController | null;
  callQueue: Promise<void>;
  activeCalls: number;
}

const ANSI_REGEX = /\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g;

function freshState(): BridgeRuntimeState {
  return {
    parser: new BasicBridgeLineParser(),
    state: "idle",
    runId: null,
    lastSequence: 0,
    activeCapture: null,
    captures: new Map(),
    returnValues: new Map(),
    runController: null,
    callQueue: Promise.resolve(),
    activeCalls: 0,
  };
}

export class BasicBridgeRuntime<PaneType extends object> {
  private readonly states = new WeakMap<PaneType, BridgeRuntimeState>();
  private readonly options: BasicBridgeRuntimeOptions<PaneType>;

  constructor(options: BasicBridgeRuntimeOptions<PaneType>) {
    this.options = options;
  }

  ingest(pane: PaneType, data: string): void {
    if (!this.options.isEnabled(pane) || this.options.isPaused()) return;
    const runtime = this.getState(pane);
    for (const parsed of runtime.parser.push(data)) {
      if (parsed.frame) {
        this.handleFrame(pane, runtime, parsed.frame);
      } else if (
        runtime.state === "capturing" &&
        !parsed.line.startsWith("<")
      ) {
        runtime.activeCapture?.lines.push(parsed.line.replace(ANSI_REGEX, ""));
      }
    }
  }

  reset(pane: PaneType, _reason: string): void {
    const runtime = this.states.get(pane);
    if (runtime) {
      runtime.runController?.abort();
      runtime.runController = null;
      runtime.state = "idle";
      runtime.runId = null;
      runtime.lastSequence = 0;
      runtime.activeCapture = null;
      runtime.captures.clear();
      runtime.returnValues.clear();
      runtime.activeCalls = 0;
      this.states.delete(pane);
    }
  }

  snapshot(pane: PaneType): BridgeSnapshot {
    const runtime = this.getState(pane);
    return {
      state: runtime.state,
      runId: runtime.runId,
      lastSequence: runtime.lastSequence,
      activeCapture: runtime.activeCapture?.name ?? null,
      captures: new Map(
        [...runtime.captures].map(([name, lines]) => [name, [...lines]]),
      ),
    };
  }

  getCapture(pane: PaneType, name: string): readonly string[] | undefined {
    const lines = this.getState(pane).captures.get(name);
    return lines ? [...lines] : undefined;
  }

  private getState(pane: PaneType): BridgeRuntimeState {
    let runtime = this.states.get(pane);
    if (!runtime) {
      runtime = freshState();
      this.states.set(pane, runtime);
    }
    return runtime;
  }

  private handleFrame(
    pane: PaneType,
    runtime: BridgeRuntimeState,
    frame: BridgeFrame,
  ): void {
    if (frame.operation === "BEGIN") {
      if (
        runtime.state !== "idle" ||
        frame.sequence !== 1 ||
        frame.arguments.length !== 0
      ) {
        return;
      }
      runtime.state = "running";
      runtime.runId = frame.runId;
      runtime.lastSequence = 1;
      runtime.runController = new AbortController();
      return;
    }

    if (runtime.runId !== frame.runId) {
      console.warn(
        `[BasicBridge] Dropped frame <${frame.runId}|${frame.sequence}|${frame.operation}>: runId mismatch (expected "${runtime.runId}", got "${frame.runId}")`,
      );
      return;
    }

    if (frame.sequence !== runtime.lastSequence + 1) {
      console.warn(
        `[BasicBridge] Dropped frame <${frame.runId}|${frame.sequence}|${frame.operation}>: sequence mismatch (expected ${runtime.lastSequence + 1}, got ${frame.sequence})`,
      );
      return;
    }

    if (
      frame.operation === "CAPTURE_BEGIN" &&
      (runtime.state === "running" || runtime.state === "executing") &&
      frame.arguments.length === 1 &&
      frame.arguments[0]
    ) {
      runtime.lastSequence = frame.sequence;
      runtime.state = "capturing";
      runtime.activeCapture = { name: frame.arguments[0], lines: [] };
      return;
    }

    if (
      frame.operation === "CAPTURE_END" &&
      runtime.state === "capturing" &&
      frame.arguments.length === 1 &&
      runtime.activeCapture?.name === frame.arguments[0]
    ) {
      runtime.lastSequence = frame.sequence;
      runtime.captures.set(
        runtime.activeCapture.name,
        runtime.activeCapture.lines,
      );
      runtime.activeCapture = null;
      runtime.state = runtime.activeCalls > 0 ? "executing" : "running";
      return;
    }

    if (
      frame.operation === "CALL" &&
      (runtime.state === "running" || runtime.state === "executing") &&
      frame.arguments.length >= 1
    ) {
      const hasCallback = frame.arguments.includes("callback");
      const effectiveArgs = frame.arguments.filter((arg) => arg !== "callback");
      if (effectiveArgs.length === 0 || !effectiveArgs[0]) {
        return;
      }
      runtime.lastSequence = frame.sequence;
      runtime.state = "executing";
      runtime.activeCalls++;
      const capability = effectiveArgs[0];
      const arguments_ = effectiveArgs.slice(1);
      const signal =
        runtime.runController?.signal ?? new AbortController().signal;
      const context: BridgeCapabilityContext<PaneType> = {
        pane,
        runId: frame.runId,
        requestSequence: frame.sequence,
        getCapture: (name) => this.getCapture(pane, name),
        signal,
      };

      runtime.callQueue = runtime.callQueue
        .catch(() => {})
        .then(async () => {
          try {
            await this.finishCall(
              pane,
              runtime,
              frame,
              capability,
              arguments_,
              context,
              hasCallback,
            );
          } finally {
            runtime.activeCalls--;
            if (runtime.activeCalls === 0 && runtime.state === "executing") {
              runtime.state = "running";
            }
          }
        });
      return;
    }

    if (
      frame.operation === "RET" &&
      (runtime.state === "running" || runtime.state === "executing") &&
      frame.arguments.length <= 1
    ) {
      runtime.lastSequence = frame.sequence;
      const targetFunc = frame.arguments[0] || "__last__";
      const signal =
        runtime.runController?.signal ?? new AbortController().signal;

      runtime.callQueue = runtime.callQueue
        .catch(() => {})
        .then(async () => {
          if (
            signal.aborted ||
            runtime.state === "idle" ||
            runtime.runId !== frame.runId
          ) {
            return;
          }
          const val =
            runtime.returnValues.get(targetFunc) ??
            runtime.returnValues.get("__last__") ??
            "ERR|no-data";
          await this.options.writeResponse(pane, `${val}\r`);
        });
      return;
    }

    if (
      frame.operation === "END" &&
      (runtime.state === "running" || runtime.state === "executing") &&
      frame.arguments.length === 0
    ) {
      runtime.lastSequence = frame.sequence;
      runtime.state = "idle";
      runtime.runId = null;
      runtime.runController?.abort();
      runtime.runController = null;
      return;
    }

    console.warn(
      `[BasicBridge] Dropped frame <${frame.runId}|${frame.sequence}|${frame.operation}>: unhandled state/operation (state=${runtime.state})`,
    );
  }

  private async finishCall(
    pane: PaneType,
    runtime: BridgeRuntimeState,
    frame: BridgeFrame,
    capability: string,
    arguments_: readonly string[],
    context: BridgeCapabilityContext<PaneType>,
    hasCallback: boolean,
  ): Promise<void> {
    if (
      context.signal.aborted ||
      runtime.state === "idle" ||
      runtime.runId !== frame.runId
    ) {
      return;
    }

    let result: BridgeCallResult;
    try {
      result = await this.options.executeCapability(
        context,
        capability,
        arguments_,
      );
    } catch {
      result = { ok: false, error: "internal" };
    }

    if (
      context.signal.aborted ||
      runtime.state === "idle" ||
      runtime.runId !== frame.runId
    ) {
      return;
    }

    const dataStr = result.ok
      ? result.data !== undefined
        ? Array.isArray(result.data)
          ? result.data.join("!")
          : String(result.data)
        : "OK"
      : `ERR|${result.error}`;

    runtime.returnValues.set(capability, dataStr);
    if (capability.includes(".")) {
      const parts = capability.split(".");
      runtime.returnValues.set(parts[parts.length - 1], dataStr);
    }
    runtime.returnValues.set("__last__", dataStr);

    if (hasCallback) {
      const suffix = result.ok ? "OK" : `ERR|${result.error}`;
      await this.options.writeResponse(
        pane,
        `<${frame.runId}|${frame.sequence}|${suffix}>\r`,
      );
    }
  }
}

let applicationRuntime: BasicBridgeRuntime<Pane> | null = null;

export function configureBasicBridgeRuntime(
  runtime: BasicBridgeRuntime<Pane>,
): void {
  applicationRuntime = runtime;
}

function getApplicationRuntime(): BasicBridgeRuntime<Pane> {
  if (!applicationRuntime) {
    throw new Error("Basic bridge runtime has not been configured");
  }
  return applicationRuntime;
}

export function ingestBasicBridgeData(pane: Pane, data: string): void {
  getApplicationRuntime().ingest(pane, data);
}

export function resetBasicBridge(pane: Pane, reason: string): void {
  getApplicationRuntime().reset(pane, reason);
}

export function getBasicBridgeSnapshot(pane: Pane): BridgeSnapshot {
  return getApplicationRuntime().snapshot(pane);
}

export function getBasicBridgeCapture(
  pane: Pane,
  name: string,
): readonly string[] | undefined {
  return getApplicationRuntime().getCapture(pane, name);
}

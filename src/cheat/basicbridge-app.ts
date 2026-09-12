import type { Pane } from "../terminal/pane";
import { allPanes, getFocusedPane } from "../terminal/workspace";
import { DEBUG } from "../core/gadget";
import { isCheatEvaluationPaused, isTestMode } from "../core/test-mode";
import * as stdin from "./input";
import { BasicBridgeRuntime, configureBasicBridgeRuntime } from "./basicbridge";
import { BRIDGE_REGISTRY, executeBridgeFunction } from "./basicbridge-registry";
import {
  createBasicBridgeDevConsole,
  type BasicBridgeDevConsole,
} from "./basicbridge-devconsole";

function bridgeEnabled(pane: Pane): boolean {
  return Boolean(
    pane.cheats.Automation?.find((cheat) => cheat.name === "Basic bridge")
      ?.enabled,
  );
}

export function setupBasicBridge(): BasicBridgeRuntime<Pane> {
  const runtime = new BasicBridgeRuntime<Pane>({
    isEnabled: bridgeEnabled,
    isPaused: isCheatEvaluationPaused,
    executeCapability: executeBridgeFunction,
    writeResponse: async (pane, response) => {
      await stdin.send(pane, response, true);
    },
  });
  configureBasicBridgeRuntime(runtime);

  if (DEBUG || isTestMode()) {
    window.basicBridge = createBasicBridgeDevConsole({
      runtime,
      allPanes,
      focusedPane: getFocusedPane,
      capabilityIds: () => BRIDGE_REGISTRY.map((entry) => entry.id),
      isConnected: (pane) => pane.state === "connected",
      isBridgeEnabled: bridgeEnabled,
    });
  } else {
    delete window.basicBridge;
  }

  return runtime;
}

if (import.meta.hot) {
  import.meta.hot.accept();
}

declare global {
  interface Window {
    basicBridge?: BasicBridgeDevConsole;
  }
}

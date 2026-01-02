import { initTerminal, fitTerminal, idleTerminal, getTerminal } from "./terminal";
import { setupShellEventListeners, writeToPty, getIsConnected } from "./shell";
import { setupEventListeners, setupResizeListener } from "./events";
import { setupResizeHandle } from "./resize";

async function main() {
  // Initialize terminal
  initTerminal();
  
  // Setup event listeners
  await setupEventListeners();
  
  // Setup shell UI listeners
  setupShellEventListeners();
  
  // Setup resize handle
  setupResizeHandle();
  
  // Setup resize listener
  addEventListener("resize", () => fitTerminal(getIsConnected()));
  
  // Initial resize and render
  await fitTerminal(getIsConnected());
  void document.fonts.ready.then(() => fitTerminal(getIsConnected()));

  const term = getTerminal();
  term.onData((data: string) => {
    if (getIsConnected()) {
      writeToPty(data);
    }
  });
  
  idleTerminal();
}

main();


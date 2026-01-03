import { initTerminal, fitTerminal, idleTerminal, getTerminal } from "./terminal";
import { setupShellEventListeners, writeToPty, getIsConnected } from "./shell";
import { setupEventListeners, setupResizeListener } from "./events";
import { setupResizeHandle } from "./resize";
export const DEBUG = import.meta.env.DEV;
export let term: ReturnType<typeof getTerminal>;

async function main() {
  initTerminal();
  await setupEventListeners();
  

  setupShellEventListeners();
  setupResizeHandle();
  addEventListener("resize", () => fitTerminal(getIsConnected()));
  await fitTerminal(getIsConnected());
  void document.fonts.ready.then(() => fitTerminal(getIsConnected()));

  term = getTerminal();
  if (DEBUG){
    (window as any).term = term;
  }
  term.onData((data: string) => {
    if (getIsConnected()) {
      writeToPty(data);
    }
  });
  
  idleTerminal();
}

main();


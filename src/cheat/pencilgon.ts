import { hack, Cheat } from "./ui";
import { sleep } from "../gadget";

import * as autologin from "./module/automation/autologin"
export const INTERVAL = 250; // milliseconds
export let busy = false;
export async function cheatsOrchestrator(){
    while (true) {
        if (busy){
            await sleep(INTERVAL);
            continue;
        }
        for (const category in hack){
            for (const cheat of hack[category]){
                if (!cheat.enabled)  continue;

                try {
                    await tick(cheat);

                } catch (e) {
                    console.error(`Error in cheat ${cheat.name}:`, e);
                }
            }

        }
    
        await sleep(INTERVAL);
    }
}

async function tick(cheat: Cheat){
    switch (cheat.name) {
        case "Autologin":
            await autologin.tick(cheat);
            break;



    }
}

export function setBusy(state: boolean){
    busy = state;
}
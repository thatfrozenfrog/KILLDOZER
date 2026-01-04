import * as stdout from "../../output";
import {Cheat, hack} from "../../ui";
import { setBusy } from "../../pencilgon";
import { sleep } from "../../../gadget";
import * as stdin from "../../input";

async function sendCred(guest: boolean, cheat: Cheat){
    setBusy(true);
    const username = cheat.getConfigByLabel("username")?.value ?? "" as string;
    const password = cheat.getConfigByLabel("password")?.value ?? "" as string;
    console.log("Autologin: Sending credentials", {username, password, guest});
    
    if (guest){
       stdin.send("guest\r");
    } else {
        if (username === "" || username === "guest" || password === ""){
            console.log("Autologin: Missing username or password, aborting");
            return;
        }
        stdin.send(username + "\r" + password + "\r");
    }

    await stdout.waitStill(10000, 200);
    setBusy(false);
}

export async function tick(cheat: Cheat){
    console.log("Autologin: Tick");
    if (stdout.getLastLines(2)[0].includes("Type NEWUSER to create an account. Press control-C to interrupt any command."))
    {
        stdin.send("login ");
        await sendCred(false, cheat);
    }
}
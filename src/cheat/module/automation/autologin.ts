import * as stdout from "../../output";
import * as stdin from "../../input";
import {Cheat, hack} from "../../ui";
import { setBusy } from "../../pencilgon";
import { sleep } from "../../../gadget";


async function sendCred(guest: boolean, cheat: Cheat){
    setBusy(true);
    const username = cheat.getConfigByLabel("username")?.value ?? "" as string;
    const password = cheat.getConfigByLabel("password")?.value ?? "" as string;
    const guest1 = cheat.getValue("As Guest?") as boolean;
    console.log("Autologin: Sending credentials", {username, password, guest});
    
    if (guest &&  guest1){
       stdin.send("guest\r");
    } else {
        if (username === "" || username === "guest" || password === ""){
            console.log("Autologin: Missing username or password, aborting");
            setBusy(false);
            return;
        }
        stdin.send(username + "\r" + password + "\r");
    }
    

    setBusy(false);
}

export async function tick(cheat: Cheat){
    console.log("Autologin: Tick");
    const currentLine = stdout.getCurrentLine();
    const previousLine = stdout.getLastLines(2)[0] || "";
    const guestMode = cheat.getValue("As Guest?") as boolean;

    if (previousLine.includes("Type NEWUSER to create an account. Press control-C to interrupt any command.")) {
        console.log("[autologin] Detected login prompt, sending credentials");
        await stdin.send("login ");
        await sendCred(false, cheat);
        await stdout.waitFor("@", 10000);
        return;
    }

    if (currentLine.match(/^Name \(.+:.+\):/)) {
        console.log("[autologin] Detected login prompt, sending credentials");
        await sendCred(false, cheat);
        await stdout.waitFor("ftp>");
        return;
    }

    if ([/Login:/i, /Username:/i, /USERID:/i].some((prompt) => prompt.test(currentLine))) {
        console.log("[autologin] Detected login prompt, sending credentials");
        if (guestMode && !currentLine.includes("USERID:")) {
            await stdin.send("guest");
            await stdin.sendkey("Enter");
        } else {
            await sendCred(false, cheat);
        }
        await sleep(1000);
        return;
    }

    if (currentLine.includes("Press any key to continue =>")) {
        console.log("[autologin] Detected 'Press any key to continue' prompt, sending key");
        await stdin.sendkey(" ");
        await stdout.waitFor("Username>");
        if (guestMode) {
            await stdin.send("guest");
            await stdin.sendkey("Enter");
        } else {
            await sendCred(false, cheat);
        }
    }
}
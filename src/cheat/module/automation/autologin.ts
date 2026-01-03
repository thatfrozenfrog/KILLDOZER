import * as stdout from "../../output";
import {Cheat, hack} from "../../ui";



async function sendCred(guest: boolean, cheat: Cheat){
    const username = cheat.getConfigByLabel("username") ?? "" as string;
    const password = cheat.getConfigByLabel("password") ?? "" as string;
    console.log("Autologin: Sending credentials", {username, password, guest});
    if (guest){
    }
}

export async function tick(cheat: Cheat){
    console.log("Autologin: Tick");
    if (stdout.getLastLines(2)[0].includes("Type NEWUSER to create an account. Press control-C to interrupt any command."))
    {
        sendCred(true, cheat);
    }   
}
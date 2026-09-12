export type AutologinFlowResult = "submitted" | "timeout";

export interface MainAccountLoginActions {
  command?: string;
  sendLogin(command: string): Promise<void>;
  waitForPassword(): Promise<boolean>;
  sendPassword(password: string): Promise<void>;
}

export async function sendMainAccountLogin(
  account: string,
  password: string,
  actions: MainAccountLoginActions,
): Promise<AutologinFlowResult> {
  await actions.sendLogin(actions.command ?? `login ${account}\r`);
  if (!(await actions.waitForPassword())) return "timeout";
  await actions.sendPassword(`${password}\r`);
  return "submitted";
}

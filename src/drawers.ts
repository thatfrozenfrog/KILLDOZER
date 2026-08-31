import { getFocusedPane, allPanes } from "./workspace";
import { connectShell, disconnectShell, saveDefaultConnection } from "./shell";
import { onChromeChange, refreshChrome } from "./chrome";
import type { Pane } from "./pane";
import { loadConnectionProfiles, profileToConnection, saveConnectionProfile } from "./profiles";
import { applyCheatSettings, saveDefaultCheats, serializeCheatState } from "./cheat/registry";
import { invalidateCheatDrawer } from "./cheat/ui";
import { CustomDropdown } from "./cheat/dropdown";

let boundPane: Pane | null = null;
let profileDialogPane: Pane | null = null;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function closeDrawers(): void {
  document.getElementById("connection-drawer")?.classList.remove("open");
  document.getElementById("cheats-drawer")?.classList.remove("open");
}

export function toggleDrawer(id: string): void {
  const drawer = document.getElementById(id);
  if (!drawer) return;
  const wasOpen = drawer.classList.contains("open");
  closeDrawers();
  if (!wasOpen) drawer.classList.add("open");
}

export function confirmDialog(message: string, title = "Confirm"): Promise<boolean> {
  const dialog = document.getElementById("confirm-dialog") as HTMLDialogElement | null;
  if (!dialog) return Promise.resolve(window.confirm(message));

  const titleEl = document.getElementById("confirm-dialog-title");
  const msgEl = document.getElementById("confirm-dialog-message");
  const cancelBtn = document.getElementById("confirm-dialog-cancel") as HTMLButtonElement | null;
  const form = document.getElementById("confirm-dialog-form") as HTMLFormElement | null;

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      cancelBtn?.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
      if (form) form.onsubmit = null;
      if (dialog.open) dialog.close();
      resolve(result);
    };

    const onCancel = (e: Event) => {
      e.preventDefault();
      finish(false);
    };
    const onClose = () => {
      finish(dialog.returnValue === "confirm");
    };

    cancelBtn?.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.returnValue = "";

    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        dialog.returnValue = "confirm";
        finish(true);
      };
    }

    dialog.showModal();
  });
}

export function setupDrawers(): void {
  el("toggle-connection").addEventListener("click", () => toggleDrawer("connection-drawer"));
  el("toggle-cheats").addEventListener("click", () => toggleDrawer("cheats-drawer"));

  const username = el<HTMLInputElement>("username");
  const proxyIp = el<HTMLInputElement>("proxy-ip");
  const proxyPort = el<HTMLInputElement>("proxy-port");
  const proxyAuthEnabled = el<HTMLInputElement>("proxy-auth-enabled");
  const proxyAuthFields = el<HTMLDivElement>("proxy-auth-fields");
  const proxyUsername = el<HTMLInputElement>("proxy-username");
  const proxyPassword = el<HTMLInputElement>("proxy-password");
  const connectBtn = el<HTMLButtonElement>("connect-btn");
  const disconnectBtn = el<HTMLButtonElement>("disconnect-btn");
  const statusText = el<HTMLSpanElement>("status-text");
  const profilePicker = el<HTMLButtonElement>("profile-picker");
  const profileMenu = el<HTMLDivElement>("profile-menu");
  const profileDropdown = new CustomDropdown(profilePicker, profileMenu);
  const saveProfileBtn = el<HTMLButtonElement>("save-profile-btn");
  const profileDialog = el<HTMLDialogElement>("profile-dialog");
  const profileDialogForm = el<HTMLFormElement>("profile-dialog-form");
  const profileName = el<HTMLInputElement>("profile-name");
  const profileDialogMessage = el<HTMLParagraphElement>("profile-dialog-message");
  const profileDialogSave = el<HTMLButtonElement>("profile-dialog-save");
  const closeProfileDialog = () => {
    profileDialog.close();
    profileDialogPane = null;
    profileDialogSave.textContent = "Save profile";
  };

  const profiles = () => loadConnectionProfiles();
  const renderProfiles = (selected = profileDropdown.value) => {
    profileDropdown.setOptions([
      { value: "", text: "Choose a profile" },
      ...profiles().map((profile) => ({
        value: profile.name,
        text: profile.name,
        tooltip: `${profile.username || "guest"} · ${profile.proxyAddress || "no proxy"}${profile.proxyPort ? ":" + profile.proxyPort : ""} · ${profile.proxyUsername || "no proxy user"} · password ${profile.proxyPassword || "not set"}`,
        actionLabel: "Save current configuration to " + profile.name,
        onAction: async () => {
          const confirmed = await confirmDialog(`Save current configuration to "${profile.name}"?`, "Save Profile");
          if (!confirmed) return;
          const pane = getFocusedPane();
          const defaultPane = Array.from(allPanes()).find((candidate) => candidate.isDefault);
          if (pane) {
            saveConnectionProfile(profile.name, pane.connection, defaultPane ? serializeCheatState(defaultPane.cheats) : profile.cheats);
            renderProfiles(profile.name);
          }
        },
      })),
    ], selected);
  };
  renderProfiles();

  const edit = (fn: (pane: Pane) => void) => () => {
    const pane = getFocusedPane();
    if (!pane) return;
    fn(pane);
    if (pane.isDefault) saveDefaultConnection(pane.connection);
    refreshChrome();
  };

  username.addEventListener("input", edit((p) => (p.connection.username = username.value)));
  proxyIp.addEventListener("input", edit((p) => (p.connection.proxyAddress = proxyIp.value)));
  proxyPort.addEventListener("input", edit((p) => (p.connection.proxyPort = proxyPort.value)));
  proxyUsername.addEventListener("input", edit((p) => (p.connection.proxyUsername = proxyUsername.value)));
  proxyPassword.addEventListener("input", edit((p) => (p.connection.proxyPassword = proxyPassword.value)));
  proxyAuthEnabled.addEventListener("change", edit((p) => {
    p.connection.proxyAuthEnabled = proxyAuthEnabled.checked;
    proxyAuthFields.classList.toggle("hidden", !proxyAuthEnabled.checked);
  }));

  connectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const pane = getFocusedPane();
    if (pane) void connectShell(pane);
  });
  disconnectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const pane = getFocusedPane();
    if (pane) void disconnectShell(pane);
  });
  profileDropdown.onSelect((value) => {
    const pane = getFocusedPane();
    const profile = profiles().find((candidate) => candidate.name === value);
    if (!pane || pane.state !== "disconnected" || !profile) return;
    pane.connection = profileToConnection(profile);
    const defaultPane = Array.from(allPanes()).find((candidate) => candidate.isDefault);
    // applyCheatSettingsdefaultPane.cheats, profile.cheats
    if (defaultPane && profile.cheats) {
      applyCheatSettings(defaultPane.cheats, profile.cheats);
      saveDefaultCheats(defaultPane.cheats);
      invalidateCheatDrawer();
    }
    boundPane = null;
    refreshChrome();
  });
  saveProfileBtn.addEventListener("click", () => {
    const pane = getFocusedPane();
    if (!pane || pane.state !== "connected") return;
    profileDialogPane = pane;
    profileName.value = "";
    profileDialogMessage.textContent = "";
    profileDialogSave.textContent = "Save profile";
    profileDialog.showModal();
    profileName.focus();
  });
  el<HTMLButtonElement>("profile-dialog-cancel").addEventListener("click", closeProfileDialog);
  profileDialog.addEventListener("cancel", () => { profileDialogPane = null; });
  profileDialog.addEventListener("close", () => {
    profileDialogPane = null;
    profileDialogSave.textContent = "Save profile";
  });
  profileName.addEventListener("input", () => {
    profileDialogSave.textContent = "Save profile";
    profileDialogMessage.textContent = "";
  });
  profileDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const pane = profileDialogPane;
    const name = profileName.value.trim();
    if (!pane || pane.state !== "connected") return closeProfileDialog();
    if (!name) {
      profileDialogMessage.textContent = "Profile name is required.";
      return;
    }
    const exists = profiles().some((profile) => profile.name === name);
    if (exists && profileDialogSave.textContent !== "Replace profile") {
      profileDialogMessage.textContent = `A profile named “${name}” already exists. Click Replace profile to overwrite it.`;
      profileDialogSave.textContent = "Replace profile";
      return;
    }
    const defaultPane = Array.from(allPanes()).find((candidate) => candidate.isDefault);
    // saveConnectionProfilename, pane.connection, defaultPane.cheats
    if (defaultPane) saveConnectionProfile(name, pane.connection, defaultPane.cheats);
    else saveConnectionProfile(name, pane.connection);
    renderProfiles(name);
    closeProfileDialog();
  });

  onChromeChange(() => {
    const pane = getFocusedPane();
    if (profileDialogPane && (!pane || pane !== profileDialogPane || pane.state !== "connected")) closeProfileDialog();
    const busy = pane?.state !== "disconnected";

    if (pane && pane !== boundPane) {
      boundPane = pane;
      username.value = pane.connection.username;
      proxyIp.value = pane.connection.proxyAddress;
      proxyPort.value = pane.connection.proxyPort;
      proxyAuthEnabled.checked = pane.connection.proxyAuthEnabled;
      proxyUsername.value = pane.connection.proxyUsername;
      proxyPassword.value = pane.connection.proxyPassword;
      proxyAuthFields.classList.toggle("hidden", !pane.connection.proxyAuthEnabled);
      const matching = profiles().find((profile) => {
        const connection = profileToConnection(profile);
        return Object.keys(connection).every((key) => connection[key as keyof typeof connection] === pane.connection[key as keyof typeof pane.connection]);
      });
      renderProfiles(matching?.name ?? "");
    }

    username.disabled = busy;
    proxyIp.disabled = busy;
    proxyPort.disabled = busy;
    proxyAuthEnabled.disabled = busy;
    proxyUsername.disabled = busy || !proxyAuthEnabled.checked;
    proxyPassword.disabled = busy || !proxyAuthEnabled.checked;

    connectBtn.disabled = !pane || pane.state !== "disconnected";
    disconnectBtn.disabled = !pane || pane.state === "disconnected";
    saveProfileBtn.disabled = !pane || pane.state !== "connected";

    if (!pane) statusText.textContent = "No pane";
    else if (pane.state === "connected") statusText.textContent = "Connected \u2014 " + pane.identity() + "@telehack.com:2222";
    else if (pane.state === "connecting") statusText.textContent = "Connecting\u2026";
    else statusText.textContent = "Disconnected";
  });
}

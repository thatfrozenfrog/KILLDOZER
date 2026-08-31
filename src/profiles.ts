import { serializeCheatState, type CheatState, type SerializedCheatState } from "./cheat/registry";
import type { ConnectionConfig, ConnectionProfile } from "./types";

const STORAGE_KEY = "connection-profiles";

export function loadConnectionProfiles(): ConnectionProfile[] {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved) as Array<Partial<ConnectionProfile>>;
    return parsed.filter((profile): profile is ConnectionProfile => typeof profile?.name === "string").map((profile) => ({
      name: profile.name!,
      username: typeof profile.username === "string" ? profile.username : "guest",
      proxyAddress: typeof profile.proxyAddress === "string" ? profile.proxyAddress : "",
      proxyPort: typeof profile.proxyPort === "string" ? profile.proxyPort : "",
      proxyUsername: typeof profile.proxyUsername === "string" ? profile.proxyUsername : "",
      proxyPassword: typeof profile.proxyPassword === "string" ? profile.proxyPassword : "",
      proxyAuthEnabled: typeof profile.proxyAuthEnabled === "boolean" ? profile.proxyAuthEnabled : Boolean(profile.proxyUsername || profile.proxyPassword),
      cheats: profile.cheats,
    }));
  } catch (error) {
    console.error("Failed to load connection profiles:", error);
    return [];
  }
}

export function saveConnectionProfile(name: string, config: ConnectionConfig, cheats?: SerializedCheatState | CheatState): void {
  const serialized = cheats
    ? Object.values(cheats).some((arr) => arr.some((c: any) => typeof c?.getValue === "function"))
      ? serializeCheatState(cheats as CheatState)
      : (cheats as SerializedCheatState)
    : undefined;
  const profile: ConnectionProfile = {
    name: name.trim(), username: config.username, proxyAddress: config.proxyAddress,
    proxyPort: config.proxyPort, proxyUsername: config.proxyUsername, proxyPassword: config.proxyPassword,
    proxyAuthEnabled: config.proxyAuthEnabled, cheats: serialized,
  };
  const profiles = loadConnectionProfiles();
  const existing = profiles.findIndex((candidate) => candidate.name === profile.name);
  if (existing >= 0) profiles[existing] = profile;
  else profiles.push(profile);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function profileToConnection(profile: ConnectionProfile): ConnectionConfig {
  return {
    username: profile.username,
    proxyAddress: profile.proxyAddress,
    proxyPort: profile.proxyPort,
    proxyAuthEnabled: profile.proxyAuthEnabled,
    proxyUsername: profile.proxyUsername,
    proxyPassword: profile.proxyPassword,
  };
}

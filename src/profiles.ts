import type { ConnectionConfig, ConnectionProfile } from "./types";

const STORAGE_KEY = "connection-profiles";

export function loadConnectionProfiles(): ConnectionProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((profile): profile is ConnectionProfile =>
      profile && typeof profile.name === "string" && typeof profile.username === "string"
    ).map((profile) => ({
      name: profile.name,
      username: profile.username,
      proxyAddress: typeof profile.proxyAddress === "string" ? profile.proxyAddress : "",
      proxyPort: typeof profile.proxyPort === "string" ? profile.proxyPort : "",
      proxyUsername: typeof profile.proxyUsername === "string" ? profile.proxyUsername : "",
      proxyPassword: typeof profile.proxyPassword === "string" ? profile.proxyPassword : "",
      proxyAuthEnabled: typeof profile.proxyAuthEnabled === "boolean" ? profile.proxyAuthEnabled : Boolean(profile.proxyUsername || profile.proxyPassword),
    }));
  } catch (error) {
    console.error("Failed to load connection profiles:", error);
    return [];
  }
}

export function saveConnectionProfile(name: string, config: ConnectionConfig): void {
  const profile: ConnectionProfile = {
    name: name.trim(),
    username: config.username,
    proxyAddress: config.proxyAddress,
    proxyPort: config.proxyPort,
    proxyUsername: config.proxyUsername,
    proxyPassword: config.proxyPassword,
    proxyAuthEnabled: config.proxyAuthEnabled,
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

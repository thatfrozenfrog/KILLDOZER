import { invoke } from "@tauri-apps/api/core";

const rocksReady = Promise.all([
  loadRock("/rock/smallrock"),
  loadRock("/rock/bigrock"),
]);

async function loadRock(path: string): Promise<Uint8Array[]> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(
      `Failed to load hash candidates from ${path}: ${response.status}`,
    );
  }

  return (await response.text())
    .split(/\r?\n/)
    .filter((candidate) => candidate.length > 0)
    .map((candidate) => new TextEncoder().encode(candidate));
}

export async function validateDescryptHash(hash: string): Promise<void> {
  await invoke("validate_descrypt_hash", { hash });
}

export async function crackDescryptHash(
  hash: string,
  candidates: Uint8Array[],
): Promise<Uint8Array | null> {
  const found = await invoke<number[] | null>("crack_descrypt_hash", {
    hash,
    candidates: candidates.map((candidate) => Array.from(candidate)),
  });
  return found === null ? null : Uint8Array.from(found);
}

export async function crack(
  hash: string,
  isBig = false,
): Promise<Uint8Array | null> {
  const [smallRock, bigRock] = await rocksReady;
  return crackDescryptHash(hash, isBig ? bigRock : smallRock);
}

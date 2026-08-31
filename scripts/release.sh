#!/usr/bin/env bash
set -euo pipefail

VERSION="${1#v}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: pnpm release 1.2.3"
  exit 1
fi

TAG="v$VERSION"

if [[ "$(node -p "require('./package.json').version")" != "$VERSION" ]]; then
  pnpm version "$VERSION" --no-git-tag-version
fi

node - "$VERSION" <<'NODE'
const fs = require("fs");

const version = process.argv[2];

const tauriPath = "src-tauri/tauri.conf.json";
const config = JSON.parse(fs.readFileSync(tauriPath, "utf8"));
config.version = version;
fs.writeFileSync(tauriPath, JSON.stringify(config, null, 2) + "\n");

const cargoPath = "src-tauri/Cargo.toml";
const cargo = fs.readFileSync(cargoPath, "utf8");
fs.writeFileSync(cargoPath, cargo.replace(/^version = "[^"]+"$/m, `version = "${version}"`));
NODE

# Keep Cargo.lock's root package version aligned with Cargo.toml.
cargo check --manifest-path src-tauri/Cargo.toml

git add package.json pnpm-lock.yaml src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
if [ -f CHANGELOG.md ]; then
  git add CHANGELOG.md
fi
git commit -m "chore(release): $TAG"
git tag -a "$TAG" -m "chore(release): $TAG"

echo
echo "Created $TAG"
echo "Push with:"
echo "  git push origin main --follow-tags"

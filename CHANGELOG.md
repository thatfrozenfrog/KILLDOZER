# Changelog

All notable changes to KILLDOZER are documented in this file.

## 2.0.0

2026-09-12

### Added

- Added a per-pane TeleBASIC bridge for framed terminal captures and a restricted catalog of local operations.
- Added bridge capabilities for opt-in Autologin, capture logging, scan export, and Telehack host route lookup.
- Added a development and Test Mode console for replaying bridge frames, inspecting captures, and checking registered capabilities.
- Added native save dialogs for exporting scan results, with browser fallbacks when the native bridge is unavailable.
- Added automated coverage for the bridge protocol, runtime, capability registry, Autologin integration, terminal sessions, and window shutdown.

### Changed

- Terminal commands now carry session-generation tokens so reconnecting or disconnecting safely aborts stale automation.
- PTY writes, resizes, and shutdown now coordinate access to each session and release pane automation locks during cleanup.
- Cheat ticks can run across panes concurrently while remaining serialized within each pane.
- Autologin now tracks prompts per pane and waits for the password prompt before submitting a password.
- Command execution now reports completed, timed-out, failed, or aborted status while preserving its array-like output.

### Fixed

- Prevented terminal events from being lost when a PTY becomes ready before shell creation finishes.
- Prevented stale connection attempts and delayed automation from writing into a replacement session.
- Improved orderly app shutdown so active SSH and PTY processes are terminated before the window closes.
- Improved Porthack prompt synchronization and current-host parsing during chained automation.
- Corrected SOCKS5 proxy response validation and synchronized concurrent native PTY access.

## 1.2.0

### Nu-Features

- Icon

### Improvements

- Fixed bug with Github API preventing user from downloading new patches
- Added an alert before downloading
- "DOCTOOS"
- Added download progress hook

## 1.1.0

### Nu-Feat

- Different profiles now have different cheat configurations. Change them in the `[DEFAULT]` pane.
- Now you can update each of your profiles. Click on the `💾` button

### Improvements

- Better tab control for nusoi
- You now no longer be able to select text outside of terminal
- Adjusted opacity

## 1.0.1

### Nu-Feat

- In-app updates
- Custom windows (target for wayland)
- Stable Arch linux CD
- Added automated version bumping and release management script.

## 1.0.0

### Nu-Feat

- Multi-panel and tabs
- Literally everything else

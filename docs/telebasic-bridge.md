# TeleBASIC bridge

The TeleBASIC bridge lets a program running in the terminal mark output for
local capture and request a small set of explicitly registered Killdozer
operations. It is enabled separately for each pane from the **Basic bridge**
cheat card.

## Protocol

Every bridge instruction must be printed as a complete line:

```text
<id|number|OPCODE|optional-arguments...|callback>
```

- `id` contains 1-32 ASCII letters, digits, dots, underscores, or hyphens.
- `number` starts at `1` and increases by exactly one for each frame.
- Argument characters outside the simple ASCII set can be percent encoded.
- A control marker embedded in another line is treated as ordinary output.
- Only `BEGIN`, `CAPTURE_BEGIN`, `CAPTURE_END`, `CALL`, and `END` are valid OPCODES.

One run can have one active capture or capability call at a time:

```text
<massnet|1|BEGIN>
<massnet|2|CAPTURE_BEGIN|filesystem-host1>
bin
etc
home
<massnet|3|CAPTURE_END|filesystem-host1>
<massnet|4|END>
```

This stores the local array `filesystem-host1` as:

```text
["bin", "etc", "home"]
```

Reusing a capture name replaces its previous array. Captures are isolated by
pane and remain in memory until the bridge is disabled, the pane disconnects,
or `basicBridge.reset()` is called.

## Capability calls

Registered in `src/cheat/basicbridge-registry.ts`. Enable **Allow credentials** in the Basic
bridge configuration before using `auth.login`. The username and password always come
from the same pane's local Autologin configuration; protocol arguments cannot
replace them.

The TeleBASIC program should include `callback` when it needs a reply from
Killdozer, and wait for the result immediately after printing the call. In schematic
TeleBASIC syntax:

```basic
PRINT "<massnet|4|CALL|auth.login|callback>"
INPUT BRIDGE_REPLY$
```

If `callback` is present, Killdozer responds to the PTY with one of:

```text
<massnet|4|OK>
<massnet|4|ERR|credentials-disabled>
<massnet|4|ERR|wrong-prompt>
<massnet|4|ERR|timeout>
<massnet|4|ERR|unknown-capability>
```

If `callback` is not specified, Killdozer executes the capability without sending any
reply back into the terminal session.

The credential operation checks recent terminal output for a login or password
prompt, ignoring the bridge marker itself. Calls have a 10-second timeout and
always release the pane automation lock.

## Development console

Development builds and Test Mode expose `window.basicBridge`. Methods use the
focused pane unless a pane ID is supplied:

```javascript
basicBridge.panes();

basicBridge.feed("<console-test|1|BEGIN>\r\n");
basicBridge.feed("<console-test|2|CAPTURE_BEGIN|demo>\r\n");
basicBridge.feed("alpha\r\nbeta\r\n");
basicBridge.feed("<console-test|3|CAPTURE_END|demo>\r\n");

basicBridge.capture("demo");
// ["alpha", "beta"]

basicBridge.captures();
basicBridge.snapshot();
basicBridge.capabilities();
basicBridge.reset();
```

`feed()` uses the production parser, state machine, permission checks, and
capability registry. Snapshot and capture methods return defensive copies and
never expose configured credentials.

## Adding a capability

Export the capability function and register a `BridgeFunctionEntry` in the registry
array in `src/cheat/basicbridge-registry.ts`. A capability should validate its
arguments, use only the supplied pane, apply a bounded timeout, and return a
structured bridge result. Do not look up arbitrary cheat handlers or module
exports from a protocol-provided name.

## Trust model

The remote service can observe, forge, reorder, or replay terminal markers and
responses. Run IDs and sequence numbers coordinate execution but do not
authenticate the remote program. Enabling **Allow credentials** authorizes
credential requests without another local confirmation, so it should be
enabled only while that behavior is intended.

The bridge does not provide arbitrary JavaScript evaluation, arbitrary terminal
input, `th_exec`, dynamic imports, or generic calls into cheat exports.

## TeleBASIC cheat catalog

Store TeleBASIC programs in `src/cheat/telebasic/`. This directory contains the
remote programs that a user pastes or installs in Telehack; it must not contain
TypeScript capability implementations.

Use one snake-case `.bas` file per program:

```text
src/cheat/
├── telebasic/
│   ├── README.md
│   ├── mass_login_netstat.bas
│   └── another_remote_program.bas
├── basicbridge.ts
├── basicbridge-capabilities.ts
└── module/
    └── automation/
        └── basic_bridge.ts
```

The directory is a source catalog only in v1. Files are not auto-discovered,
executed, uploaded, or installed by Vite or Killdozer. Installation remains an
explicit user action.

### Creating a TeleBASIC cheat

Start each file with a short `REM` header so its bridge dependencies are visible
without reading the full program:

```basic
REM NAME: Mass login netstat
REM BRIDGE: KD1
REM CAPABILITIES: auth.login
REM CAPTURES: filesystem-<host>
REM DESCRIPTION: Logs into each host and captures its filesystem listing.
```

Then follow these rules:

1. Use a stable run ID that describes the program, such as `massnet`.
2. Start every execution with sequence `1` and `BEGIN`.
3. Increase the sequence by exactly one for every bridge frame.
4. Give repeated captures unique names, normally including the target host.
5. After `CALL`, immediately wait for and inspect the bridge response.
6. Handle every `ERR` response instead of assuming the local action succeeded.
7. End a successful run with `END`.
8. Never place usernames, passwords, or other secrets in marker arguments.

Bridge control output should be centralized in a small group of TeleBASIC
subroutines rather than duplicated throughout the program. At minimum, keep the
current run ID and sequence counter in one place and provide helpers equivalent
to:

```text
BRIDGE_BEGIN(run_id)
BRIDGE_CAPTURE_BEGIN(name)
BRIDGE_CAPTURE_END(name)
BRIDGE_CALL(capability_id)
BRIDGE_END()
```

The names above describe responsibilities; implement them using syntax supported
by the target TeleBASIC version.

### Maintaining a TeleBASIC cheat

When changing a `.bas` file:

- Keep its header capability and capture lists accurate.
- Do not change its run ID merely because its implementation changed.
- Restart numbering from `1` for each execution, not for each host or capture.
- Keep bridge markers on otherwise empty output lines.
- Percent-encode arguments that contain protocol separator characters.
- Test failure paths with Basic bridge disabled and with Allow credentials off.
- Use `basicBridge.feed(...)` to reproduce its exact frames locally.
- Inspect the result with `basicBridge.snapshot()` and
  `basicBridge.capture(name)`.

If a TeleBASIC change needs a new local operation, update both sides together:

1. Add a narrow TypeScript operation shared with the relevant normal cheat.
2. Register a stable ID in `basicbridge-capabilities.ts`.
3. Add capability tests covering arguments, permission checks, result mapping,
   timeout behavior, and pane lock cleanup.
4. Add the capability ID to the `.bas` file's header.
5. Document the new response errors here.

Do not rename an existing capability ID after a TeleBASIC program depends on it.
Add a new ID and retain the old adapter until every cataloged `.bas` file has
been migrated.

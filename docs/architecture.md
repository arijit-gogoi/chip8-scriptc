# Architecture

## The short version

`src/chip8.ts` is a CHIP-8 interpreter that knows nothing about screens,
keyboards or speakers: you give it a ROM, call `stepFrame()` sixty times a
second, tell it which keys are down, and read its framebuffer. `src/main.ts` is
the host that does exactly that, either against a raylib window or against
standard output ("headless"). scriptc compiles both files to machine code and
links them with a small C shim over raylib. The result is one executable with
no JavaScript engine inside.

## Directory map

| Path | Role |
| ---- | ---- |
| `src/chip8.ts` | the interpreter core: memory, registers, stack, timers, display buffer, keypad, all 35 opcodes, quirk switches |
| `src/font.ts` | the 16 built-in hexadecimal digit sprites |
| `src/cli.ts` | argument parsing, usage text, quirk profile selection (pure functions, unit-tested) |
| `src/main.ts` | the host: loads the ROM, runs the 60 Hz frame loop, maps keyboard to keypad, draws, beeps; or runs headless |
| `src/rl.d.ts` | ambient `declare function` signatures for the C shim; scriptc binds them through the FFI manifest |
| `native/c8rl.c` | the shim: scalar-only C wrappers around the raylib calls the host needs |
| `native/ffi.base.json` | the FFI manifest: one entry per shim function with its C ABI |
| `native/vendor/raylib-6.0/src` | raylib's source at the pinned tag, fetched by the build, ignored by git |
| `native/build/` | build outputs: raylib objects and archive, shim object, generated `ffi.json` |
| `scripts/build.ts` | the build pipeline (see [toolchain.md](toolchain.md)) |
| `scripts/verify.ts` | builds, then checks that the native binary and bun produce identical headless output |
| `tests/chip8.test.ts` | opcode and edge-case unit tests against the core |
| `tests/cli.test.ts` | argument parsing tests |
| `tests/roms.test.ts`, `tests/snapshots/` | Timendus test ROMs run through the core, framebuffers compared with stored snapshots |
| `roms/tests`, `roms/games` | test ROMs and CC0 games |
| `dist/` | the executable (`chip8.exe`), its debug info, and the LLVM IR scriptc generated |

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│ host (TypeScript)          src/main.ts   src/cli.ts              │
│   arguments, ROM loading, 60 Hz frame loop, key mapping,         │
│   drawing calls, beep, headless text output                      │
├──────────────────────────────────────────────────────────────────┤
│ core (TypeScript)          src/chip8.ts  src/font.ts             │
│   memory, V0-VF, I, PC, stack, timers, display, keypad, opcodes  │
│   no I/O, no clock of its own, deterministic                     │
├──────────────────────────────────────────────────────────────────┤
│ FFI boundary               src/rl.d.ts  <->  native/ffi.base.json│
│   sixteen declare-only functions, bound by name to C symbols     │
├──────────────────────────────────────────────────────────────────┤
│ shim (C)                   native/c8rl.c                         │
│   window, rectangles, text, key state, square-wave audio stream  │
├──────────────────────────────────────────────────────────────────┤
│ raylib 6.0 (C)             native/vendor/raylib-6.0/src          │
│   GLFW window and input, OpenGL drawing, miniaudio output        │
└──────────────────────────────────────────────────────────────────┘
```

The core never calls upward or downward. That is what makes it runnable under
bun for tests and under scriptc for the binary without any change, and what
makes the headless mode an exact stand-in for the windowed one.

## One frame, from keys to pixels

`runWindowed()` in `src/main.ts` does this sixty times a second (raylib's
`SetTargetFPS(60)` paces the loop):

1. Read host keys: `P` toggles pause, `M` mute, `Backspace` resets and reloads
   the ROM, `+`/`-` change instructions per frame.
2. For each of the sixteen CHIP-8 keys, ask raylib whether the mapped keyboard
   key is down (`c8rl_key_down`) and store it with `vm.setKey()`.
3. `vm.stepFrame(ipf)`: execute up to `ipf` instructions (default 11), stop
   early after a sprite draw when the display-wait quirk is on, then decrement
   the delay and sound timers once.
4. `c8rl_beep(vm.soundTimer > 0)` and `c8rl_audio_update()`: keep raylib's
   audio stream filled with either a 440 Hz square wave or silence.
5. Compute the largest integer scale that fits the current window, then
   `c8rl_draw_display(vm.display, 64, 32, x, y, scale, fg, bg)`: the whole
   2048-byte framebuffer crosses the FFI once and the shim draws one rectangle
   per lit pixel. If the interpreter halted or is paused, `c8rl_draw_text`
   writes the reason on top.

`runHeadless()` replaces steps 1, 2, 4 and 5 with scripted key presses
(`--press k@frame+hold`) and, after the last frame, `renderAscii()` printed to
stdout followed by a status line with PC, I and the timers.

## Build-time flow

```
native/vendor/raylib-6.0/src/*.c  --zig cc-->  native/build/raylib/*.o  --zig ar-->  native/build/libraylib.a
native/c8rl.c                     --zig cc-->  native/build/c8rl.o
native/ffi.base.json  +  libraries  +  system_libraries   --->  native/build/ffi.json
src/main.ts (+ chip8.ts, cli.ts, font.ts, rl.d.ts)
        --scriptc build --ffi native/build/ffi.json  (SCRIPTC_CC=zigcc)-->  dist/chip8.exe
```

scriptc type-checks the program, lowers it to LLVM IR (`dist/main.ll`),
compiles that and its own C runtime with `zig cc`, and links everything with
the two archives and the system libraries named in the manifest. Details in
[scriptc.md](scriptc.md) and [toolchain.md](toolchain.md).

## Tests and verification

- `bun test` runs three suites against the TypeScript directly: opcode
  semantics and edge cases, argument parsing, and Timendus' test ROMs compared
  with framebuffer snapshots.
- `bun run verify` builds the binary and runs eleven headless cases through
  both `dist/chip8.exe` and `bun src/main.ts`, requiring byte-identical
  output. This is the check that scriptc's compilation preserved the program's
  behaviour, including error paths.

## Design decisions

- **Core and host are separate files with a one-way dependency.** The core is
  testable in milliseconds under bun and needs no mocking; the host is thin.
- **Interpreter differences are data.** `Quirks` holds six booleans; two
  factory functions give the CHIP-8 and SUPER-CHIP presets, `--wrap` and
  `--no-wait` override single fields. Opcode code reads the flags; nothing is
  duplicated per profile.
- **Bad ROMs halt, they do not throw.** Unknown opcodes, `0NNN`, and stack
  over/underflow set `halted` and `haltReason`; the host shows the reason in
  the window. scriptc's runtime traps are not catchable, so the core avoids
  relying on exceptions for control flow.
- **Randomness is deterministic.** `CXNN` uses a fixed-seed xorshift, so a
  ROM run is reproducible: unit tests, snapshots and native-vs-bun comparison
  all depend on that.
- **The FFI is scalar.** scriptc cannot pass structs, so the shim takes
  integers and byte buffers; colours travel as `0xRRGGBBAA`, the framebuffer
  as one `Uint8Array` per frame.
- **Headless mode is the oracle.** Everything the emulator does that matters
  ends up in the framebuffer and the status line, so text output is enough to
  compare implementations, freeze snapshots, and script key presses.

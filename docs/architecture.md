# Architecture

## The short version

`src/chip8.ts` is a CHIP-8 and SUPER-CHIP interpreter that knows nothing
about screens, keyboards or speakers: you give it a ROM, call `stepFrame()`
sixty times a second, tell it which keys are down, and read its framebuffer.
`src/main.ts` is the host that does exactly that, either against a raylib
window or against standard output ("headless"). scriptc compiles both files
to machine code and links them with a small C shim over raylib. The result is
one executable with no JavaScript engine inside.

A second program, `src/tools.ts`, is the assembler and disassembler. It
shares only a path helper (`src/paths.ts`) with the interpreter, uses no
FFI, and compiles to its own executable, `chip8-tools`.

## Directory map

| Path | Role |
| ---- | ---- |
| `src/chip8.ts` | the interpreter core: memory, registers, stack, timers, display buffer, keypad, the 35 CHIP-8 opcodes and the 10 SUPER-CHIP ones, quirk switches and profiles |
| `src/font.ts` | the 16 built-in hexadecimal digit sprites and SUPER-CHIP's 10 large digits |
| `src/cli.ts` | argument parsing, usage text, quirk profile selection (pure functions, unit-tested) |
| `src/paths.ts` | `baseName()`, the last segment of a path with either separator |
| `src/main.ts` | the host: loads the ROM, runs the 60 Hz frame loop, maps keyboard to keypad, draws, beeps, keeps the flag register file; or runs headless |
| `src/opcodes.ts` | the instruction table: mnemonic, operand kinds, opcode and mask for every instruction; decode, encode, format |
| `src/asm.ts` | two-pass assembler: source text to ROM bytes, errors by line |
| `src/disasm.ts` | disassembler: traces the code from `0x200`, lists the rest as data, in a form `asm.ts` reads back |
| `src/tools.ts`, `src/tools-cli.ts` | the `chip8-tools` program: `asm` and `dis`, and their argument parsing |
| `src/web.ts`, `web/index.html` | the browser host: same core, canvas, keyboard and on-screen keypad, Web Audio beep; bundled by bun, no scriptc involved |
| `scripts/build-web.ts` | bundles the browser host into `dist/web/` with the page, every ROM and a `roms.json` manifest; `--serve` hosts it locally |
| `src/rl.d.ts` | ambient `declare function` signatures for the C shim; scriptc binds them through the FFI manifest |
| `native/c8rl.c` | the shim: scalar-only C wrappers around the raylib calls the host needs |
| `native/ffi.base.json` | the FFI manifest: one entry per shim function with its C ABI |
| `native/vendor/raylib-6.0/src` | raylib's source at the pinned tag, fetched by the build, ignored by git |
| `native/build/` | build outputs: raylib objects and archive, shim object, generated `ffi.json` |
| `scripts/build.ts` | the build pipeline (see [toolchain.md](toolchain.md)) |
| `scripts/verify.ts` | builds, then checks that both native binaries and bun produce identical output |
| `tests/chip8.test.ts` | opcode and edge-case unit tests against the core, CHIP-8 and SUPER-CHIP |
| `tests/cli.test.ts` | argument parsing tests |
| `tests/roms.test.ts`, `tests/snapshots/` | Timendus test ROMs run through the core in each profile, framebuffers compared with stored snapshots |
| `tests/tools.test.ts` | the opcode table, the assembler, the disassembler, and a round trip through both for every ROM |
| `roms/tests`, `roms/games`, `roms/schip` | test ROMs, CC0 CHIP-8 games, CC0 SUPER-CHIP programs |
| `dist/` | the executables (`chip8.exe`, `chip8-tools.exe`) and the LLVM IR scriptc generated for each |

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│ host (TypeScript)          src/main.ts   src/cli.ts              │
│   arguments, ROM loading, 60 Hz frame loop, key mapping,         │
│   drawing calls, beep, headless text output                      │
├──────────────────────────────────────────────────────────────────┤
│ core (TypeScript)          src/chip8.ts  src/font.ts             │
│   memory, V0-VF, I, PC, stack, timers, display, keypad, opcodes, │
│   flag registers; no I/O, no clock of its own, deterministic     │
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
5. Compute the largest integer scale at which the current resolution
   (`vm.width` x `vm.height`: 64x32, or 128x64 after SUPER-CHIP's `00FF`)
   fits the window, then
   `c8rl_draw_display(vm.display, vm.width, vm.height, x, y, scale, fg, bg)`:
   the framebuffer crosses the FFI once and the shim draws one rectangle per
   lit pixel. If the interpreter halted or is paused, `c8rl_draw_text`
   writes the reason on top.

After each frame the host also writes the SUPER-CHIP flag registers to the
`--flags` file if `FX75` changed them.

`runHeadless()` replaces steps 1, 2, 4 and 5 with scripted key presses
(`--press k@frame+hold`) and, after the last frame, `renderAscii()` printed to
stdout followed by a status line with PC, I and the timers.

## The browser host

`src/web.ts` is the same loop against browser APIs: `requestAnimationFrame`
with a 1/60 s accumulator (so a 144 Hz display still gets 60 CHIP-8 frames
per second, and a background tab catches up by at most four frames),
`keydown`/`keyup` by physical key code, pointer events on sixteen on-screen
buttons, an `ImageData` of the current resolution scaled onto the canvas, and
a Web Audio square-wave oscillator whose gain follows the sound timer. The
core does not run until a ROM is loaded; choosing one from the list also
selects the quirk profile `roms.json` gives for it. `bun run build:web` bundles it with
`Bun.build` and copies the page and every ROM into `dist/web/`, a static
site with no server-side part. scriptc plays no role here: the browser runs
the TypeScript as JavaScript, which is the reason the core avoids anything
either environment lacks.

## Build-time flow

```
native/vendor/raylib-6.0/src/*.c  --zig cc-->  native/build/raylib/*.o  --zig ar-->  native/build/libraylib.a
native/c8rl.c                     --zig cc-->  native/build/c8rl.o
native/ffi.base.json  +  libraries  +  system_libraries   --->  native/build/ffi.json
src/main.ts (+ chip8.ts, cli.ts, font.ts, paths.ts, rl.d.ts)
        --scriptc build --tier static-only --ffi native/build/ffi.json-->  dist/chip8.exe
src/tools.ts (+ tools-cli.ts, asm.ts, disasm.ts, opcodes.ts, paths.ts)
        --scriptc build --tier static-only-->  dist/chip8-tools.exe
```

scriptc type-checks the program, lowers it to LLVM IR (`dist/main.ll`),
compiles that to machine code, and links it with scriptc's precompiled
runtime, the shim object, the raylib archive and the system libraries named
in the manifest. zig is the linker on Windows, clang on Linux. The tools
build is the same without the manifest; its IR is `dist/tools.ll`. Details
in [scriptc.md](scriptc.md) and [toolchain.md](toolchain.md).

## Tests and verification

- `bun test` runs four suites against the TypeScript directly: opcode
  semantics and edge cases, argument parsing, Timendus' test ROMs compared
  with framebuffer snapshots, and the assembler and disassembler.
- `bun run verify` builds both binaries and runs twenty headless cases
  through both `dist/chip8.exe` and `bun src/main.ts`, requiring
  byte-identical output. For every ROM in `roms/` it compares the listing
  from `dist/chip8-tools.exe` with bun's and has the native assembler
  rebuild the ROM from the native listing; five error cases follow. This is
  the check that scriptc's compilation preserved the programs' behaviour,
  including error paths.

## Design decisions

- **Core and host are separate files with a one-way dependency.** The core is
  testable in milliseconds under bun and needs no mocking; the host is thin.
- **Interpreter differences are data.** `Quirks` holds ten booleans, one of
  which switches the SUPER-CHIP instructions on; three factory functions give
  the CHIP-8, modern SUPER-CHIP and SUPER-CHIP 1.1 profiles, and `--wrap` and
  `--no-wait` override single fields. Opcode code reads the flags; nothing is
  duplicated per profile.
- **One framebuffer for both resolutions.** `display` is allocated for
  128x64 and holds the current resolution row by row, `width` pixels per
  row, so CHIP-8's 64x32 picture is the first 2048 bytes and every host
  passes `vm.width` and `vm.height` along with it.
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
- **The assembler and the disassembler read one table.** `src/opcodes.ts`
  lists each instruction once, with its mnemonic, operand kinds, opcode and
  mask. The disassembler decodes with it and the assembler encodes with it,
  so a listing always assembles back to the bytes it came from; the tests
  check this for every 16-bit word and every ROM.

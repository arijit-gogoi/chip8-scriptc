# chip8-scriptc

A CHIP-8 interpreter written in plain TypeScript, compiled to a self-contained
native executable with [scriptc](https://scriptc.dev) (no Node, no JS engine in
the binary) and displayed with [raylib](https://www.raylib.com) through
scriptc's native FFI.

Documentation: [docs/](docs/README.md) explains how the repository fits
together (architecture, scriptc, the bun/zig/raylib toolchain);
[docs/howto/](docs/howto/README.md) is a tutorial on writing a CHIP-8
emulator in TypeScript, following the code in `src/`.

```
src/chip8.ts            CPU, memory, timers, display buffer, keypad, quirk switches
src/font.ts             built-in hexadecimal font
src/main.ts             frame loop, key mapping, headless mode
src/cli.ts              argument parsing, usage text, quirk profile selection
src/web.ts, web/        browser host: canvas, keyboard, on-screen keypad, Web Audio beep
src/rl.d.ts             ambient FFI declarations for the raylib shim
native/c8rl.c           scalar-only C wrappers around raylib
native/ffi.base.json    FFI manifest (functions); the build adds libraries per platform
native/vendor/          raylib source at the pinned tag, fetched by the build (ignored by git)
scripts/build.ts        compiles raylib and the shim with zig cc, generates ffi.json, runs scriptc
scripts/build-web.ts    bundles the browser host and copies the ROMs into dist/web/
scripts/verify.ts       checks native executable output against bun running the same source
tests/chip8.test.ts     opcode-level unit tests
tests/cli.test.ts       argument parsing tests
tests/roms.test.ts      Timendus test-suite framebuffer snapshots (tests/snapshots/)
roms/                   Timendus' test suite and CC0 games (see roms/README.md)
```

## Prerequisites

| Tool | Used for |
| ---- | -------- |
| [bun](https://bun.sh) | scripts, tests, package install, running the scriptc compiler |
| [zig](https://ziglang.org) 0.13+ | `zig cc` compiles raylib, the shim, and scriptc's runtime |
| git | first build only: sparse-clones raylib's `src` at the pinned tag (about 15 MB) |

scriptc is a pinned devDependency and runs under bun. The build sets
`SCRIPTC_CC=zigcc`, so every object in the executable (raylib, shim, scriptc
runtime) comes from the same compiler and C runtime. `SCRIPTC=<command>`
overrides how scriptc is invoked.

Platforms: Windows x64 is tested. Linux needs the X11 development headers
(raylib's GLFW backend; the manifest links `GL X11 m pthread dl rt`). macOS is
refused by the build: raylib needs frameworks, which scriptc's FFI manifest
cannot express.

## Build and run

```
bun install
bun test                       # opcode unit tests (pure TypeScript, runs under bun)
bun run build                  # -> dist/chip8.exe (about 2.3 MB, raylib included)
bun run build -- --clean       # also rebuild raylib (otherwise cached in native/build)
dist\chip8.exe roms\games\outlaw.ch8
bun run build -- --run roms\tests\3-corax+.ch8
```

A clean build takes about 80 s on a laptop (raylib ~15 s, scriptc ~30 s).
Incremental builds skip raylib, and scriptc caches unchanged programs, so a
rebuild without source changes takes a couple of seconds. zig's linker writes a
`chip8.pdb` next to the executable; it is debug info and can be deleted.

```
usage: chip8 <rom.ch8> [options]

  --ipf <n>            instructions per 60 Hz frame (default 11)
  --scale <n>          window pixels per CHIP-8 pixel (default 12)
  --quirks <profile>   chip8 (COSMAC VIP, default) or schip (SUPER-CHIP 1.1)
  --wrap               wrap sprites around the screen edges instead of clipping
  --no-wait            do not limit DXYN to one sprite per frame
  --no-sound           do not open an audio device
  --fg <rrggbb>        pixel colour (default dcdcdc)
  --bg <rrggbb>        background colour (default 202020)
  --headless <frames>  run without a window, then print the display as text
  --press <k>@<f>[+n]  headless only: hold hex key k from frame f for n frames (default 30)
```

Keys: `1234` / `QWER` / `ASDF` / `ZXCV` map to the hex keypad
(`123C` / `456D` / `789E` / `A0BF`). `P` pauses, `Backspace` resets, `+`/`-`
change speed, `M` mutes, `Esc` quits. The window is resizable; the display is
scaled to the largest integer factor that fits.

Headless mode runs the same core without raylib and prints the framebuffer as
`#`/`.` rows. It works in the native binary and under bun
(`bun src/main.ts rom.ch8 --headless 120`), so the compiled program can be
checked against the interpreted one:

```
dist\chip8.exe roms\tests\5-quirks.ch8 --headless 1500 --press 1@30
```

## Browser

```
bun run build:web              # -> dist/web/: web.js, index.html, roms.json, roms/
bun run build:web -- --serve   # same, then serve it at http://localhost:8080/
```

`src/web.ts` is a second host for the same core: bun bundles it to plain
JavaScript (no scriptc, no wasm), `web/index.html` supplies a canvas, the
controls and an on-screen keypad, and every ROM in `roms/` is copied next to
it with a `roms.json` manifest, so the folder is a complete static site.
Keyboard mapping and host keys are the same as the native build; `.ch8` files
can be dropped on the page. Sound is a Web Audio square wave, started on the
first key press because browsers require a user gesture.

A WebAssembly build of the native executable is not possible: scriptc's only
wasm target is `wasm32-wasi`, which excludes the native FFI, so raylib cannot
be part of it.

## Tests

```
bun test          # opcodes, edge cases, argument parsing, test-suite snapshots
bun run verify    # build, then diff native vs interpreted headless output over a ROM set
```

`tests/roms.test.ts` runs Timendus' test ROMs through the core and compares the
framebuffer with `tests/snapshots/*.txt`; those files show every corax+ and
flags row passing and all six quirks detected as expected for CHIP-8.
`UPDATE_SNAPSHOTS=1 bun test tests/roms.test.ts` rewrites them after an
intentional change. `scripts/verify.ts` covers what unit tests cannot: that
the scriptc-compiled binary behaves exactly like the same TypeScript under
bun, including error paths.

## Semantics

The instruction set follows
[mattmikolay's CHIP-8 reference](https://github.com/mattmikolay/chip-8/wiki/CHIP%E2%80%908-Instruction-Set),
i.e. the original COSMAC VIP interpreter:

- `8XY6` / `8XYE` store a shifted **VY** in VX; VF gets the shifted-out bit.
- `FX55` / `FX65` leave `I = I + X + 1`.
- `BNNN` jumps to `NNN + V0`.
- `8XY1` / `8XY2` / `8XY3` reset VF.
- `8XY4` / `8XY5` / `8XY7` write VX first, then VF (so `8FY4` keeps the flag).
- `DXYN` wraps the start position, clips the sprite at the edges, XORs pixels
  and sets VF on collision; at most one sprite is drawn per frame.
- `FX0A` reports a key when it is **released**.
- `0NNN` machine-code calls, unknown opcodes and stack over/underflow halt the
  interpreter and show the reason in the window.

`--quirks schip` switches to SUPER-CHIP behaviour (shift VX in place, `I`
unchanged after `FX55`/`FX65`, `BXNN`, no VF reset, no display wait), which is
what many later ROMs expect. Timendus' test suite passes in the default profile:
logo, IBM logo, corax+ (all opcodes), flags, and quirks (all six quirks
detected as expected).

## FFI

scriptc binds signature-only `declare function` declarations to C symbols via a
JSON manifest (`--ffi`). Supported argument classes are numbers (`f64`, `i32`,
`u32`, `u8`), `bool`, `string` (pointer + length) and `bytes`
(`Uint8Array`, pointer + length). Structs cannot cross the boundary, so
`native/c8rl.c` exposes raylib as scalar functions: colours travel as
`0xRRGGBBAA` integers and the whole 64x32 framebuffer is passed once per frame
as a byte buffer (`c8rl_draw_display`). Audio is a 440 Hz square wave pushed
into a raylib audio stream while the sound timer is non-zero.

The manifest's `libraries` entries are plain link inputs: the shim object file
(`./c8rl.o`) and `./libraylib.a`.

## References

CHIP-8 specification and opcodes:

- [CHIP-8 Instruction Set](https://github.com/mattmikolay/chip-8/wiki/CHIP%E2%80%908-Instruction-Set)
  (mattmikolay) — the 35 opcodes and their original COSMAC VIP semantics; the
  default `chip8` profile follows this table, including its footnotes on
  `8XY6`/`8XYE` (shift VY) and `FX55`/`FX65` (I incremented).
- [Mastering CHIP-8](https://github.com/mattmikolay/chip-8/wiki/Mastering-CHIP%E2%80%908)
  (mattmikolay) — memory map, registers, 60 Hz timers, XOR sprite drawing,
  keypad layout, font sprite data.
- [Cowgod's Chip-8 Technical Reference v1.0](http://devernay.free.fr/hacks/chip8/C8TECH10.HTM)
  — the classic reference; its `8XY6`/`8XYE` (shift VX) and `FX55`/`FX65`
  (I unchanged) descriptions correspond to the `schip` profile.
- [CHIP-8 opcode table](https://en.wikipedia.org/wiki/CHIP-8#Opcode_table)
  (Wikipedia) — SUPER-CHIP-1991-based table with footnotes on the original
  behaviour; used to cross-check opcode coverage.
- [An Introduction to Chip-8 Emulation using the Rust Programming Language](https://github.com/aquova/chip8-book)
  (aquova) — emulator structure reference.
- [Building a CHIP-8 Emulator (C++)](https://austinmorlan.com/posts/chip8_emulator/)
  (Austin Morlan) — the walkthrough whose structure `docs/howto/` follows.
- [CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite)
  (Timendus) — the test ROMs in `roms/tests`, and the quirk definitions
  (VF reset, memory, display wait, clipping, shifting, jumping) behind
  `Quirks` in `src/chip8.ts`.
- [chip8Archive](https://github.com/JohnEarnest/chip8Archive) (John Earnest)
  — the CC0 games in `roms/games`.

Toolchain:

- [scriptc](https://scriptc.dev) — [introduction](https://scriptc.dev/introduction),
  [native FFI](https://scriptc.dev/ffi), [limitations](https://scriptc.dev/limitations),
  [platforms](https://scriptc.dev/platforms); source at
  [vercel-labs/scriptc](https://github.com/vercel-labs/scriptc).
- [raylib](https://www.raylib.com) — API from `raylib.h` 6.0; source at
  [raysan5/raylib](https://github.com/raysan5/raylib).

## scriptc static-tier constraints

The code stays inside scriptc's static tier (no `--dynamic`), which means:

- no `Uint16Array`: the call stack is a plain `number[]`;
- no `TypedArray.fill`: explicit loops;
- no compound element assignment (`a[i] ^= v`): read-modify-write;
- no `number.toString(radix)`: hand-rolled hex formatter;
- arrays are dense and out-of-bounds indexing traps: `process.argv` is copied
  with explicit length checks.

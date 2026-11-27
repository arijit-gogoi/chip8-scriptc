# chip8-scriptc

[![CI](https://github.com/arijit-gogoi/chip8-scriptc/actions/workflows/ci.yml/badge.svg)](https://github.com/arijit-gogoi/chip8-scriptc/actions/workflows/ci.yml)

A CHIP-8 and SUPER-CHIP interpreter written in plain TypeScript, compiled to a
self-contained native executable with [scriptc](https://scriptc.dev) (no Node,
no JS engine in the binary) and displayed with [raylib](https://www.raylib.com)
through scriptc's native FFI. A second executable, `chip8-tools`, assembles
and disassembles CHIP-8 programs.

Documentation: [docs/](docs/README.md) explains how the repository fits
together (architecture, scriptc, the bun/zig/raylib toolchain);
[docs/howto/](docs/howto/README.md) is a tutorial on writing a CHIP-8
emulator in TypeScript, following the code in `src/`, up to SUPER-CHIP and the
assembler and disassembler. The blog post
[docs/blog/chip8-scriptc.md](docs/blog/chip8-scriptc.md) describes the
project for readers who have not seen the code: how scriptc compiles it, the
raylib FFI, the toolchain, and how the native binaries are checked against
bun.

```
src/chip8.ts            CPU, memory, timers, display buffer, keypad, quirk switches and profiles
src/font.ts             built-in hexadecimal font and SUPER-CHIP's large digits
src/main.ts             frame loop, key mapping, headless mode, flag register file
src/cli.ts              argument parsing, usage text, quirk profile selection
src/paths.ts            baseName(), shared by the emulator and the tools
src/web.ts, web/        browser host: canvas, keyboard, on-screen keypad, Web Audio beep
src/rl.d.ts             ambient FFI declarations for the raylib shim
src/opcodes.ts          instruction table shared by the assembler and the disassembler
src/asm.ts              two-pass assembler
src/disasm.ts           disassembler that follows the code from 0x200
src/tools.ts            chip8-tools entry point (asm, dis); src/tools-cli.ts parses its arguments
native/c8rl.c           scalar-only C wrappers around raylib
native/ffi.base.json    FFI manifest (functions); the build adds libraries per platform
native/vendor/          raylib source at the pinned tag, fetched by the build (ignored by git)
scripts/build.ts        compiles raylib and the shim with zig cc, generates ffi.json, runs scriptc twice
scripts/build-web.ts    bundles the browser host and copies the ROMs into dist/web/
scripts/verify.ts       checks native output against bun running the same source
tests/chip8.test.ts     opcode-level unit tests, CHIP-8 and SUPER-CHIP
tests/cli.test.ts       argument parsing tests
tests/roms.test.ts      Timendus test-suite framebuffer snapshots (tests/snapshots/)
tests/tools.test.ts     opcode table, assembler, disassembler, round trips over roms/
roms/                   Timendus' test suite and CC0 CHIP-8 and SUPER-CHIP programs (see roms/README.md)
```

## Prerequisites

| Tool | Used for |
| ---- | -------- |
| [bun](https://bun.sh) | scripts, tests, package install |
| [zig](https://ziglang.org) 0.16+ | `zig cc` compiles raylib and the shim; on Windows scriptc also links the executables with zig |
| git | first build only: sparse-clones raylib's `src` at the pinned tag (about 15 MB) |
| clang (Linux only) | scriptc's linker on glibc Linux |

scriptc (0.4.17) is a pinned devDependency. Its package installs a native
compiler for the platform from a postinstall script, which bun runs because
`package.json` lists scriptc in `trustedDependencies`; the compiler itself
needs no JavaScript runtime. scriptc links the emulator with its own
precompiled runtime, the raylib archive and the shim object. On Windows the
linker is zig, so raylib, the shim and the runtime meet in zig's mingw-w64 C
runtime.

Platforms: Windows x64 is tested. Linux needs the X11 development headers
(raylib's GLFW backend; the manifest links `GL X11 m pthread dl rt`). macOS is
refused by the build: it is untested, and raylib's system frameworks would
need an `ffi_format` 7 manifest.

## Build and run

```
bun install
bun test                       # unit, snapshot and round-trip tests (pure TypeScript, runs under bun)
bun run build                  # -> dist/chip8.exe (about 1.9 MB, raylib included) and dist/chip8-tools.exe
bun run build -- --clean       # also rebuild raylib (otherwise cached in native/build)
dist\chip8.exe roms\games\outlaw.ch8
dist\chip8.exe roms\schip\octogon.ch8 --quirks schip --ipf 200
bun run build -- --run roms\tests\3-corax+.ch8
```

The first build takes a couple of minutes, mostly zig building its C runtime
and raylib. zig caches both and scriptc caches compiled programs, so later
builds take seconds, even with `--clean`.

```
usage: chip8 <rom.ch8> [options]

  --ipf <n>            instructions per 60 Hz frame (default 11)
  --scale <n>          window pixels per low-resolution pixel (default 12)
  --quirks <profile>   chip8 (COSMAC VIP, default), schip (modern SUPER-CHIP)
                       or schip-legacy (SUPER-CHIP 1.1 on the HP-48)
  --wrap               wrap sprites around the screen edges instead of clipping
  --no-wait            do not limit DXYN to one sprite per frame
  --no-sound           do not open an audio device
  --fg <rrggbb>        pixel colour (default dcdcdc)
  --bg <rrggbb>        background colour (default 202020)
  --flags <file>       keep the SUPER-CHIP flag registers (FX75/FX85) in this file
  --headless <frames>  run without a window, then print the display as text
  --press <k>@<f>[+n]  headless only: hold hex key k from frame f for n frames (default 30)
```

Keys: `1234` / `QWER` / `ASDF` / `ZXCV` map to the hex keypad
(`123C` / `456D` / `789E` / `A0BF`). `P` pauses, `Backspace` resets, `+`/`-`
change speed, `M` mutes, `Esc` quits. The window is resizable; the display is
scaled to the largest integer factor that fits, for 64x32 or for SUPER-CHIP's
128x64.

Headless mode runs the same core without raylib and prints the framebuffer as
`#`/`.` rows, 64 or 128 to a row depending on the resolution. It works in the
native binary and under bun (`bun src/main.ts rom.ch8 --headless 120`), so
the compiled program can be checked against the interpreted one:

```
dist\chip8.exe roms\tests\5-quirks.ch8 --headless 1500 --press 1@30
```

## Browser

Live: <https://arijit-gogoi.github.io/chip8-scriptc/> (deployed by CI from
`main`).

```
bun run build:web              # -> dist/web/: web.js, index.html, roms.json, roms/
bun run build:web -- --serve   # same, then serve it at http://localhost:8080/
```

`src/web.ts` is a second host for the same core: bun bundles it to plain
JavaScript (no scriptc, no wasm), `web/index.html` supplies a canvas, the
controls and an on-screen keypad, and every ROM in `roms/` is copied next to
it with a `roms.json` manifest, so the folder is a complete static site.
Choosing a ROM from the list also selects the quirk profile it expects.
Keyboard mapping and host keys are the same as the native build; `.ch8` files
can be dropped on the page. Sound is a Web Audio square wave, started on the
first key press because browsers require a user gesture.

A WebAssembly build of the native executable is not possible: scriptc's only
wasm target is `wasm32-wasi`, which excludes the native FFI, so raylib cannot
be part of it.

## Tests

```
bun test          # opcodes, edge cases, argument parsing, test-suite snapshots, assembler and disassembler
bun run verify    # build, then diff native vs interpreted output of both executables
```

`tests/roms.test.ts` runs Timendus' test ROMs through the core and compares the
framebuffer with `tests/snapshots/*.txt`; those files show every corax+ and
flags row passing, all six quirks detected as expected for CHIP-8, modern
SUPER-CHIP and SUPER-CHIP 1.1, and every arrow of the scrolling test inside
its box in both low-resolution modes and in high resolution.
`UPDATE_SNAPSHOTS=1 bun test tests/roms.test.ts` rewrites them after an
intentional change. `tests/tools.test.ts` assembles the listing of every
opcode word and of every ROM in `roms/` and requires the original bytes back.
`scripts/verify.ts` covers what unit tests cannot: that the scriptc-compiled
binaries behave exactly like the same TypeScript under bun, including error
paths.

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

Timendus' test suite passes in this profile: logo, IBM logo, corax+ (all
opcodes), flags, and quirks (all six quirks detected as expected).

## SUPER-CHIP

`--quirks schip` and `--quirks schip-legacy` run SUPER-CHIP programs. Both
add its instructions:

| Opcode | Mnemonic | Effect |
| ------ | -------- | ------ |
| `00CN` | `SCD N` | scroll the display down N rows |
| `00FB` / `00FC` | `SCR` / `SCL` | scroll right / left 4 pixels |
| `00FD` | `EXIT` | end the program (the interpreter halts with "program exited") |
| `00FE` / `00FF` | `LOW` / `HIGH` | 64x32 / 128x64 pixels; the display is cleared |
| `DXY0` | `DRW Vx, Vy, 0` | draw a 16x16 sprite, two bytes per row |
| `FX30` | `LD HF, Vx` | point I at the large 8x10 digit VX (0-9) |
| `FX75` / `FX85` | `LD R, Vx` / `LD Vx, R` | save / load V0..VX in the flag registers |

Both profiles shift VX in place, leave I unchanged after `FX55`/`FX65`, jump
with `BXNN` to `XNN + VX`, do not reset VF, and clip sprites. They differ
where SUPER-CHIP 1.1 on the HP-48 calculators behaves differently from the
interpreters written since, Octo among them:

| Behaviour | `schip` (modern) | `schip-legacy` (HP-48) |
| --------- | ---------------- | ---------------------- |
| display wait | never | in low resolution |
| scrolling in low resolution | 4 pixels sideways, N rows down | half as far: 2 pixels, N/2 rows |
| `DXY0` in low resolution | 16x16 | 8x16 |
| VF after `DXYN` in high resolution | 1 or 0 | rows that collide plus rows clipped at the bottom |

Switching resolution clears the display in both profiles; the HP-48 keeps
the old picture. There are 16 flag registers (the HP-48 has 8, Octo 16); they
survive a reset, and `--flags <file>` loads them at start and saves them after
each `FX75`. Under `--quirks chip8` the SUPER-CHIP instructions halt with a
message that names them, and `DXY0` draws nothing, as on the VIP.

Timendus' quirks test passes in both SUPER-CHIP profiles, and his scrolling
test passes in modern and legacy low resolution and in high resolution.
Sources for the HP-48 behaviour: Timendus'
[Legacy SUPER-CHIP](https://github.com/Timendus/chip8-test-suite/blob/main/legacy-superchip.md)
notes, Gulrak's [opcode table](https://chip8.gulrak.net), and Chromatophore's
[HP48-Superchip](https://github.com/Chromatophore/HP48-Superchip)
investigations.

## Assembler and disassembler

```
dist\chip8-tools.exe dis roms\games\outlaw.ch8            # listing on standard output
dist\chip8-tools.exe dis roms\games\outlaw.ch8 -o outlaw.s
dist\chip8-tools.exe asm outlaw.s -o outlaw.ch8           # the same 512 bytes again
bun src/tools.ts dis roms\games\outlaw.ch8                # the same program under bun
```

The disassembler follows the program from `0x200`: jumps, calls, and both
outcomes of every skip. Bytes it reaches become instructions, labelled
`sub_XXX` (called), `label_XXX` (jumped to) or `data_XXX` (loaded into I);
every other byte becomes a `db` line with the byte drawn as a sprite row. A
computed jump (`BNNN`) is marked and not followed, so code reached only that
way stays data. Each line ends with the address and the original word; the
IBM logo ROM starts like this:

```
    CLS                         ; 200: 00E0
    LD   I, data_22A            ; 202: A22A
    LD   V0, 0x0C               ; 204: 600C
...
data_22A:
    db   0xFF                   ; 22A: ########
```

The listing is valid assembler input. The assembler reads one statement per
line: `name:` labels, `NAME = expression` constants, `org` (forward only,
zero-filled), `db` bytes and `dw` big-endian words, and instructions in
[Cowgod's](http://devernay.free.fr/hacks/chip8/C8TECH10.HTM) mnemonics plus
SUPER-CHIP's (`SCD`, `SCR`, `SCL`, `EXIT`, `LOW`, `HIGH`, `LD HF, Vx`,
`LD R, Vx`, `LD Vx, R`). Numbers are decimal, `0x` hexadecimal or `0b`
binary; expressions add and subtract numbers, labels and constants; `;`
starts a comment. Errors carry the line number:

```
outlaw.s: line 12: 0x100 (256) is outside the byte range -128-255
```

[Chapter 11](docs/howto/11-assembler-disassembler.md) of the tutorial lists
every form and explains both programs.

## FFI

scriptc binds signature-only `declare function` declarations to C symbols via a
JSON manifest (`--ffi`). The manifest uses `ffi_format` 1, whose argument
classes are numbers (`f64`, `i32`, `u32`, `u8`), `bool`, `string` (pointer +
length) and `bytes` (`Uint8Array`, pointer + length); later formats add
callbacks and more classes, which this project does not need. Structs cannot
cross the boundary, so
`native/c8rl.c` exposes raylib as scalar functions: colours travel as
`0xRRGGBBAA` integers and the framebuffer (64x32 or 128x64) is passed once per
frame as a byte buffer (`c8rl_draw_display`). Audio is a 440 Hz square wave
pushed into a raylib audio stream while the sound timer is non-zero.

The manifest's `libraries` entries are plain link inputs: the shim object file
(`./c8rl.o`) and `./libraylib.a`. `chip8-tools` uses no FFI.

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
  — the classic reference, with SUPER-CHIP's instructions; its `8XY6`/`8XYE`
  (shift VX) and `FX55`/`FX65` (I unchanged) descriptions correspond to the
  SUPER-CHIP profiles, and its mnemonics are the assembler's.
- [CHIP-8 opcode table](https://en.wikipedia.org/wiki/CHIP-8#Opcode_table)
  (Wikipedia) — SUPER-CHIP-1991-based table with footnotes on the original
  behaviour; used to cross-check opcode coverage.
- [CHIP-8 variant opcode table](https://chip8.gulrak.net) (Gulrak) — which
  instruction exists on which interpreter, with the SUPER-CHIP 1.1 footnotes
  behind the `schip-legacy` profile.
- [HP48-Superchip](https://github.com/Chromatophore/HP48-Superchip)
  (Chromatophore) — SUPER-CHIP's behaviour measured on HP-48 calculators:
  8x16 `DXY0` in low resolution, VF row counts, scrolling, the large font.
- [An Introduction to Chip-8 Emulation using the Rust Programming Language](https://github.com/aquova/chip8-book)
  (aquova) — emulator structure reference.
- [Building a CHIP-8 Emulator (C++)](https://austinmorlan.com/posts/chip8_emulator/)
  (Austin Morlan) — the walkthrough whose structure `docs/howto/` follows.
- [CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite)
  (Timendus) — the test ROMs in `roms/tests`, the quirk definitions (VF reset,
  memory, display wait, clipping, shifting, jumping) behind `Quirks` in
  `src/chip8.ts`, and the notes on legacy SUPER-CHIP.
- [Octo](https://github.com/JohnEarnest/Octo) (John Earnest) — the modern
  SUPER-CHIP behaviour of the `schip` profile, and the byte values of the
  large digits.
- [chip8Archive](https://github.com/JohnEarnest/chip8Archive) (John Earnest)
  — the CC0 programs in `roms/games` and `roms/schip`.

Toolchain:

- [scriptc](https://scriptc.dev) — [introduction](https://scriptc.dev/introduction),
  [native FFI](https://scriptc.dev/ffi), [limitations](https://scriptc.dev/limitations),
  [platforms](https://scriptc.dev/platforms); source at
  [vercel-labs/scriptc](https://github.com/vercel-labs/scriptc).
- [raylib](https://www.raylib.com) — API from `raylib.h` 6.0; source at
  [raysan5/raylib](https://github.com/raysan5/raylib).

## scriptc static-tier constraints

The build passes `--tier static-only`, so any construct that scriptc cannot
compile to native code is a build error, and `scriptc coverage src/main.ts
--ffi native/build/ffi.json` reports the whole emulator as static, as
`scriptc coverage src/tools.ts` does for the tools.

One scriptc rule shapes the code: runtime traps cannot be caught, and
scriptc's documentation lists out-of-range reads of statically typed arrays
among them. So memory addresses wrap with `& 0xfff`, a bad opcode or a stack
overflow halts the interpreter instead of throwing, and the assembler and
disassembler check every index before they read an array.

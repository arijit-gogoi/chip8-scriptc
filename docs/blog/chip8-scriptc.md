# A CHIP-8 emulator in TypeScript, compiled to native code with scriptc

*27 November 2026 · Source: [arijit-gogoi/chip8-scriptc](https://github.com/arijit-gogoi/chip8-scriptc) ·
Play it in the browser: [arijit-gogoi.github.io/chip8-scriptc](https://arijit-gogoi.github.io/chip8-scriptc/)*

[scriptc](https://scriptc.dev) is an experimental compiler from Vercel Labs
that turns TypeScript into a native executable with no JavaScript engine
inside. This project is a CHIP-8 and SUPER-CHIP emulator written only in
TypeScript, compiled to native code with scriptc 0.4.17, with
[raylib](https://www.raylib.com) for the display, plus an assembler and a
disassembler compiled the same way. It is also a fair test of whether
scriptc can carry a complete interactive program.

It can. The repository builds `chip8.exe`, a 1.9 MB Windows executable with
raylib linked in, from 1,099 lines of TypeScript and a 154-line C shim. It
opens a resizable window, maps the keyboard to the hex keypad, and beeps.
Next to it, `chip8-tools.exe` is the assembler and disassembler, 893 lines of
TypeScript with no C at all. The same TypeScript runs unchanged under bun,
and a second front end runs the emulator in the browser. This post covers how
the pieces fit, how scriptc compiles the programs and calls raylib, the C
toolchain around them, and how the native binaries are checked against bun.

## Why CHIP-8

CHIP-8 is a virtual machine that Joseph Weisbecker created in 1977 for the
COSMAC VIP, a hobbyist computer. The machine is tiny: 4 KB of memory, sixteen
8-bit registers (V0 to VF), an address register, a call stack, two timers that
count down at 60 Hz, a 64 × 32 monochrome display that sprites are XORed onto,
a 16-key hex keypad, and 35 two-byte instructions. SUPER-CHIP, a 1991
interpreter for the HP-48 calculators, adds ten more: a 128 × 64 mode,
scrolling, 16 × 16 sprites, large digits, and registers that outlive the
program. The emulator runs both.

That makes it a good compiler test. An interpreter is a hot loop of bit
manipulation over byte arrays, wrapped in a class, with strings for error
messages and a frame loop around it. There is also a ready-made test bench:
Timendus' [CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite)
checks every opcode, the quirks and SUPER-CHIP's scrolling, and John
Earnest's [chip8Archive](https://github.com/JohnEarnest/chip8Archive) has
games under CC0.

## One core, three hosts

Everything else depends on one decision: the interpreter core,
[`src/chip8.ts`](../../src/chip8.ts), does no I/O and has no clock. A host
loads a ROM into it, calls `stepFrame()` sixty times a second, tells it which
keys are down with `setKey()`, and reads `display`, a `Uint8Array` with one
byte per pixel. The core never calls out.

```
                  src/chip8.ts
          the core: no I/O, no clock
                       |
       +---------------+---------------+
       |               |               |
 raylib window   headless text   browser canvas
  src/main.ts     src/main.ts     src/web.ts
    scriptc      scriptc or bun   bun bundle
```

- The **window host**, `runWindowed()` in [`src/main.ts`](../../src/main.ts),
  is what scriptc compiles into `chip8.exe`.
- The **headless host**, `runHeadless()` in the same file, replays scripted
  key presses and prints the framebuffer as text. It runs in the native binary
  and under bun.
- The **browser host**, [`src/web.ts`](../../src/web.ts), uses a canvas,
  keyboard events, an on-screen keypad and Web Audio. bun bundles it to plain
  JavaScript; scriptc is not involved.

Two smaller decisions make the rest easier. Differences between CHIP-8
interpreters, the "quirks", are data: ten booleans in a `Quirks` object, with
presets for the original COSMAC VIP, for SUPER-CHIP as modern interpreters
implement it, and for SUPER-CHIP 1.1 as it behaves on the calculator. One of
the booleans switches the SUPER-CHIP instructions on; the display buffer is
sized for 128 × 64 and holds whichever resolution is active. And randomness is
deterministic: `CXNN` draws from an xorshift32 generator with a fixed seed, so
a ROM run with the same key presses always ends on the same screen. That
property is what makes it possible to compare the compiled program with the
interpreted one byte for byte.

## How scriptc compiles TypeScript

scriptc is a native compiler, installed from npm. It type-checks the program
with TypeScript 7, lowers it to LLVM IR, compiles that to machine code, and
links it with a precompiled C runtime into one executable. `Uint8Array`,
strings, arrays, `Map`, `process` and `fs` are implemented natively in the
runtime; the program's own functions become machine code.

Code that scriptc cannot compile natively fails the build with an `SCnnnn`
code and a rewrite hint. The build passes `--tier static-only` to keep it that
way, and `scriptc coverage` reports every statement of both programs as
static. [`scripts/build.ts`](../../scripts/build.ts) ends with:

```
node_modules/scriptc/bin/scriptc.exe build src/main.ts --tier static-only --ffi native/build/ffi.json -o dist/chip8.exe
node_modules/scriptc/bin/scriptc.exe build src/tools.ts --tier static-only -o dist/chip8-tools.exe
```

The program needs nothing beyond ordinary TypeScript, but one rule shapes its
design. A user `throw` is catchable; a runtime trap ends the process, and
scriptc's documentation counts out-of-range reads of statically typed arrays
among the traps. A ROM can contain anything: an unknown opcode, a `0NNN`
machine-code call, a return with an empty stack. So the core never relies on a
trap. Memory addresses wrap with `& 0xfff`, and everything a ROM can get wrong
is checked: the core sets `halted` and a `haltReason`, and the host shows the
reason in the window.

```ts
case 0x2:
  if (this.sp >= STACK_DEPTH) {
    this.halt(`stack overflow at ${hex(at, 3)}`);
    return;
  }
  this.stack[this.sp] = this.pc;
  this.sp++;
  this.pc = nnn;
  return;
```

Nothing in the core is specific to scriptc; the only scriptc-specific file is
[`src/rl.d.ts`](../../src/rl.d.ts), the FFI declarations the window host
calls. That is why the same core runs under bun and in a browser.

## Calling raylib through a scalar FFI

scriptc binds C functions in two parts. The TypeScript side is a
signature-only `declare function`; `src/rl.d.ts` holds sixteen of them:

```ts
declare function c8rl_draw_display(
  pixels: Uint8Array, cols: number, rows: number,
  x: number, y: number, scale: number, fg: number, bg: number,
): void;
```

A JSON manifest, [`native/ffi.base.json`](../../native/ffi.base.json), passed
with `--ffi`, maps each declaration to a C symbol and gives every parameter an
ABI class:

```json
{ "name": "c8rl_draw_display", "symbol": "c8rl_draw_display",
  "params": ["bytes", "i32", "i32", "i32", "i32", "i32", "u32", "u32"], "returns": "void" }
```

The C function then receives plain scalars, with the `bytes` argument expanded
into a pointer and a length:

```c
void c8rl_draw_display(const uint8_t *pixels, size_t length,
                       int32_t cols, int32_t rows,
                       int32_t x, int32_t y, int32_t scale,
                       uint32_t fg, uint32_t bg);
```

The manifest uses `ffi_format` 1, whose classes are numbers (`f64`, `i32`,
`u32`, `u8`), `bool`, `string` and `bytes`, the last two as a borrowed pointer
and a length. Higher formats add callbacks, more integer widths and pointers,
but no format passes structs by value, and raylib's API is built on small
structs such as `Color`, `Vector2` and `AudioStream`. So the emulator talks to
raylib through a shim, [`native/c8rl.c`](../../native/c8rl.c), that flattens
every call it needs:

- Colours travel as `0xRRGGBBAA` integers. The shim turns them into a `Color`
  with raylib's `GetColor()`.
- The framebuffer crosses the boundary once per frame: 2,048 bytes at
  64 × 32, 8,192 at 128 × 64, with the column and row counts beside it. The
  shim draws one rectangle per lit pixel, and raylib batches them.
- Strings are borrowed only for the duration of the call, and raylib wants
  NUL-terminated ones, so `c8rl_init` copies the window title before passing
  it on.
- The beep is a 440 Hz square wave. The shim keeps a raylib audio stream
  playing all the time and refills it every frame with either the wave or
  silence, which avoids clicks when the sound timer flickers on and off.

Under bun, the `declare`d functions have no implementation, and only the
window host calls them. So `bun src/main.ts rom.ch8 --headless 120` runs the
same program without a window, which turns out to matter a lot.

## A second program: the assembler and disassembler

`chip8-tools` is ordinary command-line TypeScript: files in, text or bytes
out, no FFI. Its disassembler does not decode a ROM front to back, because
ROMs mix code with sprites; it follows the program from `0x200` through
jumps, calls and both outcomes of every skip, lists what it reaches as
instructions, and draws every other byte as a sprite row. Its assembler is a
classic two-pass design with labels, constants and simple expressions. Both
read one instruction table, [`src/opcodes.ts`](../../src/opcodes.ts), with
Cowgod's mnemonics, so a listing always assembles back into the bytes it came
from. The tests check that for every 16-bit word and for every ROM in the
repository.

For scriptc it is a different kind of program from the emulator: string
scanning, maps, records and error lists instead of a hot loop over bytes. It
compiled under `--tier static-only` as written.

## The toolchain

The TypeScript side is plain; the C side needs more care. zig serves purely as
a C toolchain here: a clang driver that ships libc and C runtime sources for
many targets.

- raylib is compiled from source. The build sparse-clones raylib's `src`
  directory at tag 6.0 (about 15 MB instead of the whole repository), compiles
  its seven translation units in parallel with the flags from raylib's own
  Makefile, and archives them with `zig ar`.
- The shim is compiled by the same compiler, with warnings on.
- On Windows, scriptc links the executable with zig as well, so raylib, the
  shim and scriptc's runtime all use zig's mingw-w64 C runtime. Objects built
  against different C runtimes (msvcrt and UCRT) leave symbols unresolved when
  mixed; one toolchain avoids that. The executable imports only DLLs that ship
  with Windows.
- On glibc Linux, scriptc links with clang. raylib 6.0 does not guess a Linux
  window system, so the build passes `-D_GLFW_X11` and needs the X11
  development headers.
- macOS is not supported: raylib needs system frameworks, which only an
  `ffi_format` 7 manifest can list, and that path is untested.

bun is the only JavaScript runtime involved. It installs packages, runs the
build and verify scripts, runs the tests, runs the emulator headless during
development, and bundles the browser build. The scriptc compiler needs no
JavaScript runtime: its npm package installs a native executable from a
postinstall script, which bun runs because `package.json` lists scriptc in
`trustedDependencies`.

The first build takes a couple of minutes, mostly zig building its C runtime
and raylib. zig caches both and scriptc caches compiled programs, so later
builds take seconds.

## Trust, but diff

A compiler for a language with JavaScript's semantics has many places to be
subtly wrong: number conversions, string building, array bounds, integer
wraparound. Rather than take the binary on faith, the project checks it, and
the design makes that cheap.

Headless mode prints the framebuffer as text, followed by a status line. This
is the IBM logo test from Timendus' suite after 120 frames, as printed by
`chip8.exe`, with blank rows trimmed:

```
> dist\chip8.exe roms\tests\2-ibm-logo.ch8 --headless 120
............########.#########...#####.........#####..#.#.......
......................................................#.#.......
............########.###########.######.......######...#........
................................................................
..............####.....###...###...#####.....#####....#.#.......
......................................................###.......
..............####.....#######.....#######.#######......#.......
........................................................#.......
..............####.....#######.....###.#######.###..............
.......................................................#........
..............####.....###...###...###..#####..###..............
......................................................###.......
............########.###########.#####...###...#####....#.......
......................................................##........
............########.#########...#####....#....#####..###.......
frames=120 pc=0x228 i=0x275 dt=0 st=0
```

Everything the emulator does that matters ends up in that text: the screen,
the program counter, the index register and the timers. Because the core is
deterministic and the program also runs under bun,
[`scripts/verify.ts`](../../scripts/verify.ts) runs twenty cases through both
`dist/chip8.exe` and `bun src/main.ts` and requires identical standard output
and exit codes. The cases are the test ROMs, including the quirks and
scrolling tests in both SUPER-CHIP profiles, games and SUPER-CHIP programs
run with scripted key presses or non-default quirk settings, a missing ROM
file and an invalid option. The tools get the same treatment: for every ROM
in the repository, the native disassembler's listing must match bun's, and
the native assembler must turn that listing back into the original bytes.

```
> bun scripts/verify.ts --no-build
ok   roms/tests/1-chip8-logo.ch8 --headless 120
...
ok   roms/schip/squad.ch8 --headless 300 --quirks schip --ipf 500
...
ok   dis roms/games/outlaw.ch8
ok   asm of the native listing rebuilds roms/games/outlaw.ch8
...
ok   chip8-tools asm errors.s
all 89 checks passed
```

This is the regression test for the compiler step itself: a semantic
difference between scriptc's output and JavaScript would show up as a diff.

Below that sit ordinary unit tests: 122 tests under `bun test` for opcode
semantics and edge cases, argument parsing, framebuffer snapshots of the
Timendus ROMs, and the assembler and disassembler. The snapshots show every
row of the opcode and flag tests passing, all six quirks detected as
expected for CHIP-8 and both SUPER-CHIP profiles, and the scrolling test's
arrows in their boxes. Every 16-bit word that decodes as an instruction is
disassembled and assembled back. The whole suite runs in under a second,
because the core needs no window and nothing has to be mocked.

CI on GitHub Actions runs all of it: unit tests, the type check and the
browser bundle on Ubuntu; the native build and `verify` on both Windows and
Ubuntu; and a deployment of the browser build to GitHub Pages.

## The browser build, and why it isn't WebAssembly

`src/web.ts` is the third host, written against browser APIs. It runs frames
from `requestAnimationFrame` through a 1/60-second accumulator, so a 144 Hz
monitor still gets 60 CHIP-8 frames per second and a background tab catches up
by at most four frames. It reads keys by physical key code, draws the
framebuffer into an `ImageData` of the current resolution scaled onto a
canvas, offers an
on-screen keypad, and beeps with a Web Audio square wave that starts on the
first key press, because browsers allow audio only after a user gesture.
`Bun.build` bundles it into one minified `web.js`, and the build copies every
ROM next to it with a `roms.json` index. The result is a static site:
[arijit-gogoi.github.io/chip8-scriptc](https://arijit-gogoi.github.io/chip8-scriptc/).

The obvious alternative is to compile the emulator to WebAssembly with
scriptc. Its WebAssembly target is `wasm32-wasi`, where native FFI is not
available, so raylib cannot be part of such a build. Bundling the same
TypeScript as JavaScript is the simpler answer.

## What I take away

- **scriptc compiles a complete interactive program.** Window, keyboard,
  audio, file reading and command-line parsing, from TypeScript that still
  runs anywhere TypeScript runs. The assembler and disassembler, string
  processing with maps, records and classes, compile just as fully.
- **A scalar FFI is easy to reason about.** The cost is a C shim for any
  library that passes structs, which raylib does everywhere.
- **On Windows, one C toolchain avoids a class of linking problems.** zig
  compiles raylib and the shim and links the executable, so every object uses
  the same C runtime.
- **Keep a second runtime as an oracle.** Writing the program so that it also
  runs under bun, with a deterministic headless mode, turns "did the compiler
  preserve my program?" into a diff. It is the most useful decision in the
  project.

Two questions remain open: whether an `ffi_format` 7 manifest that lists
raylib's frameworks makes a macOS build possible, and whether a WASI module
with host imports could replace the bun-bundled browser host.

## Links

- Source: [github.com/arijit-gogoi/chip8-scriptc](https://github.com/arijit-gogoi/chip8-scriptc).
  [docs/](../README.md) explains the architecture, scriptc and the toolchain
  in detail, and [docs/howto/](../howto/README.md) is a twelve-chapter
  tutorial that builds this interpreter from scratch in TypeScript, then the
  SUPER-CHIP extension and the assembler and disassembler.
- Play in the browser: [arijit-gogoi.github.io/chip8-scriptc](https://arijit-gogoi.github.io/chip8-scriptc/)
- [scriptc](https://scriptc.dev)
- [raylib](https://www.raylib.com)
- [CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite) by
  Timendus, and [chip8Archive](https://github.com/JohnEarnest/chip8Archive) by
  John Earnest
- [CHIP-8 Instruction Set](https://github.com/mattmikolay/chip-8/wiki/CHIP%E2%80%908-Instruction-Set)
  by Matthew Mikolay, the reference that the default profile follows

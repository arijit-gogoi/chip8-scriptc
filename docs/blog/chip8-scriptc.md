# A CHIP-8 emulator in TypeScript, compiled to native code with scriptc

*26 November 2026 · Source: [arijit-gogoi/chip8-scriptc](https://github.com/arijit-gogoi/chip8-scriptc) ·
Play it in the browser: [arijit-gogoi.github.io/chip8-scriptc](https://arijit-gogoi.github.io/chip8-scriptc/)*

[scriptc](https://scriptc.dev) is an experimental compiler from Vercel Labs
that turns TypeScript into a native executable with no JavaScript engine
inside. I wanted to build a CHIP-8 emulator using only TypeScript, compile it
to native code with scriptc, and use [raylib](https://www.raylib.com) for the
display. That is also a fair way to find out whether scriptc can carry a
complete interactive program.

It can. The repository builds `chip8.exe`, a 2.3 MB Windows executable with
raylib linked in, from 855 lines of TypeScript and a 154-line C shim. It opens
a resizable window, maps the keyboard to the hex keypad, and beeps. The same
TypeScript runs unchanged under bun, and a second front end runs it in the
browser. This post covers how the pieces fit, what the compiler asked of the
code, where the build fought back, and how the native binary compares with
bun.

> **Version note.** Everything here was built in August 2026 against scriptc
> 0.0.35. scriptc has moved quickly since; the repository now pins 0.4.17,
> and its build script and documentation describe that version rather than
> the build below. Where scriptc's changelog says a limitation described here
> has changed, I point to the entry.

## Why CHIP-8

CHIP-8 is a virtual machine that Joseph Weisbecker created in 1977 for the
COSMAC VIP, a hobbyist computer. The machine is tiny: 4 KB of memory, sixteen
8-bit registers (V0 to VF), an address register, a call stack, two timers that
count down at 60 Hz, a 64 × 32 monochrome display that sprites are XORed onto,
a 16-key hex keypad, and 35 two-byte instructions.

That makes it a good compiler test. An interpreter is a hot loop of bit
manipulation over byte arrays, wrapped in a class, with strings for error
messages and a frame loop around it. There is also a ready-made test bench:
Timendus' [CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite)
checks every opcode and the quirks, and John Earnest's
[chip8Archive](https://github.com/JohnEarnest/chip8Archive) has games under
CC0.

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

Two smaller decisions made the rest easier. Differences between historical
interpreters, the "quirks", are data: six booleans in a `Quirks` object, with
presets for the original COSMAC VIP and for SUPER-CHIP. And randomness is
deterministic: `CXNN` draws from an xorshift32 generator with a fixed seed, so
a ROM run with the same key presses always ends on the same screen. That
property is what later makes it possible to compare the compiled program with
the interpreted one byte for byte.

## How scriptc compiles TypeScript

scriptc type-checks the program with the real TypeScript compiler (in 0.0.35,
TypeScript 7's native `tsgo`), lowers it to LLVM IR, compiles that together
with its C runtime, and links one executable. `Uint8Array`, strings, arrays,
`Map`, `process` and `fs` are implemented natively in the runtime; the
program's own functions become machine code.

Every construct falls into one of three tiers. The **static** tier compiles
natively with Node-compatible semantics. The **dynamic** tier, enabled with
`--dynamic`, embeds the quickjs-ng engine (about 620 KB) to run `any`-typed
code and npm packages. Everything else is **rejected** at compile time with an
`SCnnnn` code and a hint. This project stays in the static tier, so the binary
contains no JavaScript engine at all. `scriptc coverage src/main.ts` reports
which tier each construct lands in.

With `SCRIPTC_CC=zigcc` in its environment (more on that below),
[`scripts/build.ts`](../../scripts/build.ts) ends with:

```
bun node_modules/scriptc/dist/bootstrap.js build src/main.ts --ffi native/build/ffi.json -o dist/chip8.exe
```

## What the static tier asked of the code

The first build stopped at the call stack, which was declared as a
`Uint16Array`:

```
src/chip8.ts:59:12 - error SC2020: 'Uint16Array<ArrayBuffer>' is part of the standard library types but has no scriptc lowering yet
  ...
  hint: the type checker sees the full standard library, but only the supported surface compiles (https://scriptc.dev/limitations)
```

That diagnostic is typical of the whole experience. The TypeScript checker
accepts everything in the standard library, scriptc compiles only the part it
has lowered, and anything outside that part is a compile error that names the
construct. These are the rules the emulator ran into, and the rewrite each one
needed:

| scriptc 0.0.35 rule | Rewrite in `src/` |
| --- | --- |
| `Uint16Array` has no lowering | the call stack is a `number[]` |
| `TypedArray.fill` has no lowering | `clearBytes()` zeroes in a loop |
| compound element assignment (`a[i] ^= v`) is unsupported | an explicit read-modify-write |
| `number.toString(radix)` needs the dynamic tier | `hex()` builds the string from a digit table |
| arrays are dense; an out-of-bounds read traps and cannot be caught | every memory index is masked with `& 0xfff`; `process.argv` is copied with an explicit loop |
| `==` only between operands of the same type | `===` everywhere |
| record types are exact | `Options` has every field and no optional properties |
| a user `throw` is catchable, a runtime trap is not | an oversized ROM throws; a bad opcode halts the interpreter |

None of these go deep. The XOR in the sprite routine became an explicit
branch, which also gives the collision flag a natural home:

```ts
const index = py * DISPLAY_WIDTH + px;
if (this.display[index] !== 0) {
  collision = 1;
  this.display[index] = 0;
} else {
  this.display[index] = 1;
}
```

Without `toString(16)`, hexadecimal formatting for error messages takes a few
lines:

```ts
const HEX_DIGITS = "0123456789ABCDEF";

export function hex(value: number, width: number): string {
  let rest = Math.floor(value) >>> 0;
  let s = "";
  while (rest > 0 || s.length < width) {
    s = HEX_DIGITS.charAt(rest & 0xf) + s;
    rest = rest >>> 4;
  }
  return "0x" + s;
}
```

The last rule shaped the error handling more than any other. A ROM can contain
anything: an unknown opcode, a `0NNN` machine-code call, a return with an
empty stack. A runtime trap ends the process, so the core never relies on one.
It checks, sets `halted` and a `haltReason`, and the host shows the reason in
the window:

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

The result is still ordinary TypeScript. Nothing in the core is specific to
scriptc; the only scriptc-specific file is
[`src/rl.d.ts`](../../src/rl.d.ts), the FFI declarations the window host
calls. That is why the same core runs under bun and in a browser. Some of
these rewrites are no longer necessary: according to the changelog, 0.1.5
compiles indexed compound assignments natively, and 0.2.0 widened support for
numeric typed arrays.

## Calling raylib through a scalar FFI

In 0.0.35, scriptc binds C functions in two parts. The TypeScript side is a
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

The classes are numbers (`f64`, `i32`, `u32`, `u8`), `bool`, `string` and
`bytes`, the last two as a borrowed pointer and a length. Structs cannot cross
the boundary, and raylib's API is built on small structs such as `Color`,
`Vector2` and `AudioStream`. So the emulator talks to raylib through a shim,
[`native/c8rl.c`](../../native/c8rl.c), that flattens every call it needs:

- Colours travel as `0xRRGGBBAA` integers. The shim turns them into a `Color`
  with raylib's `GetColor()`.
- The whole 64 × 32 framebuffer crosses the boundary once per frame as 2,048
  bytes. The shim draws one rectangle per lit pixel, and raylib batches them.
- Strings are borrowed only for the duration of the call, and raylib wants
  NUL-terminated ones, so `c8rl_init` copies the window title before passing
  it on.
- The beep is a 440 Hz square wave. The shim keeps a raylib audio stream
  playing all the time and refills it every frame with either the wave or
  silence, which avoids clicks when the sound timer flickers on and off.

Under bun, the `declare`d functions have no implementation, and only the
window host calls them. So `bun src/main.ts rom.ch8 --headless 120` runs the
same program without a window, which turns out to matter a lot.

Later releases go well beyond this: the 0.2.0 changelog describes `node:ffi`
bindings with "exact 64-bit and pointer ABIs, native memory views, reusable
callback pools, and Darwin framework linking".

## The toolchain was the hard part

The TypeScript side needed a handful of mechanical rewrites. The C side is
where the build got complicated.

scriptc drives a C compiler for its runtime, the program's IR and the final
link. Its default is `clang` from `PATH`, and on Windows that clang has to
target mingw-w64; the LLVM I had installed targets MSVC and fails on GNU-style
linker flags. So the first build used winlibs' mingw-w64 clang, which links
against the Universal C Runtime (UCRT), together with scoop's prebuilt raylib,
which is built against the older msvcrt. Mixing the two C runtimes left
symbols unresolved, and the program linked only after two patches: an alias in
the shim for the `stat64i32` helper that the msvcrt-built raylib referenced,
forwarding to UCRT's `_stat64i32`, and `winpthread` added to the link line for
`clock_gettime` and `nanosleep`.

Instead of carrying those patches, I moved every C compile to `zig cc`. zig is
used here purely as a C toolchain: a clang driver that ships libc and C
runtime sources for many targets.

- raylib is compiled from source. The build sparse-clones raylib's `src`
  directory at tag 6.0 (about 15 MB instead of the whole repository), compiles
  its seven translation units in parallel with the flags from raylib's own
  Makefile, and archives them with `zig ar`.
- The shim is compiled by the same compiler, with warnings on.
- scriptc is told to use zig with `SCRIPTC_CC=zigcc`, one of its two
  documented drivers.

Every object in the executable now comes from one compiler and one C runtime,
and both patches are gone. The prerequisites dropped to two tools, bun and
zig, and the executable imports only DLLs that ship with Windows.

I also wanted one JavaScript runtime rather than two, and picked bun. It
installs packages, runs the build and verify scripts, runs the tests, runs the
emulator headless during development, bundles the browser build, and, on
Windows, runs the scriptc compiler itself, although scriptc's `package.json`
asks for Node 24.

Continuous integration added Linux, and the first two runs failed. raylib 6.0
refuses to guess a Linux window system:

```
native/vendor/raylib-6.0/src/rglfw.c:57:10: error: "Cannot disable Wayland and X11 at the same time"
```

Passing `-D_GLFW_X11` fixed that. The second failure came from bun hosting
scriptc:

```
131 |             this.readFd = stdout._handle.fd;
TypeError: undefined is not an object (evaluating 'stdout._handle.fd')
```

scriptc 0.0.35 runs TypeScript 7's native compiler as a child process and
talks to it over a synchronous pipe whose file descriptor it reads from Node's
internal `stdout._handle`. bun provides that handle on Windows but not on
Linux, so the build script uses node on Linux and macOS. (scriptc 0.2.0 made
the CLI itself a native executable, and its changelog says native compilation
no longer requires Node, which should make this workaround unnecessary.)

macOS is refused by the build: raylib needs `-framework` flags, which the
0.0.35 manifest cannot express. That gap is the "Darwin framework linking" in
the 0.2.0 changelog.

On my laptop a clean build takes about 80 seconds, most of it raylib (about
15 s) and scriptc (about 30 s). The raylib archive is cached and scriptc
caches unchanged programs, so a rebuild without source changes takes a couple
of seconds.

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
[`scripts/verify.ts`](../../scripts/verify.ts) runs eleven cases through both
`dist/chip8.exe` and `bun src/main.ts` and requires identical standard output
and exit codes. The cases are the test ROMs, three games run with scripted key
presses or non-default quirk settings, a missing ROM file and an invalid
option:

```
> bun scripts/verify.ts --no-build
ok   roms/tests/1-chip8-logo.ch8 --headless 120
...
ok   roms/games/tank.ch8 --headless 300 --press 8@60+20 --quirks schip
ok   roms/games/flightrunner.ch8 --headless 240 --wrap --no-wait --ipf 30
ok   missing.ch8 --headless 1
ok   roms/games/outlaw.ch8 --ipf 0
all 11 cases identical
```

This is the regression test for the compiler step itself: a semantic
difference between scriptc's output and JavaScript would show up as a diff.
All eleven cases match in CI on Windows and Linux, and they matched again on
my machine while I wrote this.

Below that sit ordinary unit tests: 56 tests under `bun test` for opcode
semantics and edge cases, argument parsing, and framebuffer snapshots of the
Timendus ROMs. The snapshots show every row of the opcode and flag tests
passing, and all six quirks detected as expected for CHIP-8. The whole suite runs in under half a second,
because the core needs no window and nothing has to be mocked.

CI on GitHub Actions runs all of it: unit tests, the type check and the
browser bundle on Ubuntu; the native build and `verify` on both Windows and
Ubuntu; and a deployment of the browser build to GitHub Pages.

## The browser build, and why it isn't WebAssembly

`src/web.ts` is the third host, written against browser APIs. It runs frames
from `requestAnimationFrame` through a 1/60-second accumulator, so a 144 Hz
monitor still gets 60 CHIP-8 frames per second and a background tab catches up
by at most four frames. It reads keys by physical key code, draws the
framebuffer into a 64 × 32 `ImageData` scaled onto a canvas, offers an
on-screen keypad, and beeps with a Web Audio square wave that starts on the
first key press, because browsers allow audio only after a user gesture.
`Bun.build` bundles it into a 10.7 KB minified `web.js`, and the build copies
every ROM next to it with a `roms.json` index. The result is a static site:
[arijit-gogoi.github.io/chip8-scriptc](https://arijit-gogoi.github.io/chip8-scriptc/).

The obvious alternative was to compile the emulator to WebAssembly with
scriptc. In 0.0.35 its only wasm target is `wasm32-wasi`, which has no native
FFI, so the build stops at the first raylib call:

```
src/main.ts:50:3 - error SC1090: the reference to 'c8rl_init' (a binding form with no lowering) is not supported yet
```

With 0.0.35, bundling the same TypeScript as JavaScript was the simpler
answer. The 0.2.0 changelog lists callable exports and host imports for
WebAssembly libraries as new, and says browser hosts supply "their own WASI
adapter and rendering integration", so a scriptc-compiled browser build may be
possible now. I have not tried it.

## Numbers

| | Native, scriptc 0.0.35 | bun 1.4.5 |
| --- | --- | --- |
| Executable size | 2.3 MB, raylib included | 115 MB with `bun build --compile`, which cannot open the window |
| Start-up, one headless frame | 13 ms | 30 ms |
| Peak memory, headless | 5.8 MB | 29 MB |
| 15 million instructions, headless | 2.3 s | 0.22 s |

These were measured on a laptop with an AMD Ryzen 5 5500U, Windows 11 and the
Balanced power plan, using the binary built in August from the current source.
Start-up is the median of nine runs, and throughput the median of seven
interleaved runs. bun was started directly rather than through scoop's shim,
which adds tens of milliseconds to every start. The throughput workload is
`outlaw.ch8 --headless 3000 --ipf 5000 --no-wait`: 3,000 frames of 5,000
instructions each, and both runtimes end on the same status line. The
`bun build --compile` executable embeds bun itself, and in window mode it
fails with `ReferenceError: c8rl_init is not defined`, since nothing
implements the raylib shim there.

The native binary wins on size, start-up and memory, which is what you would
expect from a program with no engine to load. It loses on raw speed: bun's JIT
runs the interpreter loop about ten times faster.

The reason is visible in `dist/main.ll`, the LLVM IR that scriptc writes next
to the executable. This is the opcode fetch:

```ts
const opcode = (this.memory[pc] << 8) | this.memory[(pc + 1) & 0xfff];
```

and this is part of what scriptc 0.0.35 emits for it (an excerpt; the comments
are mine):

```llvm
%t20 = call ptr @sc_retain__x25_m1_Chip8(ptr %t19)           ; retain this
%t21 = getelementptr inbounds %sc_o__x25_m1_Chip8, ptr %t20, i64 0, i32 1
%t22 = load ptr, ptr %t21
%t23 = call ptr @scr_bytes_retain_v(ptr %t22)                ; retain this.memory
; ... bounds check: the index must be >= 0, < length and a whole number ...
%t37 = load i8, ptr %t36, align 1
%t38 = zext i8 %t37 to i32
%t39 = uitofp i32 %t38 to double                             ; the byte becomes a double
%t40 = call double @scr_bit_shl(double %t39, double 0x4020000000000000)   ; << 8
; ... the same retains and bounds check for memory[(pc + 1) & 0xfff] ...
%t48 = call double @scr_bit_and(double %t47, double 0x40AFFE0000000000)   ; & 0xfff
; ...
%t64 = call double @scr_bit_or(double %t40, double %t63)     ; |
store double %t64, ptr %sc_l_opcode_0
call void @sc_release__x25_m1_Chip8(ptr %t20)
call void @scr_bytes_release(ptr %t23)
call void @sc_release__x25_m1_Chip8(ptr %t42)
call void @scr_bytes_release(ptr %t45)
```

Numbers are `double`s, the bitwise operators are calls into the C runtime, and
field and typed-array accesses retain the object first and release it
afterwards. This is the IR before optimization, but compiling it with
`clang -O2` (LLVM 23, not scriptc's exact pipeline) shows that the important
part survives. `step()` and `execute()` get inlined into `stepFrame()`, yet
the loop still calls `scr_bit_and`, `scr_bit_or`, `scr_bit_shl`,
`scr_bit_shr`, `scr_bytes_retain_v` and `scr_bytes_release`. Those functions
live in the separately compiled runtime, where the optimizer cannot see into
them. An emulator is almost nothing but bitwise operators and byte-array
reads, which makes it close to a worst case for this lowering. A JIT, by
contrast, watches the loop run, can speculate that these values are small
integers, and emits integer instructions for them.

None of this matters for CHIP-8. At the default speed of 11 instructions per
frame, a game needs 660 instructions per second. The native build executes
about 6.5 million per second, nearly ten thousand times more.

It may also no longer hold for current scriptc. Later changelog entries target
exactly these costs: 0.2.7 added an `--optimization=speed` mode that "enables
runtime inlining, inline reference counting", 0.3.1 says "Integer code stays
in integer registers", and 0.4.0 says "Retain and release pairs are removed".
I haven't measured a newer release, so I don't know how much of the gap
remains.

## What I took away

- **scriptc compiled a complete interactive program.** Window, keyboard,
  audio, file reading and command-line parsing, from TypeScript that still
  runs anywhere TypeScript runs. The rewrites it asked for were local and
  mechanical, and most of them arrived as compile errors with a code and a
  hint.
- **A scalar FFI is easy to reason about.** The cost is a C shim for any
  library that passes structs, which raylib does everywhere.
- **On Windows, the C toolchain was harder than the compiler.** One `zig cc`
  for everything removed a class of linking problems instead of patching
  symbols one at a time.
- **Keep a second runtime as an oracle.** Writing the program so that it also
  runs under bun, with a deterministic headless mode, turned "did the compiler
  preserve my program?" into a diff. It was the most useful decision in the
  project.
- **Native does not automatically mean faster.** Here the native binary won
  on size, start-up and memory, and lost on throughput. Measure what you care
  about.

Some questions remain open: how much of the throughput gap the 0.4 series
closes, whether framework linking makes a macOS build possible, and whether a
WASI module with host imports could replace the bun-bundled browser host.

## Links

- Source: [github.com/arijit-gogoi/chip8-scriptc](https://github.com/arijit-gogoi/chip8-scriptc).
  [docs/](../README.md) explains the architecture, scriptc and the toolchain
  in detail, and [docs/howto/](../howto/README.md) is a ten-chapter tutorial
  that builds this interpreter from scratch in TypeScript.
- Play in the browser: [arijit-gogoi.github.io/chip8-scriptc](https://arijit-gogoi.github.io/chip8-scriptc/)
- [scriptc](https://scriptc.dev) and its
  [changelog](https://github.com/vercel-labs/scriptc/blob/main/CHANGELOG.md)
- [raylib](https://www.raylib.com)
- [CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite) by
  Timendus, and [chip8Archive](https://github.com/JohnEarnest/chip8Archive) by
  John Earnest
- [CHIP-8 Instruction Set](https://github.com/mattmikolay/chip-8/wiki/CHIP%E2%80%908-Instruction-Set)
  by Matthew Mikolay, the reference that the default profile follows

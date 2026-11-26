# scriptc

## What it is

[scriptc](https://scriptc.dev) is an experimental compiler from Vercel Labs
that turns ordinary TypeScript into a native executable. It type-checks the
program with the real TypeScript compiler, lowers it to LLVM IR, compiles that
to machine code, and links it with a precompiled C runtime into a
self-contained binary. There is no V8, no QuickJS and no interpreter in the
output: strings, arrays, `Map`, typed arrays, `process`, `fs` and the rest are
native implementations in the runtime, and the program's own functions are
machine code.

Code that scriptc cannot compile to native code is a compile error with an
`SCnnnn` code and a rewrite hint. The build passes `--tier static-only`, which
keeps it that way even if a later release starts moving such code to a dynamic
tier. `scriptc coverage src/main.ts --ffi native/build/ffi.json` reports how
much of the program compiles natively; here it is the whole program.

The project pins scriptc 0.4.17. It was first built with 0.0.35, which had a
narrower static tier and an optional embedded JavaScript engine (`--dynamic`,
removed in 0.3.0).

## How the build invokes it

`scripts/build.ts` runs:

```
node_modules/scriptc/bin/scriptc.exe build src/main.ts --tier static-only --ffi native/build/ffi.json -o dist/chip8.exe
```

- `build src/main.ts` — the entry module; imports (`./chip8`, `./cli`,
  `./font`) and the `/// <reference path="./rl.d.ts" />` are followed by
  TypeScript's module resolution.
- `--tier static-only` — fail the build instead of accepting code outside the
  static tier.
- `--ffi native/build/ffi.json` — the manifest that binds the `declare`d
  `c8rl_*` functions to C symbols and names the archives and system libraries
  to link.
- `-o dist/chip8.exe` — output path. The generated LLVM IR is kept beside it
  as `dist/main.ll`.

No environment variables are needed. scriptc links with zig on Windows and
with clang on glibc Linux; `SCRIPTC_LINKER` would replace that driver and
`SCRIPTC_TARGET` would select a cross target, and this project uses neither.
(`SCRIPTC_CC`, which the 0.0.35 build set to `zigcc`, now only selects the C
compiler for `--sanitize` builds.)

scriptc caches compiled programs, so a rebuild with unchanged sources takes
about a second, and recompiling after a change takes a few seconds.

The package installs the compiler as a native executable,
`node_modules/scriptc/bin/scriptc.exe` (the same file name on every platform),
from a postinstall script. bun runs install scripts only for packages listed
in `trustedDependencies`, which is why `package.json` lists scriptc there;
without it the file stays a small placeholder and the build stops with a
message saying so. The script is written for node, and bun runs it itself when
node is not installed. `SCRIPTC="<command line>"` replaces the compiler
command.

## The FFI to raylib

### Declarations

`src/rl.d.ts` declares the shim's functions with no body:

```ts
declare function c8rl_draw_display(
  pixels: Uint8Array, cols: number, rows: number,
  x: number, y: number, scale: number, fg: number, bg: number,
): void;
```

scriptc requires such bindings to resolve to exactly one signature-only,
non-generic function declaration in project-owned source. Under bun the
declarations have no runtime value, which is fine because only the windowed
code path calls them.

### Manifest

`native/ffi.base.json` lists every function; `scripts/build.ts` adds the
link inputs and writes `native/build/ffi.json`:

```json
{
  "ffi_format": 1,
  "functions": [
    { "name": "c8rl_draw_display", "symbol": "c8rl_draw_display",
      "params": ["bytes", "i32", "i32", "i32", "i32", "i32", "u32", "u32"], "returns": "void" }
  ],
  "libraries": ["./c8rl.o", "./libraylib.a"],
  "system_libraries": ["opengl32", "gdi32", "winmm"]
}
```

`name` is the TypeScript identifier, `symbol` the C symbol. `libraries` are
paths relative to the manifest, passed to the linker as they are (an object
file works as well as an archive); `system_libraries` become `-l` flags.

### ABI classes

| Class | TypeScript | C parameters |
| ----- | ---------- | ------------ |
| `f64` | number | `double` |
| `i32` | number | `int32_t` (ToInt32) |
| `u32` | number | `uint32_t` (ToUint32) |
| `u8` | number | `uint8_t` |
| `bool` | boolean | `uint8_t` 0/1 |
| `string` | string | `const uint8_t *, size_t` (UTF-8, not NUL-terminated) |
| `bytes` | Uint8Array | `const uint8_t *, size_t` |
| `void` | void | return only |

These are the classes of `ffi_format` 1, which this project uses. Formats 2
to 7 add callbacks, `f32`, 8- and 16-bit integers, writable byte spans,
64-bit integers and opaque pointers.

So the declaration above corresponds to this C function in `native/c8rl.c`:

```c
void c8rl_draw_display(const uint8_t *pixels, size_t length,
                       int32_t cols, int32_t rows,
                       int32_t x, int32_t y, int32_t scale,
                       uint32_t fg, uint32_t bg);
```

### Rules and their consequences

- Pointers for `string` and `bytes` are borrowed for the duration of the call.
  `c8rl_init` copies the title into a NUL-terminated buffer before handing it
  to raylib; `c8rl_draw_display` reads the framebuffer and returns.
- No structs by value, and no pointers or callbacks needed here. raylib's
  `Color`, `Vector2` and `AudioStream` never cross the boundary: colours are
  `0xRRGGBBAA` integers converted with `GetColor()`, the audio stream is a
  `static` in the shim.
- Calls are synchronous; C must not unwind exceptions or `longjmp` across the
  boundary. raylib does neither.

## Language rules that shaped the code

scriptc 0.0.35's static tier was strict about what it lowered. These are the
rules this program ran into, how `src/` handles them, and how scriptc 0.4.17
behaves. The code keeps the 0.0.35 forms; they are ordinary TypeScript and
still compile.

| Rule in 0.0.35 | Where it shows | 0.4.17 |
| -------------- | -------------- | ------ |
| `Uint16Array` has no lowering | the call stack is a `number[]` created by `zeros()` | compiles |
| `TypedArray.fill` has no lowering | `clearBytes()` loops | compiles |
| compound element assignment (`a[i] ^= v`) is unsupported | `drawSprite` uses an explicit read-modify-write | compiles |
| `number.toString(radix)` is dynamic-tier only | `hex()` builds the string from a digit table | compiles |
| arrays are dense; out-of-bounds reads trap and are not catchable | `process.argv` is copied with an explicit length loop; every memory index is masked with `& 0xfff` | the reads tested returned `undefined`, as in JavaScript, but scriptc's docs still list out-of-range reads of statically typed arrays as uncatchable traps |
| `==` only between operands of the same type | `===` everywhere | compiles |
| record types are exact structs | `Options` has every field, no optional properties; `Quirks` presets are built field by field | optional properties compile |
| `any` is an error without `--dynamic` | none in the code | compiles, even with `--tier static-only` |
| user `throw` is catchable, runtime traps are not | `loadRom` throws for oversized images (caught in `main`); bad opcodes set `halted` instead of throwing | still holds |
| `scriptc run` does not forward arguments | the build produces a binary and runs that | still holds |

`process.argv` has the same shape as under Node (`argv[0]` is `"scriptc"`,
`argv[1]` the binary path), so `main()` slices from index 2 in both worlds.

## One source, two runtimes

Because the program is plain TypeScript, bun can run it directly:

```
bun src/main.ts roms/tests/3-corax+.ch8 --headless 400
dist\chip8.exe   roms/tests/3-corax+.ch8 --headless 400
```

`scripts/verify.ts` runs eleven such cases through both and requires
byte-identical stdout and exit codes. It is the regression test for the
compiler step itself: a semantic difference between scriptc's runtime and
JavaScript would show up as a diff.

## Further reading

- [Introduction](https://scriptc.dev/introduction), [Native FFI](https://scriptc.dev/ffi),
  [Limitations](https://scriptc.dev/limitations), [Platforms](https://scriptc.dev/platforms),
  [CLI](https://scriptc.dev/cli), [How it works](https://scriptc.dev/how-it-works)
- Source: [vercel-labs/scriptc](https://github.com/vercel-labs/scriptc)

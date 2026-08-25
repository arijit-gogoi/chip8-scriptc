# scriptc

## What it is

[scriptc](https://scriptc.dev) is an experimental compiler from Vercel Labs
that turns ordinary TypeScript into a native executable. It type-checks the
program with the real TypeScript compiler, lowers it to LLVM IR, compiles that
together with a small C runtime, and links a self-contained binary. There is
no V8, no QuickJS and no interpreter in the output: strings, arrays, `Map`,
typed arrays, `process`, `fs` and the rest are native implementations in the
runtime, and the program's own functions are machine code.

Every language construct falls into one of three tiers:

- **static** — compiled to native code with Node-compatible semantics. This
  project lives entirely in this tier.
- **dynamic** — with `--dynamic`, scriptc embeds quickjs-ng (about 620 KB) to
  run `any`-typed code and npm packages. Not used here.
- **rejected** — a compile error with an `SCnnnn` code and a rewrite hint.
  `scriptc coverage src/main.ts` reports which tier each construct lands in.

## How the build invokes it

`scripts/build.ts` runs, with `SCRIPTC_CC=zigcc` in the environment:

```
bun node_modules/scriptc/dist/bootstrap.js build src/main.ts --ffi native/build/ffi.json -o dist/chip8.exe
```

- `build src/main.ts` — the entry module; imports (`./chip8`, `./cli`,
  `./font`) and the `/// <reference path="./rl.d.ts" />` are followed by
  TypeScript's module resolution.
- `--ffi native/build/ffi.json` — the manifest that binds the `declare`d
  `c8rl_*` functions to C symbols and names the archives and system libraries
  to link.
- `-o dist/chip8.exe` — output path. The generated IR is kept beside it as
  `dist/main.ll`; `zig cc` also leaves a `chip8.pdb`.
- `SCRIPTC_CC=zigcc` — scriptc's C driver. The default is `clang` from
  `PATH`; `zigcc` makes it spawn `zig cc` for the runtime sources, the program
  IR and the final link. `SCRIPTC_TARGET` could additionally select a cross
  target, which this project does not use.

scriptc caches compiled runtime objects and whole-program results per
compiler and target, so a rebuild with unchanged sources takes seconds and a
change to one module takes roughly half a minute.

The package declares `engines: node >= 24`. It is pinned as a devDependency
and executed by bun; every check in this repository (unit tests, snapshots,
`bun run verify`) runs against binaries produced that way. `SCRIPTC=<command>`
overrides the invocation if another runtime or a global install is wanted.

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
- No structs by value, no pointer returns, no callbacks needed here. raylib's
  `Color`, `Vector2` and `AudioStream` never cross the boundary: colours are
  `0xRRGGBBAA` integers converted with `GetColor()`, the audio stream is a
  `static` in the shim.
- Calls are synchronous; C must not unwind exceptions or `longjmp` across the
  boundary. raylib does neither.

## Language rules that shaped the code

The static tier is strict about what it lowers. These are the rules this
program ran into and how `src/` handles them:

| Rule | Where it shows |
| ---- | -------------- |
| `Uint16Array` has no lowering | the call stack is a `number[]` created by `zeros()` |
| `TypedArray.fill` has no lowering | `clearBytes()` loops |
| compound element assignment (`a[i] ^= v`) is unsupported | `drawSprite` uses an explicit read-modify-write |
| `number.toString(radix)` is dynamic-tier only | `hex()` builds the string from a digit table |
| arrays are dense; out-of-bounds reads trap and are not catchable | `process.argv` is copied with an explicit length loop; every memory index is masked with `& 0xfff` |
| `==` only between operands of the same type | `===` everywhere |
| record types are exact structs | `Options` has every field, no optional properties; `Quirks` presets are built field by field |
| `any` is an error without `--dynamic` | none in the code |
| user `throw` is catchable, runtime traps are not | `loadRom` throws for oversized images (caught in `main`); bad opcodes set `halted` instead of throwing |
| `scriptc run` does not forward arguments | the build produces a binary and runs that |

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

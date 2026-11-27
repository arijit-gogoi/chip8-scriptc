# Toolchain: bun, zig, raylib

Two tools have to be installed: bun and zig, plus clang on Linux, where
scriptc links with it. Everything else is either in `package.json` (scriptc,
TypeScript types) or fetched by the build (raylib).

## bun

bun is the only JavaScript runtime involved, in five roles:

| Role | Command |
| ---- | ------- |
| package manager | `bun install` pins `scriptc`, `@types/bun`, `typescript` in `bun.lock`, and runs scriptc's postinstall, which installs the native compiler |
| script runner | `bun scripts/build.ts`, `bun scripts/verify.ts` — TypeScript executed directly, using `Bun.spawn` for parallel compiles |
| test runner | `bun test` runs `tests/*.test.ts` with `bun:test` |
| development runtime | `bun src/main.ts rom.ch8 --headless 120` runs the emulator core without compiling; the `declare`d raylib functions are simply never called on that path. `bun src/tools.ts dis rom.ch8` runs the tools the same way |
| bundler | `bun scripts/build-web.ts` calls `Bun.build` to turn `src/web.ts` into `dist/web/web.js` for browsers, and `Bun.serve` to host the result with `--serve` |

scriptc itself is a native executable and needs no JavaScript runtime. bun
runs its postinstall script because `package.json` lists scriptc in
`trustedDependencies`; the script is written for node, and bun runs it itself
when node is not installed. The version is pinned so that an upgrade is a
deliberate, re-verified step.

## zig

zig is used purely as a C toolchain: `zig cc` (a clang driver bundled with
libc and C runtime sources for many targets) and `zig ar`. No Zig-language
code exists in the project.

Why zig rather than a system clang or gcc:

- **One C runtime on Windows.** raylib and the shim are compiled by `zig cc`,
  and scriptc links the executable with zig, so everything, including
  scriptc's precompiled runtime, meets in zig's mingw-w64 C runtime. Objects
  built against different C runtimes (msvcrt and UCRT) leave symbols
  unresolved when mixed; one toolchain avoids that.
- **scriptc uses it anyway.** zig is scriptc's default linker on Windows, so
  the build needs no setting to steer it. On glibc Linux scriptc links with
  clang instead, and zig only compiles raylib and the shim.
- **No system-specific install.** `scoop install zig`, `brew install zig`, or
  a tarball; the CRT and compiler-rt pieces are built on first use into zig's
  global cache (`%LOCALAPPDATA%\zig` on Windows), after which compiles are
  as fast as plain clang.
- **Cross-compilation is available** through `SCRIPTC_TARGET` and zig's
  `-target`, though this project does not wire it up.

## raylib

[raylib](https://www.raylib.com) is a C library for windows, 2D/3D drawing,
input and audio. The emulator uses a small slice of it, all wrapped by
`native/c8rl.c`:

| Area | raylib calls |
| ---- | ------------ |
| window | `SetTraceLogLevel`, `SetConfigFlags`, `InitWindow`, `SetWindowMinSize`, `SetTargetFPS`, `WindowShouldClose`, `GetScreenWidth`, `GetScreenHeight`, `CloseWindow` |
| drawing | `BeginDrawing`, `ClearBackground`, `DrawRectangle`, `DrawText`, `GetColor`, `EndDrawing` |
| input | `IsKeyDown`, `IsKeyPressed` |
| audio | `InitAudioDevice`, `IsAudioDeviceReady`, `SetAudioStreamBufferSizeDefault`, `LoadAudioStream`, `PlayAudioStream`, `IsAudioStreamProcessed`, `UpdateAudioStream`, `StopAudioStream`, `UnloadAudioStream`, `CloseAudioDevice` |

The framebuffer is drawn as one filled rectangle per lit pixel. At 64x32 that
is at most 2048 rectangles per frame, which raylib batches into a single draw
call; a texture upload would not be simpler.

The beep is a 440 Hz square wave. The shim keeps a raylib audio stream
playing continuously and, once per frame, refills every drained buffer with
either the wave or silence depending on the last `c8rl_beep()` call. Keeping
the stream running avoids start/stop clicks and start-up latency.

### Vendoring

raylib's `src` directory at tag `6.0` lives in `native/vendor/raylib-6.0/`.
It is ignored by git; when it is missing, `scripts/build.ts` sparse-clones it
(`git clone --depth 1 --filter=blob:none --sparse` followed by
`sparse-checkout set src`), which transfers about 15 MB instead of the whole
repository with its examples.

### Compiling it

Seven translation units are compiled with the flags raylib's own Makefile
uses for the desktop GLFW platform:

```
zig cc -c -O2 -std=gnu99 -w -D_GNU_SOURCE -DPLATFORM_DESKTOP_GLFW -DGRAPHICS_API_OPENGL_33
       -fno-strict-aliasing -I<src> -I<src>/external/glfw/include  rcore.c rshapes.c rtextures.c rtext.c rmodels.c raudio.c rglfw.c
zig ar rcs native/build/libraylib.a native/build/raylib/*.o
```

`rglfw.c` picks the window system from the target on Windows (`_GLFW_WIN32`)
and macOS (Cocoa); on Linux the build passes `-D_GLFW_X11` because raylib 6.0
insists on an explicit choice and Wayland would need generated protocol
sources. Warnings are disabled for this third-party code; the shim is
compiled with `-Wall -Wextra`. The seven compiles run in parallel and the
archive is cached until `--clean`.

System libraries per platform, written into the manifest:

| Platform | `system_libraries` |
| -------- | ------------------ |
| Windows | `opengl32 gdi32 winmm` |
| Linux | `m pthread dl rt GL X11` (X11 development headers required to compile `rglfw.c`) |
| macOS | refused: untested; raylib's frameworks would need an `ffi_format` 7 manifest |

## scripts/build.ts, step by step

```
bun scripts/build.ts [--clean] [--run <rom> [emulator args...]]
```

1. `--clean` removes `native/build/`.
2. `zig version` must succeed, otherwise the script stops with install hints.
3. **raylib**: if `native/build/libraylib.a` exists, skip. Otherwise fetch the
   source when `native/vendor/raylib-6.0/src/raylib.h` is missing, compile
   the seven files in parallel, archive.
4. **shim**: `zig cc -c -O2 -std=c11 -Wall -Wextra -I<raylib src> native/c8rl.c -o native/build/c8rl.o`.
5. **manifest**: read `native/ffi.base.json`, add `libraries`
   (`./c8rl.o`, `./libraylib.a`) and the platform's `system_libraries`,
   write `native/build/ffi.json`.
6. **scriptc**: `node_modules/scriptc/bin/scriptc.exe build src/main.ts --tier static-only --ffi native/build/ffi.json -o dist/chip8[.exe]`.
   The script first checks that the compiler is installed and is not the
   placeholder left when the postinstall did not run.
7. **scriptc again**: `scriptc.exe build src/tools.ts --tier static-only -o dist/chip8-tools[.exe]`,
   the assembler and disassembler. No manifest: this program calls no C.
8. `--run <rom> ...` executes the fresh emulator with the remaining arguments.

Artifacts:

| Path | Content |
| ---- | ------- |
| `native/build/raylib/*.o`, `native/build/libraylib.a` | raylib objects and archive (cached) |
| `native/build/c8rl.o` | the shim |
| `native/build/ffi.json` | generated manifest |
| `dist/chip8.exe` | the emulator |
| `dist/chip8-tools.exe` | the assembler and disassembler |
| `dist/main.ll`, `dist/tools.ll` | LLVM IR scriptc generated for each program |

## scripts/verify.ts

```
bun scripts/verify.ts [--no-build]
```

Builds (unless `--no-build`), then:

1. runs twenty headless cases through `dist/chip8.exe` and through
   `bun src/main.ts`: the Timendus ROMs, including the quirks and scrolling
   tests in both SUPER-CHIP profiles, games and SUPER-CHIP programs with
   scripted key presses and quirk flags, a SUPER-CHIP program under the
   CHIP-8 profile, a missing ROM and an invalid option;
2. for every ROM in `roms/`, compares the listing `dist/chip8-tools.exe dis`
   prints with the one from `bun src/tools.ts dis`, then has the native
   assembler rebuild the ROM from the native listing and compares the bytes;
3. runs five error cases through both tools programs: assembly errors, an
   oversized ROM, a missing file, an unknown command, no arguments.

It prints `ok` per check, or the two outputs side by side. The exit code is
non-zero if any check fails.

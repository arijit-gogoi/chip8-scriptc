# Documentation

Two kinds of documents live here.

**About this repository** — how the pieces fit together and why each tool is
in the build:

| File | What it covers |
| ---- | -------------- |
| [architecture.md](architecture.md) | directory map, the layers of the program, and the path a ROM takes from disk to pixels |
| [scriptc.md](scriptc.md) | what scriptc is, how it compiles the TypeScript in `src/` to a native executable, how the FFI to raylib works, and the language rules it imposes |
| [toolchain.md](toolchain.md) | the roles of bun, zig and raylib, and what `scripts/build.ts` does step by step |

**How to write a CHIP-8 emulator** — a tutorial series in
[howto/](howto/README.md). It starts from "what is CHIP-8" and ends with a
working interpreter in TypeScript, following the code in `src/chip8.ts`. No
prior emulator experience is assumed; you need to know basic TypeScript
(variables, functions, classes, arrays) and be willing to learn what a byte is.

# How to write a CHIP-8 emulator in TypeScript

This series builds the interpreter in `src/chip8.ts` from nothing, one idea at
a time. Every code block is taken from that file (sometimes shortened), so
when you finish a chapter you can open the real file and recognise everything
in it.

You need: a computer with [bun](https://bun.sh) installed, a text editor, and
TypeScript basics — variables, `if`, loops, functions, classes, arrays. You do
not need to know what a byte or a register is; chapter 0 and the appendix
cover that.

TypeScript makes this easier than the classic C or C++ write-ups: typed arrays
wrap values into 0–255 for you, there are no pointers to get wrong, no memory
to free, and a `switch` statement is all the dispatch you need.

| Chapter | What you will do |
| ------- | ---------------- |
| [0. What is CHIP-8?](00-what-is-chip8.md) | learn what a CPU does, what an emulator is, and what CHIP-8 looks like |
| [1. The machine](01-the-machine.md) | write the `Chip8` class: memory, registers, stack, timers, display, keypad, font |
| [2. Fetch, decode, execute](02-fetch-decode-execute.md) | read an instruction from memory, take it apart, dispatch it |
| [3. Drawing](03-drawing.md) | implement six instructions and show your first picture |
| [4. Jumps, calls and skips](04-flow.md) | subroutines with the stack, conditional skips |
| [5. Arithmetic and the VF flag](05-arithmetic.md) | the `8XY?` family, carries, borrows, shifts, and the first quirks |
| [6. Timers, keys and memory helpers](06-timers-keys-memory.md) | the last twelve instructions: timers, keypad, font, BCD, register dump/load |
| [7. The frame loop](07-frame-loop.md) | run it at the right speed and drive it from a program |
| [8. Testing](08-testing.md) | unit tests, the Timendus test ROMs, snapshots, debugging |
| [9. A window, a keyboard and a beep](09-window.md) | connect the core to raylib and build the native executable |
| [Appendix: bits, bytes and hex](appendix-bits-bytes-hex.md) | binary, hexadecimal, AND/OR/XOR, shifts, masks |

## Further reading

- [Building a CHIP-8 Emulator (C++)](https://austinmorlan.com/posts/chip8_emulator/)
  by Austin Morlan — the same journey in C++ with SDL; this series follows
  its structure.
- [Cowgod's Chip-8 Technical Reference](http://devernay.free.fr/hacks/chip8/C8TECH10.HTM)
  — the classic one-page reference for every instruction.
- [CHIP-8 Instruction Set](https://github.com/mattmikolay/chip-8/wiki/CHIP%E2%80%908-Instruction-Set)
  and [Mastering CHIP-8](https://github.com/mattmikolay/chip-8/wiki/Mastering-CHIP%E2%80%908)
  by Matthew Mikolay — the original COSMAC VIP behaviour, which this emulator
  follows by default.
- [CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite)
  by Timendus — the ROMs used in chapter 8.

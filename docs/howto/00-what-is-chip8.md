# 0. What is CHIP-8?

## How does a CPU work?

Every computer, from a 1977 hobby kit to your phone, runs on the same idea.
There is a **memory**: a long row of numbered slots, each holding one number
between 0 and 255 (a *byte*). Some of those bytes are data — a score, a
position, the pixels of a spaceship. Others are **instructions**: numbers that
tell the processor what to do, like "add these two things" or "jump to slot
512".

The **CPU** (central processing unit) sits in a loop forever:

1. Read the instruction at the address stored in the **program counter** (PC).
2. Move the PC forward so it points at the next instruction.
3. Do what the instruction says. That might change memory, change one of the
   CPU's own small storage cells (its **registers**), or change the PC
   itself, which is how loops and `if` statements work.

That is all. Games, browsers and operating systems are this loop running
billions of times a second.

## What is an emulator?

An emulator is a program that pretends to be another computer. It has an
array for the memory, variables for the registers, and a function that does
step 1–3 above. Feed it a program written for the real machine — a **ROM** —
and it runs it, because from the program's point of view nothing is different:
the numbers end up in the same places.

CHIP-8 is the machine people usually emulate first, for good reasons:

- it has 35 instructions (a Game Boy has about 500);
- its memory is 4 kilobytes, its screen is 64x32 black-and-white pixels, its
  keyboard has 16 keys;
- there are free test programs that tell you exactly which instruction you got
  wrong;
- everything you learn (fetch/decode/execute, registers, a stack, timers,
  sprites) is exactly what you need for the bigger machines.

## CHIP-8

CHIP-8 was created in 1977 by Joseph Weisbecker for the COSMAC VIP, a build-
it-yourself computer with 2 KB of RAM. Programs for the VIP were tedious to
write directly, so he designed a tiny "virtual" machine whose instructions were
two bytes each and easy to type in on a hex keypad. The VIP ran an
**interpreter** that read those instructions and carried them out, which is
why CHIP-8 is called an interpreted language and also a virtual machine. Pong,
Tetris, Breakout and Space Invaders clones were written for it, and people
still write CHIP-8 games today (search for Octojam).

Strictly speaking, what we are building is an interpreter for the CHIP-8
language, not an emulator of the VIP hardware. Everybody calls it an emulator
anyway.

Here is the machine we are going to model. Do not worry if a term is new; each
one gets its own section in the next chapter.

| Part | Size | What it is for |
| ---- | ---- | -------------- |
| memory | 4096 bytes (addresses `0x000`–`0xFFF`) | the program, its data, and the built-in font |
| registers V0–VF | sixteen 8-bit values | the CPU's working variables; VF doubles as a flag |
| index register I | one 16-bit address | points at memory, usually at sprite data |
| program counter PC | one 16-bit address | where the next instruction is |
| stack | sixteen addresses | remembers where to return to after a subroutine |
| delay timer | one byte | counts down 60 times a second; programs use it to wait |
| sound timer | one byte | counts down 60 times a second; the speaker beeps while it is not zero |
| display | 64 x 32 pixels, on or off | drawn with 8-pixel-wide sprites |
| keypad | 16 keys, `0`–`F` | laid out in a 4x4 grid |

Instructions are two bytes long and are written as four hexadecimal digits,
for example `6A02` ("put the value `02` into register VA") or `D015` ("draw a
5-row sprite at the position in V0, V1"). If hexadecimal is new to you, read
the [appendix](appendix-bits-bytes-hex.md) now; it takes ten minutes and the
rest of the series assumes it.

## What you will build

By the end of chapter 7 you will have a class like this:

```ts
const vm = new Chip8(chip8Quirks());
vm.loadRom(readFileSync("roms/tests/2-ibm-logo.ch8"));
for (let frame = 0; frame < 120; frame++) vm.stepFrame(11);
console.log(renderAscii(vm.display));
```

which prints

```
............########.#########...#####.........#####..#.#.......
......................................................#.#.......
............########.###########.######.......######...#........
................................................................
..............####.....###...###...#####.....#####....#.#.......
......................................................###.......
..............####.....#######.....#######.#######......#.......
```

(the IBM logo, cropped). Chapter 9 puts it in a window at 60 frames per
second with keyboard input and a beep.

## Get the test programs

Clone this repository, or download these files into a `roms/tests` folder:

- `1-chip8-logo.ch8`, `2-ibm-logo.ch8`, `3-corax+.ch8`, `4-flags.ch8`,
  `5-quirks.ch8`, `6-keypad.ch8`, `7-beep.ch8` from
  [Timendus' test suite](https://github.com/Timendus/chip8-test-suite/tree/main/bin).

The first two only need six instructions to run, and they are the first
milestone in [chapter 3](03-drawing.md).

Next: [1. The machine](01-the-machine.md)

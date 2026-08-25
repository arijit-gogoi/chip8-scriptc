# 1. The machine

This chapter turns the table from chapter 0 into a TypeScript class. Each part
gets a short explanation of what it does in a real CHIP-8 program, then the
line of code that models it.

## Memory

4096 bytes, addresses `0x000` to `0xFFF`. On the COSMAC VIP the interpreter
itself lived in the first 512 bytes, so programs are loaded at `0x200` and
everything below is "reserved". We only use a small piece of that reserved
area: the font, which by convention goes at `0x050`.

```
0x000 ┌──────────────────────────────┐
      │ reserved (interpreter)       │
0x050 │ font: 16 digits x 5 bytes    │
0x0A0 │ reserved                     │
0x200 ├──────────────────────────────┤
      │ program (ROM) ...            │
      │ ... and its data             │
0xFFF └──────────────────────────────┘
```

In TypeScript a `Uint8Array` is exactly a row of bytes: every element holds
0–255, and if you store a bigger number it keeps only the low 8 bits
(`memory[5] = 300` stores 44, because 300 − 256 = 44). That wrap-around is
what real 8-bit hardware does, so typed arrays save us a lot of `& 0xff`.

```ts
export const MEMORY_SIZE = 4096;
export const PROGRAM_START = 0x200;

readonly memory = new Uint8Array(MEMORY_SIZE);
```

## Registers V0–VF

Sixteen 8-bit registers, named V0 to VF (hexadecimal 0–15). They are the
program's variables: a game keeps the ball's x position in V1, its y in V2,
and so on. Almost every instruction reads or writes one of them.

VF is special. Arithmetic instructions overwrite it with a **flag** — 1 if an
addition overflowed, 1 if a sprite hit something — so programs avoid keeping
data in it.

```ts
export const REGISTER_COUNT = 16;

readonly v = new Uint8Array(REGISTER_COUNT);
```

`this.v[0xf]` is VF.

## The index register I

One 16-bit register that holds a memory address. Programs point it at sprite
data before drawing, or at a block of memory before saving registers into it.
It is the only register that can hold an address, which is why it is called
the *index* register.

```ts
i = 0;
```

## The program counter PC

The address of the next instruction. Programs start at `0x200`. Every
instruction is 2 bytes, so the PC normally moves in steps of 2; jump
instructions set it to something else.

```ts
pc = PROGRAM_START;
```

## The stack and the stack pointer

A **subroutine** is a piece of code that can be called from several places
and then returns to wherever it was called from. To return, the machine has
to remember the address it came from. The stack is where it remembers:
`2NNN` (call) pushes the current PC onto the stack and jumps to `NNN`; `00EE`
(return) pops the address back into the PC.

The **stack pointer** SP says how many entries are in use. Push means "store
at `stack[sp]`, then `sp++`"; pop means "`sp--`, then read `stack[sp]`".

Walk through a call and return. The program:

```
0x200: 2208    call 0x208
0x202: 1202    jump 0x202 (loop forever)
...
0x208: 6001    V0 = 1
0x20A: 00EE    return
```

| Step | PC before | Instruction | Effect | SP after | stack[0] |
| ---- | --------- | ----------- | ------ | -------- | -------- |
| 1 | 0x200 | `2208` | PC has already advanced to 0x202; push 0x202, jump to 0x208 | 1 | 0x202 |
| 2 | 0x208 | `6001` | V0 = 1 | 1 | 0x202 |
| 3 | 0x20A | `00EE` | pop 0x202 into PC | 0 | (stale) |
| 4 | 0x202 | `1202` | jump to 0x202, forever | 0 | |

The original machine had room for 12 nested calls; we allow 16. Calling a
17th level or returning with an empty stack is a program bug, and we will
stop the interpreter when it happens rather than corrupt memory.

```ts
export const STACK_DEPTH = 16;

readonly stack: number[] = zeros(STACK_DEPTH);
sp = 0;
```

(`zeros(n)` just builds an array of `n` zeros. A `Uint16Array` would be the
natural choice; this project uses a plain array because the compiler it is
built with does not support `Uint16Array` yet. A `Uint16Array` works fine
under bun.)

## The timers

Two 8-bit counters. Whenever a timer is above zero, the machine decrements it
60 times per second — independently of how fast instructions run. The
**delay timer** is how programs wait: set it to 30, then spin until it reads
0, and half a second has passed. The **sound timer** works the same way, and
the speaker beeps for as long as it is non-zero. That is the entire CHIP-8
sound system: one tone, on or off.

```ts
delayTimer = 0;
soundTimer = 0;

/** Called once per 60 Hz frame. */
tickTimers(): void {
  if (this.delayTimer > 0) this.delayTimer--;
  if (this.soundTimer > 0) this.soundTimer--;
}
```

## The display

64 pixels wide, 32 tall, each either on or off. Programs cannot set single
pixels; they draw **sprites**, small pictures 8 pixels wide and 1–15 pixels
tall, and the sprite is combined with the screen using XOR (chapter 3 has the
diagrams). We store one byte per pixel, row by row, so pixel (x, y) is at
index `y * 64 + x`.

```ts
export const DISPLAY_WIDTH = 64;
export const DISPLAY_HEIGHT = 32;

/** One byte per pixel, row-major, 1 = lit. */
readonly display = new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT);
```

One bit per pixel would be more compact, but a byte per pixel makes drawing
and testing simpler, and 2048 bytes is nothing.

## The keypad

Sixteen keys labelled with hex digits, arranged like this on the original
machine:

```
1 2 3 C
4 5 6 D
7 8 9 E
A 0 B F
```

The interpreter only needs to know, at any moment, which keys are down. The
host program (the part that talks to a real keyboard) will map physical keys
to these and call `setKey`.

```ts
export const KEY_COUNT = 16;

/** Keypad state, 1 = pressed. */
readonly keys = new Uint8Array(KEY_COUNT);

setKey(key: number, down: boolean): void {
  this.keys[key & 0xf] = down ? 1 : 0;
}
```

## The font

Programs need to draw digits — scores, menus — and the machine provides
sprites for `0`–`F` built in. Each digit is 4 pixels wide and 5 tall, stored
as 5 bytes, one per row, with the pixels in the top 4 bits. Here is `0`:

```
byte   binary      pixels
0xF0   1111 0000   ####
0x90   1001 0000   #  #
0x90   1001 0000   #  #
0x90   1001 0000   #  #
0xF0   1111 0000   ####
```

`src/font.ts` holds all 80 bytes:

```ts
export const FONT_ADDRESS = 0x050;
export const FONT_GLYPH_SIZE = 5;

export const FONT = new Uint8Array([
  0xf0, 0x90, 0x90, 0x90, 0xf0, // 0
  0x20, 0x60, 0x20, 0x20, 0x70, // 1
  0xf0, 0x10, 0xf0, 0x80, 0xf0, // 2
  // ... 3 to F
]);
```

The digit `d` starts at `FONT_ADDRESS + d * 5`, which is what instruction
`FX29` will compute in chapter 6.

Exercise: draw `1` from its bytes `20 60 20 20 70` the way `0` is drawn above.

## Putting the class together

```ts
export class Chip8 {
  readonly memory = new Uint8Array(MEMORY_SIZE);
  readonly v = new Uint8Array(REGISTER_COUNT);
  readonly stack: number[] = zeros(STACK_DEPTH);
  readonly display = new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT);
  readonly keys = new Uint8Array(KEY_COUNT);
  i = 0;
  pc = PROGRAM_START;
  sp = 0;
  delayTimer = 0;
  soundTimer = 0;
  halted = false;
  haltReason = "";

  constructor() {
    this.reset();
  }

  /** Clear all state and reload the font. The ROM must be loaded again afterwards. */
  reset(): void {
    clearBytes(this.memory);
    clearBytes(this.v);
    for (let k = 0; k < STACK_DEPTH; k++) this.stack[k] = 0;
    clearBytes(this.display);
    clearBytes(this.keys);
    this.i = 0;
    this.pc = PROGRAM_START;
    this.sp = 0;
    this.delayTimer = 0;
    this.soundTimer = 0;
    this.halted = false;
    this.haltReason = "";
    for (let k = 0; k < FONT.length; k++) {
      this.memory[FONT_ADDRESS + k] = FONT[k];
    }
  }

  /** Copy a ROM image to 0x200. Throws when the image does not fit. */
  loadRom(rom: Uint8Array): void {
    if (rom.length > MEMORY_SIZE - PROGRAM_START) {
      throw new Error(`ROM is ${rom.length} bytes; at most ${MEMORY_SIZE - PROGRAM_START} fit`);
    }
    for (let k = 0; k < rom.length; k++) {
      this.memory[PROGRAM_START + k] = rom[k];
    }
  }
}
```

`halted` and `haltReason` are ours, not CHIP-8's: when a program does
something impossible (an instruction that does not exist, one return too
many) we set them and stop, and a host can show the reason. That is far more
useful than an exception or silently continuing.

A ROM file is nothing more than the bytes of memory from `0x200` onwards, so
`loadRom` is a copy. `readFileSync("game.ch8")` gives you a `Buffer`, which is
a `Uint8Array`, so it can be passed straight in.

The real `src/chip8.ts` has a few more fields (for waiting on a key and for
the quirk switches); they arrive in the chapters that need them.

Next: [2. Fetch, decode, execute](02-fetch-decode-execute.md)

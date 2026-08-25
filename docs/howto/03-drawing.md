# 3. Drawing

Six instructions are enough to show a picture: clear the screen, set a
register, add to a register, set I, jump, and draw. Both logo test ROMs use
only these, so this chapter ends with your first real program running.

The format for each instruction from here on: the opcode pattern and a short
name, the official one-line description in italics, an explanation, then the
code as it appears in `execute()`.

## 00E0 — clear

*Clear the screen.*

Every pixel off. `clearBytes` is a loop that zeroes a `Uint8Array`. The
`drawn` flag is for chapter 7: it tells the frame loop that the picture
changed.

```ts
case 0x0:
  if (opcode === 0x00e0) {
    clearBytes(this.display);
    this.drawn = true;
  } else if (opcode === 0x00ee) {
    // return — chapter 4
  } else {
    this.halt(`machine code call ${hex(opcode, 4)} at ${hex(at, 3)} is not supported`);
  }
  return;
```

Any other `0NNN` meant "run the machine code at NNN" on the real VIP. There is
no machine code in an emulator, so we stop with a clear message. This is also
what happens when a program runs off its end into zero bytes: `0000` halts
instead of looping forever.

## 1NNN — jump

*Jump to address NNN.*

```ts
case 0x1:
  this.pc = nnn;
  return;
```

## 6XNN — set

*Store number NN in register VX.*

```ts
case 0x6:
  this.v[x] = nn;
  return;
```

## 7XNN — add

*Add the value NN to register VX.*

No carry flag; the result simply wraps at 256.

```ts
case 0x7:
  this.v[x] = (vx + nn) & 0xff;
  return;
```

## ANNN — set I

*Store memory address NNN in register I.*

```ts
case 0xa:
  this.i = nnn;
  return;
```

## DXYN — draw

*Draw a sprite at position VX, VY with N bytes of sprite data starting at the
address stored in I. Set VF to 01 if any set pixels are changed to unset, and
00 otherwise.*

This is the big one. A sprite is N bytes at address I, each byte one row of
8 pixels, most significant bit on the left — exactly like the font glyphs in
chapter 1. The sprite's top-left corner goes at (VX, VY).

Pixels are not simply switched on. Each sprite pixel is **XORed** with the
screen pixel under it: on XOR off = on, on XOR on = off. Drawing the same
sprite twice in the same place erases it, which is how CHIP-8 games move
things — draw, wait, draw again to erase, draw at the new position.

```
 screen          sprite         screen after XOR
 ........        ####....       ####....
 ........   +    #..#....   =   #..#....
 ........        ####....       ####....

 screen          sprite drawn   screen after XOR   VF
 ####....        ..####..       ##..##..           1  (two pixels turned off)
 #..#....   +    ..#..#..   =   #.##.#..
 ####....        ..####..       ##..##..
```

Whenever a pixel that was on is turned off, VF becomes 1; otherwise 0. Games
use this as collision detection: draw the ball, and if VF is 1 it overlapped
something.

Two edge rules. The starting position wraps: a sprite at VX = 68 is drawn at
x = 4. But once a sprite starts on screen, the part that runs past the right
or bottom edge is clipped, not wrapped. (Some interpreters wrap that part too;
the `wrapSprites` quirk switch in chapter 5 enables it.)

```ts
case 0xd:
  this.drawSprite(vx, vy, n);
  return;

private drawSprite(vx: number, vy: number, height: number): void {
  const x0 = vx % DISPLAY_WIDTH;
  const y0 = vy % DISPLAY_HEIGHT;
  let collision = 0;
  for (let row = 0; row < height; row++) {
    let py = y0 + row;
    if (py >= DISPLAY_HEIGHT) {
      if (!this.quirks.wrapSprites) break;
      py -= DISPLAY_HEIGHT;
    }
    const bits = this.memory[(this.i + row) & 0xfff];
    for (let bit = 0; bit < 8; bit++) {
      if ((bits & (0x80 >> bit)) === 0) continue;
      let px = x0 + bit;
      if (px >= DISPLAY_WIDTH) {
        if (!this.quirks.wrapSprites) break;
        px -= DISPLAY_WIDTH;
      }
      const index = py * DISPLAY_WIDTH + px;
      if (this.display[index] !== 0) {
        collision = 1;
        this.display[index] = 0;
      } else {
        this.display[index] = 1;
      }
    }
  }
  this.v[0xf] = collision;
  this.drawn = true;
}
```

Reading the inner loop: `0x80 >> bit` is a mask with a single 1 that walks
from the leftmost bit (`1000 0000`) to the rightmost. If the sprite bit is 0
nothing happens — XOR with 0 changes nothing, so we skip. If it is 1 the
screen pixel flips, and we note a collision when it flips from on to off.

Until chapter 5 introduces `quirks`, you can replace `this.quirks.wrapSprites`
with `false`.

## Seeing the result

A screen is just an array; print it:

```ts
export function renderAscii(display: Uint8Array): string {
  let out = "";
  for (let row = 0; row < DISPLAY_HEIGHT; row++) {
    let line = "";
    for (let col = 0; col < DISPLAY_WIDTH; col++) {
      line += display[row * DISPLAY_WIDTH + col] !== 0 ? "#" : ".";
    }
    out += line;
    if (row < DISPLAY_HEIGHT - 1) out += "\n";
  }
  return out;
}
```

Now run the IBM logo. It draws once and then jumps to itself forever, so a
few hundred instructions are plenty:

```ts
import { readFileSync } from "node:fs";

const vm = new Chip8();
vm.loadRom(readFileSync("roms/tests/2-ibm-logo.ch8"));
for (let k = 0; k < 500; k++) vm.step();
console.log(renderAscii(vm.display));
console.log(vm.halted ? vm.haltReason : "running");
```

```
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
```

If you see this (the top and bottom rows of blank lines are cropped here), six
instructions work. If the picture is garbled, the usual suspects are the bit
order in `drawSprite` (`0x80 >> bit`, not `1 << bit`) and the row index
(`py * DISPLAY_WIDTH + px`, width not height). `1-chip8-logo.ch8` is a second
picture using the same instructions.

Next: [4. Jumps, calls and skips](04-flow.md)

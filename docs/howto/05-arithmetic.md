# 5. Arithmetic and the VF flag

All nine instructions in this chapter start with `8`, take two registers, and
are selected by the last digit. Most of them set VF as a side effect, and
getting VF exactly right is what separates an emulator that runs the logo from
one that runs games.

## Wrap-around and flags

Registers hold 0–255. When an addition goes past 255 the register keeps the
low 8 bits and the machine records that it happened in VF: `200 + 100 = 300`
stores `44` and sets VF to 1. Subtraction that goes below 0 wraps the other
way and clears VF. Programs read VF right after the operation to handle
16-bit numbers, detect underflow, and so on.

## 8XY0 — copy

*Store the value of register VY in register VX.*

```ts
case 0x0:
  this.v[x] = vy;
  return true;
```

(These cases live in a helper, `executeArithmetic(n, x, vx, vy)`, that
returns `false` for an undefined last digit so the caller can halt.)

## 8XY1, 8XY2, 8XY3 — OR, AND, XOR

*Set VX to VX OR VY.* / *Set VX to VX AND VY.* / *Set VX to VX XOR VY.*

Bitwise operations, one bit at a time; see the appendix if `|`, `&`, `^` are
new. The original interpreter also cleared VF after these three, a side
effect of how it was written. Programs from that era occasionally depend on
it, so it is a quirk switch.

```ts
case 0x1:
  this.v[x] = vx | vy;
  if (this.quirks.vfReset) this.v[0xf] = 0;
  return true;
case 0x2:
  this.v[x] = vx & vy;
  if (this.quirks.vfReset) this.v[0xf] = 0;
  return true;
case 0x3:
  this.v[x] = vx ^ vy;
  if (this.quirks.vfReset) this.v[0xf] = 0;
  return true;
```

## 8XY4 — add with carry

*Add the value of register VY to register VX. Set VF to 01 if a carry occurs;
set VF to 00 if a carry does not occur.*

```ts
case 0x4: {
  const sum = vx + vy;
  this.v[x] = sum & 0xff;
  this.v[0xf] = sum > 0xff ? 1 : 0;
  return true;
}
```

The order of the last two lines is deliberate. If X is F — `8F14`, add V1 to
VF — the result is written to VF and then immediately replaced by the flag.
That is what the original hardware did, and the `4-flags.ch8` test ROM checks
for it. It is also why `vx` and `vy` were read *before* the `switch` in
chapter 2: after `this.v[x] = ...` runs, `this.v[y]` might already be
different from the value the instruction was supposed to use.

## 8XY5 — subtract

*Subtract the value of register VY from register VX. Set VF to 00 if a borrow
occurs; set VF to 01 if a borrow does not occur.*

Note the direction: VF is 1 when the subtraction *succeeded* without going
below zero. It is easy to get backwards.

```ts
case 0x5:
  this.v[x] = (vx - vy) & 0xff;
  this.v[0xf] = vx >= vy ? 1 : 0;
  return true;
```

## 8XY7 — subtract the other way

*Set register VX to the value of VY minus VX. Set VF to 00 if a borrow occurs;
set VF to 01 if a borrow does not occur.*

```ts
case 0x7:
  this.v[x] = (vy - vx) & 0xff;
  this.v[0xf] = vy >= vx ? 1 : 0;
  return true;
```

## 8XY6 — shift right

*Store the value of register VY shifted right one bit in register VX. Set
register VF to the least significant bit prior to the shift. VY is unchanged.*

Shifting right by one halves the value and drops the lowest bit; that dropped
bit goes to VF.

Here is the first famous disagreement between CHIP-8 references. The original
interpreter shifts VY and stores the result in VX, as described above. The
CHIP-48 and SUPER-CHIP interpreters from the 1990s ignored VY and shifted VX
in place, and many references (including Cowgod's) document that version.
Games written for one break on the other, so emulators offer a switch:

```ts
case 0x6: {
  const src = this.quirks.shiftVx ? vx : vy;
  this.v[x] = src >> 1;
  this.v[0xf] = src & 1;
  return true;
}
```

## 8XYE — shift left

*Store the value of register VY shifted left one bit in register VX. Set
register VF to the most significant bit prior to the shift. VY is unchanged.*

Doubling; the bit that falls off the top goes to VF. Same quirk as `8XY6`.

```ts
case 0xe: {
  const src = this.quirks.shiftVx ? vx : vy;
  this.v[x] = (src << 1) & 0xff;
  this.v[0xf] = (src >> 7) & 1;
  return true;
}
```

## The quirks object

This is where the interpreter grows its `quirks` field. Rather than two
copies of the code, the behaviours that differ between CHIP-8 interpreters
are six booleans, and each instruction reads the one it cares about:

```ts
export interface Quirks {
  shiftVx: boolean;        // 8XY6 / 8XYE shift VX in place instead of VY into VX
  indexIncrement: boolean; // FX55 / FX65 leave I = I + X + 1 afterwards (chapter 6)
  jumpVx: boolean;         // BNNN jumps to XNN + VX instead of NNN + V0
  vfReset: boolean;        // 8XY1 / 8XY2 / 8XY3 reset VF
  wrapSprites: boolean;    // DXYN wraps pixels at the edges instead of clipping
  displayWait: boolean;    // DXYN waits for the next frame (chapter 7)
}

export function chip8Quirks(): Quirks {
  return { shiftVx: false, indexIncrement: true, jumpVx: false, vfReset: true, wrapSprites: false, displayWait: true };
}

export function schipQuirks(): Quirks {
  return { shiftVx: true, indexIncrement: false, jumpVx: true, vfReset: false, wrapSprites: false, displayWait: false };
}
```

The constructor takes one: `new Chip8(chip8Quirks())`. The first preset is
the original 1977 behaviour and the default; the second is what SUPER-CHIP
and most 1990s-and-later games expect. Chapter 8 shows a test ROM that
detects which preset an emulator is running and reports it.

## Try it

- `60C8 6164 8014` (V0 = 200, V1 = 100, V0 += V1): V0 should be 44 and VF 1.
- `6005 6103 8015`: V0 = 2, VF = 1 (no borrow).
- `6003 6105 8015`: V0 = 254, VF = 0.
- `6000 6183 8016` with `chip8Quirks()`: V0 = 0x41, VF = 1, V1 still 0x83.
- The same with `schipQuirks()`: V0 = 0 (V0 was 0 and is shifted in place),
  VF = 0.

Next: [6. Timers, keys and memory helpers](06-timers-keys-memory.md)

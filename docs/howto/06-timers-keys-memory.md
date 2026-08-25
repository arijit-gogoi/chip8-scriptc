# 6. Timers, keys and memory helpers

Twelve instructions remain: two for keys, three for timers, one that waits
for a key, and six that move data between registers and memory. After this
chapter every CHIP-8 instruction is implemented.

## EX9E — skip if key pressed

*Skip the following instruction if the key corresponding to the hex value
currently stored in register VX is pressed.*

Only the low four bits of VX name a key, so `& 0xf` keeps the index inside
the 16-entry array.

```ts
case 0xe:
  if (nn === 0x9e) {
    if (this.keys[vx & 0xf] !== 0) this.skip();
    return;
  }
  if (nn === 0xa1) {
    if (this.keys[vx & 0xf] === 0) this.skip();
    return;
  }
  break;
```

## EXA1 — skip if key not pressed

*Skip the following instruction if the key corresponding to the hex value
currently stored in register VX is not pressed.*

Same code, other branch. Together these are how a game reads the joystick
every frame.

## FX07, FX15, FX18 — the timers

*Store the current value of the delay timer in register VX.* /
*Set the delay timer to the value of register VX.* /
*Set the sound timer to the value of register VX.*

The timers were introduced in chapter 1 and decrement in `tickTimers()`,
which the frame loop (chapter 7) calls sixty times a second. The instructions
themselves are trivial. (These `F` cases live in `executeMisc(nn, x, vx)`,
selected by the last two digits, and return `false` for an unknown one.)

```ts
case 0x07:
  this.v[x] = this.delayTimer;
  return true;
case 0x15:
  this.delayTimer = vx;
  return true;
case 0x18:
  this.soundTimer = vx;
  return true;
```

A typical delay loop in a game:

```
6A03    VA = 3
FA15    delay timer = VA
FA07    VA = delay timer        <-+
3A00    skip if VA == 0           |
1204    jump back                 -+  (three frames, 50 ms)
```

## FX0A — wait for a key

*Wait for a keypress and store the result in register VX.*

The only instruction that blocks. The whole interpreter stops executing
instructions until a key is pressed — but the timers keep running, so a game
can still count down and beep while it waits for "press any key".

We cannot literally block: our `step()` is called from a loop that also has
to poll the keyboard, or nothing would ever be pressed. Instead `FX0A` puts
the interpreter into a waiting state, and `step()` (chapter 2) checks that
state first and polls the keys instead of fetching an instruction.

One more subtlety: the original interpreter reports the key when it is
**released**, not when it is pressed. A game that does `FX0A` and then
immediately checks `EX9E` for the same key would otherwise always see it
still held. Timendus' keypad test checks for release, so that is what we do:
remember the first key seen down, then finish when it goes up.

```ts
waitingForKey = false;
waitRegister = 0;
waitKey = -1;

case 0x0a:
  this.waitingForKey = true;
  this.waitRegister = x;
  this.waitKey = -1;
  this.pollWaitKey();
  return true;

private pollWaitKey(): void {
  if (this.waitKey < 0) {
    for (let k = 0; k < KEY_COUNT; k++) {
      if (this.keys[k] !== 0) {
        this.waitKey = k;
        break;
      }
    }
    return;
  }
  if (this.keys[this.waitKey] === 0) {
    this.v[this.waitRegister] = this.waitKey;
    this.waitingForKey = false;
    this.waitKey = -1;
  }
}
```

## FX1E — add to I

*Add the value stored in register VX to register I.*

```ts
case 0x1e:
  this.i = (this.i + vx) & 0xffff;
  return true;
```

I is 16 bits wide even though only 12 are needed to address memory; every
memory access masks with `& 0xfff` anyway.

## FX29 — point I at a font digit

*Set I to the memory address of the sprite data corresponding to the
hexadecimal digit stored in register VX.*

The glyphs from chapter 1, five bytes each, starting at `0x050`. After this,
`D??5` draws the digit.

```ts
case 0x29:
  this.i = FONT_ADDRESS + (vx & 0xf) * FONT_GLYPH_SIZE;
  return true;
```

## FX33 — binary-coded decimal

*Store the binary-coded decimal equivalent of the value stored in register
VX at addresses I, I + 1, and I + 2.*

Split a number into its decimal digits: 237 becomes the three bytes 2, 3, 7.
This exists so that a game can show a score: `FX33`, then `FX65` to load the
three digits into V0–V2, then `FX29` + `DXYN` for each. The name comes from
the way each digit is stored in its own byte.

```ts
case 0x33:
  this.memory[this.i & 0xfff] = Math.floor(vx / 100);
  this.memory[(this.i + 1) & 0xfff] = Math.floor(vx / 10) % 10;
  this.memory[(this.i + 2) & 0xfff] = vx % 10;
  return true;
```

## FX55 — store registers

*Store the values of registers V0 to VX inclusive in memory starting at
address I. I is set to I + X + 1 after operation.*

"V0 to VX inclusive" means X + 1 registers; `FF55` saves all sixteen. The
second sentence is the second famous disagreement: the original interpreter
left I pointing past the block it wrote, SUPER-CHIP left I unchanged, and
games exist that depend on each. Hence the `indexIncrement` quirk.

```ts
case 0x55:
  for (let k = 0; k <= x; k++) {
    this.memory[(this.i + k) & 0xfff] = this.v[k];
  }
  if (this.quirks.indexIncrement) this.i = (this.i + x + 1) & 0xffff;
  return true;
```

## FX65 — load registers

*Fill registers V0 to VX inclusive with the values stored in memory starting
at address I. I is set to I + X + 1 after operation.*

```ts
case 0x65:
  for (let k = 0; k <= x; k++) {
    this.v[k] = this.memory[(this.i + k) & 0xfff];
  }
  if (this.quirks.indexIncrement) this.i = (this.i + x + 1) & 0xffff;
  return true;
```

## CXNN — random

*Set VX to a random number with a mask of NN.*

A random byte ANDed with NN. `C0FF` gives 0–255, `C007` gives 0–7, `C00E`
gives even numbers up to 14 — the mask is how games pick a range.

`Math.random()` would work, but a deterministic generator is much better for
an emulator: the same ROM then produces exactly the same run every time,
which lets you write tests that compare whole screens (chapter 8). This is a
xorshift generator, a few lines that produce a good-enough sequence from a
fixed seed:

```ts
private rngState = 0x2545f491;

private nextRandom(): number {
  let x = this.rngState;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  this.rngState = x === 0 ? 1 : x;
  return x & 0xff;
}

case 0xc:
  this.v[x] = this.nextRandom() & nn;
  return;
```

(`>>> 0` forces the intermediate value back to an unsigned 32-bit number;
JavaScript's `<<` works on signed 32-bit integers.)

## All 35

That is every instruction in the CHIP-8 set. Chapter 2's `execute()` now has
a case for each first digit, `executeArithmetic` covers `8XY0`–`8XYE`, and
`executeMisc` covers `FX07`–`FX65`. Anything else — including `0NNN` and
patterns like `5XY1` or `8XY8` that look valid but are not — ends in
`halt()` with the offending opcode in the message.

Next: [7. The frame loop](07-frame-loop.md)

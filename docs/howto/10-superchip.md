# 10. SUPER-CHIP

In 1991 Erik Bryntse released SUPER-CHIP, a CHIP-8 interpreter for the HP-48
graphing calculators with ten new instructions: a 128x64 high-resolution
mode, scrolling, 16x16 sprites, large digits, a way to keep a few registers
between runs, and an instruction that ends the program. Many later CHIP-8
programs, including many written for Octo, use them. This chapter adds them
to the interpreter of chapters 1 to 9; the result is `src/chip8.ts` as it
stands.

SUPER-CHIP also changed some CHIP-8 instructions, and those changes are the
`schip` preset of chapter 5: shift VX in place, leave I alone after
`FX55`/`FX65`, `BXNN`, no VF reset. What is new here is the hardware.

## The new instructions

| Opcode | Mnemonic | What it does |
| ------ | -------- | ------------ |
| `00CN` | `SCD N` | scroll the display down N rows |
| `00FB` | `SCR` | scroll the display right 4 pixels |
| `00FC` | `SCL` | scroll the display left 4 pixels |
| `00FD` | `EXIT` | end the program |
| `00FE` | `LOW` | 64x32 pixels (the CHIP-8 screen) |
| `00FF` | `HIGH` | 128x64 pixels |
| `DXY0` | `DRW Vx, Vy, 0` | draw a 16x16 sprite, two bytes per row |
| `FX30` | `LD HF, Vx` | point I at the large (8x10) digit in VX |
| `FX75` | `LD R, Vx` | save V0..VX in the flag registers |
| `FX85` | `LD Vx, R` | load V0..VX from the flag registers |

The mnemonics are the ones in Cowgod's reference; chapter 11's assembler
uses them.

## Two resolutions, one buffer

The display needs room for 128x64 pixels. Rather than two buffers, the
interpreter allocates the larger one and keeps the current size in two
fields. Pixel (x, y) is always at `y * width + x`, so in low resolution the
picture is simply the first 64 * 32 bytes, exactly as before:

```ts
export const HIRES_WIDTH = 128;
export const HIRES_HEIGHT = 64;

/**
 * One byte per pixel, 1 = lit, row-major with `width` pixels per row. It is
 * sized for high resolution; low resolution uses the first 64 * 32 bytes.
 */
readonly display = new Uint8Array(HIRES_WIDTH * HIRES_HEIGHT);
/** SUPER-CHIP high resolution (00FF) is active. */
hires = false;
/** Display size in pixels: 64 x 32, or 128 x 64 in high resolution. */
width = DISPLAY_WIDTH;
height = DISPLAY_HEIGHT;
```

`reset()` sets `hires`, `width` and `height` back to low resolution, and the
hosts pass `vm.width` and `vm.height` along with `vm.display` wherever chapter
9 passed 64 and 32. `00FE` and `00FF` switch:

```ts
/** 00FE / 00FF: switch between 64x32 and 128x64 pixels. The display is cleared. */
private setResolution(hires: boolean): void {
  this.hires = hires;
  this.width = hires ? HIRES_WIDTH : DISPLAY_WIDTH;
  this.height = hires ? HIRES_HEIGHT : DISPLAY_HEIGHT;
  this.display.fill(0);
}
```

Clearing is what modern interpreters do. The calculator did not: its screen
was always 128x64, a low-resolution pixel was a 2x2 block of it, and
switching modes left the old picture there to be drawn over. A buffer with
one byte per pixel of the current resolution cannot hold that picture
exactly, so both SUPER-CHIP profiles clear.

## The 0 group

Chapter 3 handled `00E0` and `00EE` inline and halted on any other `0NNN`.
Seven SUPER-CHIP instructions live in this group too, so it gets its own
method:

```ts
/** 0NNN group: 00E0, 00EE, the SUPER-CHIP screen instructions, and machine code calls. */
private executeSystem(opcode: number, at: number): void {
  if (opcode === 0x00e0) {
    this.display.fill(0);
    this.drawn = true;
    return;
  }
  if (opcode === 0x00ee) {
    if (this.sp === 0) {
      this.halt(`stack underflow at ${hex(at, 3)}`);
      return;
    }
    this.sp--;
    this.pc = this.stack[this.sp] & 0xfff;
    return;
  }
  if ((opcode & 0xfff0) === 0x00c0) {
    if (this.superChipEnabled(opcode, at)) this.scrollDown(opcode & 0xf);
    return;
  }
  switch (opcode) {
    case 0x00fb:
      if (this.superChipEnabled(opcode, at)) this.scrollRight();
      return;
    case 0x00fc:
      if (this.superChipEnabled(opcode, at)) this.scrollLeft();
      return;
    case 0x00fd:
      if (this.superChipEnabled(opcode, at)) this.halt(`program exited at ${hex(at, 3)}`);
      return;
    case 0x00fe:
      if (this.superChipEnabled(opcode, at)) this.setResolution(false);
      return;
    case 0x00ff:
      if (this.superChipEnabled(opcode, at)) this.setResolution(true);
      return;
    default:
      this.halt(`machine code call ${hex(opcode, 4)} at ${hex(at, 3)} is not supported`);
  }
}
```

On a COSMAC VIP, `00FF` is a machine code call like any other. So the new
instructions only run when the quirks say this is a SUPER-CHIP; otherwise the
interpreter halts and names the instruction, which tells a user running a
SUPER-CHIP program under the CHIP-8 profile what to change:

```ts
/** True when the SUPER-CHIP instructions are enabled; otherwise halts, naming the instruction. */
private superChipEnabled(opcode: number, at: number): boolean {
  if (this.quirks.superChip) return true;
  this.halt(`${hex(opcode, 4)} at ${hex(at, 3)} is a SUPER-CHIP instruction`);
  return false;
}
```

`00FD` halts too, with a reason that says the program ended rather than
failed.

## Scrolling

Scrolling moves the picture and blanks what scrolls in. Moving right, the
loop has to run from the right edge leftwards, or it would copy pixels it
has already moved:

```ts
/** 00FB: move the picture 4 pixels right. */
private scrollRight(): void {
  const width = this.width;
  const distance = this.scrollDistance(4);
  for (let y = 0; y < this.height; y++) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x--) {
      this.display[row + x] = x >= distance ? this.display[row + x - distance] : 0;
    }
  }
}
```

`scrollLeft()` is the mirror image, and `scrollDown(n)` does the same with
whole rows, from the bottom row upwards.

How far is 4 pixels? In high resolution, 4 pixels. In low resolution,
interpreters disagree. On the HP-48 the scroll instructions move the
calculator's 128x64 screen, where a low-resolution pixel is 2x2, so they
move half as far as their names say: 2 pixels sideways, N/2 rows down.
Modern interpreters, Octo first among them, move whole low-resolution
pixels, and programs written for them depend on it. A quirk chooses:

```ts
/** Scroll distance: `pixels`, or half of it in low resolution with the loresHalfScroll quirk. */
private scrollDistance(pixels: number): number {
  return !this.hires && this.quirks.loresHalfScroll ? pixels >> 1 : pixels;
}
```

## Big sprites, and VF in high resolution

`DXYN` with N = 0 draws nothing on the VIP (chapter 3's loop runs zero
times). SUPER-CHIP uses it for a 16x16 sprite: 16 rows of two bytes, the
left byte first. The sprite loop of chapter 3 gains a row width and a width
in bits:

```ts
private drawSprite(vx: number, vy: number, n: number): void {
  const width = this.width;
  const height = this.height;
  let rows = n;
  let wide = false;
  if (n === 0 && this.quirks.superChip) {
    rows = 16;
    wide = this.hires || !this.quirks.lores8x16;
  }
  const columns = wide ? 16 : 8;
  const firstBit = wide ? 0x8000 : 0x80;
  const x0 = vx % width;
  const y0 = vy % height;
  let collidingRows = 0;
  let clippedRows = 0;
  for (let row = 0; row < rows; row++) {
    let py = y0 + row;
    if (py >= height) {
      if (!this.quirks.wrapSprites) {
        clippedRows = rows - row;
        break;
      }
      py -= height;
    }
    let bits = this.memory[(this.i + row) & 0xfff];
    if (wide) {
      bits = (this.memory[(this.i + row * 2) & 0xfff] << 8) | this.memory[(this.i + row * 2 + 1) & 0xfff];
    }
    let collided = false;
    for (let bit = 0; bit < columns; bit++) {
      if ((bits & (firstBit >> bit)) === 0) continue;
      let px = x0 + bit;
      if (px >= width) {
        if (!this.quirks.wrapSprites) break;
        px -= width;
      }
      const index = py * width + px;
      if (this.display[index] !== 0) collided = true;
      this.display[index] ^= 1;
    }
    if (collided) collidingRows++;
  }
  if (this.hires && this.quirks.rowCollisions) this.v[0xf] = collidingRows + clippedRows;
  else this.v[0xf] = collidingRows > 0 ? 1 : 0;
  this.drawn = true;
}
```

Two more places where the HP-48 differs from later interpreters show up
here. Its low-resolution drawing routine never learned about 16x16 sprites:
for `DXY0` it draws 16 rows of one byte, an 8x16 sprite (the `lores8x16`
quirk). And in high resolution it sets VF to the number of sprite rows that
hit something, plus the number of rows cut off at the bottom edge, instead
of 1 (the `rowCollisions` quirk). A program that tests `VF != 0` works
either way; one that tests `VF == 1` does not on the calculator. Counting
rows is why the loop tracks `collidingRows` instead of a single flag.

## Large digits and flag registers

`FX30` works like `FX29` with a second font: ten digits, 8 pixels wide and
10 tall, stored right after the small font. SUPER-CHIP has no large A to F;
asking for one points I past the end of the table.

```ts
case 0x30:
  // Digits A-F have no large glyph; their addresses lie past the font.
  if (this.superChipEnabled(opcode, at)) this.i = BIG_FONT_ADDRESS + (vx & 0xf) * BIG_FONT_GLYPH_SIZE;
  return true;
```

`FX75` and `FX85` copy V0..VX to and from the calculator's user flags, which
survive after the program ends. Here they are sixteen bytes on the
interpreter (the HP-48 has eight; Octo keeps sixteen, so any X works), and
`reset()` leaves them alone:

```ts
/** SUPER-CHIP flag registers (FX75 / FX85). They survive reset(), as on the HP-48. */
readonly flags = new Uint8Array(FLAG_COUNT);
/** Set by FX75; a host that keeps the flags in a file saves them and clears it. */
flagsChanged = false;
```

```ts
case 0x75:
  if (this.superChipEnabled(opcode, at)) {
    for (let k = 0; k <= x; k++) {
      this.flags[k] = this.v[k];
    }
    this.flagsChanged = true;
  }
  return true;
```

Surviving the end of the program is the host's job. With `--flags <file>`,
`src/main.ts` fills `vm.flags` from the file before the first frame and,
after every frame in which `FX75` ran, writes them back:

```ts
/** Write the flag registers to the --flags file after FX75 changed them. */
function saveFlags(vm: Chip8, path: string): void {
  if (path === "" || !vm.flagsChanged) return;
  vm.flagsChanged = false;
  try {
    writeFileSync(path, vm.flags);
  } catch {
    console.log(`cannot write flags file ${path}`);
  }
}
```

## Display wait belongs to low resolution

Erik Bryntse described the high-resolution mode as enabling "higher speed"
as well as the full screen. Low resolution was a compatibility mode, and in
it the calculator waits for the display like the VIP (Timendus' notes on
legacy SUPER-CHIP tell how this was found). High resolution never waits, so
chapter 7's frame loop gains a condition:

```ts
if (this.drawn && this.quirks.displayWait && !this.hires) break;
```

CHIP-8 programs never leave low resolution, so for them nothing changes.

## Two SUPER-CHIPs

The quirks object gains the SUPER-CHIP switch and the three HP-48 rules:

```ts
superChip: boolean;       // the ten instructions above
loresHalfScroll: boolean; // low resolution scrolls half as far
lores8x16: boolean;       // low resolution DXY0 draws 8x16
rowCollisions: boolean;   // high resolution VF counts rows
```

and two presets:

```ts
/**
 * Modern SUPER-CHIP, as Timendus' test suite defines it: SUPER-CHIP's quirks,
 * with the SUPER-CHIP instructions as current interpreters run them.
 */
export function schipQuirks(): Quirks {
  return {
    shiftVx: true,
    indexIncrement: false,
    jumpVx: true,
    vfReset: false,
    wrapSprites: false,
    displayWait: false,
    superChip: true,
    loresHalfScroll: false,
    lores8x16: false,
    rowCollisions: false,
  };
}

/** SUPER-CHIP 1.1 as it behaves on the HP-48 calculators. */
export function schipLegacyQuirks(): Quirks {
  return {
    shiftVx: true,
    indexIncrement: false,
    jumpVx: true,
    vfReset: false,
    wrapSprites: false,
    displayWait: true,
    superChip: true,
    loresHalfScroll: true,
    lores8x16: true,
    rowCollisions: true,
  };
}
```

`chip8Quirks()` sets all four new fields to false. `profileQuirks(name)`
maps the names `chip8`, `schip` and `schip-legacy` to these functions for
the command line (`--quirks`) and the browser's profile menu.

Which one to use? Programs written for modern SUPER-CHIP interpreters expect
`schip`. Programs from the 1990s were written on calculators, but most of
them run under `schip` too; `schip-legacy` is for the ones that do not, and
for checking an interpreter against the real thing. Many programs written
with Octo are a third case: they use the SUPER-CHIP instructions but keep
CHIP-8's `8XY6`/`8XYE` and `FX55`/`FX65`, a combination neither preset
offers (`roms/README.md` says which of the included programs fit `schip`).

## The hosts

`renderAscii` prints whatever size it is given, defaulting to 64x32:

```ts
export function renderAscii(display: Uint8Array, width: number = DISPLAY_WIDTH, height: number = DISPLAY_HEIGHT): string {
```

and the headless host calls it as `renderAscii(vm.display, vm.width,
vm.height)`. The window computes its scale from the current resolution
every frame, so switching to high resolution halves the size of a pixel and
keeps the picture the same size:

```ts
// The largest integer scale for the current resolution (64x32 or 128x64).
const scale = Math.max(1, Math.floor(Math.min(width / vm.width, height / vm.height)));
const originX = Math.floor((width - vm.width * scale) / 2);
const originY = Math.floor((height - vm.height * scale) / 2);
```

The C shim needed no change beyond a minimum window size of 128x64:
`c8rl_draw_display` already took the number of columns and rows. The
browser host resizes its backing canvas when the resolution changes.

## Testing it

Timendus' suite covers SUPER-CHIP too. Both menus can be skipped by storing
the choice at `0x1FF` before the first frame, which is how
`tests/roms.test.ts` runs them:

| ROM | `0x1FF` | Profile | Expected |
| --- | ------- | ------- | -------- |
| `5-quirks.ch8` | 2 | `schip` | every quirk with a check mark; display wait `NONE`, clipping `BOTH` |
| `5-quirks.ch8` | 4 | `schip-legacy` | the same, but display wait `LRES` (low resolution only) |
| `8-scrolling.ch8` | 1 | `schip` | every arrow inside its box, low resolution |
| `8-scrolling.ch8` | 2 | `schip-legacy` | the same, with half-distance scrolling |
| `8-scrolling.ch8` | 3 | `schip` | the same in high resolution |

`tests/chip8.test.ts` has a unit test for each instruction and each of the
new quirks, and `roms/schip/` holds three CC0 SUPER-CHIP programs that
`bun run verify` runs through both the native binary and bun.

Next: [11. An assembler and a disassembler](11-assembler-disassembler.md)

import { BIG_FONT, BIG_FONT_ADDRESS, BIG_FONT_GLYPH_SIZE, FONT, FONT_ADDRESS, FONT_GLYPH_SIZE } from "./font";

export const MEMORY_SIZE = 4096;
export const PROGRAM_START = 0x200;
/** The CHIP-8 screen, which is also SUPER-CHIP's low resolution. */
export const DISPLAY_WIDTH = 64;
export const DISPLAY_HEIGHT = 32;
/** SUPER-CHIP's high resolution, selected by 00FF. */
export const HIRES_WIDTH = 128;
export const HIRES_HEIGHT = 64;
export const STACK_DEPTH = 16;
export const REGISTER_COUNT = 16;
export const KEY_COUNT = 16;
/** SUPER-CHIP flag registers for FX75 / FX85 (the HP-48 has 8; Octo keeps 16, so FX75 with any X works). */
export const FLAG_COUNT = 16;

/**
 * Behaviours that differ between CHIP-8 interpreters. The defaults follow the
 * original COSMAC VIP interpreter as documented in
 * https://github.com/mattmikolay/chip-8/wiki/CHIP%E2%80%908-Instruction-Set
 */
export interface Quirks {
  /** 8XY6 / 8XYE shift VX in place (SUPER-CHIP) instead of storing a shifted VY into VX (VIP). */
  shiftVx: boolean;
  /** FX55 / FX65 leave I at I + X + 1 afterwards (VIP). SUPER-CHIP leaves I untouched. */
  indexIncrement: boolean;
  /** BNNN jumps to XNN + VX (SUPER-CHIP) instead of NNN + V0 (VIP). */
  jumpVx: boolean;
  /** 8XY1 / 8XY2 / 8XY3 reset VF to 0 (VIP). */
  vfReset: boolean;
  /** DXYN wraps sprite pixels around the screen edges instead of clipping them. */
  wrapSprites: boolean;
  /**
   * DXYN and 00E0 end the 60 Hz frame, so at most one sprite is drawn per
   * frame (VIP, and SUPER-CHIP 1.1 in low resolution). Never in high resolution.
   */
  displayWait: boolean;
  /**
   * The SUPER-CHIP instructions: 00CN, 00FB-00FF, DXY0 as a 16x16 sprite,
   * FX30, FX75 and FX85. Without them, DXY0 draws nothing and the others halt.
   */
  superChip: boolean;
  /**
   * In low resolution, 00CN, 00FB and 00FC scroll half as far: SUPER-CHIP 1.1
   * on the HP-48 scrolls the calculator's 128x64 screen, where a low-resolution
   * pixel is 2x2.
   */
  loresHalfScroll: boolean;
  /** In low resolution, DXY0 draws 8x16 pixels instead of 16x16 (SUPER-CHIP 1.1). */
  lores8x16: boolean;
  /**
   * In high resolution, DXYN sets VF to the number of sprite rows that collide
   * or are clipped at the bottom edge (SUPER-CHIP 1.1), instead of 1 or 0.
   */
  rowCollisions: boolean;
}

/** Original CHIP-8 (COSMAC VIP) behaviour. */
export function chip8Quirks(): Quirks {
  return {
    shiftVx: false,
    indexIncrement: true,
    jumpVx: false,
    vfReset: true,
    wrapSprites: false,
    displayWait: true,
    superChip: false,
    loresHalfScroll: false,
    lores8x16: false,
    rowCollisions: false,
  };
}

/** Modern SUPER-CHIP, as Octo and most current interpreters implement it; many later ROMs assume it. */
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

/** Names of the quirk profiles, in the order hosts list them. */
export const PROFILES = ["chip8", "schip", "schip-legacy"];

/** The quirks of a profile named in PROFILES; anything else gets CHIP-8. */
export function profileQuirks(profile: string): Quirks {
  if (profile === "schip") return schipQuirks();
  if (profile === "schip-legacy") return schipLegacyQuirks();
  return chip8Quirks();
}

export class Chip8 {
  readonly memory = new Uint8Array(MEMORY_SIZE);
  /** General purpose registers V0..VF. */
  readonly v = new Uint8Array(REGISTER_COUNT);
  /** Return addresses. */
  readonly stack = new Uint16Array(STACK_DEPTH);
  /**
   * One byte per pixel, 1 = lit, row-major with `width` pixels per row. It is
   * sized for high resolution; low resolution uses the first 64 * 32 bytes.
   */
  readonly display = new Uint8Array(HIRES_WIDTH * HIRES_HEIGHT);
  /** Keypad state, 1 = pressed. */
  readonly keys = new Uint8Array(KEY_COUNT);
  /** SUPER-CHIP flag registers (FX75 / FX85). They survive reset(), as on the HP-48. */
  readonly flags = new Uint8Array(FLAG_COUNT);
  /** Set by FX75; a host that keeps the flags in a file saves them and clears it. */
  flagsChanged = false;
  /** Address register. */
  i = 0;
  pc = PROGRAM_START;
  sp = 0;
  delayTimer = 0;
  soundTimer = 0;
  /** SUPER-CHIP high resolution (00FF) is active. */
  hires = false;
  /** Display size in pixels: 64 x 32, or 128 x 64 in high resolution. */
  width = DISPLAY_WIDTH;
  height = DISPLAY_HEIGHT;
  /** Set by 00E0 and DXYN; with the displayWait quirk it ends the frame. stepFrame clears it. */
  drawn = false;
  /** FX0A state. */
  waitingForKey = false;
  waitRegister = 0;
  waitKey = -1;
  /** The interpreter stops executing after a fatal condition. */
  halted = false;
  haltReason = "";
  quirks: Quirks;
  private rngState = 0x2545f491;

  constructor(quirks: Quirks) {
    this.quirks = quirks;
    this.reset();
  }

  /** Clear all state except the flag registers and reload the fonts. The ROM must be loaded again afterwards. */
  reset(): void {
    this.memory.fill(0);
    this.v.fill(0);
    this.stack.fill(0);
    this.display.fill(0);
    this.keys.fill(0);
    this.i = 0;
    this.pc = PROGRAM_START;
    this.sp = 0;
    this.delayTimer = 0;
    this.soundTimer = 0;
    this.hires = false;
    this.width = DISPLAY_WIDTH;
    this.height = DISPLAY_HEIGHT;
    this.drawn = false;
    this.waitingForKey = false;
    this.waitRegister = 0;
    this.waitKey = -1;
    this.halted = false;
    this.haltReason = "";
    for (let k = 0; k < FONT.length; k++) {
      this.memory[FONT_ADDRESS + k] = FONT[k];
    }
    for (let k = 0; k < BIG_FONT.length; k++) {
      this.memory[BIG_FONT_ADDRESS + k] = BIG_FONT[k];
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

  setKey(key: number, down: boolean): void {
    this.keys[key & 0xf] = down ? 1 : 0;
  }

  /** The pixel at (x, y) in the current resolution, 1 = lit. */
  pixel(x: number, y: number): number {
    return this.display[y * this.width + x];
  }

  /** Called once per 60 Hz frame. */
  tickTimers(): void {
    if (this.delayTimer > 0) this.delayTimer--;
    if (this.soundTimer > 0) this.soundTimer--;
  }

  /**
   * Run one 60 Hz frame: up to `ipf` instructions followed by a timer tick.
   * With the displayWait quirk, in low resolution, a sprite draw ends the
   * frame early. Returns the number of instructions executed.
   */
  stepFrame(ipf: number): number {
    this.drawn = false;
    let executed = 0;
    while (executed < ipf && !this.halted) {
      this.step();
      executed++;
      if (this.drawn && this.quirks.displayWait && !this.hires) break;
    }
    this.tickTimers();
    return executed;
  }

  /** Fetch, decode and execute a single instruction. */
  step(): void {
    if (this.halted) return;
    if (this.waitingForKey) {
      this.pollWaitKey();
      return;
    }
    const pc = this.pc & 0xfff;
    const opcode = (this.memory[pc] << 8) | this.memory[(pc + 1) & 0xfff];
    this.pc = (pc + 2) & 0xfff;
    this.execute(opcode, pc);
  }

  private halt(reason: string): void {
    this.halted = true;
    this.haltReason = reason;
  }

  /** True when the SUPER-CHIP instructions are enabled; otherwise halts, naming the instruction. */
  private superChipEnabled(opcode: number, at: number): boolean {
    if (this.quirks.superChip) return true;
    this.halt(`${hex(opcode, 4)} at ${hex(at, 3)} is a SUPER-CHIP instruction`);
    return false;
  }

  private skip(): void {
    this.pc = (this.pc + 2) & 0xfff;
  }

  /** xorshift32 */
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
    // The original interpreter reports the key once it is released.
    if (this.keys[this.waitKey] === 0) {
      this.v[this.waitRegister] = this.waitKey;
      this.waitingForKey = false;
      this.waitKey = -1;
    }
  }

  private execute(opcode: number, at: number): void {
    const x = (opcode >> 8) & 0xf;
    const y = (opcode >> 4) & 0xf;
    const n = opcode & 0xf;
    const nn = opcode & 0xff;
    const nnn = opcode & 0xfff;
    const vx = this.v[x];
    const vy = this.v[y];

    switch (opcode >> 12) {
      case 0x0:
        this.executeSystem(opcode, at);
        return;
      case 0x1:
        this.pc = nnn;
        return;
      case 0x2:
        if (this.sp >= STACK_DEPTH) {
          this.halt(`stack overflow at ${hex(at, 3)}`);
          return;
        }
        this.stack[this.sp] = this.pc;
        this.sp++;
        this.pc = nnn;
        return;
      case 0x3:
        if (vx === nn) this.skip();
        return;
      case 0x4:
        if (vx !== nn) this.skip();
        return;
      case 0x5:
        if (n !== 0) break;
        if (vx === vy) this.skip();
        return;
      case 0x6:
        this.v[x] = nn;
        return;
      case 0x7:
        this.v[x] = (vx + nn) & 0xff;
        return;
      case 0x8:
        if (this.executeArithmetic(n, x, vx, vy)) return;
        break;
      case 0x9:
        if (n !== 0) break;
        if (vx !== vy) this.skip();
        return;
      case 0xa:
        this.i = nnn;
        return;
      case 0xb:
        this.pc = (nnn + (this.quirks.jumpVx ? vx : this.v[0])) & 0xfff;
        return;
      case 0xc:
        this.v[x] = this.nextRandom() & nn;
        return;
      case 0xd:
        this.drawSprite(vx, vy, n);
        return;
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
      case 0xf:
        if (this.executeMisc(opcode, at, x, vx)) return;
        break;
      default:
        break;
    }
    this.halt(`unknown opcode ${hex(opcode, 4)} at ${hex(at, 3)}`);
  }

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

  /** 8XYN group. Returns false for an undefined N. */
  private executeArithmetic(n: number, x: number, vx: number, vy: number): boolean {
    switch (n) {
      case 0x0:
        this.v[x] = vy;
        return true;
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
      case 0x4: {
        // VF is written after VX so that X == F keeps the flag.
        const sum = vx + vy;
        this.v[x] = sum & 0xff;
        this.v[0xf] = sum > 0xff ? 1 : 0;
        return true;
      }
      case 0x5:
        this.v[x] = (vx - vy) & 0xff;
        this.v[0xf] = vx >= vy ? 1 : 0;
        return true;
      case 0x6: {
        const src = this.quirks.shiftVx ? vx : vy;
        this.v[x] = src >> 1;
        this.v[0xf] = src & 1;
        return true;
      }
      case 0x7:
        this.v[x] = (vy - vx) & 0xff;
        this.v[0xf] = vy >= vx ? 1 : 0;
        return true;
      case 0xe: {
        const src = this.quirks.shiftVx ? vx : vy;
        this.v[x] = (src << 1) & 0xff;
        this.v[0xf] = (src >> 7) & 1;
        return true;
      }
      default:
        return false;
    }
  }

  /** FXNN group. Returns false for an undefined NN. */
  private executeMisc(opcode: number, at: number, x: number, vx: number): boolean {
    switch (opcode & 0xff) {
      case 0x07:
        this.v[x] = this.delayTimer;
        return true;
      case 0x0a:
        this.waitingForKey = true;
        this.waitRegister = x;
        this.waitKey = -1;
        this.pollWaitKey();
        return true;
      case 0x15:
        this.delayTimer = vx;
        return true;
      case 0x18:
        this.soundTimer = vx;
        return true;
      case 0x1e:
        this.i = (this.i + vx) & 0xffff;
        return true;
      case 0x29:
        this.i = FONT_ADDRESS + (vx & 0xf) * FONT_GLYPH_SIZE;
        return true;
      case 0x30:
        // Digits A-F have no large glyph; their addresses lie past the font.
        if (this.superChipEnabled(opcode, at)) this.i = BIG_FONT_ADDRESS + (vx & 0xf) * BIG_FONT_GLYPH_SIZE;
        return true;
      case 0x33:
        this.memory[this.i & 0xfff] = Math.floor(vx / 100);
        this.memory[(this.i + 1) & 0xfff] = Math.floor(vx / 10) % 10;
        this.memory[(this.i + 2) & 0xfff] = vx % 10;
        return true;
      case 0x55:
        for (let k = 0; k <= x; k++) {
          this.memory[(this.i + k) & 0xfff] = this.v[k];
        }
        if (this.quirks.indexIncrement) this.i = (this.i + x + 1) & 0xffff;
        return true;
      case 0x65:
        for (let k = 0; k <= x; k++) {
          this.v[k] = this.memory[(this.i + k) & 0xfff];
        }
        if (this.quirks.indexIncrement) this.i = (this.i + x + 1) & 0xffff;
        return true;
      case 0x75:
        if (this.superChipEnabled(opcode, at)) {
          for (let k = 0; k <= x; k++) {
            this.flags[k] = this.v[k];
          }
          this.flagsChanged = true;
        }
        return true;
      case 0x85:
        if (this.superChipEnabled(opcode, at)) {
          for (let k = 0; k <= x; k++) {
            this.v[k] = this.flags[k];
          }
        }
        return true;
      default:
        return false;
    }
  }

  /**
   * DXYN: XOR an 8xN sprite at (VX, VY). With the SUPER-CHIP instructions,
   * DXY0 draws a 16x16 sprite from two bytes per row (8x16 in low resolution
   * with the lores8x16 quirk). VF = 1 when a lit pixel was erased, or with the
   * rowCollisions quirk in high resolution the count of colliding rows plus
   * rows clipped at the bottom edge.
   */
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

  /** Scroll distance: `pixels`, or half of it in low resolution with the loresHalfScroll quirk. */
  private scrollDistance(pixels: number): number {
    return !this.hires && this.quirks.loresHalfScroll ? pixels >> 1 : pixels;
  }

  /** 00CN: move the picture down N rows; the rows scrolled in are blank. */
  private scrollDown(n: number): void {
    const width = this.width;
    const distance = this.scrollDistance(n);
    for (let y = this.height - 1; y >= 0; y--) {
      const from = y - distance;
      for (let x = 0; x < width; x++) {
        this.display[y * width + x] = from >= 0 ? this.display[from * width + x] : 0;
      }
    }
  }

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

  /** 00FC: move the picture 4 pixels left. */
  private scrollLeft(): void {
    const width = this.width;
    const distance = this.scrollDistance(4);
    for (let y = 0; y < this.height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        this.display[row + x] = x + distance < width ? this.display[row + x + distance] : 0;
      }
    }
  }

  /** 00FE / 00FF: switch between 64x32 and 128x64 pixels. The display is cleared. */
  private setResolution(hires: boolean): void {
    this.hires = hires;
    this.width = hires ? HIRES_WIDTH : DISPLAY_WIDTH;
    this.height = hires ? HIRES_HEIGHT : DISPLAY_HEIGHT;
    this.display.fill(0);
  }
}

/** Render a width x height display as text: '#' for lit pixels, '.' for dark ones. */
export function renderAscii(display: Uint8Array, width: number = DISPLAY_WIDTH, height: number = DISPLAY_HEIGHT): string {
  let out = "";
  for (let row = 0; row < height; row++) {
    let line = "";
    for (let col = 0; col < width; col++) {
      line += display[row * width + col] !== 0 ? "#" : ".";
    }
    out += line;
    if (row < height - 1) out += "\n";
  }
  return out;
}

/** Upper-case hexadecimal with a fixed minimum width, prefixed with 0x. */
export function hex(value: number, width: number): string {
  return "0x" + (Math.floor(value) >>> 0).toString(16).toUpperCase().padStart(width, "0");
}

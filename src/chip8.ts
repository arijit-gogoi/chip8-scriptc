import { FONT, FONT_ADDRESS, FONT_GLYPH_SIZE } from "./font";

export const MEMORY_SIZE = 4096;
export const PROGRAM_START = 0x200;
export const DISPLAY_WIDTH = 64;
export const DISPLAY_HEIGHT = 32;
export const STACK_DEPTH = 16;
export const REGISTER_COUNT = 16;
export const KEY_COUNT = 16;

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
  /** DXYN waits for the next frame (VIP: at most one sprite is drawn per 60 Hz frame). */
  displayWait: boolean;
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
  };
}

/** SUPER-CHIP 1.1 style behaviour, which many later ROMs assume. */
export function schipQuirks(): Quirks {
  return {
    shiftVx: true,
    indexIncrement: false,
    jumpVx: true,
    vfReset: false,
    wrapSprites: false,
    displayWait: false,
  };
}

export class Chip8 {
  readonly memory = new Uint8Array(MEMORY_SIZE);
  /** General purpose registers V0..VF. */
  readonly v = new Uint8Array(REGISTER_COUNT);
  /** Return addresses (a plain array: scriptc has no Uint16Array yet). */
  readonly stack: number[] = zeros(STACK_DEPTH);
  /** One byte per pixel, row-major, 1 = lit. */
  readonly display = new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT);
  /** Keypad state, 1 = pressed. */
  readonly keys = new Uint8Array(KEY_COUNT);
  /** Address register. */
  i = 0;
  pc = PROGRAM_START;
  sp = 0;
  delayTimer = 0;
  soundTimer = 0;
  /** Set whenever the display changes; the host clears it. */
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
    this.drawn = false;
    this.waitingForKey = false;
    this.waitRegister = 0;
    this.waitKey = -1;
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

  setKey(key: number, down: boolean): void {
    this.keys[key & 0xf] = down ? 1 : 0;
  }

  /** Called once per 60 Hz frame. */
  tickTimers(): void {
    if (this.delayTimer > 0) this.delayTimer--;
    if (this.soundTimer > 0) this.soundTimer--;
  }

  /**
   * Run one 60 Hz frame: up to `ipf` instructions followed by a timer tick.
   * With the displayWait quirk a sprite draw ends the frame early.
   * Returns the number of instructions executed.
   */
  stepFrame(ipf: number): number {
    this.drawn = false;
    let executed = 0;
    while (executed < ipf && !this.halted) {
      this.step();
      executed++;
      if (this.drawn && this.quirks.displayWait) break;
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
        if (opcode === 0x00e0) {
          clearBytes(this.display);
          this.drawn = true;
        } else if (opcode === 0x00ee) {
          if (this.sp === 0) {
            this.halt(`stack underflow at ${hex(at, 3)}`);
            return;
          }
          this.sp--;
          this.pc = this.stack[this.sp] & 0xfff;
        } else {
          this.halt(`machine code call ${hex(opcode, 4)} at ${hex(at, 3)} is not supported`);
        }
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
        if (this.executeMisc(nn, x, vx)) return;
        break;
      default:
        break;
    }
    this.halt(`unknown opcode ${hex(opcode, 4)} at ${hex(at, 3)}`);
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
  private executeMisc(nn: number, x: number, vx: number): boolean {
    switch (nn) {
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
      default:
        return false;
    }
  }

  /** DXYN: XOR an 8xN sprite at (VX, VY); VF = 1 when a lit pixel was erased. */
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
}

/** Render the display as text: '#' for lit pixels, '.' for dark ones. */
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

/** Zero every element (scriptc has no TypedArray.fill yet). */
function clearBytes(bytes: Uint8Array): void {
  for (let k = 0; k < bytes.length; k++) bytes[k] = 0;
}

/** A dense array of `count` zeros. */
function zeros(count: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(0);
  return out;
}

const HEX_DIGITS = "0123456789ABCDEF";

/** Upper-case hexadecimal with a fixed minimum width, prefixed with 0x. */
export function hex(value: number, width: number): string {
  let rest = Math.floor(value) >>> 0;
  let s = "";
  while (rest > 0 || s.length < width) {
    s = HEX_DIGITS.charAt(rest & 0xf) + s;
    rest = rest >>> 4;
  }
  return "0x" + s;
}

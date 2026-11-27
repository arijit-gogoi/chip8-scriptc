import { describe, expect, test } from "bun:test";
import {
  Chip8,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  HIRES_HEIGHT,
  HIRES_WIDTH,
  PROGRAM_START,
  chip8Quirks,
  renderAscii,
  schipLegacyQuirks,
  schipQuirks,
  type Quirks,
} from "../src/chip8";
import { BIG_FONT_ADDRESS, FONT_ADDRESS } from "../src/font";

/** Build a VM whose program consists of the given 16-bit opcodes. */
function program(ops: number[], quirks: Quirks = chip8Quirks()): Chip8 {
  const rom = new Uint8Array(ops.length * 2);
  ops.forEach((op, k) => {
    rom[k * 2] = op >> 8;
    rom[k * 2 + 1] = op & 0xff;
  });
  const vm = new Chip8(quirks);
  vm.loadRom(rom);
  return vm;
}

function steps(vm: Chip8, count: number): void {
  for (let k = 0; k < count; k++) vm.step();
}

function pixel(vm: Chip8, x: number, y: number): number {
  return vm.pixel(x, y);
}

/** Number of lit pixels on the display. */
function litPixels(vm: Chip8): number {
  let count = 0;
  for (const p of vm.display) count += p;
  return count;
}

describe("registers and flow", () => {
  test("6XNN / 7XNN store and add with 8-bit wrap", () => {
    const vm = program([0x60ff, 0x7002]);
    steps(vm, 2);
    expect(vm.v[0]).toBe(0x01);
    expect(vm.pc).toBe(PROGRAM_START + 4);
  });

  test("1NNN jumps, 2NNN / 00EE call and return", () => {
    const vm = program([0x2206, 0x1204, 0x0000, 0x6142, 0x00ee]);
    vm.step();
    expect(vm.pc).toBe(0x206);
    expect(vm.sp).toBe(1);
    steps(vm, 2);
    expect(vm.v[1]).toBe(0x42);
    expect(vm.pc).toBe(0x202);
    expect(vm.sp).toBe(0);
    vm.step();
    expect(vm.pc).toBe(0x204);
  });

  test("3XNN / 4XNN / 5XY0 / 9XY0 skips", () => {
    const vm = program([0x6005, 0x6105, 0x3005, 0x0000, 0x4005, 0x5010, 0x0000, 0x9010, 0x6207]);
    steps(vm, 3);
    expect(vm.pc).toBe(0x208);
    vm.step();
    expect(vm.pc).toBe(0x20a);
    vm.step();
    expect(vm.pc).toBe(0x20e);
    vm.step();
    expect(vm.pc).toBe(0x210);
    vm.step();
    expect(vm.v[2]).toBe(7);
  });

  test("BNNN uses V0 (chip8) or VX (schip)", () => {
    const vip = program([0x6004, 0x6110, 0xb300]);
    steps(vip, 3);
    expect(vip.pc).toBe(0x304);

    // BXNN on SUPER-CHIP: X names the register (here V1).
    const schip = program([0x6004, 0x6110, 0xb100], schipQuirks());
    steps(schip, 3);
    expect(schip.pc).toBe(0x110);
  });

  test("stack overflow and underflow halt", () => {
    const overflow = program([0x2200]);
    steps(overflow, 20);
    expect(overflow.halted).toBe(true);
    expect(overflow.haltReason).toContain("overflow");

    const underflow = program([0x00ee]);
    underflow.step();
    expect(underflow.halted).toBe(true);
    expect(underflow.haltReason).toContain("underflow");
  });

  test("unknown opcodes and machine code calls halt", () => {
    const vm = program([0x5001]);
    vm.step();
    expect(vm.halted).toBe(true);
    expect(vm.haltReason).toContain("0x5001");

    const machine = program([0x0123]);
    machine.step();
    expect(machine.halted).toBe(true);
  });
});

describe("arithmetic", () => {
  test("8XY4 sets VF to the carry after storing the sum", () => {
    const vm = program([0x60ff, 0x6102, 0x8014, 0x6f05, 0x8f04]);
    steps(vm, 3);
    expect(vm.v[0]).toBe(0x01);
    expect(vm.v[0xf]).toBe(1);
    steps(vm, 2);
    // VF is both destination and flag: the flag wins.
    expect(vm.v[0xf]).toBe(0);
  });

  test("8XY5 / 8XY7 set VF to NOT borrow", () => {
    const vm = program([0x6005, 0x6103, 0x8015, 0x6005, 0x6103, 0x8017]);
    steps(vm, 3);
    expect(vm.v[0]).toBe(2);
    expect(vm.v[0xf]).toBe(1);
    steps(vm, 3);
    expect(vm.v[0]).toBe(0xfe);
    expect(vm.v[0xf]).toBe(0);
  });

  test("8XY6 / 8XYE shift VY into VX (chip8)", () => {
    const vm = program([0x6000, 0x6183, 0x8016, 0x6000, 0x801e]);
    steps(vm, 3);
    expect(vm.v[0]).toBe(0x41);
    expect(vm.v[0xf]).toBe(1);
    expect(vm.v[1]).toBe(0x83);
    steps(vm, 2);
    expect(vm.v[0]).toBe(0x06);
    expect(vm.v[0xf]).toBe(1);
  });

  test("8XY6 / 8XYE shift VX in place (schip)", () => {
    const vm = program([0x6083, 0x6100, 0x8016, 0x6083, 0x801e], schipQuirks());
    steps(vm, 3);
    expect(vm.v[0]).toBe(0x41);
    expect(vm.v[0xf]).toBe(1);
    steps(vm, 2);
    expect(vm.v[0]).toBe(0x06);
    expect(vm.v[0xf]).toBe(1);
  });

  test("8XY1/2/3 reset VF only with the vfReset quirk", () => {
    const vip = program([0x6f01, 0x600c, 0x610a, 0x8011, 0x6f01, 0x8012, 0x6f01, 0x8013]);
    steps(vip, 4);
    expect(vip.v[0]).toBe(0x0e);
    expect(vip.v[0xf]).toBe(0);
    steps(vip, 2);
    expect(vip.v[0]).toBe(0x0a);
    expect(vip.v[0xf]).toBe(0);
    steps(vip, 2);
    expect(vip.v[0]).toBe(0x00);
    expect(vip.v[0xf]).toBe(0);

    const schip = program([0x6f01, 0x600c, 0x610a, 0x8011], schipQuirks());
    steps(schip, 4);
    expect(schip.v[0xf]).toBe(1);
  });

  test("CXNN masks the random value", () => {
    const vm = program([0xc00f, 0xc10f, 0xc20f, 0xc30f, 0xc4f0]);
    steps(vm, 5);
    for (let k = 0; k < 4; k++) expect(vm.v[k] & 0xf0).toBe(0);
    expect(vm.v[4] & 0x0f).toBe(0);
  });
});

describe("memory and timers", () => {
  test("ANNN / FX1E", () => {
    const vm = program([0xa123, 0x6010, 0xf01e]);
    steps(vm, 3);
    expect(vm.i).toBe(0x133);
  });

  test("FX33 stores BCD digits", () => {
    const vm = program([0x60ed, 0xa300, 0xf033]);
    steps(vm, 3);
    expect(vm.memory[0x300]).toBe(2);
    expect(vm.memory[0x301]).toBe(3);
    expect(vm.memory[0x302]).toBe(7);
  });

  test("FX55 / FX65 increment I on chip8 and leave it on schip", () => {
    const vip = program([0x6011, 0x6122, 0x6233, 0xa300, 0xf255, 0xa300, 0x6000, 0x6100, 0xf165]);
    steps(vip, 5);
    expect(vip.memory[0x300]).toBe(0x11);
    expect(vip.memory[0x302]).toBe(0x33);
    expect(vip.i).toBe(0x303);
    steps(vip, 4);
    expect(vip.v[0]).toBe(0x11);
    expect(vip.v[1]).toBe(0x22);
    expect(vip.i).toBe(0x302);

    const schip = program([0x6011, 0xa300, 0xf055], schipQuirks());
    steps(schip, 3);
    expect(schip.memory[0x300]).toBe(0x11);
    expect(schip.i).toBe(0x300);
  });

  test("FX29 points at the built-in font", () => {
    const vm = program([0x600a, 0xf029]);
    steps(vm, 2);
    expect(vm.i).toBe(FONT_ADDRESS + 10 * 5);
    expect(vm.memory[vm.i]).toBe(0xf0);
    expect(vm.memory[vm.i + 4]).toBe(0x90);
  });

  test("FX15 / FX18 / FX07 with 60 Hz ticks", () => {
    const vm = program([0x6003, 0xf015, 0xf018, 0xf107]);
    steps(vm, 4);
    expect(vm.v[1]).toBe(3);
    vm.tickTimers();
    vm.tickTimers();
    expect(vm.delayTimer).toBe(1);
    expect(vm.soundTimer).toBe(1);
    vm.tickTimers();
    vm.tickTimers();
    expect(vm.delayTimer).toBe(0);
    expect(vm.soundTimer).toBe(0);
  });

  test("loadRom rejects oversized images", () => {
    const vm = new Chip8(chip8Quirks());
    expect(() => vm.loadRom(new Uint8Array(4096 - 0x200 + 1))).toThrow();
    expect(() => vm.loadRom(new Uint8Array(4096 - 0x200))).not.toThrow();
  });
});

describe("display", () => {
  test("DXYN draws with XOR, reports collisions, 00E0 clears", () => {
    // Font glyph 0 at (2,3), twice; second draw erases and sets VF.
    const vm = program([0x6000, 0xf029, 0x6102, 0x6203, 0xd125, 0xd125, 0x00e0]);
    steps(vm, 5);
    expect(pixel(vm, 2, 3)).toBe(1);
    expect(pixel(vm, 5, 3)).toBe(1);
    expect(pixel(vm, 3, 4)).toBe(0);
    expect(pixel(vm, 2, 4)).toBe(1);
    expect(vm.v[0xf]).toBe(0);
    expect(vm.drawn).toBe(true);
    vm.step();
    expect(vm.v[0xf]).toBe(1);
    expect(vm.display.every((p) => p === 0)).toBe(true);
    vm.drawn = false;
    vm.step();
    expect(vm.drawn).toBe(true);
  });

  test("sprites clip at the edge by default and wrap with the quirk", () => {
    const ops = [0x6000, 0xf029, 0x613e, 0x621e, 0xd125];
    const clip = program(ops);
    steps(clip, 5);
    expect(pixel(clip, 62, 30)).toBe(1);
    expect(pixel(clip, 63, 30)).toBe(1);
    expect(pixel(clip, 0, 30)).toBe(0);
    expect(pixel(clip, 62, 0)).toBe(0);

    const wrapQuirks = chip8Quirks();
    wrapQuirks.wrapSprites = true;
    const wrap = program(ops, wrapQuirks);
    steps(wrap, 5);
    expect(pixel(wrap, 0, 30)).toBe(1);
    expect(pixel(wrap, 1, 30)).toBe(1);
    expect(pixel(wrap, 62, 0)).toBe(1);
  });

  test("sprite origin wraps modulo the display size", () => {
    const vm = program([0x6000, 0xf029, 0x6142, 0x6223, 0xd125]);
    steps(vm, 5);
    expect(pixel(vm, 2, 3)).toBe(1);
  });

  test("stepFrame stops after a draw with displayWait and ticks timers once", () => {
    const vm = program([0x6005, 0xf015, 0xd005, 0x6101, 0x6102]);
    const executed = vm.stepFrame(10);
    expect(executed).toBe(3);
    expect(vm.v[1]).toBe(0);
    expect(vm.delayTimer).toBe(4);

    const quirks = chip8Quirks();
    quirks.displayWait = false;
    // Ends in a jump-to-self so the frame runs all 10 instructions.
    const free = program([0x6005, 0xf015, 0xd005, 0x6101, 0x6102, 0x120a], quirks);
    expect(free.stepFrame(10)).toBe(10);
    expect(free.v[1]).toBe(2);
    expect(free.halted).toBe(false);
  });

  test("renderAscii has 32 rows of 64 columns", () => {
    const vm = program([0x6000, 0xf029, 0xd005]);
    steps(vm, 3);
    const rows = renderAscii(vm.display).split("\n");
    expect(rows.length).toBe(DISPLAY_HEIGHT);
    expect(rows[0].length).toBe(DISPLAY_WIDTH);
    expect(rows[0].slice(0, 5)).toBe("####.");
  });
});

describe("input", () => {
  test("EX9E / EXA1 test the key named by VX", () => {
    const vm = program([0x6005, 0xe09e, 0x0000, 0xe0a1, 0x0000, 0x6101]);
    vm.setKey(5, true);
    steps(vm, 2);
    expect(vm.pc).toBe(0x206);
    vm.setKey(5, false);
    vm.step();
    expect(vm.pc).toBe(0x20a);
    vm.step();
    expect(vm.v[1]).toBe(1);
  });

  test("FX0A waits for a key press followed by its release", () => {
    const vm = program([0xf30a, 0x6101]);
    vm.step();
    expect(vm.waitingForKey).toBe(true);
    steps(vm, 3);
    expect(vm.pc).toBe(0x202);
    expect(vm.v[1]).toBe(0);
    vm.setKey(0xa, true);
    vm.step();
    expect(vm.waitingForKey).toBe(true);
    expect(vm.v[3]).toBe(0);
    vm.setKey(0xa, false);
    vm.step();
    expect(vm.waitingForKey).toBe(false);
    expect(vm.v[3]).toBe(0xa);
    vm.step();
    expect(vm.v[1]).toBe(1);
  });

  test("timers keep running while waiting for a key", () => {
    const vm = program([0x6002, 0xf015, 0xf00a]);
    steps(vm, 3);
    vm.stepFrame(5);
    expect(vm.delayTimer).toBe(1);
  });
});

describe("edge cases", () => {
  test("8XY0 copies VY into VX", () => {
    const vm = program([0x6100, 0x60aa, 0x6155, 0x8010]);
    steps(vm, 4);
    expect(vm.v[0]).toBe(0x55);
    expect(vm.v[1]).toBe(0x55);
  });

  test("VF as destination keeps the flag for 8XY5 / 8XY7 / 8XY6 / 8XYE", () => {
    const sub = program([0x6f05, 0x6103, 0x8f15]);
    steps(sub, 3);
    expect(sub.v[0xf]).toBe(1);

    const rsub = program([0x6f03, 0x6105, 0x8f17]);
    steps(rsub, 3);
    expect(rsub.v[0xf]).toBe(1);

    const shr = program([0x6f00, 0x6102, 0x8f16]);
    steps(shr, 3);
    expect(shr.v[0xf]).toBe(0);

    const shl = program([0x6f00, 0x6180, 0x8f1e]);
    steps(shl, 3);
    expect(shl.v[0xf]).toBe(1);
  });

  test("X == Y operands read the value before it is written", () => {
    const add = program([0x6005, 0x8004]);
    steps(add, 2);
    expect(add.v[0]).toBe(10);
    expect(add.v[0xf]).toBe(0);

    const carry = program([0x60ff, 0x8004]);
    steps(carry, 2);
    expect(carry.v[0]).toBe(0xfe);
    expect(carry.v[0xf]).toBe(1);

    const sub = program([0x6005, 0x8005]);
    steps(sub, 2);
    expect(sub.v[0]).toBe(0);
    expect(sub.v[0xf]).toBe(1);

    const shr = program([0x6003, 0x8006]);
    steps(shr, 2);
    expect(shr.v[0]).toBe(1);
    expect(shr.v[0xf]).toBe(1);
  });

  test("FX33 at the boundaries", () => {
    const zero = program([0x6000, 0xa300, 0xf033]);
    steps(zero, 3);
    expect([zero.memory[0x300], zero.memory[0x301], zero.memory[0x302]]).toEqual([0, 0, 0]);

    const max = program([0x60ff, 0xa300, 0xf033]);
    steps(max, 3);
    expect([max.memory[0x300], max.memory[0x301], max.memory[0x302]]).toEqual([2, 5, 5]);
  });

  test("FX55 / FX65 with X = 0 and X = F", () => {
    const one = program([0x6011, 0x6122, 0xa300, 0xf055]);
    steps(one, 4);
    expect(one.memory[0x300]).toBe(0x11);
    expect(one.memory[0x301]).toBe(0);
    expect(one.i).toBe(0x301);

    const all = new Chip8(chip8Quirks());
    const ops: number[] = [];
    for (let r = 0; r < 16; r++) ops.push(0x6000 | (r << 8) | (0x10 + r));
    ops.push(0xa300, 0xff55, 0xa300, 0xff65);
    const rom = new Uint8Array(ops.length * 2);
    ops.forEach((op, k) => {
      rom[k * 2] = op >> 8;
      rom[k * 2 + 1] = op & 0xff;
    });
    all.loadRom(rom);
    steps(all, 18);
    for (let r = 0; r < 16; r++) expect(all.memory[0x300 + r]).toBe(0x10 + r);
    expect(all.i).toBe(0x310);
    for (let r = 0; r < 16; r++) all.v[r] = 0;
    steps(all, 2);
    for (let r = 0; r < 16; r++) expect(all.v[r]).toBe(0x10 + r);
    expect(all.i).toBe(0x310);
  });

  test("DXY0 draws nothing and clears VF; 15-row sprites draw every row", () => {
    const none = program([0x6f01, 0xa200, 0xd000]);
    steps(none, 3);
    expect(none.display.every((p) => p === 0)).toBe(true);
    expect(none.v[0xf]).toBe(0);

    const tall = program([0xa300, 0xd00f]);
    for (let row = 0; row < 15; row++) tall.memory[0x300 + row] = 0x80;
    steps(tall, 2);
    for (let row = 0; row < 15; row++) expect(pixel(tall, 0, row)).toBe(1);
    expect(pixel(tall, 0, 15)).toBe(0);
  });

  test("EX9E / EXA1 use only the low nibble of VX", () => {
    const vm = program([0x6015, 0xe09e, 0x0000, 0xe0a1, 0x6101]);
    vm.setKey(5, true);
    steps(vm, 2);
    expect(vm.pc).toBe(0x206);
    vm.step();
    expect(vm.pc).toBe(0x208);
    vm.step();
    expect(vm.v[1]).toBe(1);
  });

  test("BNNN wraps inside 4 KiB", () => {
    const vm = program([0x60ff, 0xbfff]);
    steps(vm, 2);
    expect(vm.pc).toBe(0x0fe);
  });

  test("FX0A with a key already held waits for its release", () => {
    const vm = program([0xf00a, 0x6101]);
    vm.setKey(7, true);
    steps(vm, 5);
    expect(vm.waitingForKey).toBe(true);
    expect(vm.v[1]).toBe(0);
    vm.setKey(7, false);
    steps(vm, 2);
    expect(vm.v[0]).toBe(7);
    expect(vm.v[1]).toBe(1);
  });

  test("CXNN produces varying values", () => {
    const vm = program([0xc0ff, 0x1200]);
    const seen = new Set<number>();
    for (let k = 0; k < 32; k++) {
      steps(vm, 2);
      seen.add(vm.v[0]);
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  test("halted interpreter ignores steps and frames", () => {
    const vm = program([0x0123, 0x6101]);
    vm.step();
    expect(vm.halted).toBe(true);
    expect(vm.stepFrame(10)).toBe(0);
    vm.step();
    expect(vm.v[1]).toBe(0);
  });
});

describe("SUPER-CHIP", () => {
  test("its instructions halt with a hint on the chip8 profile", () => {
    for (const op of [0x00c1, 0x00fb, 0x00fc, 0x00fd, 0x00fe, 0x00ff, 0xf030, 0xf075, 0xf085]) {
      const vm = program([op]);
      vm.step();
      expect(vm.halted).toBe(true);
      expect(vm.haltReason).toContain("is a SUPER-CHIP instruction");
    }
  });

  test("00FF / 00FE switch resolution and clear the display", () => {
    // Glyph 0 in low resolution; then high resolution, glyph 0 at (120, 59); then low again.
    const vm = program([0x6000, 0xf029, 0xd005, 0x00ff, 0x6178, 0x623b, 0xd125, 0x00fe], schipQuirks());
    steps(vm, 3);
    expect(litPixels(vm)).toBeGreaterThan(0);
    vm.step();
    expect(vm.hires).toBe(true);
    expect(vm.width).toBe(HIRES_WIDTH);
    expect(vm.height).toBe(HIRES_HEIGHT);
    expect(litPixels(vm)).toBe(0);
    steps(vm, 3);
    expect(pixel(vm, 120, 59)).toBe(1);
    expect(pixel(vm, 123, 63)).toBe(1);
    vm.step();
    expect(vm.hires).toBe(false);
    expect(vm.width).toBe(DISPLAY_WIDTH);
    expect(vm.height).toBe(DISPLAY_HEIGHT);
    expect(litPixels(vm)).toBe(0);
  });

  test("high-resolution sprite origins wrap modulo 128 x 64", () => {
    const vm = program([0x00ff, 0x6000, 0xf029, 0x6182, 0x6243, 0xd125], schipQuirks());
    steps(vm, 6);
    expect(pixel(vm, 2, 3)).toBe(1);
  });

  test("DXY0 draws a 16x16 sprite in both resolutions", () => {
    for (const ops of [[0xa300, 0xd000], [0x00ff, 0xa300, 0xd000]]) {
      const vm = program(ops, schipQuirks());
      for (let row = 0; row < 16; row++) {
        vm.memory[0x300 + row * 2] = 0x80;
        vm.memory[0x300 + row * 2 + 1] = 0x01;
      }
      steps(vm, ops.length);
      for (let row = 0; row < 16; row++) {
        expect(pixel(vm, 0, row)).toBe(1);
        expect(pixel(vm, 1, row)).toBe(0);
        expect(pixel(vm, 15, row)).toBe(1);
      }
      expect(litPixels(vm)).toBe(32);
    }
  });

  test("DXY0 draws 8x16 in low resolution on schip-legacy", () => {
    const vm = program([0xa300, 0xd000], schipLegacyQuirks());
    for (let row = 0; row < 16; row++) vm.memory[0x300 + row] = 0x81;
    steps(vm, 2);
    for (let row = 0; row < 16; row++) {
      expect(pixel(vm, 0, row)).toBe(1);
      expect(pixel(vm, 7, row)).toBe(1);
    }
    expect(litPixels(vm)).toBe(32);
  });

  test("high-resolution VF counts colliding and clipped rows on schip-legacy", () => {
    // A 4-row sprite at y = 62 loses two rows at the bottom edge; it is drawn twice.
    const ops = [0x00ff, 0xa300, 0x6100, 0x623e, 0xd124, 0xd124];
    const legacy = program(ops, schipLegacyQuirks());
    const modern = program(ops, schipQuirks());
    for (const vm of [legacy, modern]) {
      for (let row = 0; row < 4; row++) vm.memory[0x300 + row] = 0xff;
      steps(vm, 5);
    }
    expect(legacy.v[0xf]).toBe(2);
    expect(modern.v[0xf]).toBe(0);
    legacy.step();
    modern.step();
    expect(legacy.v[0xf]).toBe(4);
    expect(modern.v[0xf]).toBe(1);

    // Low resolution keeps 1 or 0.
    const lores = program([0xa300, 0x6100, 0x621e, 0xd124, 0xd124], schipLegacyQuirks());
    for (let row = 0; row < 4; row++) lores.memory[0x300 + row] = 0xff;
    steps(lores, 4);
    expect(lores.v[0xf]).toBe(0);
    lores.step();
    expect(lores.v[0xf]).toBe(1);
  });

  test("00CN scrolls down N rows, half as far in low resolution on schip-legacy", () => {
    const run = (ops: number[], quirks: Quirks): Chip8 => {
      // One lit pixel at (V0, V0), then the scroll.
      const vm = program(ops, quirks);
      vm.memory[0x300] = 0x80;
      steps(vm, ops.length);
      return vm;
    };
    const modern = run([0xa300, 0x6005, 0xd001, 0x00c4], schipQuirks());
    expect(pixel(modern, 5, 9)).toBe(1);
    expect(litPixels(modern)).toBe(1);
    expect(pixel(run([0xa300, 0x6005, 0xd001, 0x00c4], schipLegacyQuirks()), 5, 7)).toBe(1);
    expect(pixel(run([0x00ff, 0xa300, 0x6005, 0xd001, 0x00c4], schipLegacyQuirks()), 5, 9)).toBe(1);
    // Rows scrolled past the bottom edge are gone.
    expect(litPixels(run([0xa300, 0x601f, 0xd001, 0x00c1], schipQuirks()))).toBe(0);
  });

  test("00FB / 00FC scroll 4 pixels right and left, 2 in low resolution on schip-legacy", () => {
    const run = (scroll: number, quirks: Quirks): Chip8 => {
      const vm = program([0xa300, 0x6005, 0xd001, scroll], quirks);
      vm.memory[0x300] = 0x80;
      steps(vm, 4);
      return vm;
    };
    expect(pixel(run(0x00fb, schipQuirks()), 9, 5)).toBe(1);
    expect(pixel(run(0x00fc, schipQuirks()), 1, 5)).toBe(1);
    expect(pixel(run(0x00fb, schipLegacyQuirks()), 7, 5)).toBe(1);
    expect(pixel(run(0x00fc, schipLegacyQuirks()), 3, 5)).toBe(1);

    // Pixels scrolled past the left edge are gone.
    const off = program([0xa300, 0x6002, 0xd001, 0x00fc], schipQuirks());
    off.memory[0x300] = 0x80;
    steps(off, 4);
    expect(litPixels(off)).toBe(0);
  });

  test("00FD ends the program", () => {
    const vm = program([0x6101, 0x00fd, 0x6102], schipQuirks());
    steps(vm, 3);
    expect(vm.halted).toBe(true);
    expect(vm.haltReason).toBe("program exited at 0x202");
    expect(vm.v[1]).toBe(1);
  });

  test("FX30 points at the large digit", () => {
    const vm = program([0x6007, 0xf030], schipQuirks());
    steps(vm, 2);
    expect(vm.i).toBe(BIG_FONT_ADDRESS + 70);
    expect(vm.memory[vm.i]).toBe(0xff);
    expect(vm.memory[vm.i + 9]).toBe(0x60);
  });

  test("FX75 / FX85 save and load the flag registers, which survive a reset", () => {
    const vm = program([0x6011, 0x6122, 0x6233, 0xf275], schipQuirks());
    steps(vm, 4);
    expect(Array.from(vm.flags.slice(0, 4))).toEqual([0x11, 0x22, 0x33, 0]);
    expect(vm.flagsChanged).toBe(true);
    vm.reset();
    vm.loadRom(new Uint8Array([0xf1, 0x85]));
    vm.step();
    expect(vm.v[0]).toBe(0x11);
    expect(vm.v[1]).toBe(0x22);
    expect(vm.v[2]).toBe(0);
  });

  test("display wait applies only in low resolution", () => {
    // Each program ends in a jump-to-self so a frame can run all 10 instructions.
    const lores = program([0xd005, 0x6101, 0x6102, 0x1206], schipLegacyQuirks());
    expect(lores.stepFrame(10)).toBe(1);
    const hires = program([0x00ff, 0xd005, 0x6101, 0x6102, 0x1208], schipLegacyQuirks());
    expect(hires.stepFrame(10)).toBe(10);
    expect(hires.v[1]).toBe(2);
  });

  test("renderAscii prints the current resolution", () => {
    const vm = program([0x00ff, 0x6000, 0xf029, 0xd005], schipQuirks());
    steps(vm, 4);
    const rows = renderAscii(vm.display, vm.width, vm.height).split("\n");
    expect(rows.length).toBe(HIRES_HEIGHT);
    expect(rows[0].length).toBe(HIRES_WIDTH);
    expect(rows[0].slice(0, 5)).toBe("####.");
  });
});

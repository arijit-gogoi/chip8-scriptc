/**
 * Timendus' test ROMs, frozen as framebuffer snapshots. Each expected file
 * was checked by eye once: corax+ and flags show a check mark on every row,
 * the quirks test reports all six quirks as expected for CHIP-8.
 *
 * Regenerate with: UPDATE_SNAPSHOTS=1 bun test tests/roms.test.ts
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Chip8, chip8Quirks, renderAscii } from "../src/chip8";
import { DEFAULT_IPF, DEFAULT_PRESS_FRAMES, type KeyPress } from "../src/cli";

const ROM_DIR = join(import.meta.dir, "..", "roms", "tests");
const SNAPSHOT_DIR = join(import.meta.dir, "snapshots");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

interface Case {
  rom: string;
  frames: number;
  presses: KeyPress[];
}

const CASES: Case[] = [
  { rom: "1-chip8-logo.ch8", frames: 120, presses: [] },
  { rom: "2-ibm-logo.ch8", frames: 120, presses: [] },
  { rom: "3-corax+.ch8", frames: 400, presses: [] },
  { rom: "4-flags.ch8", frames: 400, presses: [] },
  { rom: "5-quirks.ch8", frames: 1500, presses: [{ key: 1, frame: 30, frames: DEFAULT_PRESS_FRAMES }] },
];

/** Same frame loop as the CLI's headless mode. */
function run(c: Case): Chip8 {
  const vm = new Chip8(chip8Quirks());
  vm.loadRom(readFileSync(join(ROM_DIR, c.rom)));
  for (let frame = 0; frame < c.frames && !vm.halted; frame++) {
    for (const press of c.presses) {
      if (frame === press.frame) vm.setKey(press.key, true);
      else if (frame === press.frame + press.frames) vm.setKey(press.key, false);
    }
    vm.stepFrame(DEFAULT_IPF);
  }
  return vm;
}

describe("Timendus test suite snapshots", () => {
  for (const c of CASES) {
    test(c.rom, () => {
      const vm = run(c);
      expect(vm.halted).toBe(false);
      const actual = renderAscii(vm.display) + "\n";
      const path = join(SNAPSHOT_DIR, c.rom.replace(/\.ch8$/, ".txt"));
      if (UPDATE || !existsSync(path)) writeFileSync(path, actual);
      expect(actual).toBe(readFileSync(path, "utf8").replace(/\r\n/g, "\n"));
    });
  }
});

describe("7-beep.ch8", () => {
  test("drives the sound timer", () => {
    const vm = new Chip8(chip8Quirks());
    vm.loadRom(readFileSync(join(ROM_DIR, "7-beep.ch8")));
    let beeped = false;
    for (let frame = 0; frame < 300 && !beeped; frame++) {
      vm.stepFrame(DEFAULT_IPF);
      beeped = vm.soundTimer > 0;
    }
    expect(vm.halted).toBe(false);
    expect(beeped).toBe(true);
  });
});

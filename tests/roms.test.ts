/**
 * Timendus' test ROMs, frozen as framebuffer snapshots. Each expected file
 * was checked by eye once: corax+ and flags show a check mark on every row,
 * the quirks test reports all six quirks as expected for CHIP-8, modern
 * SUPER-CHIP and SUPER-CHIP 1.1 (legacy), and the scrolling test ends with
 * every arrow inside its box.
 *
 * Regenerate with: UPDATE_SNAPSHOTS=1 bun test tests/roms.test.ts
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Chip8, chip8Quirks, profileQuirks, renderAscii } from "../src/chip8";
import { DEFAULT_IPF, DEFAULT_PRESS_FRAMES, type KeyPress } from "../src/cli";

const ROM_DIR = join(import.meta.dir, "..", "roms", "tests");
const SNAPSHOT_DIR = join(import.meta.dir, "snapshots");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

interface Case {
  rom: string;
  /** Snapshot file name, without .txt. */
  snapshot: string;
  frames: number;
  presses: KeyPress[];
  profile: string;
  /** Menu choice poked into 0x1FF, where Timendus' menus look first; 0 shows the menu. */
  select: number;
  ipf: number;
}

function chip8Case(rom: string, frames: number, presses: KeyPress[] = []): Case {
  return { rom, snapshot: rom.replace(/\.ch8$/, ""), frames, presses, profile: "chip8", select: 0, ipf: DEFAULT_IPF };
}

function schipCase(rom: string, snapshot: string, profile: string, select: number, frames: number): Case {
  return { rom, snapshot, frames, presses: [], profile, select, ipf: 30 };
}

const CASES: Case[] = [
  chip8Case("1-chip8-logo.ch8", 120),
  chip8Case("2-ibm-logo.ch8", 120),
  chip8Case("3-corax+.ch8", 400),
  chip8Case("4-flags.ch8", 400),
  chip8Case("5-quirks.ch8", 1500, [{ key: 1, frame: 30, frames: DEFAULT_PRESS_FRAMES }]),
  schipCase("5-quirks.ch8", "5-quirks-schip", "schip", 2, 1500),
  schipCase("5-quirks.ch8", "5-quirks-schip-legacy", "schip-legacy", 4, 1500),
  schipCase("8-scrolling.ch8", "8-scrolling-lores", "schip", 1, 300),
  schipCase("8-scrolling.ch8", "8-scrolling-lores-legacy", "schip-legacy", 2, 300),
  schipCase("8-scrolling.ch8", "8-scrolling-hires", "schip", 3, 300),
];

/** Same frame loop as the CLI's headless mode. */
function run(c: Case): Chip8 {
  const vm = new Chip8(profileQuirks(c.profile));
  vm.loadRom(readFileSync(join(ROM_DIR, c.rom)));
  if (c.select !== 0) vm.memory[0x1ff] = c.select;
  for (let frame = 0; frame < c.frames && !vm.halted; frame++) {
    for (const press of c.presses) {
      if (frame === press.frame) vm.setKey(press.key, true);
      else if (frame === press.frame + press.frames) vm.setKey(press.key, false);
    }
    vm.stepFrame(c.ipf);
  }
  return vm;
}

describe("Timendus test suite snapshots", () => {
  for (const c of CASES) {
    test(c.snapshot, () => {
      const vm = run(c);
      expect(vm.halted).toBe(false);
      const actual = renderAscii(vm.display, vm.width, vm.height) + "\n";
      const path = join(SNAPSHOT_DIR, `${c.snapshot}.txt`);
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

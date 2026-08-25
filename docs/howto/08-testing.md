# 8. Testing

An emulator with one wrong flag runs the logo perfectly and breaks every
game in a different, confusing way. Test it at three levels: single
instructions, purpose-built test ROMs, and whole screens.

## Unit tests: one instruction at a time

`bun test` runs any `*.test.ts` file with the built-in `bun:test`. The one
helper that makes opcode tests short is a function that turns a list of
opcodes into a loaded machine:

```ts
import { describe, expect, test } from "bun:test";
import { Chip8, chip8Quirks, type Quirks } from "../src/chip8";

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

test("8XY4 sets VF to the carry after storing the sum", () => {
  const vm = program([0x60ff, 0x6102, 0x8014, 0x6f05, 0x8f04]);
  steps(vm, 3);
  expect(vm.v[0]).toBe(0x01);
  expect(vm.v[0xf]).toBe(1);
  steps(vm, 2);
  expect(vm.v[0xf]).toBe(0); // VF is both destination and flag: the flag wins
});
```

Write one of these per instruction as you implement it, and one per rule you
learned the hard way: the VF write order, `X == Y` operands, sprites at the
right edge, `FX0A` with a key already held, `FX55` with X = F. The file
`tests/chip8.test.ts` in this repository has about forty of them and is a
reasonable checklist.

## Test ROMs

[Timendus' test suite](https://github.com/Timendus/chip8-test-suite) is a set
of programs written to check emulators. Run each headless and read the
screen:

| ROM | Frames | What it shows |
| --- | ------ | ------------- |
| `1-chip8-logo.ch8` | 120 | a logo; needs only the six instructions of chapter 3 |
| `2-ibm-logo.ch8` | 120 | the IBM logo; same six instructions |
| `3-corax+.ch8` | 400 | one line per instruction group with a check mark (`✓`, three pixels wide) or a cross next to it |
| `4-flags.ch8` | 400 | the VF behaviour of `8XY4`–`8XYE`; check marks again |
| `5-quirks.ch8` | 1500, press `1` at frame 30 | detects the six quirks and prints `ON`/`OFF` with a check when it matches the selected platform |
| `6-keypad.ch8` | interactive | `EX9E`, `EXA1`, `FX0A` |
| `7-beep.ch8` | 200 | sets the sound timer; useful for the host's beep |

The quirks ROM is the important one. Choose "CHIP-8" from its menu (key `1`)
and it reports, for the original behaviour, `VF RESET ON`, `MEMORY ON`
(I incremented by `FX55`/`FX65`), `DISP.WAIT ON`, `CLIPPING ON`,
`SHIFTING OFF` (shift VY), `JUMPING OFF` (`BNNN` uses V0) — the six fields
of the `Quirks` object in chapter 5, each with a check mark. Under the
SUPER-CHIP preset the ROM's own SUPER-CHIP mode uses instructions outside
CHIP-8 (`00FF`, high resolution), so this interpreter halts there by design;
the SUPER-CHIP quirks are covered by unit tests instead.

In this repository the whole table is one command each:

```
bun src/main.ts roms/tests/5-quirks.ch8 --headless 1500 --press 1@30
```

## Snapshots: freezing a known-good screen

Once a test ROM shows all check marks, keep that screen. A snapshot test runs
the ROM again and compares the rendered text with the saved file:

```ts
test("3-corax+.ch8", () => {
  const vm = run({ rom: "3-corax+.ch8", frames: 400, presses: [] });
  const actual = renderAscii(vm.display) + "\n";
  const path = join(SNAPSHOT_DIR, "3-corax+.txt");
  if (process.env.UPDATE_SNAPSHOTS === "1" || !existsSync(path)) writeFileSync(path, actual);
  expect(actual).toBe(readFileSync(path, "utf8"));
});
```

This works because the interpreter is deterministic (chapter 6's random
generator has a fixed seed). Any later change that alters a single pixel of a
verified screen fails the test, and the diff shows where. `tests/roms.test.ts`
and `tests/snapshots/` are this repository's version.

## Debugging

- **It halted.** The reason names the opcode and address. Look the opcode up;
  if it is valid, you have a decoding bug (`5XY0` treated as `5XYN`?) or the
  program jumped somewhere wrong earlier and is executing data.
- **Wrong picture, no halt.** Compare with the expected screen in the test
  suite's README. Garbled sprites: bit order or row stride in `drawSprite`.
  Shifted picture: the start-position wrap. Missing pieces: clipping the
  wrong way.
- **Cross instead of check on one line of corax+.** That line names the
  instruction group. Write a unit test for it from the spec sentence.
- **Game runs but plays badly.** Timing: `ipf`, the display-wait quirk, or
  timers ticking per instruction instead of per frame.
- **Print the state.** `hex(vm.pc, 3)`, the current opcode, and
  `renderAscii(vm.display)` after every frame is a debugger good enough for a
  4 KB machine.

Next: [9. A window, a keyboard and a beep](09-window.md)

# ROMs

Nothing in this directory is written by this project.

## tests/

Test ROMs from Timendus' [chip8-test-suite](https://github.com/Timendus/chip8-test-suite)
(GPL-3.0). Run them with `--quirks chip8` (the default) unless the table says
otherwise:

| ROM               | What it checks                                              |
| ----------------- | ----------------------------------------------------------- |
| 1-chip8-logo.ch8  | DXYN, ANNN, 6XNN, 7XNN                                       |
| 2-ibm-logo.ch8    | same, with the classic IBM logo                              |
| 3-corax+.ch8      | every opcode; every row must show a check mark, no crosses   |
| 4-flags.ch8       | VF semantics of 8XY4/5/6/7/E; every row must show check marks |
| 5-quirks.ch8      | quirk detection; press `1` for CHIP-8, or `2` for SUPER-CHIP and then `1` (modern, `--quirks schip`) or `2` (legacy, `--quirks schip-legacy`) |
| 6-keypad.ch8      | EX9E / EXA1 / FX0A; press `1`, `2` or `3` to pick a test     |
| 7-beep.ch8        | sound timer; a beep should be audible                        |
| 8-scrolling.ch8   | 00CN / 00FB / 00FC; press `1` for SUPER-CHIP, then `1` for low resolution and `1` (modern) or `2` (legacy), or `2` for high resolution; every arrow must end inside its box |

The quirks and scrolling ROMs also read a menu choice from memory address
`0x1FF`, which `tests/roms.test.ts` uses instead of key presses.

## games/

CC0 games for the original CHIP-8 platform from John Earnest's
[chip8Archive](https://github.com/JohnEarnest/chip8Archive). Each ROM's
controls are described in the archive's `programs.json`.

## schip/

CC0 SUPER-CHIP programs from the same archive, chosen because the settings
`programs.json` lists for them match `--quirks schip`. Many of the archive's
other SUPER-CHIP programs expect the CHIP-8 behaviour of `8XY6`/`8XYE` and
`FX55`/`FX65` together with the SUPER-CHIP instructions, which none of the
profiles here combines.

| ROM          | Program                                | Suggested options              |
| ------------ | -------------------------------------- | ------------------------------ |
| octogon.ch8  | Super Octogon, a game (low resolution) | `--quirks schip --ipf 200`     |
| squad.ch8    | Squad, a Forth interpreter (high resolution) | `--quirks schip --ipf 500` |
| applejak.ch8 | Applejak, an interpreter for a subset of APL/K (high resolution) | `--quirks schip --ipf 100` |

The `--ipf` values are the speeds the archive gives for each program.

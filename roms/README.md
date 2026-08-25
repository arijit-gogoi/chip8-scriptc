# ROMs

Nothing in this directory is written by this project.

## tests/

Test ROMs from Timendus' [chip8-test-suite](https://github.com/Timendus/chip8-test-suite)
(GPL-3.0). Run them with `--quirks chip8` (the default):

| ROM               | What it checks                                              |
| ----------------- | ----------------------------------------------------------- |
| 1-chip8-logo.ch8  | DXYN, ANNN, 6XNN, 7XNN                                       |
| 2-ibm-logo.ch8    | same, with the classic IBM logo                              |
| 3-corax+.ch8      | every opcode; every row must show a check mark, no crosses   |
| 4-flags.ch8       | VF semantics of 8XY4/5/6/7/E; every row must show check marks |
| 5-quirks.ch8      | quirk detection; press `1` for CHIP-8 mode                   |
| 6-keypad.ch8      | EX9E / EXA1 / FX0A; press `1`, `2` or `3` to pick a test     |
| 7-beep.ch8        | sound timer; a beep should be audible                        |

## games/

CC0 games for the original CHIP-8 platform from John Earnest's
[chip8Archive](https://github.com/JohnEarnest/chip8Archive). Each ROM's
controls are described in the archive's `programs.json`.

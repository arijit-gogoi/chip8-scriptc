# 9. A window, a keyboard and a beep

The core is finished and tested; it just has nowhere to draw. This chapter
connects it to real hardware through a **platform layer** — the code that
opens a window, reads the keyboard and makes sound — and turns the whole
thing into a native executable.

## What a platform layer needs to provide

Look back at the outline in chapter 7. The host needs exactly these things
from the outside world:

| Need | Used for |
| ---- | -------- |
| open a window of a given size, know when it is closed | the loop condition |
| pace the loop at 60 frames per second | `stepFrame` once per frame |
| "is this keyboard key down right now?" | the sixteen CHIP-8 keys, plus pause/reset/speed keys |
| draw a filled rectangle in a colour | one per lit pixel, scaled up |
| draw a line of text | "PAUSED", "HALTED: ..." |
| play a tone, or silence | the sound timer |

Anything that offers those will do: an HTML canvas plus `keydown` events and
the Web Audio API in a browser, SDL, or, as here, [raylib](https://www.raylib.com),
a C library that provides all six in a few calls.

## Calling C from TypeScript

This project compiles the TypeScript with [scriptc](../scriptc.md), which
can call C functions declared like this:

```ts
declare function c8rl_init(width: number, height: number, title: string, fps: number): void;
declare function c8rl_should_close(): boolean;
declare function c8rl_key_down(key: number): boolean;
declare function c8rl_draw_display(pixels: Uint8Array, cols: number, rows: number,
                                   x: number, y: number, scale: number, fg: number, bg: number): void;
declare function c8rl_beep(on: boolean): void;
```

`declare` means "this exists somewhere else"; a JSON manifest tells scriptc
which C symbol each one is and what its arguments look like on the C side.
The C side, `native/c8rl.c`, is thin: `c8rl_draw_display` loops over the
framebuffer and calls raylib's `DrawRectangle` for every non-zero byte;
`c8rl_key_down` is `IsKeyDown`; `c8rl_beep` flips a flag that a square-wave
generator reads. Colours are passed as one integer, `0xRRGGBBAA`, because
scriptc cannot pass C structs. The details are in
[docs/scriptc.md](../scriptc.md); for this chapter, treat the `c8rl_*`
functions as the platform layer's API.

## Mapping the keypad

The CHIP-8 keypad is a 4x4 grid, so it is mapped to the 4x4 block of keys on
the left of a QWERTY keyboard:

```
CHIP-8          keyboard
1 2 3 C         1 2 3 4
4 5 6 D   ->    Q W E R
7 8 9 E         A S D F
A 0 B F         Z X C V
```

As a table indexed by CHIP-8 key, holding raylib's key codes (which are the
ASCII codes of the capital letters and digits):

```ts
/** raylib key code for each CHIP-8 key 0x0..0xF. */
const KEYMAP: number[] = [88, 49, 50, 51, 81, 87, 69, 65, 83, 68, 90, 67, 52, 82, 70, 86];
//                        X   1   2   3   Q   W   E   A   S   D   Z   C   4   R   F   V
```

## The windowed loop

```ts
function runWindowed(vm: Chip8, rom: Uint8Array, opts: Options): void {
  c8rl_init(DISPLAY_WIDTH * opts.scale, DISPLAY_HEIGHT * opts.scale, `CHIP-8 - ${baseName(opts.rom)}`, 60);
  if (opts.sound) c8rl_audio_init();

  let ipf = opts.ipf;
  let paused = false;
  let muted = false;

  while (!c8rl_should_close()) {
    if (c8rl_key_pressed(KEY_P)) paused = !paused;
    if (c8rl_key_pressed(KEY_M)) muted = !muted;
    if (c8rl_key_pressed(KEY_BACKSPACE)) {
      vm.reset();
      vm.loadRom(rom);
      paused = false;
    }
    if (c8rl_key_pressed(KEY_EQUAL) || c8rl_key_pressed(KEY_KP_ADD)) {
      ipf = Math.min(MAX_IPF, ipf + (ipf < 20 ? 1 : 5));
    }
    if (c8rl_key_pressed(KEY_MINUS) || c8rl_key_pressed(KEY_KP_SUBTRACT)) {
      ipf = Math.max(MIN_IPF, ipf - (ipf <= 20 ? 1 : 5));
    }
    for (let key = 0; key < KEY_COUNT; key++) {
      vm.setKey(key, c8rl_key_down(KEYMAP[key]));
    }

    if (!paused) vm.stepFrame(ipf);

    if (opts.sound) {
      c8rl_beep(!muted && !paused && vm.soundTimer > 0);
      c8rl_audio_update();
    }

    const width = c8rl_screen_width();
    const height = c8rl_screen_height();
    const scale = Math.max(1, Math.floor(Math.min(width / DISPLAY_WIDTH, height / DISPLAY_HEIGHT)));
    const originX = Math.floor((width - DISPLAY_WIDTH * scale) / 2);
    const originY = Math.floor((height - DISPLAY_HEIGHT * scale) / 2);

    c8rl_begin();
    c8rl_clear(0x000000ff);
    c8rl_draw_display(vm.display, DISPLAY_WIDTH, DISPLAY_HEIGHT, originX, originY, scale, opts.fg, opts.bg);
    if (vm.halted) {
      c8rl_draw_text(`HALTED: ${vm.haltReason}`, originX + 8, originY + 8, 20, 0xff5252ff);
    } else if (paused) {
      c8rl_draw_text(`PAUSED  (${ipf} ipf)`, originX + 8, originY + 8, 20, 0xffd54fff);
    }
    c8rl_end();
  }

  if (opts.sound) c8rl_audio_close();
  c8rl_close();
}
```

Things to notice:

- `c8rl_init(..., 60)` asks raylib to cap the loop at 60 frames per second,
  and `c8rl_end()` is where it sleeps to make that true. The core never
  looks at a clock.
- The window is resizable. Each frame recomputes the largest whole-number
  scale that fits and centres the 64x32 image, so pixels stay square.
- `c8rl_key_pressed` (true once per press) is used for host keys;
  `c8rl_key_down` (true while held) for the keypad, because CHIP-8 programs
  poll key state themselves.
- Sound is the sound timer and nothing else: on while it is non-zero.

## The beep

The shim keeps a raylib audio stream playing all the time. Once per frame
`c8rl_audio_update()` refills every buffer the sound card has consumed with
either a 440 Hz square wave (alternating +6000 and −6000 samples) or zeros,
depending on the last `c8rl_beep()`. Keeping the stream open avoids clicks
and start-up delay when the timer flickers on and off.

## Building it

```
bun install
bun run build
dist\chip8.exe roms\games\outlaw.ch8
```

`bun run build` compiles raylib and the shim with `zig cc`, generates the FFI
manifest, and runs scriptc, which compiles `src/main.ts` and everything it
imports to machine code and links the lot into `dist/chip8.exe` — about 2 MB,
no runtime to install. [docs/toolchain.md](../toolchain.md) walks through
every step of that script.

The same TypeScript still runs under bun. `bun run verify` uses that: it
runs a set of ROMs headless through both the executable and
`bun src/main.ts` and requires identical output, which is the final check
that the compiled program is the program you tested.

## Where to go from here

- **Another platform layer.** The core does not import anything from the
  host. Render `vm.display` to an HTML canvas at 60 fps with
  `requestAnimationFrame`, wire `keydown`/`keyup` to `setKey`, and the same
  `chip8.ts` runs in a browser.
- **SUPER-CHIP.** Add the `00CN`/`00FB`–`00FF`/`DXY0`/`FX30`/`FX75`/`FX85`
  instructions and a 128x64 mode; the quirks object already has the right
  preset.
- **A debugger.** A disassembler for the 35 opcodes is an afternoon's work,
  and pausing with `P` already exists.
- **A bigger machine.** Everything here — fetch/decode/execute, registers, a
  stack, timers, memory-mapped sprites, quirk switches, headless testing —
  is the foundation of a Game Boy or NES emulator. The instruction count goes
  up; the shape does not change.

/// <reference path="./rl.d.ts" />
import { readFileSync } from "node:fs";
import {
  Chip8,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  KEY_COUNT,
  chip8Quirks,
  hex,
  renderAscii,
  schipQuirks,
  type Quirks,
} from "./chip8";
// The c8rl_* functions are ambient FFI declarations (see rl.d.ts, referenced
// at the top of this file); scriptc binds them to native/c8rl.c through
// native/build/ffi.json.

// raylib key codes used by the host.
const KEY_MINUS = 45;
const KEY_EQUAL = 61;
const KEY_M = 77;
const KEY_P = 80;
const KEY_BACKSPACE = 259;
const KEY_KP_SUBTRACT = 333;
const KEY_KP_ADD = 334;

/**
 * raylib key code for each CHIP-8 key 0x0..0xF.
 *
 *   1 2 3 C        1 2 3 4
 *   4 5 6 D   ->   Q W E R
 *   7 8 9 E        A S D F
 *   A 0 B F        Z X C V
 */
const KEYMAP: number[] = [88, 49, 50, 51, 81, 87, 69, 65, 83, 68, 90, 67, 52, 82, 70, 86];

const MIN_IPF = 1;
const MAX_IPF = 5000;

interface KeyPress {
  key: number;
  frame: number;
  frames: number;
}

interface Options {
  rom: string;
  ipf: number;
  scale: number;
  profile: string;
  wrapSprites: boolean;
  displayWait: boolean;
  sound: boolean;
  headless: boolean;
  frames: number;
  presses: KeyPress[];
  fg: number;
  bg: number;
}

function usage(): void {
  console.log("usage: chip8 <rom.ch8> [options]");
  console.log("");
  console.log("  --ipf <n>            instructions per 60 Hz frame (default 11)");
  console.log("  --scale <n>          window pixels per CHIP-8 pixel (default 12)");
  console.log("  --quirks <profile>   chip8 (COSMAC VIP, default) or schip (SUPER-CHIP 1.1)");
  console.log("  --wrap               wrap sprites around the screen edges instead of clipping");
  console.log("  --no-wait            do not limit DXYN to one sprite per frame");
  console.log("  --no-sound           do not open an audio device");
  console.log("  --fg <rrggbb>        pixel colour (default dcdcdc)");
  console.log("  --bg <rrggbb>        background colour (default 202020)");
  console.log("  --headless <frames>  run without a window, then print the display as text");
  console.log("  --press <k>@<f>[+n]  headless only: hold hex key k from frame f for n frames (default 30)");
  console.log("");
  console.log("keys: 1234/QWER/ASDF/ZXCV = keypad, P pause, Backspace reset, +/- speed, M mute, Esc quit");
}

/** Parse a non-negative decimal integer; -1 when the text is not one. */
function parseDecimal(text: string): number {
  if (text.length === 0) return -1;
  let value = 0;
  for (let k = 0; k < text.length; k++) {
    const code = text.charCodeAt(k);
    if (code < 48 || code > 57) return -1;
    value = value * 10 + (code - 48);
  }
  return value;
}

/** Parse a non-negative hexadecimal integer; -1 when the text is not one. */
function parseHex(text: string): number {
  if (text.length === 0) return -1;
  let value = 0;
  for (let k = 0; k < text.length; k++) {
    const code = text.charCodeAt(k);
    let digit = -1;
    if (code >= 48 && code <= 57) digit = code - 48;
    else if (code >= 65 && code <= 70) digit = code - 55;
    else if (code >= 97 && code <= 102) digit = code - 87;
    if (digit < 0) return -1;
    value = value * 16 + digit;
  }
  return value;
}

/** "rrggbb" -> 0xrrggbbff, or -1. */
function parseColor(text: string): number {
  if (text.length !== 6) return -1;
  const rgb = parseHex(text);
  if (rgb < 0) return -1;
  return (rgb * 256 + 0xff) >>> 0;
}

/** "k@f" or "k@f+n" -> KeyPress, or null. */
function parsePress(text: string): KeyPress | null {
  const at = text.indexOf("@");
  if (at <= 0) return null;
  const key = parseHex(text.slice(0, at));
  if (key < 0 || key > 15) return null;
  let rest = text.slice(at + 1);
  // Half a second: long enough for ROMs that poll one key per frame.
  let frames = 30;
  const plus = rest.indexOf("+");
  if (plus >= 0) {
    frames = parseDecimal(rest.slice(plus + 1));
    rest = rest.slice(0, plus);
    if (frames <= 0) return null;
  }
  const frame = parseDecimal(rest);
  if (frame < 0) return null;
  return { key, frame, frames };
}

function parseOptions(args: string[]): Options | null {
  const opts: Options = {
    rom: "",
    ipf: 11,
    scale: 12,
    profile: "chip8",
    wrapSprites: false,
    displayWait: true,
    sound: true,
    headless: false,
    frames: 0,
    presses: [],
    fg: 0xdcdcdcff,
    bg: 0x202020ff,
  };
  let k = 0;
  while (k < args.length) {
    const arg = args[k];
    k++;
    if (arg === "--help" || arg === "-h") return null;
    if (arg === "--no-sound") {
      opts.sound = false;
      continue;
    }
    if (arg === "--wrap") {
      opts.wrapSprites = true;
      continue;
    }
    if (arg === "--no-wait") {
      opts.displayWait = false;
      continue;
    }
    if (arg.length > 2 && arg.charCodeAt(0) === 45 && arg.charCodeAt(1) === 45) {
      if (k >= args.length) {
        console.log(`missing value for ${arg}`);
        return null;
      }
      const value = args[k];
      k++;
      if (arg === "--ipf") {
        opts.ipf = parseDecimal(value);
        if (opts.ipf < MIN_IPF || opts.ipf > MAX_IPF) {
          console.log(`--ipf must be between ${MIN_IPF} and ${MAX_IPF}`);
          return null;
        }
      } else if (arg === "--scale") {
        opts.scale = parseDecimal(value);
        if (opts.scale < 1 || opts.scale > 64) {
          console.log("--scale must be between 1 and 64");
          return null;
        }
      } else if (arg === "--quirks") {
        if (value !== "chip8" && value !== "schip") {
          console.log("--quirks must be chip8 or schip");
          return null;
        }
        opts.profile = value;
        if (value === "schip") opts.displayWait = false;
      } else if (arg === "--headless") {
        opts.headless = true;
        opts.frames = parseDecimal(value);
        if (opts.frames < 0) {
          console.log("--headless needs a frame count");
          return null;
        }
      } else if (arg === "--press") {
        const press = parsePress(value);
        if (press === null) {
          console.log(`bad --press value ${value} (expected k@frame or k@frame+n)`);
          return null;
        }
        opts.presses.push(press);
      } else if (arg === "--fg" || arg === "--bg") {
        const color = parseColor(value);
        if (color < 0) {
          console.log(`${arg} expects rrggbb`);
          return null;
        }
        if (arg === "--fg") opts.fg = color;
        else opts.bg = color;
      } else {
        console.log(`unknown option ${arg}`);
        return null;
      }
      continue;
    }
    if (opts.rom !== "") {
      console.log("only one ROM can be loaded");
      return null;
    }
    opts.rom = arg;
  }
  if (opts.rom === "") return null;
  return opts;
}

function buildQuirks(opts: Options): Quirks {
  const quirks = opts.profile === "schip" ? schipQuirks() : chip8Quirks();
  quirks.wrapSprites = opts.wrapSprites;
  quirks.displayWait = opts.displayWait;
  return quirks;
}

function baseName(path: string): string {
  let start = 0;
  for (let k = 0; k < path.length; k++) {
    const code = path.charCodeAt(k);
    if (code === 47 || code === 92) start = k + 1;
  }
  return path.slice(start);
}

function applyPresses(vm: Chip8, presses: KeyPress[], frame: number): void {
  for (let k = 0; k < presses.length; k++) {
    const press = presses[k];
    if (frame === press.frame) vm.setKey(press.key, true);
    else if (frame === press.frame + press.frames) vm.setKey(press.key, false);
  }
}

function runHeadless(vm: Chip8, opts: Options): void {
  let frame = 0;
  while (frame < opts.frames && !vm.halted) {
    applyPresses(vm, opts.presses, frame);
    vm.stepFrame(opts.ipf);
    frame++;
  }
  console.log(renderAscii(vm.display));
  let status = `frames=${frame} pc=${hex(vm.pc, 3)} i=${hex(vm.i, 3)} dt=${vm.delayTimer} st=${vm.soundTimer}`;
  if (vm.halted) status += ` halted: ${vm.haltReason}`;
  console.log(status);
}

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

function main(): void {
  const args: string[] = [];
  for (let k = 2; k < process.argv.length; k++) args.push(process.argv[k]);
  const opts = parseOptions(args);
  if (opts === null) {
    usage();
    process.exit(2);
    return;
  }

  let rom: Uint8Array;
  try {
    rom = readFileSync(opts.rom);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unreadable";
    console.log(`cannot read ROM ${opts.rom}: ${reason}`);
    process.exit(1);
    return;
  }

  const vm = new Chip8(buildQuirks(opts));
  try {
    vm.loadRom(rom);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "invalid ROM";
    console.log(`cannot load ROM ${opts.rom}: ${reason}`);
    process.exit(1);
    return;
  }

  if (opts.headless) runHeadless(vm, opts);
  else runWindowed(vm, rom, opts);
}

main();

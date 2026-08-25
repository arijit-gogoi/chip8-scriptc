import { chip8Quirks, schipQuirks, type Quirks } from "./chip8";

export const MIN_IPF = 1;
export const MAX_IPF = 5000;
export const DEFAULT_IPF = 11;
export const DEFAULT_SCALE = 12;
/** Half a second: long enough for ROMs that poll one key per frame. */
export const DEFAULT_PRESS_FRAMES = 30;

export const USAGE = `usage: chip8 <rom.ch8> [options]

  --ipf <n>            instructions per 60 Hz frame (default ${DEFAULT_IPF})
  --scale <n>          window pixels per CHIP-8 pixel (default ${DEFAULT_SCALE})
  --quirks <profile>   chip8 (COSMAC VIP, default) or schip (SUPER-CHIP 1.1)
  --wrap               wrap sprites around the screen edges instead of clipping
  --no-wait            do not limit DXYN to one sprite per frame
  --no-sound           do not open an audio device
  --fg <rrggbb>        pixel colour (default dcdcdc)
  --bg <rrggbb>        background colour (default 202020)
  --headless <frames>  run without a window, then print the display as text
  --press <k>@<f>[+n]  headless only: hold hex key k from frame f for n frames (default ${DEFAULT_PRESS_FRAMES})

keys: 1234/QWER/ASDF/ZXCV = keypad, P pause, Backspace reset, +/- speed, M mute, Esc quit`;

export interface KeyPress {
  key: number;
  frame: number;
  frames: number;
}

export interface Options {
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

export interface ParseResult {
  /** null when parsing failed or help was requested. */
  options: Options | null;
  /** Empty when help was requested, otherwise the problem. */
  error: string;
}

/** Parse a non-negative decimal integer; -1 when the text is not one. */
export function parseDecimal(text: string): number {
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
export function parseHex(text: string): number {
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
export function parseColor(text: string): number {
  if (text.length !== 6) return -1;
  const rgb = parseHex(text);
  if (rgb < 0) return -1;
  return (rgb * 256 + 0xff) >>> 0;
}

/** "k@f" or "k@f+n" -> KeyPress, or null. */
export function parsePress(text: string): KeyPress | null {
  const at = text.indexOf("@");
  if (at <= 0) return null;
  const key = parseHex(text.slice(0, at));
  if (key < 0 || key > 15) return null;
  let rest = text.slice(at + 1);
  let frames = DEFAULT_PRESS_FRAMES;
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

function failure(error: string): ParseResult {
  return { options: null, error };
}

export function parseOptions(args: string[]): ParseResult {
  const opts: Options = {
    rom: "",
    ipf: DEFAULT_IPF,
    scale: DEFAULT_SCALE,
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
    if (arg === "--help" || arg === "-h") return failure("");
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
      if (k >= args.length) return failure(`missing value for ${arg}`);
      const value = args[k];
      k++;
      if (arg === "--ipf") {
        opts.ipf = parseDecimal(value);
        if (opts.ipf < MIN_IPF || opts.ipf > MAX_IPF) return failure(`--ipf must be between ${MIN_IPF} and ${MAX_IPF}`);
      } else if (arg === "--scale") {
        opts.scale = parseDecimal(value);
        if (opts.scale < 1 || opts.scale > 64) return failure("--scale must be between 1 and 64");
      } else if (arg === "--quirks") {
        if (value !== "chip8" && value !== "schip") return failure("--quirks must be chip8 or schip");
        opts.profile = value;
        if (value === "schip") opts.displayWait = false;
      } else if (arg === "--headless") {
        opts.headless = true;
        opts.frames = parseDecimal(value);
        if (opts.frames < 0) return failure("--headless needs a frame count");
      } else if (arg === "--press") {
        const press = parsePress(value);
        if (press === null) return failure(`bad --press value ${value} (expected k@frame or k@frame+n)`);
        opts.presses.push(press);
      } else if (arg === "--fg" || arg === "--bg") {
        const color = parseColor(value);
        if (color < 0) return failure(`${arg} expects rrggbb`);
        if (arg === "--fg") opts.fg = color;
        else opts.bg = color;
      } else {
        return failure(`unknown option ${arg}`);
      }
      continue;
    }
    if (opts.rom !== "") return failure("only one ROM can be loaded");
    opts.rom = arg;
  }
  if (opts.rom === "") return failure("no ROM given");
  return { options: opts, error: "" };
}

/** The quirk profile selected by the options, with the explicit overrides applied. */
export function quirksFor(opts: Options): Quirks {
  const quirks = opts.profile === "schip" ? schipQuirks() : chip8Quirks();
  quirks.wrapSprites = opts.wrapSprites;
  quirks.displayWait = opts.displayWait;
  return quirks;
}

/** Last path segment, accepting both separators. */
export function baseName(path: string): string {
  let start = 0;
  for (let k = 0; k < path.length; k++) {
    const code = path.charCodeAt(k);
    if (code === 47 || code === 92) start = k + 1;
  }
  return path.slice(start);
}

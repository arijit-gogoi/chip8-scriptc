/// <reference path="./rl.d.ts" />
import { readFileSync } from "node:fs";
import { Chip8, DISPLAY_HEIGHT, DISPLAY_WIDTH, KEY_COUNT, hex, renderAscii } from "./chip8";
import { MAX_IPF, MIN_IPF, USAGE, baseName, parseOptions, quirksFor, type KeyPress, type Options } from "./cli";
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
  const parsed = parseOptions(args);
  if (parsed.options === null) {
    if (parsed.error !== "") console.log(parsed.error);
    console.log(USAGE);
    process.exit(parsed.error === "" ? 0 : 2);
    return;
  }
  const opts = parsed.options;

  let rom: Uint8Array;
  try {
    rom = readFileSync(opts.rom);
  } catch {
    console.log(`cannot read ROM ${opts.rom}`);
    process.exit(1);
    return;
  }

  const vm = new Chip8(quirksFor(opts));
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

/**
 * Signature-only ambient declarations bound to native/c8rl.c through the FFI
 * manifest (native/ffi.base.json). Each one wraps a raylib call behind a
 * scalar-only C ABI because scriptc cannot pass structs by value.
 *
 * Under bun (development, `bun src/main.ts --headless`) these have no runtime
 * binding, so only the windowed code path may call them.
 */

declare function c8rl_init(width: number, height: number, title: string, fps: number): void;
declare function c8rl_close(): void;
declare function c8rl_should_close(): boolean;
declare function c8rl_screen_width(): number;
declare function c8rl_screen_height(): number;

declare function c8rl_begin(): void;
declare function c8rl_end(): void;
declare function c8rl_clear(rgba: number): void;
declare function c8rl_draw_display(
  pixels: Uint8Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
  scale: number,
  fg: number,
  bg: number,
): void;
declare function c8rl_draw_text(text: string, x: number, y: number, size: number, rgba: number): void;

declare function c8rl_key_down(key: number): boolean;
declare function c8rl_key_pressed(key: number): boolean;

declare function c8rl_audio_init(): void;
declare function c8rl_audio_close(): void;
declare function c8rl_beep(on: boolean): void;
declare function c8rl_audio_update(): void;

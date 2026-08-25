/*
 * Scalar-only wrappers around raylib for the scriptc FFI.
 *
 * scriptc passes numbers, booleans, strings (pointer + length) and byte
 * buffers (pointer + length) across the boundary, but no structs by value.
 * raylib's API is built on small structs (Color, Vector2, ...), so this shim
 * flattens every call the emulator needs into plain integers.
 */
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#include "raylib.h"

static char *copy_cstring(const uint8_t *text, size_t length) {
    char *out = (char *)malloc(length + 1);
    if (out == NULL) return NULL;
    memcpy(out, text, length);
    out[length] = '\0';
    return out;
}

/* ---- window ------------------------------------------------------------ */

void c8rl_init(int32_t width, int32_t height, const uint8_t *title, size_t title_length, int32_t fps) {
    char *ctitle = copy_cstring(title, title_length);
    SetTraceLogLevel(LOG_WARNING);
    SetConfigFlags(FLAG_WINDOW_RESIZABLE | FLAG_VSYNC_HINT);
    InitWindow(width, height, ctitle != NULL ? ctitle : "CHIP-8");
    SetWindowMinSize(64, 32);
    SetTargetFPS(fps);
    free(ctitle);
}

void c8rl_close(void) {
    CloseWindow();
}

uint8_t c8rl_should_close(void) {
    return WindowShouldClose() ? 1 : 0;
}

int32_t c8rl_screen_width(void) {
    return GetScreenWidth();
}

int32_t c8rl_screen_height(void) {
    return GetScreenHeight();
}

/* ---- drawing ----------------------------------------------------------- */

void c8rl_begin(void) {
    BeginDrawing();
}

void c8rl_end(void) {
    EndDrawing();
}

void c8rl_clear(uint32_t rgba) {
    ClearBackground(GetColor(rgba));
}

/* pixels: one byte per pixel, row-major, non-zero = lit. */
void c8rl_draw_display(const uint8_t *pixels, size_t length,
                       int32_t cols, int32_t rows,
                       int32_t x, int32_t y, int32_t scale,
                       uint32_t fg, uint32_t bg) {
    if (cols <= 0 || rows <= 0 || scale <= 0) return;
    if ((size_t)cols * (size_t)rows > length) return;
    DrawRectangle(x, y, cols * scale, rows * scale, GetColor(bg));
    Color lit = GetColor(fg);
    for (int32_t r = 0; r < rows; r++) {
        for (int32_t c = 0; c < cols; c++) {
            if (pixels[(size_t)r * (size_t)cols + (size_t)c] != 0) {
                DrawRectangle(x + c * scale, y + r * scale, scale, scale, lit);
            }
        }
    }
}

void c8rl_draw_text(const uint8_t *text, size_t length, int32_t x, int32_t y, int32_t size, uint32_t rgba) {
    char buffer[256];
    if (length >= sizeof buffer) length = sizeof buffer - 1;
    memcpy(buffer, text, length);
    buffer[length] = '\0';
    DrawText(buffer, x, y, size, GetColor(rgba));
}

/* ---- input ------------------------------------------------------------- */

uint8_t c8rl_key_down(int32_t key) {
    return IsKeyDown(key) ? 1 : 0;
}

uint8_t c8rl_key_pressed(int32_t key) {
    return IsKeyPressed(key) ? 1 : 0;
}

/* ---- audio: a square-wave beep driven by the CHIP-8 sound timer -------- */

#define C8RL_SAMPLE_RATE 44100
#define C8RL_BUFFER_FRAMES 1024
#define C8RL_TONE_HZ 440.0f
#define C8RL_AMPLITUDE 6000

static AudioStream g_stream;
static int g_audio_ready = 0;
static int g_beep = 0;
static float g_phase = 0.0f;
static int16_t g_buffer[C8RL_BUFFER_FRAMES];

void c8rl_audio_init(void) {
    InitAudioDevice();
    if (!IsAudioDeviceReady()) return;
    SetAudioStreamBufferSizeDefault(C8RL_BUFFER_FRAMES);
    g_stream = LoadAudioStream(C8RL_SAMPLE_RATE, 16, 1);
    PlayAudioStream(g_stream);
    g_audio_ready = 1;
}

void c8rl_beep(uint8_t on) {
    g_beep = on != 0;
}

/* Refill every drained stream buffer; call once per frame. */
void c8rl_audio_update(void) {
    if (!g_audio_ready) return;
    const float step = C8RL_TONE_HZ / (float)C8RL_SAMPLE_RATE;
    while (IsAudioStreamProcessed(g_stream)) {
        for (int k = 0; k < C8RL_BUFFER_FRAMES; k++) {
            if (g_beep) {
                g_buffer[k] = g_phase < 0.5f ? C8RL_AMPLITUDE : -C8RL_AMPLITUDE;
                g_phase += step;
                if (g_phase >= 1.0f) g_phase -= 1.0f;
            } else {
                g_buffer[k] = 0;
                g_phase = 0.0f;
            }
        }
        UpdateAudioStream(g_stream, g_buffer, C8RL_BUFFER_FRAMES);
    }
}

void c8rl_audio_close(void) {
    if (g_audio_ready) {
        StopAudioStream(g_stream);
        UnloadAudioStream(g_stream);
        g_audio_ready = 0;
    }
    if (IsAudioDeviceReady()) CloseAudioDevice();
}

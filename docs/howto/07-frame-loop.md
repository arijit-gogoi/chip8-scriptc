# 7. The frame loop

`step()` runs one instruction. A program needs someone to call it at the
right speed, tick the timers at 60 Hz, feed in keys, and show the screen. That
someone is the **host**, and its central piece is the frame loop.

## How fast is a CHIP-8?

The original VIP ran a few hundred instructions per second — it varied by
instruction — while its timers and its display refresh ran at 60 Hz. Games
were tuned to that: a Pong ball moves one pixel per few instructions, so an
interpreter that runs a million instructions per second is unplayable.

The common approach, and the one used here, is to organise everything
around 60 frames per second:

1. run a fixed number of instructions — **instructions per frame**, `ipf`;
2. decrement the timers once;
3. show the screen.

With `ipf = 11` that is 660 instructions per second, a comfortable speed for
most 1970s–80s games. Faster modern games want 20–50; `+`/`-` in the windowed
host change it live.

## Display wait

There is one more piece of period-accurate behaviour. The VIP could only
draw a sprite while the display was not being refreshed, so `DXYN` waited
for the next refresh: at most one sprite per 60 Hz frame. Games from that
era rely on the resulting slowdown — the frame rate *is* their timing.

Chapter 3 set `drawn = true` in `DXYN` and `00E0`. The frame loop clears the
flag at the start of a frame and, when the `displayWait` quirk is on, ends
the frame as soon as it comes back on. Everything is in one method on the
core so that every host — windowed, headless, tests — gets identical timing:

```ts
/**
 * Run one 60 Hz frame: up to `ipf` instructions followed by a timer tick.
 * With the displayWait quirk a sprite draw ends the frame early.
 * Returns the number of instructions executed.
 */
stepFrame(ipf: number): number {
  this.drawn = false;
  let executed = 0;
  while (executed < ipf && !this.halted) {
    this.step();
    executed++;
    if (this.drawn && this.quirks.displayWait) break;
  }
  this.tickTimers();
  return executed;
}
```

While the interpreter is waiting for a key (`FX0A`), `step()` returns
immediately each time, the loop runs `ipf` cheap polls, and the timers still
tick. That is the "timers continue while waiting" rule from chapter 6 for
free.

## A headless host

The simplest host has no window at all. It runs N frames, optionally
pressing keys at scripted moments, and prints the screen. It is what
`bun src/main.ts rom.ch8 --headless 120 --press 1@30` does:

```ts
interface KeyPress {
  key: number;    // 0..15
  frame: number;  // press on this frame
  frames: number; // hold for this many frames
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
```

This mode turns out to be the most useful thing in the project. It is how
the test ROMs are checked in chapter 8, how screens are frozen as snapshots,
and how the compiled executable is compared against the interpreted program.
A default hold of 30 frames (half a second) matters: several ROMs scan one
key per frame, and a six-frame tap can slip between scans.

## A windowed host, in outline

The windowed host is the same loop with real inputs and outputs, paced by the
window library at 60 frames per second:

```
while the window is open:
  handle host keys (pause, reset, speed, mute)
  for each of the 16 CHIP-8 keys: vm.setKey(key, isKeyboardKeyDown(mapping[key]))
  if not paused: vm.stepFrame(ipf)
  beep(vm.soundTimer > 0)
  draw vm.display scaled to the window
```

Chapter 9 fills that in with raylib. Before that, chapter 8 makes sure the
core is actually correct.

Next: [8. Testing](08-testing.md)

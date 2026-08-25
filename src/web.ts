/**
 * Browser host: the same Chip8 core driven by requestAnimationFrame, drawn on
 * a <canvas>, fed by keyboard and on-screen keypad, with a Web Audio beep.
 * Bundled by scripts/build-web.ts into dist/web/web.js.
 */
import { Chip8, DISPLAY_HEIGHT, DISPLAY_WIDTH, KEY_COUNT, chip8Quirks, hex, schipQuirks, type Quirks } from "./chip8";
import { DEFAULT_IPF, MAX_IPF, MIN_IPF } from "./cli";

const FRAME_MS = 1000 / 60;
const MAX_CATCH_UP_FRAMES = 4;
const FG = [0xdc, 0xdc, 0xdc];
const BG = [0x20, 0x20, 0x20];

/** KeyboardEvent.code -> CHIP-8 key (1234/QWER/ASDF/ZXCV layout). */
const KEY_CODES: Record<string, number> = {
  Digit1: 0x1, Digit2: 0x2, Digit3: 0x3, Digit4: 0xc,
  KeyQ: 0x4, KeyW: 0x5, KeyE: 0x6, KeyR: 0xd,
  KeyA: 0x7, KeyS: 0x8, KeyD: 0x9, KeyF: 0xe,
  KeyZ: 0xa, KeyX: 0x0, KeyC: 0xb, KeyV: 0xf,
};

/** Keypad in its physical layout, with the keyboard key shown on each button. */
const KEYPAD_LAYOUT: [number, string][] = [
  [0x1, "1"], [0x2, "2"], [0x3, "3"], [0xc, "4"],
  [0x4, "Q"], [0x5, "W"], [0x6, "E"], [0xd, "R"],
  [0x7, "A"], [0x8, "S"], [0x9, "D"], [0xe, "F"],
  [0xa, "Z"], [0x0, "X"], [0xb, "C"], [0xf, "V"],
];

interface RomEntry {
  group: string;
  name: string;
  path: string;
  size: number;
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node as T;
}

const screen = element<HTMLCanvasElement>("screen");
const romSelect = element<HTMLSelectElement>("rom");
const fileInput = element<HTMLInputElement>("file");
const quirksSelect = element<HTMLSelectElement>("quirks");
const wrapInput = element<HTMLInputElement>("wrap");
const ipfInput = element<HTMLInputElement>("ipf");
const pauseButton = element<HTMLButtonElement>("pause");
const resetButton = element<HTMLButtonElement>("reset");
const muteInput = element<HTMLInputElement>("mute");
const status = element<HTMLElement>("status");
const keypad = element<HTMLElement>("keypad");

const vm = new Chip8(chip8Quirks());
let rom: Uint8Array = new Uint8Array(0);
let romName = "";
let ipf = DEFAULT_IPF;
let paused = false;

// ---- quirks -------------------------------------------------------------

function selectedQuirks(): Quirks {
  const quirks = quirksSelect.value === "schip" ? schipQuirks() : chip8Quirks();
  quirks.wrapSprites = wrapInput.checked;
  return quirks;
}

// ---- ROM loading --------------------------------------------------------

function load(bytes: Uint8Array, name: string): void {
  vm.reset();
  try {
    vm.loadRom(bytes);
  } catch (err) {
    status.textContent = `${name}: ${err instanceof Error ? err.message : "cannot load"}`;
    return;
  }
  rom = bytes;
  romName = name;
  paused = false;
  pauseButton.textContent = "Pause";
}

async function loadFromUrl(path: string, name: string): Promise<void> {
  const response = await fetch(path);
  if (!response.ok) {
    status.textContent = `${name}: HTTP ${response.status}`;
    return;
  }
  load(new Uint8Array(await response.arrayBuffer()), name);
}

async function loadFile(file: File): Promise<void> {
  load(new Uint8Array(await file.arrayBuffer()), file.name);
}

async function populateRoms(): Promise<void> {
  const response = await fetch("roms.json");
  if (!response.ok) return;
  const entries = (await response.json()) as RomEntry[];
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const entry of entries) {
    let group = groups.get(entry.group);
    if (group === undefined) {
      group = document.createElement("optgroup");
      group.label = entry.group;
      groups.set(entry.group, group);
      romSelect.appendChild(group);
    }
    const option = document.createElement("option");
    option.value = entry.path;
    option.textContent = `${entry.name} (${entry.size} B)`;
    group.appendChild(option);
  }
  if (entries.length > 0) {
    romSelect.value = entries[0].path;
    await loadFromUrl(entries[0].path, entries[0].name);
  }
}

// ---- audio --------------------------------------------------------------

let audio: AudioContext | null = null;
let gain: GainNode | null = null;

/** Browsers only allow audio after a user gesture; call from input handlers. */
function ensureAudio(): void {
  if (audio !== null) {
    if (audio.state === "suspended") void audio.resume();
    return;
  }
  audio = new AudioContext();
  const oscillator = audio.createOscillator();
  oscillator.type = "square";
  oscillator.frequency.value = 440;
  gain = audio.createGain();
  gain.gain.value = 0;
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
}

function setBeep(on: boolean): void {
  if (audio === null || gain === null) return;
  gain.gain.setTargetAtTime(on && !muteInput.checked ? 0.12 : 0, audio.currentTime, 0.005);
}

// ---- drawing ------------------------------------------------------------

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("2D canvas unsupported");
  return context;
}

const context = context2d(screen);
context.imageSmoothingEnabled = false;
const backing = document.createElement("canvas");
backing.width = DISPLAY_WIDTH;
backing.height = DISPLAY_HEIGHT;
const backingContext = context2d(backing);
const image = backingContext.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);

function draw(): void {
  const pixels = image.data;
  for (let k = 0; k < DISPLAY_WIDTH * DISPLAY_HEIGHT; k++) {
    const rgb = vm.display[k] !== 0 ? FG : BG;
    pixels[k * 4] = rgb[0];
    pixels[k * 4 + 1] = rgb[1];
    pixels[k * 4 + 2] = rgb[2];
    pixels[k * 4 + 3] = 255;
  }
  backingContext.putImageData(image, 0, 0);
  context.drawImage(backing, 0, 0, screen.width, screen.height);
}

function updateStatus(): void {
  if (romName === "") {
    status.textContent = "no ROM loaded";
    return;
  }
  let text = `${romName} | ${ipf} ipf | ${quirksSelect.value}`;
  if (vm.halted) text += ` | HALTED: ${vm.haltReason}`;
  else if (paused) text += " | paused";
  else if (vm.waitingForKey) text += " | waiting for key";
  text += ` | pc=${hex(vm.pc, 3)}`;
  status.textContent = text;
}

// ---- frame loop ---------------------------------------------------------

let last = performance.now();
let accumulated = 0;

function tick(now: number): void {
  accumulated += now - last;
  last = now;
  const running = romName !== "" && !paused;
  let frames = 0;
  while (accumulated >= FRAME_MS && frames < MAX_CATCH_UP_FRAMES) {
    if (running) vm.stepFrame(ipf);
    accumulated -= FRAME_MS;
    frames++;
  }
  if (frames === MAX_CATCH_UP_FRAMES) accumulated = 0;
  setBeep(running && vm.soundTimer > 0);
  draw();
  updateStatus();
  requestAnimationFrame(tick);
}

// ---- input --------------------------------------------------------------

function setIpf(value: number): void {
  ipf = Math.min(MAX_IPF, Math.max(MIN_IPF, Math.floor(value)));
  ipfInput.value = String(ipf);
}

function togglePause(): void {
  paused = !paused;
  pauseButton.textContent = paused ? "Resume" : "Pause";
}

function reset(): void {
  vm.reset();
  vm.loadRom(rom);
  paused = false;
  pauseButton.textContent = "Pause";
}

document.addEventListener("keydown", (event) => {
  if (event.target === ipfInput) return;
  ensureAudio();
  const key = KEY_CODES[event.code];
  if (key !== undefined) {
    vm.setKey(key, true);
    event.preventDefault();
    return;
  }
  if (event.repeat) return;
  switch (event.code) {
    case "KeyP":
      togglePause();
      break;
    case "Backspace":
      reset();
      event.preventDefault();
      break;
    case "Equal":
    case "NumpadAdd":
      setIpf(ipf + (ipf < 20 ? 1 : 5));
      break;
    case "Minus":
    case "NumpadSubtract":
      setIpf(ipf - (ipf <= 20 ? 1 : 5));
      break;
    case "KeyM":
      muteInput.checked = !muteInput.checked;
      break;
    default:
      break;
  }
});

document.addEventListener("keyup", (event) => {
  const key = KEY_CODES[event.code];
  if (key !== undefined) {
    vm.setKey(key, false);
    event.preventDefault();
  }
});

window.addEventListener("blur", () => {
  for (let key = 0; key < KEY_COUNT; key++) vm.setKey(key, false);
});

for (const [key, label] of KEYPAD_LAYOUT) {
  const button = document.createElement("button");
  button.type = "button";
  button.innerHTML = `${key.toString(16).toUpperCase()}<small>${label}</small>`;
  const press = (event: PointerEvent): void => {
    ensureAudio();
    vm.setKey(key, true);
    button.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const release = (): void => vm.setKey(key, false);
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  keypad.appendChild(button);
}

romSelect.addEventListener("change", () => {
  const option = romSelect.selectedOptions[0];
  if (option !== undefined) void loadFromUrl(option.value, option.textContent ?? option.value);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file !== undefined) void loadFile(file);
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) void loadFile(file);
});
quirksSelect.addEventListener("change", () => {
  vm.quirks = selectedQuirks();
});
wrapInput.addEventListener("change", () => {
  vm.quirks = selectedQuirks();
});
ipfInput.addEventListener("change", () => setIpf(Number(ipfInput.value)));
pauseButton.addEventListener("click", () => {
  ensureAudio();
  togglePause();
});
resetButton.addEventListener("click", () => {
  ensureAudio();
  reset();
});

setIpf(DEFAULT_IPF);
void populateRoms();
requestAnimationFrame(tick);

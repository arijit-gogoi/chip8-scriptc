#!/usr/bin/env bun
/**
 * Checks the native executables against the interpreted program (bun running
 * the same TypeScript):
 *
 * - the emulator prints identical headless output for a set of ROMs;
 * - chip8-tools prints identical listings for every ROM in roms/, the native
 *   assembler turns each native listing back into the original bytes, and
 *   both report the same errors.
 *
 * Usage: bun scripts/verify.ts [--no-build]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const exe = join(root, "dist", `chip8${suffix}`);
const toolsExe = join(root, "dist", `chip8-tools${suffix}`);
const mainSource = join(root, "src", "main.ts");
const toolsSource = join(root, "src", "tools.ts");

const CASES: string[][] = [
  ["roms/tests/1-chip8-logo.ch8", "--headless", "120"],
  ["roms/tests/2-ibm-logo.ch8", "--headless", "120"],
  ["roms/tests/3-corax+.ch8", "--headless", "400"],
  ["roms/tests/4-flags.ch8", "--headless", "400"],
  ["roms/tests/5-quirks.ch8", "--headless", "1500", "--press", "1@30"],
  ["roms/tests/7-beep.ch8", "--headless", "200"],
  ["roms/games/outlaw.ch8", "--headless", "300", "--press", "5@40"],
  ["roms/games/tank.ch8", "--headless", "300", "--press", "8@60+20", "--quirks", "schip"],
  ["roms/games/flightrunner.ch8", "--headless", "240", "--wrap", "--no-wait", "--ipf", "30"],
  ["roms/tests/5-quirks.ch8", "--headless", "1500", "--quirks", "schip", "--ipf", "30", "--press", "2@30", "--press", "1@90"],
  ["roms/tests/5-quirks.ch8", "--headless", "1500", "--quirks", "schip-legacy", "--ipf", "30", "--press", "2@30", "--press", "2@90"],
  ["roms/tests/8-scrolling.ch8", "--headless", "400", "--quirks", "schip", "--ipf", "30", "--press", "1@30", "--press", "1@90", "--press", "1@150"],
  ["roms/tests/8-scrolling.ch8", "--headless", "400", "--quirks", "schip-legacy", "--ipf", "30", "--press", "1@30", "--press", "1@90", "--press", "2@150"],
  ["roms/tests/8-scrolling.ch8", "--headless", "400", "--quirks", "schip", "--ipf", "30", "--press", "1@30", "--press", "2@90"],
  ["roms/schip/octogon.ch8", "--headless", "400", "--quirks", "schip", "--ipf", "200", "--press", "6@100+10", "--press", "7@250+60"],
  ["roms/schip/squad.ch8", "--headless", "300", "--quirks", "schip", "--ipf", "500"],
  ["roms/schip/applejak.ch8", "--headless", "300", "--quirks", "schip", "--ipf", "100"],
  ["roms/schip/squad.ch8", "--headless", "10"],
  ["missing.ch8", "--headless", "1"],
  ["roms/games/outlaw.ch8", "--ipf", "0"],
];

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) return `spawn error: ${result.error.message}\n`;
  return `exit ${result.status}\n${result.stdout.replace(/\r\n/g, "\n")}`;
}

let checks = 0;
let failures = 0;

function report(label: string, ok: boolean, detail: string): void {
  checks++;
  console.log(`${ok ? "ok  " : "DIFF"} ${label}`);
  if (!ok) {
    failures++;
    console.log(detail);
  }
}

/** Run the same arguments through a native executable and through bun; outputs must match. */
function compare(label: string, native: string, source: string, args: string[]): void {
  const fromNative = capture(native, args);
  const fromBun = capture("bun", [source, ...args]);
  report(label, fromNative === fromBun, `--- native ---\n${fromNative}--- bun ---\n${fromBun}`);
}

if (!process.argv.includes("--no-build")) {
  const build = spawnSync("bun", [join(root, "scripts", "build.ts")], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(1);
}
for (const path of [exe, toolsExe]) {
  if (!existsSync(path)) {
    console.error(`verify: ${path} not found`);
    process.exit(1);
  }
}

for (const args of CASES) compare(args.join(" "), exe, mainSource, args);

const work = mkdtempSync(join(tmpdir(), "chip8-verify-"));
for (const group of ["tests", "games", "schip"]) {
  for (const name of readdirSync(join(root, "roms", group)).filter((entry) => entry.endsWith(".ch8")).sort()) {
    const rom = `roms/${group}/${name}`;
    compare(`dis ${rom}`, toolsExe, toolsSource, ["dis", rom]);
    const listing = join(work, `${group}-${name}.s`);
    const rebuilt = join(work, `${group}-${name}`);
    const steps = capture(toolsExe, ["dis", rom, "-o", listing]) + capture(toolsExe, ["asm", listing, "-o", rebuilt]);
    const same = existsSync(rebuilt) && Buffer.compare(readFileSync(rebuilt), readFileSync(join(root, rom))) === 0;
    report(`asm of the native listing rebuilds ${rom}`, same, steps);
  }
}

const errors = join(work, "errors.s");
writeFileSync(errors, "    FOO V1\n    LD V1, 0x100\n    JP nowhere\nloop: CLS\nloop: CLS\n");
const oversized = join(work, "oversized.ch8");
writeFileSync(oversized, new Uint8Array(4000));
const toolErrors: [string, string[]][] = [
  ["asm errors.s", ["asm", errors]],
  ["dis oversized.ch8", ["dis", oversized]],
  ["dis missing.ch8", ["dis", "missing.ch8"]],
  ["run x", ["run", "x"]],
  ["(no arguments)", []],
];
for (const [label, args] of toolErrors) compare(`chip8-tools ${label}`, toolsExe, toolsSource, args);
rmSync(work, { recursive: true, force: true });

console.log(failures === 0 ? `all ${checks} checks passed` : `${failures} of ${checks} checks failed`);
process.exit(failures === 0 ? 0 : 1);

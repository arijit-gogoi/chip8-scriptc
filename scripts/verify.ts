#!/usr/bin/env bun
/**
 * Checks that the native executable and the interpreted program (bun running
 * src/main.ts) print identical headless output for a set of ROMs.
 *
 * Usage: bun scripts/verify.ts [--no-build]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const exe = join(root, "dist", process.platform === "win32" ? "chip8.exe" : "chip8");

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
  ["missing.ch8", "--headless", "1"],
  ["roms/games/outlaw.ch8", "--ipf", "0"],
];

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) return `spawn error: ${result.error.message}\n`;
  return `exit ${result.status}\n${result.stdout.replace(/\r\n/g, "\n")}`;
}

if (!process.argv.includes("--no-build")) {
  const build = spawnSync("bun", [join(root, "scripts", "build.ts")], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(1);
}
if (!existsSync(exe)) {
  console.error(`verify: ${exe} not found`);
  process.exit(1);
}

let failures = 0;
for (const args of CASES) {
  const native = capture(exe, args);
  const interpreted = capture("bun", [join(root, "src", "main.ts"), ...args]);
  const same = native === interpreted;
  console.log(`${same ? "ok  " : "DIFF"} ${args.join(" ")}`);
  if (!same) {
    failures++;
    console.log("--- native ---\n" + native + "--- bun ---\n" + interpreted);
  }
}
console.log(failures === 0 ? `all ${CASES.length} cases identical` : `${failures} of ${CASES.length} cases differ`);
process.exit(failures === 0 ? 0 : 1);

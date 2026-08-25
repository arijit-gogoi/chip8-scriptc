#!/usr/bin/env bun
/**
 * Build pipeline. One C toolchain (zig cc) compiles everything: the vendored
 * raylib sources, the FFI shim, and scriptc's own runtime.
 *
 *   1. native/vendor/raylib-<ver>/src  --zig cc-->  native/build/libraylib.a   (cached)
 *   2. native/c8rl.c                   --zig cc-->  native/build/c8rl.o
 *   3. native/ffi.base.json + libraries + system libraries  -->  native/build/ffi.json
 *   4. SCRIPTC_CC=zigcc scriptc build src/main.ts --ffi native/build/ffi.json -o dist/chip8[.exe]
 *      (scriptc from node_modules, run by bun on Windows and by node elsewhere)
 *
 * Usage: bun scripts/build.ts [--clean] [--run <rom> [emulator args...]]
 *
 * Environment:
 *   SCRIPTC   command line used to start scriptc instead of the default,
 *             for example SCRIPTC="node node_modules/scriptc/dist/bootstrap.js"
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const RAYLIB_VERSION = "6.0";
const RAYLIB_SOURCES = ["rcore.c", "rshapes.c", "rtextures.c", "rtext.c", "rmodels.c", "raudio.c", "rglfw.c"];

const root = resolve(import.meta.dir, "..");
const buildDir = join(root, "native", "build");
const distDir = join(root, "dist");
const raylibDir = join(root, "native", "vendor", `raylib-${RAYLIB_VERSION}`);
const raylibSrc = join(raylibDir, "src");
const platform = process.platform;
const exeName = platform === "win32" ? "chip8.exe" : "chip8";

const argv = process.argv.slice(2);
const runIndex = argv.indexOf("--run");
const runArgs = runIndex >= 0 ? argv.slice(runIndex + 1) : null;
const clean = argv.includes("--clean");

function fail(message: string): never {
  console.error(`build: ${message}`);
  process.exit(1);
}

function run(label: string, command: string, args: string[], env?: Record<string, string>): void {
  console.log(`[${label}] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: root,
    env: env === undefined ? process.env : { ...process.env, ...env },
  });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status}`);
}

async function runMany(label: string, commands: string[][]): Promise<void> {
  const procs = commands.map((command) => {
    console.log(`[${label}] ${command.join(" ")}`);
    return Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
  });
  const codes = await Promise.all(procs.map((proc) => proc.exited));
  const failed = codes.findIndex((code) => code !== 0);
  if (failed >= 0) fail(`${label}: ${commands[failed].join(" ")} exited with ${codes[failed]}`);
}

function requireZig(): void {
  const result = spawnSync("zig", ["version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    fail("zig not found on PATH (scoop install zig / brew install zig / https://ziglang.org/download)");
  }
  console.log(`[toolchain] zig ${result.stdout.trim()} (zig cc, native target)`);
}

/** Sparse-clone raylib's src directory at the pinned tag (needs git; ~15 MB). */
function fetchRaylib(): void {
  const tmp = join(tmpdir(), `raylib-${RAYLIB_VERSION}-sparse`);
  rmSync(tmp, { recursive: true, force: true });
  run("git", "git", ["clone", "--quiet", "--depth", "1", "--branch", RAYLIB_VERSION, "--filter=blob:none", "--sparse", "https://github.com/raysan5/raylib.git", tmp]);
  run("git", "git", ["-C", tmp, "sparse-checkout", "set", "src"]);
  mkdirSync(raylibDir, { recursive: true });
  cpSync(join(tmp, "src"), raylibSrc, { recursive: true });
  copyFileSync(join(tmp, "LICENSE"), join(raylibDir, "LICENSE"));
  rmSync(tmp, { recursive: true, force: true });
}

async function buildRaylib(): Promise<string> {
  const archive = join(buildDir, "libraylib.a");
  if (existsSync(archive)) {
    console.log(`[raylib] cached ${archive} (use --clean to rebuild)`);
    return archive;
  }
  if (!existsSync(join(raylibSrc, "raylib.h"))) {
    console.log(`[raylib] ${raylibSrc} missing; fetching raylib ${RAYLIB_VERSION}`);
    fetchRaylib();
  }
  const objectDir = join(buildDir, "raylib");
  mkdirSync(objectDir, { recursive: true });
  // Flags follow raylib's own Makefile for PLATFORM_DESKTOP_GLFW. Third-party
  // code: warnings off. rglfw.c picks the window system from the target on
  // Windows and macOS; Linux must choose, and X11 is the one that needs no
  // generated protocol sources.
  const flags = [
    "-c", "-O2", "-std=gnu99", "-w",
    "-D_GNU_SOURCE", "-DPLATFORM_DESKTOP_GLFW", "-DGRAPHICS_API_OPENGL_33",
    "-fno-strict-aliasing",
    ...(platform === "linux" ? ["-D_GLFW_X11"] : []),
    `-I${raylibSrc}`, `-I${join(raylibSrc, "external", "glfw", "include")}`,
  ];
  const objects = RAYLIB_SOURCES.map((source) => join(objectDir, basename(source, ".c") + ".o"));
  await runMany("raylib", RAYLIB_SOURCES.map((source, k) => ["zig", "cc", ...flags, join(raylibSrc, source), "-o", objects[k]]));
  run("raylib", "zig", ["ar", "rcs", archive, ...objects]);
  return archive;
}

function buildShim(): string {
  const object = join(buildDir, "c8rl.o");
  run("shim", "zig", ["cc", "-c", "-O2", "-std=c11", "-Wall", "-Wextra", `-I${raylibSrc}`, join(root, "native", "c8rl.c"), "-o", object]);
  return object;
}

function systemLibraries(): string[] {
  switch (platform) {
    case "win32":
      return ["opengl32", "gdi32", "winmm"];
    case "linux":
      return ["m", "pthread", "dl", "rt", "GL", "X11"];
    default:
      return fail(`${platform}: raylib needs frameworks that scriptc's FFI manifest cannot express`);
  }
}

function writeManifest(): string {
  const base = JSON.parse(readFileSync(join(root, "native", "ffi.base.json"), "utf8")) as Record<string, unknown>;
  const manifest = {
    ...base,
    libraries: ["./c8rl.o", "./libraylib.a"],
    system_libraries: systemLibraries(),
  };
  const manifestPath = join(buildDir, "ffi.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifestPath;
}

/**
 * How to start the scriptc compiler. bun runs it on Windows; on other
 * platforms bun's child_process lacks the pipe handle that TypeScript 7's
 * native compiler channel reads, so node (24+) is used when available.
 * SCRIPTC="<command> [args]" overrides the choice.
 */
function scriptcCommand(): string[] {
  const override = process.env.SCRIPTC;
  if (override !== undefined && override.trim() !== "") return override.trim().split(/\s+/);
  const bootstrap = join(root, "node_modules", "scriptc", "dist", "bootstrap.js");
  if (!existsSync(bootstrap)) fail("scriptc not installed: run bun install");
  if (platform !== "win32" && spawnSync("node", ["--version"]).status === 0) return ["node", bootstrap];
  return ["bun", bootstrap];
}

function buildExecutable(manifestPath: string): string {
  mkdirSync(distDir, { recursive: true });
  const output = join(distDir, exeName);
  const command = scriptcCommand();
  run("scriptc", command[0], [...command.slice(1), "build", join(root, "src", "main.ts"), "--ffi", manifestPath, "-o", output], {
    SCRIPTC_CC: "zigcc",
  });
  return output;
}

if (clean) rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
requireZig();
await buildRaylib();
buildShim();
const output = buildExecutable(writeManifest());
console.log(`[done] ${output}`);

if (runArgs !== null) {
  if (runArgs.length === 0) fail("--run needs a ROM path");
  const result = spawnSync(output, runArgs, { stdio: "inherit", cwd: root });
  process.exit(result.status ?? 1);
}

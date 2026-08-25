#!/usr/bin/env bun
/**
 * Browser build: bundles src/web.ts, copies web/index.html and every ROM in
 * roms/, and writes a roms.json manifest, all into dist/web/.
 *
 * Usage: bun scripts/build-web.ts [--serve [port]]
 */
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outDir = join(root, "dist", "web");
const argv = process.argv.slice(2);
const serveIndex = argv.indexOf("--serve");
const port = serveIndex >= 0 && argv.length > serveIndex + 1 ? Number(argv[serveIndex + 1]) : 8080;

interface RomEntry {
  group: string;
  name: string;
  path: string;
  size: number;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "src", "web.ts")],
  outdir: outDir,
  target: "browser",
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}

cpSync(join(root, "web", "index.html"), join(outDir, "index.html"));

const manifest: RomEntry[] = [];
for (const group of ["tests", "games"]) {
  const source = join(root, "roms", group);
  const target = join(outDir, "roms", group);
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source).filter((entry) => entry.endsWith(".ch8")).sort()) {
    cpSync(join(source, name), join(target, name));
    manifest.push({ group, name, path: `roms/${group}/${name}`, size: statSync(join(source, name)).size });
  }
}
writeFileSync(join(outDir, "roms.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`[web] ${outDir}: web.js, index.html, roms.json, ${manifest.length} ROMs`);

if (serveIndex >= 0) {
  Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const path = normalize(join(outDir, requested));
      if (!path.startsWith(outDir)) return new Response("forbidden", { status: 403 });
      const file = Bun.file(path);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file);
    },
  });
  console.log(`[web] serving http://localhost:${port}/ (Ctrl+C to stop)`);
}

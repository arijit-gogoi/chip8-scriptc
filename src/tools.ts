/**
 * chip8-tools: the assembler and the disassembler as one command-line
 * program. It uses no FFI; scripts/build.ts compiles it to
 * dist/chip8-tools[.exe], and bun runs it as `bun src/tools.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { assemble } from "./asm";
import { disassemble } from "./disasm";
import { baseName } from "./paths";
import { TOOLS_USAGE, parseToolArgs, withExtension } from "./tools-cli";

function runAssembler(input: string, output: string): number {
  let source: string;
  try {
    source = readFileSync(input, "utf8");
  } catch {
    console.log(`cannot read ${input}`);
    return 1;
  }
  const result = assemble(source);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.log(`${input}: ${error}`);
    return 1;
  }
  const target = output !== "" ? output : withExtension(input, ".ch8");
  try {
    writeFileSync(target, result.bytes);
  } catch {
    console.log(`cannot write ${target}`);
    return 1;
  }
  console.log(`${target}: ${result.bytes.length} bytes`);
  return 0;
}

function runDisassembler(input: string, output: string): number {
  let rom: Uint8Array;
  try {
    rom = readFileSync(input);
  } catch {
    console.log(`cannot read ${input}`);
    return 1;
  }
  let listing: string;
  try {
    listing = disassemble(rom, baseName(input));
  } catch (err) {
    console.log(`cannot disassemble ${input}: ${err instanceof Error ? err.message : "invalid ROM"}`);
    return 1;
  }
  if (output === "") {
    process.stdout.write(listing);
    return 0;
  }
  try {
    writeFileSync(output, listing);
  } catch {
    console.log(`cannot write ${output}`);
    return 1;
  }
  console.log(`${output}: ${rom.length} bytes disassembled`);
  return 0;
}

function main(): void {
  const parsed = parseToolArgs(process.argv.slice(2));
  if (parsed.command === "") {
    if (parsed.error !== "") console.log(parsed.error);
    console.log(TOOLS_USAGE);
    process.exit(parsed.error === "" ? 0 : 2);
  }
  const code = parsed.command === "asm" ? runAssembler(parsed.input, parsed.output) : runDisassembler(parsed.input, parsed.output);
  process.exit(code);
}

main();

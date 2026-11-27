/**
 * Disassembler. ROMs mix code with sprites and other data, so it does not
 * decode the bytes in order: it follows the program's control flow from 0x200
 * (jumps, calls, both outcomes of a skip) and lists only the bytes it reached
 * as instructions. Everything else is listed as data, one byte per line with
 * the byte drawn as a sprite row. The listing is valid input for the
 * assembler (src/asm.ts), which turns it back into the same bytes.
 */
import { decode, formatInstruction, hexDigits, type Instruction } from "./opcodes";

const PROGRAM_START = 0x200;
const MEMORY_SIZE = 4096;
/** The trailing comment starts at this column. */
const COMMENT_COLUMN = 32;

/** How an address is referenced; a stronger reference picks the label's name. */
const REF_NONE = 0;
const REF_DATA = 1;
const REF_CODE = 2;
const REF_CALL = 3;

/** Largest ROM that fits between 0x200 and the end of memory. */
export const MAX_ROM_SIZE = MEMORY_SIZE - PROGRAM_START;

/** Control flow after one instruction. */
function successors(instruction: Instruction, word: number, address: number): number[] {
  const target = word & 0xfff;
  switch (instruction.mnemonic) {
    case "RET":
    case "EXIT":
    case "SYS":
      return [];
    case "JP":
      // JP V0, addr jumps to a computed address, which cannot be followed.
      return instruction.operands.length === 1 ? [target] : [];
    case "CALL":
      return [target, address + 2];
    case "SE":
    case "SNE":
    case "SKP":
    case "SKNP":
      return [address + 2, address + 4];
    default:
      return [address + 2];
  }
}

/** The reference an instruction makes to its address operand, if any. */
function referenceKind(instruction: Instruction): number {
  switch (instruction.mnemonic) {
    case "CALL":
      return REF_CALL;
    case "JP":
      return REF_CODE;
    default:
      return instruction.mnemonic === "LD" && instruction.operands[0] === "i" ? REF_DATA : REF_NONE;
  }
}

function labelName(kind: number, address: number): string {
  const prefix = kind === REF_CALL ? "sub" : kind === REF_CODE ? "label" : "data";
  return `${prefix}_${hexDigits(address, 3)}`;
}

/** A byte as a sprite row: '#' for set bits, '.' for clear ones. */
function spriteRow(byte: number): string {
  let row = "";
  for (let bit = 7; bit >= 0; bit--) row += (byte >> bit) & 1 ? "#" : ".";
  return row;
}

function withComment(code: string, comment: string): string {
  return `${`    ${code}`.padEnd(COMMENT_COLUMN - 1)} ; ${comment}`;
}

/**
 * Disassemble a ROM loaded at 0x200. `name` appears in the header comment.
 * Throws when the ROM does not fit in memory.
 */
export function disassemble(rom: Uint8Array, name: string): string {
  if (rom.length > MAX_ROM_SIZE) {
    throw new Error(`ROM is ${rom.length} bytes; at most ${MAX_ROM_SIZE} fit`);
  }
  const end = PROGRAM_START + rom.length;
  const word = (address: number): number => (rom[address - PROGRAM_START] << 8) | rom[address - PROGRAM_START + 1];

  // Trace the code. An address becomes an instruction only when both of its
  // bytes are inside the ROM, are not part of another instruction, and form
  // a valid word.
  const starts = new Uint8Array(MEMORY_SIZE);
  const covered = new Uint8Array(MEMORY_SIZE);
  const references = new Uint8Array(MEMORY_SIZE);
  let superChip = false;
  const pending: number[] = [PROGRAM_START];
  while (pending.length > 0) {
    const address = pending.pop() ?? PROGRAM_START;
    if (address < PROGRAM_START || address + 2 > end) continue;
    if (starts[address] !== 0 || covered[address] !== 0 || covered[address + 1] !== 0) continue;
    const value = word(address);
    const instruction = decode(value);
    if (instruction === null) continue;
    starts[address] = 1;
    covered[address] = 1;
    covered[address + 1] = 1;
    if (instruction.superChip) superChip = true;
    const kind = referenceKind(instruction);
    const target = value & 0xfff;
    if (kind > references[target]) references[target] = kind;
    for (const next of successors(instruction, value, address)) pending.push(next);
  }

  // Labels go only where a line starts: on an instruction, or on a data byte.
  const labels = new Map<number, string>();
  for (let address = PROGRAM_START; address < end; address++) {
    const lineStart = starts[address] !== 0 || covered[address] === 0;
    if (references[address] !== REF_NONE && lineStart) labels.set(address, labelName(references[address], address));
  }

  const lines: string[] = [
    `; ${name}: ${rom.length} bytes`,
    "; Code reached from 0x200 is listed as instructions, every other byte as data.",
  ];
  if (superChip) lines.push("; The program uses SUPER-CHIP instructions.");
  lines.push("");
  let address = PROGRAM_START;
  while (address < end) {
    const label = labels.get(address);
    if (label !== undefined) lines.push(`${label}:`);
    const location = hexDigits(address, 3);
    if (starts[address] !== 0) {
      const value = word(address);
      const instruction = decode(value);
      if (instruction !== null) {
        let comment = `${location}: ${hexDigits(value, 4)}`;
        if (instruction.mnemonic === "JP" && instruction.operands.length === 2) comment += " (computed jump, not followed)";
        lines.push(withComment(formatInstruction(instruction, value, labels), comment));
      }
      address += 2;
    } else {
      const byte = rom[address - PROGRAM_START];
      lines.push(withComment(`db   0x${hexDigits(byte, 2)}`, `${location}: ${spriteRow(byte)}`));
      address += 1;
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * The CHIP-8 and SUPER-CHIP instruction set as one table, shared by the
 * assembler (src/asm.ts) and the disassembler (src/disasm.ts). Mnemonics
 * follow Cowgod's Chip-8 Technical Reference, including its SUPER-CHIP
 * section.
 *
 * Each operand has a kind. "vx", "vy", "addr", "byte" and "nibble" are fields
 * of the 16-bit word; the other kinds are fixed words such as "I" or "DT"
 * that only select the form of the instruction.
 */

export interface Instruction {
  mnemonic: string;
  /** Operand kinds, in source order. */
  operands: string[];
  /** The word with every operand field zero. */
  opcode: number;
  /** Bits that are not operand fields; a word is this instruction when (word & mask) === opcode. */
  mask: number;
  superChip: boolean;
}

/** Operand kinds that are fields of the word, with the bits each one occupies. */
const FIELDS = new Map<string, number>([
  ["vx", 0x0f00],
  ["vy", 0x00f0],
  ["addr", 0x0fff],
  ["byte", 0x00ff],
  ["nibble", 0x000f],
]);

/** How each operand kind is written in source; fields show their kind. */
const SYNTAX = new Map<string, string>([
  ["vx", "Vx"], ["vy", "Vy"], ["addr", "addr"], ["byte", "byte"], ["nibble", "nibble"],
  ["v0", "V0"], ["i", "I"], ["[i]", "[I]"], ["dt", "DT"], ["st", "ST"], ["k", "K"], ["f", "F"], ["hf", "HF"], ["b", "B"], ["r", "R"],
]);

function entry(mnemonic: string, operands: string[], opcode: number, superChip: boolean): Instruction {
  let fields = 0;
  for (const kind of operands) fields |= FIELDS.get(kind) ?? 0;
  return { mnemonic, operands, opcode, mask: 0xffff & ~fields, superChip };
}

function op(mnemonic: string, operands: string[], opcode: number): Instruction {
  return entry(mnemonic, operands, opcode, false);
}

function schip(mnemonic: string, operands: string[], opcode: number): Instruction {
  return entry(mnemonic, operands, opcode, true);
}

/**
 * Every instruction. Decoding takes the first entry that matches, so the
 * fixed 00xx words come before SYS, which matches any 0NNN.
 */
export const INSTRUCTIONS: Instruction[] = [
  op("CLS", [], 0x00e0),
  op("RET", [], 0x00ee),
  schip("SCD", ["nibble"], 0x00c0),
  schip("SCR", [], 0x00fb),
  schip("SCL", [], 0x00fc),
  schip("EXIT", [], 0x00fd),
  schip("LOW", [], 0x00fe),
  schip("HIGH", [], 0x00ff),
  op("SYS", ["addr"], 0x0000),
  op("JP", ["addr"], 0x1000),
  op("CALL", ["addr"], 0x2000),
  op("SE", ["vx", "byte"], 0x3000),
  op("SNE", ["vx", "byte"], 0x4000),
  op("SE", ["vx", "vy"], 0x5000),
  op("LD", ["vx", "byte"], 0x6000),
  op("ADD", ["vx", "byte"], 0x7000),
  op("LD", ["vx", "vy"], 0x8000),
  op("OR", ["vx", "vy"], 0x8001),
  op("AND", ["vx", "vy"], 0x8002),
  op("XOR", ["vx", "vy"], 0x8003),
  op("ADD", ["vx", "vy"], 0x8004),
  op("SUB", ["vx", "vy"], 0x8005),
  op("SHR", ["vx", "vy"], 0x8006),
  op("SUBN", ["vx", "vy"], 0x8007),
  op("SHL", ["vx", "vy"], 0x800e),
  op("SNE", ["vx", "vy"], 0x9000),
  op("LD", ["i", "addr"], 0xa000),
  op("JP", ["v0", "addr"], 0xb000),
  op("RND", ["vx", "byte"], 0xc000),
  op("DRW", ["vx", "vy", "nibble"], 0xd000),
  op("SKP", ["vx"], 0xe09e),
  op("SKNP", ["vx"], 0xe0a1),
  op("LD", ["vx", "dt"], 0xf007),
  op("LD", ["vx", "k"], 0xf00a),
  op("LD", ["dt", "vx"], 0xf015),
  op("LD", ["st", "vx"], 0xf018),
  op("ADD", ["i", "vx"], 0xf01e),
  op("LD", ["f", "vx"], 0xf029),
  schip("LD", ["hf", "vx"], 0xf030),
  op("LD", ["b", "vx"], 0xf033),
  op("LD", ["[i]", "vx"], 0xf055),
  op("LD", ["vx", "[i]"], 0xf065),
  schip("LD", ["r", "vx"], 0xf075),
  schip("LD", ["vx", "r"], 0xf085),
];

/** The instruction a 16-bit word encodes, or null when it encodes none. */
export function decode(word: number): Instruction | null {
  for (const instruction of INSTRUCTIONS) {
    if ((word & instruction.mask) === instruction.opcode) return instruction;
  }
  return null;
}

/** True when the operand kind is a field of the word rather than a fixed word. */
export function isField(kind: string): boolean {
  return FIELDS.has(kind);
}

/** Source spelling of an operand kind: "Vx", "addr", "[I]", ... */
export function operandSyntax(kind: string): string {
  return SYNTAX.get(kind) ?? kind;
}

/** An instruction's form in source, such as "LD Vx, byte". */
export function formSyntax(instruction: Instruction): string {
  const operands = instruction.operands.map(operandSyntax).join(", ");
  return operands === "" ? instruction.mnemonic : `${instruction.mnemonic} ${operands}`;
}

/** The value of one field operand in a word. */
export function fieldValue(word: number, kind: string): number {
  switch (kind) {
    case "vx":
      return (word >> 8) & 0xf;
    case "vy":
      return (word >> 4) & 0xf;
    case "addr":
      return word & 0xfff;
    case "byte":
      return word & 0xff;
    case "nibble":
      return word & 0xf;
    default:
      return 0;
  }
}

/** The word for an instruction with the given field values, one per operand (ignored for fixed words). */
export function encode(instruction: Instruction, values: number[]): number {
  let word = instruction.opcode;
  for (let k = 0; k < instruction.operands.length && k < values.length; k++) {
    const value = values[k];
    switch (instruction.operands[k]) {
      case "vx":
        word |= (value & 0xf) << 8;
        break;
      case "vy":
        word |= (value & 0xf) << 4;
        break;
      case "addr":
        word |= value & 0xfff;
        break;
      case "byte":
        word |= value & 0xff;
        break;
      case "nibble":
        word |= value & 0xf;
        break;
      default:
        break;
    }
  }
  return word;
}

/** Upper-case hexadecimal digits without a prefix, padded to `width`. */
export function hexDigits(value: number, width: number): string {
  return (Math.floor(value) >>> 0).toString(16).toUpperCase().padStart(width, "0");
}

/**
 * The operands of a word as source text. Addresses that have a name in
 * `labels` are written as that name.
 */
export function formatOperands(instruction: Instruction, word: number, labels: Map<number, string>): string {
  const parts: string[] = [];
  for (const kind of instruction.operands) {
    const value = fieldValue(word, kind);
    switch (kind) {
      case "vx":
      case "vy":
        parts.push(`V${hexDigits(value, 1)}`);
        break;
      case "addr":
        parts.push(labels.get(value) ?? `0x${hexDigits(value, 3)}`);
        break;
      case "byte":
        parts.push(`0x${hexDigits(value, 2)}`);
        break;
      case "nibble":
        parts.push(String(value));
        break;
      default:
        parts.push(operandSyntax(kind));
        break;
    }
  }
  return parts.join(", ");
}

/** A word as one line of source, such as "LD I, 0x2F0". */
export function formatInstruction(instruction: Instruction, word: number, labels: Map<number, string>): string {
  const operands = formatOperands(instruction, word, labels);
  return operands === "" ? instruction.mnemonic : `${instruction.mnemonic.padEnd(4)} ${operands}`;
}

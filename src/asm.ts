/**
 * Two-pass assembler for CHIP-8 and SUPER-CHIP, using the mnemonics of
 * src/opcodes.ts. The first pass gives every label its address, the second
 * encodes. Programs start at 0x200.
 *
 *   ; comment                 everything after a semicolon
 *   name:                     label: the address of the next byte
 *   NAME = expression         constant
 *   org expression            continue at this address (forward only; the gap is zeros)
 *   db expression, ...        bytes
 *   dw expression, ...        16-bit big-endian words
 *   LD V0, 0x1F               an instruction; mnemonics and registers in any case
 *
 * Numbers are decimal, hexadecimal (0x1F) or binary (0b11110000). An
 * expression adds and subtracts numbers, labels and constants: sprite + 5.
 * `SHR Vx` and `SHL Vx` without Vy assemble as `SHR Vx, Vx`, which shifts
 * Vx under every quirk profile.
 */
import { INSTRUCTIONS, encode, formSyntax, isField, type Instruction } from "./opcodes";

const PROGRAM_START = 0x200;
const MEMORY_SIZE = 4096;

/** Fixed operand words, by their upper-case spelling. */
const KEYWORDS: Record<string, string> = { I: "i", "[I]": "[i]", DT: "dt", ST: "st", K: "k", F: "f", HF: "hf", B: "b", R: "r" };

export interface AssemblyResult {
  /** The ROM: the bytes from 0x200 up to the last one written. Empty when there are errors. */
  bytes: Uint8Array;
  /** "line N: message", in line order. */
  errors: string[];
}

interface Problem {
  line: number;
  message: string;
}

/** One statement that produces bytes, kept from the first pass for the second. */
interface Statement {
  line: number;
  address: number;
  /** Upper-case mnemonic, or DB / DW. */
  name: string;
  operands: string[];
}

interface Value {
  value: number;
  /** Empty when the expression evaluated. */
  error: string;
}

function isIdentifierStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isIdentifierPart(code: number): boolean {
  return isIdentifierStart(code) || (code >= 48 && code <= 57) || code === 46;
}

function isIdentifier(text: string): boolean {
  if (text.length === 0 || !isIdentifierStart(text.charCodeAt(0))) return false;
  for (let k = 1; k < text.length; k++) {
    if (!isIdentifierPart(text.charCodeAt(k))) return false;
  }
  return true;
}

/** Register number for "V0".."VF" in any case, or -1. */
function registerNumber(text: string): number {
  if (text.length !== 2 || (text.charCodeAt(0) !== 86 && text.charCodeAt(0) !== 118)) return -1;
  return digitValue(text.charCodeAt(1), 16);
}

/** Value of one digit in the given base, or -1. */
function digitValue(code: number, base: number): number {
  let digit = -1;
  if (code >= 48 && code <= 57) digit = code - 48;
  else if (code >= 65 && code <= 70) digit = code - 55;
  else if (code >= 97 && code <= 102) digit = code - 87;
  return digit < base ? digit : -1;
}

/** A number literal (decimal, 0x hexadecimal, 0b binary), or -1. */
function parseNumber(text: string): number {
  let base = 10;
  let start = 0;
  if (text.length > 2 && text.charCodeAt(0) === 48) {
    const marker = text.charCodeAt(1);
    if (marker === 120 || marker === 88) base = 16;
    else if (marker === 98 || marker === 66) base = 2;
    if (base !== 10) start = 2;
  }
  if (start >= text.length) return -1;
  let value = 0;
  for (let k = start; k < text.length; k++) {
    const digit = digitValue(text.charCodeAt(k), base);
    if (digit < 0) return -1;
    value = value * base + digit;
  }
  return value;
}

/** True for names that operands use for registers and fixed words, so labels cannot take them. */
function isReserved(name: string): boolean {
  return registerNumber(name) >= 0 || KEYWORDS[name.toUpperCase()] !== undefined;
}

class Assembler {
  private readonly symbols = new Map<string, number>();
  private readonly problems: Problem[] = [];
  private readonly statements: Statement[] = [];
  private readonly image = new Uint8Array(MEMORY_SIZE);
  private address = PROGRAM_START;
  private end = PROGRAM_START;

  run(source: string): AssemblyResult {
    const lines = source.split("\n");
    for (let k = 0; k < lines.length; k++) this.firstPass(k + 1, lines[k]);
    for (const statement of this.statements) this.secondPass(statement);
    if (this.problems.length > 0) {
      const sorted = this.problems.slice().sort((a, b) => a.line - b.line);
      return { bytes: new Uint8Array(0), errors: sorted.map((p) => `line ${p.line}: ${p.message}`) };
    }
    return { bytes: this.image.slice(PROGRAM_START, this.end), errors: [] };
  }

  private problem(line: number, message: string): void {
    this.problems.push({ line, message });
  }

  /** Define a label or constant; false after reporting a clash. */
  private define(line: number, name: string, value: number): boolean {
    if (isReserved(name)) {
      this.problem(line, `${name} is a register or operand name and cannot be a label`);
      return false;
    }
    if (this.symbols.has(name)) {
      this.problem(line, `${name} is already defined`);
      return false;
    }
    this.symbols.set(name, value);
    return true;
  }

  /** Evaluate terms joined by + and -, with an optional leading sign; numbers, labels and constants. */
  private evaluate(text: string): Value {
    const expression = text.trim();
    if (expression === "") return { value: 0, error: "missing value" };
    const bad: Value = { value: 0, error: `bad expression ${expression}` };
    let total = 0;
    let sign = 1;
    let k = 0;
    let expectTerm = true;
    let leading = true;
    while (k < expression.length) {
      const code = expression.charCodeAt(k);
      if (code === 32 || code === 9) {
        k++;
        continue;
      }
      if (code === 43 || code === 45) {
        // Either the sign before the first term or an operator after a term.
        if (expectTerm && !leading) return bad;
        sign = code === 45 ? -1 : 1;
        expectTerm = true;
        leading = false;
        k++;
        continue;
      }
      if (!expectTerm) return bad;
      leading = false;
      let stop = k;
      while (stop < expression.length) {
        const c = expression.charCodeAt(stop);
        if (c === 43 || c === 45 || c === 32 || c === 9) break;
        stop++;
      }
      const term = expression.slice(k, stop);
      let value = parseNumber(term);
      if (value < 0) {
        if (!isIdentifier(term)) return { value: 0, error: `bad number or name ${term}` };
        const symbol = this.symbols.get(term);
        if (symbol === undefined) return { value: 0, error: `undefined name ${term}` };
        value = symbol;
      }
      total += sign * value;
      sign = 1;
      expectTerm = false;
      k = stop;
    }
    return expectTerm ? bad : { value: total, error: "" };
  }

  /** Evaluate during the first pass, where only names defined above are known. */
  private evaluateEarly(text: string): Value {
    const result = this.evaluate(text);
    if (result.error.startsWith("undefined")) result.error += " (only names defined above can be used here)";
    return result;
  }

  private firstPass(line: number, raw: string): void {
    let text = raw;
    const comment = text.indexOf(";");
    if (comment >= 0) text = text.slice(0, comment);
    text = text.trim();

    // Labels: "name:" prefixes.
    while (text.length > 0) {
      let k = 0;
      while (k < text.length && isIdentifierPart(text.charCodeAt(k))) k++;
      if (k === 0 || k >= text.length || text.charCodeAt(k) !== 58) break;
      const name = text.slice(0, k);
      if (!isIdentifier(name)) {
        this.problem(line, `bad label ${name}`);
        return;
      }
      this.define(line, name, this.address);
      text = text.slice(k + 1).trim();
    }
    if (text === "") return;

    const space = text.search(/[\s=]/);
    const head = space < 0 ? text : text.slice(0, space);
    const rest = space < 0 ? "" : text.slice(space).trim();

    if (rest.startsWith("=")) {
      if (!isIdentifier(head)) {
        this.problem(line, `bad constant name ${head}`);
        return;
      }
      const result = this.evaluateEarly(rest.slice(1));
      if (result.error !== "") {
        this.problem(line, result.error);
        return;
      }
      this.define(line, head, result.value);
      return;
    }

    const name = head.toUpperCase();
    const operands = rest === "" ? [] : rest.split(",").map((operand) => operand.trim());
    if (name === "ORG") {
      this.org(line, operands);
      return;
    }
    let size = 2;
    if (name === "DB") size = operands.length;
    else if (name === "DW") size = operands.length * 2;
    else if (!INSTRUCTIONS.some((instruction) => instruction.mnemonic === name)) {
      this.problem(line, `unknown instruction ${head}`);
      return;
    }
    if (size === 0) {
      this.problem(line, `${head} needs at least one value`);
      return;
    }
    if (this.address + size > MEMORY_SIZE) {
      this.problem(line, `the program does not fit below 0x1000`);
      return;
    }
    this.statements.push({ line, address: this.address, name, operands });
    this.address += size;
  }

  private org(line: number, operands: string[]): void {
    if (operands.length !== 1) {
      this.problem(line, "org takes one address");
      return;
    }
    const result = this.evaluateEarly(operands[0]);
    if (result.error !== "") {
      this.problem(line, `org: ${result.error}`);
      return;
    }
    if (result.value < this.address || result.value > MEMORY_SIZE) {
      this.problem(line, `org ${operands[0]} is outside 0x${this.address.toString(16).toUpperCase()}-0x1000`);
      return;
    }
    this.address = result.value;
  }

  private secondPass(statement: Statement): void {
    const { line, address, name, operands } = statement;
    if (name === "DB" || name === "DW") {
      const wide = name === "DW";
      for (let k = 0; k < operands.length; k++) {
        const result = this.evaluate(operands[k]);
        if (result.error !== "") {
          this.problem(line, result.error);
          continue;
        }
        const limit = wide ? 0xffff : 0xff;
        if (result.value < -(limit + 1) / 2 || result.value > limit) {
          this.problem(line, `${operands[k]} does not fit in a ${wide ? "word" : "byte"}`);
          continue;
        }
        if (wide) this.writeWord(address + k * 2, result.value);
        else this.writeByte(address + k, result.value);
      }
      return;
    }
    const word = this.encodeInstruction(line, name, operands);
    if (word >= 0) this.writeWord(address, word);
  }

  private writeByte(address: number, value: number): void {
    this.image[address] = value & 0xff;
    if (address + 1 > this.end) this.end = address + 1;
  }

  private writeWord(address: number, value: number): void {
    this.writeByte(address, (value >> 8) & 0xff);
    this.writeByte(address + 1, value & 0xff);
  }

  /** The word for an instruction, or -1 after reporting why there is none. */
  private encodeInstruction(line: number, name: string, given: string[]): number {
    let operands = given;
    if ((name === "SHR" || name === "SHL") && operands.length === 1) operands = [operands[0], operands[0]];
    const forms = INSTRUCTIONS.filter((instruction) => instruction.mnemonic === name);
    for (const form of forms) {
      if (form.operands.length === operands.length && this.matches(form, operands)) {
        return this.encodeForm(line, form, operands);
      }
    }
    const written = `${name}${operands.length > 0 ? " " + operands.join(", ") : ""}`;
    this.problem(line, `${written} matches no form of ${name}: ${forms.map(formSyntax).join(" | ")}`);
    return -1;
  }

  /** Whether the operands have the kinds a form needs (values are checked when encoding). */
  private matches(form: Instruction, operands: string[]): boolean {
    for (let k = 0; k < operands.length; k++) {
      const kind = form.operands[k];
      const text = operands[k];
      const register = registerNumber(text);
      const keyword = KEYWORDS[text.toUpperCase()];
      if (kind === "vx" || kind === "vy") {
        if (register < 0) return false;
      } else if (kind === "v0") {
        if (register !== 0) return false;
      } else if (isField(kind)) {
        if (register >= 0 || keyword !== undefined) return false;
      } else if (keyword !== kind) {
        return false;
      }
    }
    return true;
  }

  private encodeForm(line: number, form: Instruction, operands: string[]): number {
    const values: number[] = [];
    let ok = true;
    for (let k = 0; k < operands.length; k++) {
      const kind = form.operands[k];
      if (kind === "vx" || kind === "vy") {
        values.push(registerNumber(operands[k]));
        continue;
      }
      if (!isField(kind)) {
        values.push(0);
        continue;
      }
      const result = this.evaluate(operands[k]);
      if (result.error !== "") {
        this.problem(line, result.error);
        ok = false;
        values.push(0);
        continue;
      }
      const value = result.value;
      let fits = true;
      if (kind === "addr") fits = value >= 0 && value <= 0xfff;
      else if (kind === "byte") fits = value >= -128 && value <= 0xff;
      else if (kind === "nibble") fits = value >= 0 && value <= 0xf;
      if (!fits) {
        const range = kind === "addr" ? "0-0xFFF" : kind === "byte" ? "-128-255" : "0-15";
        const shown = String(value) === operands[k] ? operands[k] : `${operands[k]} (${value})`;
        this.problem(line, `${shown} is outside the ${kind} range ${range}`);
        ok = false;
      }
      values.push(value);
    }
    return ok ? encode(form, values) : -1;
  }
}

/** Assemble source text into a ROM image that loads at 0x200. */
export function assemble(source: string): AssemblyResult {
  return new Assembler().run(source.replace(/\r/g, ""));
}

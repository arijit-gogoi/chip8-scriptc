import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assemble } from "../src/asm";
import { disassemble } from "../src/disasm";
import { INSTRUCTIONS, decode, formatInstruction } from "../src/opcodes";
import { parseToolArgs, withExtension } from "../src/tools-cli";

const ROM_ROOT = join(import.meta.dir, "..", "roms");

/** 16-bit words as big-endian bytes. */
function words(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  values.forEach((value, k) => {
    out[k * 2] = value >> 8;
    out[k * 2 + 1] = value & 0xff;
  });
  return out;
}

/** Strip the header comment and blank line from a listing. */
function body(listing: string): string {
  return listing
    .split("\n")
    .filter((line) => !line.startsWith(";") && line !== "")
    .join("\n");
}

describe("opcode table", () => {
  test("every word that decodes assembles back to the same word", () => {
    const decodable: number[] = [];
    for (let word = 0; word <= 0xffff; word++) {
      if (decode(word) !== null) decodable.push(word);
    }
    // 1500 instructions at a time fit between 0x200 and 0x1000.
    for (let start = 0; start < decodable.length; start += 1500) {
      const chunk = decodable.slice(start, start + 1500);
      const source = chunk.map((word) => formatInstruction(decode(word)!, word, new Map())).join("\n");
      const result = assemble(source);
      expect(result.errors).toEqual([]);
      expect(result.bytes).toEqual(words(...chunk));
    }
  });

  test("words outside the instruction set decode to nothing", () => {
    for (const word of [0x5001, 0x8008, 0x800f, 0x9001, 0xe000, 0xe09f, 0xf000, 0xf031, 0xf0ff]) {
      expect(decode(word)).toBeNull();
    }
  });

  test("the SUPER-CHIP instructions are marked", () => {
    const marked = INSTRUCTIONS.filter((instruction) => instruction.superChip).map((instruction) => instruction.opcode);
    expect(marked).toEqual([0x00c0, 0x00fb, 0x00fc, 0x00fd, 0x00fe, 0x00ff, 0xf030, 0xf075, 0xf085]);
  });
});

describe("assembler", () => {
  test("labels, constants, expressions, org, db and dw", () => {
    const result = assemble(`; a comment
SPEED = 3
start:  LD V0, SPEED          ; a constant
        LD I, sprite          ; a label defined further down
        DRW V0, V1, sprite.end - sprite
loop:   JP loop
sprite: db 0b11110000, 0x90, 144
sprite.end:
        org 0x210
        dw 0x1234, table
table:  db -1
`);
    expect(result.errors).toEqual([]);
    expect(Array.from(result.bytes)).toEqual([
      0x60, 0x03, 0xa2, 0x08, 0xd0, 0x13, 0x12, 0x06, 0xf0, 0x90, 0x90,
      0, 0, 0, 0, 0,
      0x12, 0x34, 0x02, 0x14, 0xff,
    ]);
  });

  test("mnemonics, registers and fixed words in any case; SHR and SHL without Vy", () => {
    const result = assemble("ld va, 0xff\nshr v3\nSHL V4\nld [i], v2\nLd vB, Dt\nscd 4\nhigh\nld hf, v1");
    expect(result.errors).toEqual([]);
    expect(result.bytes).toEqual(words(0x6aff, 0x8336, 0x844e, 0xf255, 0xfb07, 0x00c4, 0x00ff, 0xf130));
  });

  test("errors name the line and the problem", () => {
    const result = assemble(`    FOO V1
    LD V1, 0x100
    JP nowhere
dup: CLS
dup: CLS
    DRW V0, V1, 16
    LD V0
F:  CLS
    org 0x100
    LD V0, 1 +
    db`);
    expect(result.bytes.length).toBe(0);
    expect(result.errors).toEqual([
      "line 1: unknown instruction FOO",
      "line 2: 0x100 (256) is outside the byte range -128-255",
      "line 3: undefined name nowhere",
      "line 5: dup is already defined",
      "line 6: 16 is outside the nibble range 0-15",
      "line 7: LD V0 matches no form of LD: LD Vx, byte | LD Vx, Vy | LD I, addr | LD Vx, DT | LD Vx, K | " +
        "LD DT, Vx | LD ST, Vx | LD F, Vx | LD HF, Vx | LD B, Vx | LD [I], Vx | LD Vx, [I] | LD R, Vx | LD Vx, R",
      "line 8: F is a register or operand name and cannot be a label",
      "line 9: org 0x100 is outside 0x20E-0x1000",
      "line 10: bad expression 1 +",
      "line 11: db needs at least one value",
    ]);
  });

  test("constants and org only see names defined above them", () => {
    expect(assemble("WIDTH = HEIGHT\nHEIGHT = 1").errors).toEqual([
      "line 1: undefined name HEIGHT (only names defined above can be used here)",
    ]);
    expect(assemble("org START\nSTART = 0x300").errors).toEqual([
      "line 1: org: undefined name START (only names defined above can be used here)",
    ]);
  });

  test("a program must end below 0x1000", () => {
    expect(assemble("org 0xFFF\nCLS").errors).toEqual(["line 2: the program does not fit below 0x1000"]);
    expect(assemble("org 0xFFE\nCLS").bytes.length).toBe(0x1000 - 0x200);
  });
});

describe("disassembler", () => {
  test("follows calls, jumps and both outcomes of a skip; the rest is data", () => {
    const rom = new Uint8Array([
      ...words(0x2208, 0x3001, 0x120c, 0x1206, 0xa20e, 0x00ee, 0x00fd),
      0xf0, 0x90, 0x12,
    ]);
    const listing = disassemble(rom, "test.ch8");
    expect(listing.startsWith("; test.ch8: 17 bytes\n")).toBe(true);
    expect(listing).toContain("; The program uses SUPER-CHIP instructions.");
    expect(body(listing)).toBe(
      [
        "    CALL sub_208                ; 200: 2208",
        "    SE   V0, 0x01               ; 202: 3001",
        "    JP   label_20C              ; 204: 120C",
        "label_206:",
        "    JP   label_206              ; 206: 1206",
        "sub_208:",
        "    LD   I, data_20E            ; 208: A20E",
        "    RET                         ; 20A: 00EE",
        "label_20C:",
        "    EXIT                        ; 20C: 00FD",
        "data_20E:",
        "    db   0xF0                   ; 20E: ####....",
        "    db   0x90                   ; 20F: #..#....",
        "    db   0x12                   ; 210: ...#..#.",
      ].join("\n"),
    );
    expect(assemble(listing).bytes).toEqual(rom);
  });

  test("a jump into the middle of an instruction keeps a numeric target", () => {
    const rom = new Uint8Array([...words(0x6012, 0x1201), 0x12]);
    const listing = disassemble(rom, "overlap.ch8");
    expect(body(listing)).toBe(
      [
        "    LD   V0, 0x12               ; 200: 6012",
        "    JP   0x201                  ; 202: 1201",
        "    db   0x12                   ; 204: ...#..#.",
      ].join("\n"),
    );
    expect(assemble(listing).bytes).toEqual(rom);
  });

  test("computed jumps are marked and not followed", () => {
    const rom = words(0xb204, 0x6001, 0x6002);
    const lines = body(disassemble(rom, "jump.ch8")).split("\n");
    expect(lines[0]).toBe("    JP   V0, label_204          ; 200: B204 (computed jump, not followed)");
    expect(lines[1]).toBe("    db   0x60                   ; 202: .##.....");
    expect(lines[3]).toBe("label_204:");
  });

  test("ROMs that do not fit in memory are refused", () => {
    expect(() => disassemble(new Uint8Array(4096 - 0x200 + 1), "big.ch8")).toThrow();
  });
});

describe("every ROM in roms/ survives disassembly and reassembly", () => {
  for (const group of ["tests", "games", "schip"]) {
    for (const name of readdirSync(join(ROM_ROOT, group)).filter((entry) => entry.endsWith(".ch8")).sort()) {
      test(`${group}/${name}`, () => {
        const rom = new Uint8Array(readFileSync(join(ROM_ROOT, group, name)));
        const result = assemble(disassemble(rom, name));
        expect(result.errors).toEqual([]);
        expect(result.bytes).toEqual(rom);
      });
    }
  }
});

describe("chip8-tools arguments", () => {
  test("commands, input and -o", () => {
    expect(parseToolArgs(["dis", "game.ch8"])).toEqual({ command: "dis", input: "game.ch8", output: "", error: "" });
    expect(parseToolArgs(["asm", "-o", "out.ch8", "game.s"])).toEqual({ command: "asm", input: "game.s", output: "out.ch8", error: "" });
  });

  test("help and errors", () => {
    expect(parseToolArgs([]).error).toBe("");
    expect(parseToolArgs(["--help"]).command).toBe("");
    expect(parseToolArgs(["run", "x"]).error).toBe("unknown command run");
    expect(parseToolArgs(["asm"]).error).toBe("asm needs an input file");
    expect(parseToolArgs(["asm", "a.s", "b.s"]).error).toBe("only one input file can be given");
    expect(parseToolArgs(["dis", "a.ch8", "-o"]).error).toBe("missing file name after -o");
    expect(parseToolArgs(["dis", "a.ch8", "--all"]).error).toBe("unknown option --all");
  });

  test("withExtension", () => {
    expect(withExtension("game.s", ".ch8")).toBe("game.ch8");
    expect(withExtension("dir.v2/game", ".ch8")).toBe("dir.v2/game.ch8");
    expect(withExtension("dir\\game.asm.s", ".ch8")).toBe("dir\\game.asm.ch8");
    expect(withExtension(".hidden", ".ch8")).toBe(".hidden.ch8");
  });
});

# 11. An assembler and a disassembler

Writing programs as hex words gets old quickly, and reading a ROM as hex is
worse. Two small programs fix both: a disassembler turns a ROM into a
listing a person can read, and an assembler turns such a listing back into a
ROM. In this repository they are `src/disasm.ts` and `src/asm.ts`, joined by
`src/tools.ts` into one command-line program, `chip8-tools`, which scriptc
compiles to a second executable. It uses no FFI.

## One table for both directions

Both programs need the same knowledge: which words are which instructions,
and how each is written. `src/opcodes.ts` holds it once, as a list with an
entry per instruction form:

```ts
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
```

An operand kind is either a field of the word (`vx`, `vy`, `addr`, `byte`,
`nibble`) or a fixed word that only selects the form (`I`, `DT`, `[I]` and
the like). The mask follows from the fields, so each entry is written as a
mnemonic, its operands and its opcode:

```ts
op("LD", ["vx", "byte"], 0x6000),
op("ADD", ["vx", "byte"], 0x7000),
op("LD", ["vx", "vy"], 0x8000),
// ...
op("LD", ["i", "addr"], 0xa000),
op("JP", ["v0", "addr"], 0xb000),
```

Decoding takes the first entry whose fixed bits match. Order matters in one
place: `00E0` and the SUPER-CHIP `00xx` words come before `SYS addr`, which
matches every `0NNN`.

```ts
/** The instruction a 16-bit word encodes, or null when it encodes none. */
export function decode(word: number): Instruction | null {
  for (const instruction of INSTRUCTIONS) {
    if ((word & instruction.mask) === instruction.opcode) return instruction;
  }
  return null;
}
```

Encoding ORs the operand values into their fields. The mnemonics are the
ones in Cowgod's Chip-8 Technical Reference, SUPER-CHIP's included:

| Word | Source | Word | Source |
| ---- | ------ | ---- | ------ |
| `00E0` | `CLS` | `9XY0` | `SNE Vx, Vy` |
| `00EE` | `RET` | `ANNN` | `LD I, addr` |
| `00CN` | `SCD nibble` | `BNNN` | `JP V0, addr` |
| `00FB` | `SCR` | `CXNN` | `RND Vx, byte` |
| `00FC` | `SCL` | `DXYN` | `DRW Vx, Vy, nibble` |
| `00FD` | `EXIT` | `EX9E` | `SKP Vx` |
| `00FE` | `LOW` | `EXA1` | `SKNP Vx` |
| `00FF` | `HIGH` | `FX07` | `LD Vx, DT` |
| `0NNN` | `SYS addr` | `FX0A` | `LD Vx, K` |
| `1NNN` | `JP addr` | `FX15` | `LD DT, Vx` |
| `2NNN` | `CALL addr` | `FX18` | `LD ST, Vx` |
| `3XNN` | `SE Vx, byte` | `FX1E` | `ADD I, Vx` |
| `4XNN` | `SNE Vx, byte` | `FX29` | `LD F, Vx` |
| `5XY0` | `SE Vx, Vy` | `FX30` | `LD HF, Vx` |
| `6XNN` | `LD Vx, byte` | `FX33` | `LD B, Vx` |
| `7XNN` | `ADD Vx, byte` | `FX55` | `LD [I], Vx` |
| `8XY0`–`8XY5` | `LD`, `OR`, `AND`, `XOR`, `ADD`, `SUB Vx, Vy` | `FX65` | `LD Vx, [I]` |
| `8XY6`, `8XY7`, `8XYE` | `SHR`, `SUBN`, `SHL Vx, Vy` | `FX75` / `FX85` | `LD R, Vx` / `LD Vx, R` |

Two forms keep every bit of the word on purpose. `SHR` and `SHL` are always
written with Vy, because the VIP shifts Vy (chapter 5). `BNNN` is always
`JP V0, addr`, although the SUPER-CHIP profiles read it as `XNN + VX`: the
disassembler writes the bits, not one profile's meaning of them.

## The disassembler: follow the code

A ROM is code and data in one block. The IBM logo program is twenty-one
instructions followed by the logo's sprites, and decoding it front to back
turns the sprites into nonsense instructions. So the disassembler does what
the CPU does: it starts at `0x200` and follows the program.

```ts
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
```

A skip has two successors, because the disassembler cannot know which way it
goes. Addresses wait in a list, not on the call stack: a recursive version
would recurse once per instruction, and native Windows executables do not
check stack depth. An address becomes an instruction only when both of its
bytes lie inside the ROM, neither belongs to another instruction, and the
word decodes; anything else is left as data.

```ts
const pending: number[] = [PROGRAM_START];
while (pending.length > 0) {
  const address = pending.pop() ?? PROGRAM_START;
  if (address < PROGRAM_START || address + 2 > end) continue;
  if (starts[address] !== 0 || covered[address] !== 0 || covered[address + 1] !== 0) continue;
  const value = word(address);
  const instruction = decode(value);
  if (instruction === null) continue;
  // ... mark the two bytes, note what the instruction refers to,
  // and push its successors
}
```

While tracing, it notes what each instruction points at: a `CALL` target, a
jump target, or an address loaded into I. Those become labels, `sub_XXX`,
`label_XXX` and `data_XXX`, wherever a line of the listing starts there. A
target in the middle of an instruction, or outside the ROM (the font, say),
keeps its number.

Then it writes the ROM from start to end: an instruction per traced address,
a `db` line per remaining byte, each byte drawn as a row of a sprite because
most CHIP-8 data is sprites. The IBM logo program:

```
    CLS                         ; 200: 00E0
    LD   I, data_22A            ; 202: A22A
    LD   V0, 0x0C               ; 204: 600C
    LD   V1, 0x08               ; 206: 6108
    DRW  V0, V1, 15             ; 208: D01F
...
label_228:
    JP   label_228              ; 228: 1228
data_22A:
    db   0xFF                   ; 22A: ########
    db   0x00                   ; 22B: ........
    db   0xFF                   ; 22C: ########
```

The address and the original word go in a comment, so the listing is itself
a source file. What tracing cannot see stays data: code reached only through
`JP V0, addr` (marked "computed jump, not followed"), or through
instructions the program rewrites while it runs. The bytes are still all
there, so the listing still assembles to the same ROM.

## The assembler: two passes

Source is one statement per line:

| Line | Meaning |
| ---- | ------- |
| `; text` | comment, anywhere on a line |
| `loop:` | label: the address of the next byte; may share a line with a statement |
| `SPEED = 3` | constant |
| `org 0x300` | continue at this address; forward only, the gap is zeros |
| `db 0b11110000, 0x90, 144` | bytes |
| `dw 0x1234, table` | 16-bit words, high byte first |
| `LD V0, SPEED` | an instruction from the table above |

Numbers are decimal, hexadecimal (`0x1F`) or binary (`0b1010`), and an
expression adds and subtracts numbers, labels and constants, like
`sprite + 5`. Mnemonics, registers and fixed words can be written in any
case; labels are case-sensitive. `SHR Vx` and `SHL Vx` without a second
register assemble as `SHR Vx, Vx`, which shifts Vx under every profile.

The problem an assembler solves is the forward reference: `JP end` before
`end:` is defined. So it reads the source twice. The first pass only counts:
every statement's size is known without evaluating anything (two bytes per
instruction, one per `db` value, two per `dw` value), so each label gets its
address. Constants and `org` are evaluated right away, from names defined
above them. The second pass encodes, with every label known.

To encode, the assembler tries each form of the mnemonic and takes the first
whose operands fit: a register where the form has `Vx`, the right fixed word
where it has `I` or `DT`, and an expression where it has a field. Then it
checks the value against the field:

```
line 2: 0x100 (256) is outside the byte range -128-255
line 7: LD V0 matches no form of LD: LD Vx, byte | LD Vx, Vy | LD I, addr | ...
```

Errors do not stop it. It reports every problem in the file, each with its
line number, and writes no ROM.

## Round trips as tests

A table used in both directions invites one test: for every 16-bit word that
decodes, format it, assemble the text, and compare. `tests/tools.test.ts`
does exactly that for all 65,536 words, then does the same for every ROM in
`roms/`, disassembling and reassembling each and requiring the original
bytes. `bun run verify` repeats the ROM round trip with the native
executable and compares its listings with bun's.

## The command line

```
chip8-tools dis roms/games/outlaw.ch8 -o outlaw.s
chip8-tools asm outlaw.s -o outlaw.ch8
bun src/tools.ts dis roms/games/outlaw.ch8
```

Without `-o`, `dis` prints the listing and `asm` writes the ROM next to the
source with a `.ch8` extension. Errors go to standard output with exit code
1; a usage error exits with 2.

From here, a debugger is a short step: the interpreter knows the PC, and
`decode` plus `formatInstruction` turn the word there into the line the
listing would show.

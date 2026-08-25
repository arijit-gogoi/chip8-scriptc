# 2. Fetch, decode, execute

The heart of the interpreter is one method, `step()`, that runs a single
instruction. Everything else in this series is a `case` inside it.

## Fetch

An instruction is two bytes, stored big-endian: the first byte holds the high
half. If memory at the PC contains `D0` and then `15`, the instruction is
`0xD015`. To combine two bytes into one 16-bit number, shift the first byte
left by 8 bits (that multiplies it by 256, making room for the second) and OR
the second into the gap:

```ts
const opcode = (this.memory[pc] << 8) | this.memory[pc + 1];
//              0xD0 << 8  = 0xD000
//              0xD000 | 0x15 = 0xD015
```

## Advance the PC first

Before executing, move the PC to the next instruction:

```ts
this.pc = pc + 2;
```

This order matters. Instructions that jump simply overwrite the PC, and
instructions that *skip* the next instruction add another 2. If we advanced
after executing instead, every jump would land two bytes off. The stack
walk-through in chapter 1 shows the same thing: `2NNN` pushes the *already
advanced* PC, so `00EE` returns to the instruction after the call.

## Decode

Instructions are designed to be taken apart by hex digit. Using `D015` as the
example, with digits numbered from the left:

| Name | Which bits | How to extract | `D015` |
| ---- | ---------- | -------------- | ------ |
| first digit | top 4 | `opcode >> 12` | `D` — draw |
| X | second digit | `(opcode >> 8) & 0xf` | `0` — register V0 |
| Y | third digit | `(opcode >> 4) & 0xf` | `1` — register V1 |
| N | last digit | `opcode & 0xf` | `5` — 5 rows |
| NN | last two digits | `opcode & 0xff` | `15` |
| NNN | last three digits | `opcode & 0xfff` | `015` |

Shifting right by `k` bits throws away the low `k` bits; masking with `& 0xf`
keeps only the low 4. Together they cut out any digit you want. (The
[appendix](appendix-bits-bytes-hex.md) has more on shifts and masks.)

Which fields mean something depends on the instruction. `1NNN` uses NNN as an
address; `6XNN` uses X as a register number and NN as a value; `DXYN` uses X,
Y and N. We compute all of them up front because it is cheap and keeps each
`case` short.

## Execute: dispatch on the first digit

The first digit sorts the 35 instructions into 16 groups. Some groups contain
a single instruction (`1NNN`, `6XNN`); others need a second look at the last
digit (`8XY?`) or the last two (`FX??`, `EX??`, `00E?`). A `switch` on the
first digit, with nested switches where needed, is all the dispatch this
machine needs.

Here is the real `step()` and the skeleton of `execute()`. The two lines about
`waitingForKey` belong to an instruction from chapter 6; ignore them for now.

```ts
step(): void {
  if (this.halted) return;
  if (this.waitingForKey) {
    this.pollWaitKey();
    return;
  }
  const pc = this.pc & 0xfff;
  const opcode = (this.memory[pc] << 8) | this.memory[(pc + 1) & 0xfff];
  this.pc = (pc + 2) & 0xfff;
  this.execute(opcode, pc);
}

private execute(opcode: number, at: number): void {
  const x = (opcode >> 8) & 0xf;
  const y = (opcode >> 4) & 0xf;
  const n = opcode & 0xf;
  const nn = opcode & 0xff;
  const nnn = opcode & 0xfff;
  const vx = this.v[x];
  const vy = this.v[y];

  switch (opcode >> 12) {
    case 0x0:
      // 00E0, 00EE — chapter 3 and 4
      return;
    case 0x1:
      this.pc = nnn;
      return;
    // ... one case per first digit ...
    default:
      break;
  }
  this.halt(`unknown opcode ${hex(opcode, 4)} at ${hex(at, 3)}`);
}

private halt(reason: string): void {
  this.halted = true;
  this.haltReason = reason;
}
```

Three details worth noticing:

- Every address is masked with `& 0xfff`. Memory has 4096 bytes, and a
  program that runs off the end would otherwise index past the array. Real
  hardware wraps, so we wrap.
- `vx` and `vy` are read once, before any `case` runs. Several instructions
  write VX and then VF, and when X happens to be F the second write must not
  see the first. Reading the inputs up front makes that automatic (chapter 5
  has the details).
- Anything the `switch` does not recognise falls through to `halt()` with a
  message that names the opcode and its address. When a test ROM stops, that
  message tells you what you have not implemented yet.

`hex(value, width)` is a small helper that formats a number as `0x...` with
leading zeros; you can use `value.toString(16)` instead.

## Try it

Add a `case 0x6:` that does `this.v[x] = nn` and a `case 0x7:` that does
`this.v[x] = (vx + nn) & 0xff` (the typed array would wrap for you, but the
mask says what you mean). Then:

```ts
const vm = new Chip8();
vm.loadRom(new Uint8Array([0x60, 0xff, 0x70, 0x02]));  // 60FF: V0 = 255, 7002: V0 += 2
vm.step();
vm.step();
console.log(vm.v[0]);  // 1 — 257 wrapped around to 1
console.log(vm.pc);    // 516, which is 0x204
```

Two instructions down, thirty-three to go.

Next: [3. Drawing](03-drawing.md)

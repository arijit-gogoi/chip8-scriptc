# 4. Jumps, calls and skips

CHIP-8 has no `if`, no `while` and no function call in the way TypeScript
does. It has jumps, a call/return pair, and instructions that *skip the next
instruction* when a condition holds. Programs build everything else out of
those.

## 2NNN — call

*Execute subroutine starting at address NNN.*

Push the current PC (already pointing at the instruction after the call) and
jump. If the stack is full the program has recursed sixteen levels deep,
which no real CHIP-8 program does; we stop rather than overwrite memory.

```ts
case 0x2:
  if (this.sp >= STACK_DEPTH) {
    this.halt(`stack overflow at ${hex(at, 3)}`);
    return;
  }
  this.stack[this.sp] = this.pc;
  this.sp++;
  this.pc = nnn;
  return;
```

## 00EE — return

*Return from a subroutine.*

Pop the address the call saved. Returning with nothing on the stack is
likewise a bug in the program.

```ts
} else if (opcode === 0x00ee) {
  if (this.sp === 0) {
    this.halt(`stack underflow at ${hex(at, 3)}`);
    return;
  }
  this.sp--;
  this.pc = this.stack[this.sp] & 0xfff;
}
```

## Skips

A skip advances the PC by another 2, so that the instruction right after the
skip is never executed. The pattern in CHIP-8 programs is:

```
3005    skip next if V0 == 5
1220    jump to 0x220        <- skipped when V0 is 5
....    code for the V0 == 5 case
```

which is an `if`. Put a jump in the skipped slot and you have `if ... else`;
put the skip at the bottom of a block with a jump back to the top and you
have a loop.

```ts
private skip(): void {
  this.pc = (this.pc + 2) & 0xfff;
}
```

### 3XNN — skip if equal

*Skip the following instruction if the value of register VX equals NN.*

```ts
case 0x3:
  if (vx === nn) this.skip();
  return;
```

### 4XNN — skip if not equal

*Skip the following instruction if the value of register VX is not equal to NN.*

```ts
case 0x4:
  if (vx !== nn) this.skip();
  return;
```

### 5XY0 — skip if registers equal

*Skip the following instruction if the value of register VX is equal to the
value of register VY.*

The last digit must be 0; `5XY1` and friends do not exist. Falling out of the
`case` with `break` reaches the `halt()` at the bottom of `execute()`.

```ts
case 0x5:
  if (n !== 0) break;
  if (vx === vy) this.skip();
  return;
```

### 9XY0 — skip if registers differ

*Skip the following instruction if the value of register VX is not equal to
the value of register VY.*

```ts
case 0x9:
  if (n !== 0) break;
  if (vx !== vy) this.skip();
  return;
```

## BNNN — jump with offset

*Jump to address NNN + V0.*

A computed jump: with a table of jump targets and V0 as the index, a program
can implement a `switch`. Later interpreters (CHIP-48, SUPER-CHIP) changed
this to `NNN + VX`, where X is the second digit; the `jumpVx` quirk switch
from chapter 5 selects that reading.

```ts
case 0xb:
  this.pc = (nnn + (this.quirks.jumpVx ? vx : this.v[0])) & 0xfff;
  return;
```

## Try it: a counting loop

Hand-assemble this program. Addresses on the left, instruction bytes in the
middle:

```
0x200  6000    V0 = 0
0x202  7001    V0 += 1
0x204  3005    skip next if V0 == 5
0x206  1202    jump 0x202
0x208  1208    jump 0x208 (done: loop here forever)
```

```ts
const vm = new Chip8();
vm.loadRom(new Uint8Array([0x60, 0x00, 0x70, 0x01, 0x30, 0x05, 0x12, 0x02, 0x12, 0x08]));
for (let k = 0; k < 100; k++) vm.step();
console.log(vm.v[0], vm.pc.toString(16)); // 5 208
```

Then replace the last instruction with `00EE` and check that the interpreter
halts with a stack underflow message instead of doing something strange.

Next: [5. Arithmetic and the VF flag](05-arithmetic.md)

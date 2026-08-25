# Appendix: bits, bytes and hex

Everything in an emulator is a number, and the numbers are easiest to read in
binary or hexadecimal. This appendix is the ten minutes of background the
series assumes.

## Place value

Decimal 216 means `2·100 + 1·10 + 6·1`: each position is worth ten times the
one to its right. Binary works the same way with two instead of ten. The
binary number `1101` is `1·8 + 1·4 + 0·2 + 1·1 = 13`.

A **bit** is one binary digit, 0 or 1. A **byte** is eight bits, so it can
hold 256 different values, 0 to 255. A **nibble** is four bits, 0 to 15.

| bit | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
| --- | - | - | - | - | - | - | - | - |
| worth | 128 | 64 | 32 | 16 | 8 | 4 | 2 | 1 |

Bit 7 is the **most significant bit** (MSB), bit 0 the **least significant
bit** (LSB). `11110000` is 128 + 64 + 32 + 16 = 240.

## Hexadecimal

Writing bytes in binary is long. Hexadecimal (base 16) uses sixteen digits,
`0`–`9` then `A`–`F`, and each hex digit is exactly one nibble, so a byte is
always two hex digits. The `0x` prefix marks a hex number in code.

| hex | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | A | B | C | D | E | F |
| --- | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| binary | 0000 | 0001 | 0010 | 0011 | 0100 | 0101 | 0110 | 0111 | 1000 | 1001 | 1010 | 1011 | 1100 | 1101 | 1110 | 1111 |
| decimal | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |

So `0xF0` is `1111 0000` = 240, `0x200` is 512, `0xFFF` is 4095 (the last
address of 4 KB), and a CHIP-8 instruction like `0xD015` is two bytes,
`0xD0` and `0x15`.

In TypeScript, `0xff`, `255` and `0b11111111` are the same number;
`(255).toString(16)` gives `"ff"` and `(255).toString(2)` gives `"11111111"`.

## AND, OR, XOR, NOT

Bitwise operators combine two numbers one bit position at a time.

| a | b | a AND b `&` | a OR b `\|` | a XOR b `^` |
| - | - | - | - | - |
| 0 | 0 | 0 | 0 | 0 |
| 0 | 1 | 0 | 1 | 1 |
| 1 | 0 | 0 | 1 | 1 |
| 1 | 1 | 1 | 1 | 0 |

AND is 1 only when both bits are 1. OR is 1 when either is. XOR is 1 when
they differ — which is why XOR-ing the same thing twice gets you back where
you started, and why CHIP-8 draws sprites with it. NOT (`~`) flips every bit.

```
  1100 1010          1100 1010          1100 1010
& 0000 1111        | 0000 1111        ^ 0000 1111
= 0000 1010        = 1100 1111        = 1100 0101
```

## Masking

AND with a pattern of 1s keeps only those bits and zeroes the rest. This is
how `execute()` cuts an instruction into pieces:

```
opcode        = 0xD015 = 1101 0000 0001 0101
opcode & 0xF  =          0000 0000 0000 0101 = 0x5    (last digit, N)
opcode & 0xFF =          0000 0000 0001 0101 = 0x15   (NN)
opcode & 0xFFF=          0000 0000 0001 0101 = 0x015  (NNN)
```

`& 0xff` is also how code says "keep this in one byte": `(200 + 100) & 0xff`
is 44.

## Shifting

`x << n` moves every bit `n` positions to the left, filling with zeros; the
value is multiplied by 2ⁿ. `x >> n` moves right, dropping the low bits; the
value is divided by 2ⁿ, rounding down.

```
0x15 << 8  = 0x1500        (make room for another byte on the right)
0xD0 << 8 | 0x15 = 0xD015  (combine two bytes into an instruction)
0xD015 >> 12 = 0xD          (the first digit)
(0xD015 >> 8) & 0xF = 0x0   (shift the second digit down, then mask it)
(0xD015 >> 4) & 0xF = 0x1   (the third digit)
0x83 >> 1 = 0x41            (halve; the dropped bit 1 is what 8XY6 puts in VF)
```

`0x80 >> bit` walks a single 1 across a byte from left to right —
`1000 0000`, `0100 0000`, ... — which is how `drawSprite` tests each pixel.

## JavaScript detail: 32-bit integers

JavaScript numbers are floating point, but the bitwise operators convert
their operands to 32-bit *signed* integers first. For bytes and 16-bit
instructions that never matters. It matters in the random-number generator
(chapter 6), where `x << 13` can set bit 31 and make the number negative;
`x >>> 0` (unsigned shift by zero) converts it back to a positive 32-bit
value. Typed arrays do their own conversion: storing 300 into a `Uint8Array`
keeps `300 & 0xff = 44`.

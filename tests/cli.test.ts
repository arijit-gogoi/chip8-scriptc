import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IPF,
  DEFAULT_PRESS_FRAMES,
  DEFAULT_SCALE,
  MAX_IPF,
  USAGE,
  baseName,
  parseColor,
  parseDecimal,
  parseHex,
  parseOptions,
  parsePress,
  quirksFor,
} from "../src/cli";

describe("number parsing", () => {
  test("parseDecimal", () => {
    expect(parseDecimal("0")).toBe(0);
    expect(parseDecimal("1500")).toBe(1500);
    expect(parseDecimal("")).toBe(-1);
    expect(parseDecimal("-1")).toBe(-1);
    expect(parseDecimal("1a")).toBe(-1);
    expect(parseDecimal(" 1")).toBe(-1);
  });

  test("parseHex", () => {
    expect(parseHex("0")).toBe(0);
    expect(parseHex("ff")).toBe(255);
    expect(parseHex("FF")).toBe(255);
    expect(parseHex("dcdcdc")).toBe(0xdcdcdc);
    expect(parseHex("")).toBe(-1);
    expect(parseHex("g")).toBe(-1);
    expect(parseHex("0x10")).toBe(-1);
  });

  test("parseColor appends an opaque alpha", () => {
    expect(parseColor("dcdcdc")).toBe(0xdcdcdcff);
    expect(parseColor("000000")).toBe(0x000000ff);
    expect(parseColor("ffffff")).toBe(0xffffffff);
    expect(parseColor("fff")).toBe(-1);
    expect(parseColor("zzzzzz")).toBe(-1);
    expect(parseColor("#dcdcdc")).toBe(-1);
  });
});

describe("parsePress", () => {
  test("key@frame with the default hold", () => {
    expect(parsePress("1@30")).toEqual({ key: 1, frame: 30, frames: DEFAULT_PRESS_FRAMES });
    expect(parsePress("f@0")).toEqual({ key: 15, frame: 0, frames: DEFAULT_PRESS_FRAMES });
  });

  test("key@frame+hold", () => {
    expect(parsePress("a@5+10")).toEqual({ key: 10, frame: 5, frames: 10 });
  });

  test("rejects malformed input", () => {
    expect(parsePress("@5")).toBeNull();
    expect(parsePress("1")).toBeNull();
    expect(parsePress("g@1")).toBeNull();
    expect(parsePress("10@1")).toBeNull();
    expect(parsePress("1@x")).toBeNull();
    expect(parsePress("1@5+0")).toBeNull();
    expect(parsePress("1@5+")).toBeNull();
  });
});

describe("parseOptions", () => {
  test("defaults", () => {
    const parsed = parseOptions(["game.ch8"]);
    expect(parsed.error).toBe("");
    expect(parsed.options).toEqual({
      rom: "game.ch8",
      ipf: DEFAULT_IPF,
      scale: DEFAULT_SCALE,
      profile: "chip8",
      wrapSprites: false,
      displayWait: true,
      sound: true,
      headless: false,
      frames: 0,
      presses: [],
      fg: 0xdcdcdcff,
      bg: 0x202020ff,
    });
  });

  test("every option", () => {
    const parsed = parseOptions([
      "--ipf", "700", "--scale", "8", "--quirks", "schip", "--wrap", "--no-sound",
      "--fg", "00ff00", "--bg", "101010", "--headless", "120", "--press", "1@30", "--press", "5@60+3",
      "roms/x.ch8",
    ]);
    expect(parsed.error).toBe("");
    const opts = parsed.options!;
    expect(opts.rom).toBe("roms/x.ch8");
    expect(opts.ipf).toBe(700);
    expect(opts.scale).toBe(8);
    expect(opts.profile).toBe("schip");
    expect(opts.wrapSprites).toBe(true);
    expect(opts.displayWait).toBe(false);
    expect(opts.sound).toBe(false);
    expect(opts.fg).toBe(0x00ff00ff);
    expect(opts.bg).toBe(0x101010ff);
    expect(opts.headless).toBe(true);
    expect(opts.frames).toBe(120);
    expect(opts.presses).toEqual([
      { key: 1, frame: 30, frames: DEFAULT_PRESS_FRAMES },
      { key: 5, frame: 60, frames: 3 },
    ]);
  });

  test("--no-wait after --quirks chip8, ROM before options", () => {
    const opts = parseOptions(["rom.ch8", "--quirks", "chip8", "--no-wait"]).options!;
    expect(opts.profile).toBe("chip8");
    expect(opts.displayWait).toBe(false);
  });

  test("help yields no options and no error", () => {
    expect(parseOptions(["--help"])).toEqual({ options: null, error: "" });
    expect(parseOptions(["rom.ch8", "-h"])).toEqual({ options: null, error: "" });
    expect(USAGE.startsWith("usage: chip8 <rom.ch8>")).toBe(true);
  });

  test("errors", () => {
    const error = (args: string[]): string => {
      const parsed = parseOptions(args);
      expect(parsed.options).toBeNull();
      return parsed.error;
    };
    expect(error([])).toBe("no ROM given");
    expect(error(["a.ch8", "b.ch8"])).toBe("only one ROM can be loaded");
    expect(error(["a.ch8", "--ipf"])).toBe("missing value for --ipf");
    expect(error(["a.ch8", "--ipf", "0"])).toContain("--ipf must be between");
    expect(error(["a.ch8", "--ipf", String(MAX_IPF + 1)])).toContain("--ipf must be between");
    expect(error(["a.ch8", "--ipf", "ten"])).toContain("--ipf must be between");
    expect(error(["a.ch8", "--scale", "0"])).toBe("--scale must be between 1 and 64");
    expect(error(["a.ch8", "--quirks", "xochip"])).toBe("--quirks must be chip8 or schip");
    expect(error(["a.ch8", "--headless", "x"])).toBe("--headless needs a frame count");
    expect(error(["a.ch8", "--press", "1"])).toContain("bad --press value 1");
    expect(error(["a.ch8", "--fg", "red"])).toBe("--fg expects rrggbb");
    expect(error(["a.ch8", "--bg", "12345"])).toBe("--bg expects rrggbb");
    expect(error(["a.ch8", "--turbo", "1"])).toBe("unknown option --turbo");
  });
});

describe("quirksFor", () => {
  test("profiles with overrides", () => {
    const chip8 = quirksFor(parseOptions(["r"]).options!);
    expect(chip8).toEqual({ shiftVx: false, indexIncrement: true, jumpVx: false, vfReset: true, wrapSprites: false, displayWait: true });

    const schip = quirksFor(parseOptions(["r", "--quirks", "schip"]).options!);
    expect(schip).toEqual({ shiftVx: true, indexIncrement: false, jumpVx: true, vfReset: false, wrapSprites: false, displayWait: false });

    const mixed = quirksFor(parseOptions(["r", "--wrap", "--no-wait"]).options!);
    expect(mixed.wrapSprites).toBe(true);
    expect(mixed.displayWait).toBe(false);
    expect(mixed.shiftVx).toBe(false);
  });
});

describe("baseName", () => {
  test("handles both separators", () => {
    expect(baseName("roms\\games\\outlaw.ch8")).toBe("outlaw.ch8");
    expect(baseName("roms/tests/3-corax+.ch8")).toBe("3-corax+.ch8");
    expect(baseName("plain.ch8")).toBe("plain.ch8");
    expect(baseName("dir/")).toBe("");
  });
});

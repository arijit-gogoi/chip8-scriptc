import { baseName } from "./cli";

export const TOOLS_USAGE = `usage: chip8-tools asm <source.s> [-o <rom.ch8>]
       chip8-tools dis <rom.ch8> [-o <listing.s>]

  asm   assemble; the ROM is written next to the source unless -o names it
  dis   disassemble, following the code from 0x200; the listing goes to
        standard output unless -o names a file, and assembles back to the
        same bytes`;

export interface ToolArgs {
  /** "asm" or "dis"; empty when parsing failed or help was requested. */
  command: string;
  input: string;
  /** Empty for the default. */
  output: string;
  /** Empty when help was requested or parsing succeeded. */
  error: string;
}

function toolFailure(error: string): ToolArgs {
  return { command: "", input: "", output: "", error };
}

export function parseToolArgs(args: string[]): ToolArgs {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") return toolFailure("");
  const command = args[0];
  if (command !== "asm" && command !== "dis") return toolFailure(`unknown command ${command}`);
  let input = "";
  let output = "";
  let k = 1;
  while (k < args.length) {
    const arg = args[k];
    k++;
    if (arg === "-o") {
      if (k >= args.length) return toolFailure("missing file name after -o");
      output = args[k];
      k++;
    } else if (arg.length > 1 && arg.charCodeAt(0) === 45) {
      return toolFailure(`unknown option ${arg}`);
    } else if (input === "") {
      input = arg;
    } else {
      return toolFailure("only one input file can be given");
    }
  }
  if (input === "") return toolFailure(`${command} needs an input file`);
  return { command, input, output, error: "" };
}

/** `path` with its extension replaced by `extension`, or with `extension` added when it has none. */
export function withExtension(path: string, extension: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return path + extension;
  return path.slice(0, path.length - name.length + dot) + extension;
}

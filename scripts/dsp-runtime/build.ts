#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {
  compilePatchFromFile,
  defaultModuleNameFromPath,
  resolvePath,
  sanitizeModuleName,
  writeBuildOutputs
} from "./utils";

interface BuildCliOptions {
  patchPath: string;
  outDir: string;
  moduleName?: string;
}

function printUsage(): void {
  const scriptName = path.basename(process.argv[1] ?? "build.ts");
  console.log(
    [
      `Usage: ${scriptName} --patch <patch.json> [--out <dir>] [--module <name>]`,
      "",
      "Options:",
      "  --patch    Path to a patch JSON file (required)",
      "  --out      Output directory for source/wasm/metadata (default: dist/dsp-runtime)",
      "  --module   Override the generated module name"
    ].join("\n")
  );
}

function parseArgs(argv: string[]): BuildCliOptions | "help" | null {
  let patchPath: string | undefined;
  let outDir = "dist/dsp-runtime";
  let moduleName: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--patch": {
        patchPath = argv[++index];
        break;
      }
      case "--out": {
        outDir = argv[++index] ?? outDir;
        break;
      }
      case "--module": {
        moduleName = argv[++index];
        break;
      }
      case "--help":
      case "-h": {
        return "help";
      }
      default: {
        if (arg && !arg.startsWith("-") && !patchPath) {
          patchPath = arg;
        } else {
          console.warn(`Unknown argument: ${arg}`);
        }
        break;
      }
    }
  }

  if (!patchPath) {
    return null;
  }

  return {
    patchPath,
    outDir,
    moduleName
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options || options === "help") {
    printUsage();
    process.exit(options === "help" ? 0 : 1);
    return;
  }

  const patchPath = resolvePath(options.patchPath);
  const moduleName =
    options.moduleName && options.moduleName.length > 0
      ? sanitizeModuleName(options.moduleName)
      : defaultModuleNameFromPath(patchPath);

  console.log(`[bench:build] compiling patch ${patchPath}`);

  const artifacts = await compilePatchFromFile(patchPath, { moduleName });
  const outputs = await writeBuildOutputs(artifacts, options.outDir);

  console.log(
    [
      `[bench:build] module: ${outputs.moduleName}`,
      `[bench:build] source: ${outputs.sourcePath}`,
      `[bench:build] wasm: ${outputs.wasmPath}`,
      `[bench:build] metadata: ${outputs.metadataPath}`
    ].join("\n")
  );
}

main().catch((error) => {
  console.error("[bench:build] failed:", error);
  process.exitCode = 1;
});

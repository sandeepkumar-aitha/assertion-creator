#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { generateAssertions } from "./generator.js";

function printUsage() {
  console.error(`Usage:
  node src/cli.js --input response.json [--status 200] [--target postman] [--output assertions.js]
  node src/cli.js --json '{"id":123}' [--status 201] [--target axios]
  type response.json | node src/cli.js --input - [--status 200] [--target postman]`);
}

function getOption(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function getStatus(args) {
  const status = getOption(args, "--status");
  return status === undefined ? undefined : status;
}

async function readResponse(args) {
  const inputPath = getOption(args, "--input");
  const inlineJson = getOption(args, "--json");

  if (inlineJson !== undefined) {
    return inlineJson;
  }

  if (inputPath === "-") {
    return new Promise((resolve, reject) => {
      let response = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        response += chunk;
      });
      process.stdin.on("end", () => resolve(response));
      process.stdin.on("error", reject);
    });
  }

  if (inputPath !== undefined) {
    return readFile(inputPath, "utf8");
  }

  throw new Error("Provide a response with --input or --json.");
}

async function main() {
  try {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.length === 0) {
      printUsage();
      process.exitCode = args.length === 0 ? 1 : 0;
      return;
    }

    const outputPath = getOption(args, "--output");
    const assertions = generateAssertions(await readResponse(args), {
      status: getStatus(args),
      target: getOption(args, "--target"),
    });

    if (outputPath !== undefined) {
      await writeFile(outputPath, assertions, "utf8");
      console.log(`Assertions written to ${outputPath}`);
      return;
    }

    process.stdout.write(assertions);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
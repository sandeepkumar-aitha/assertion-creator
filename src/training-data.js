import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const RESPONSE_FILE_PATTERN = /^response(\d+)\.json$/;

function parseResponse(responsePath, content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new TypeError(`Invalid JSON in ${responsePath}: ${error.message}`);
  }
}

export async function loadTrainingData(directory = "trainingData") {
  const fileNames = await readdir(directory);
  const responseFiles = fileNames.filter((fileName) => RESPONSE_FILE_PATTERN.test(fileName));

  return Promise.all(responseFiles
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map(async (responseFile) => {
      const match = responseFile.match(RESPONSE_FILE_PATTERN);
      const exampleId = match[1];
      const assertionFile = `assertion${exampleId}.js`;
      const responsePath = join(directory, responseFile);
      const assertionPath = join(directory, assertionFile);

      let responseContent;
      let assertion;
      try {
        [responseContent, assertion] = await Promise.all([
          readFile(responsePath, "utf8"),
          readFile(assertionPath, "utf8"),
        ]);
      } catch (error) {
        if (error.code === "ENOENT") {
          throw new Error(`Missing ${assertionFile} for ${responseFile}.`);
        }
        throw error;
      }

      return {
        id: exampleId,
        response: parseResponse(responsePath, responseContent),
        assertion,
        responseFile,
        assertionFile,
      };
    }));
}
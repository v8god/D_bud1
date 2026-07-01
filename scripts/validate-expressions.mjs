import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const characterRoot = path.resolve("public/assets/character");
const expressionRoot = path.join(characterRoot, "character_extensions/expressions");
const cdiPath = path.join(characterRoot, "yachiyo.cdi3.json");
const absoluteEyeStates = new Set(["sleepy", "sleep", "wake_up", "low_battery"]);

const cdi = JSON.parse(await readFile(cdiPath, "utf8"));
const knownParameters = new Set((cdi.Parameters ?? []).map(parameter => parameter.Id));
const files = (await readdir(expressionRoot)).filter(file => file.endsWith(".exp3.json"));
const errors = [];
let parameterCount = 0;

for (const file of files.sort()) {
  const expressionId = file.replace(/\.exp3\.json$/i, "");
  const document = JSON.parse(await readFile(path.join(expressionRoot, file), "utf8"));
  const parameters = document.Parameters ?? [];
  parameterCount += parameters.length;

  for (const parameter of parameters) {
    if (!knownParameters.has(parameter.Id)) {
      errors.push(`${file}: unknown parameter ${parameter.Id}`);
    }
  }

  if (absoluteEyeStates.has(expressionId)) {
    for (const eyeId of ["ParamEyeLOpen", "ParamEyeROpen"]) {
      const eye = parameters.find(parameter => parameter.Id === eyeId);
      if (!eye) {
        errors.push(`${file}: missing ${eyeId}`);
      } else if (eye.Blend !== "Overwrite") {
        errors.push(`${file}: ${eyeId} must use Overwrite, found ${eye.Blend}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} expressions and ${parameterCount} parameter entries.`);
  console.log("All expression files passed structural and sleep-state blend validation.");
}

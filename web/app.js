import { generateAssertions, inferSchema } from "../src/generator.js";

const form = document.querySelector("#generator-form");
const responseInput = document.querySelector("#response-input");
const statusInput = document.querySelector("#status-input");
const targetInput = document.querySelector("#target-input");
const fetchStructureButton = document.querySelector("#fetch-structure");
const generateButton = document.querySelector("#generate-button");
const schemaPanel = document.querySelector("#schema-panel");
const schemaRowsElement = document.querySelector("#schema-rows");
const schemaSummary = document.querySelector("#schema-summary");
const extractionPanel = document.querySelector("#extraction-panel");
const extractionRowsElement = document.querySelector("#extraction-rows");
const addExtractionButton = document.querySelector("#add-extraction");
const assertDataTypesInput = document.querySelector("#assert-data-types");
const inputIndex = document.querySelector("#input-index");
const schemaIndex = document.querySelector("#schema-index");
const extractionIndex = document.querySelector("#extraction-index");
const outputTitle = document.querySelector("#output-title");
const outputIndex = document.querySelector("#output-index");
const schemaIntro = document.querySelector("#schema-intro");
const codeOutput = document.querySelector("#code-output code");
const copyButton = document.querySelector("#copy-button");
const formMessage = document.querySelector("#form-message");
const outputState = document.querySelector("#output-state");
const outputCount = document.querySelector("#output-count");
const toast = document.querySelector("#toast");
const toastMessage = document.querySelector("#toast-message");
let toastTimer;
let schemaState;
let schemaRows = [];
let extractionRows = [];

const typeOptions = ["any", "string", "number", "integer", "boolean", "object", "array"];
const valueMatchOptions = [
  { value: "none", label: "No value check" },
  { value: "exact", label: "Exact" },
  { value: "oneOf", label: "One of" },
  { value: "regex", label: "Matches regex" },
  { value: "notEqual", label: "Not equal" },
  { value: "greaterThan", label: "Greater than" },
  { value: "greaterThanOrEqual", label: "Greater than or equal" },
  { value: "lessThan", label: "Less than" },
  { value: "lessThanOrEqual", label: "Less than or equal" },
  { value: "contains", label: "Contains" },
  { value: "startsWith", label: "Starts with" },
  { value: "endsWith", label: "Ends with" },
];
const scalarValueMatchModes = new Set(
  valueMatchOptions
    .map(({ value }) => value)
    .filter((value) => value !== "none" && value !== "oneOf" && value !== "regex"),
);
const stringValueMatchModes = new Set(["contains", "startsWith", "endsWith"]);
const regexPresets = [
  { value: "custom", label: "Custom regex", pattern: "" },
  { value: "email", label: "Email", pattern: String.raw`^[^\s@]+@[^\s@]+\.[^\s@]+$` },
  { value: "url", label: "HTTP(S) URL", pattern: String.raw`^https?:\/\/[^\s]+$` },
  { value: "uuid", label: "UUID", pattern: `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$` },
  { value: "isoDate", label: "ISO date", pattern: String.raw`^\d{4}-\d{2}-\d{2}$` },
  { value: "isoDateTime", label: "ISO date-time", pattern: String.raw`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$` },
  { value: "digits", label: "Digits only", pattern: String.raw`^\d+$` },
  { value: "alphanumeric", label: "Letters and digits", pattern: `^[A-Za-z0-9]+$` },
];
const extractionScopeOptions = [
  { value: "environment", label: "Environment" },
  { value: "collection", label: "Collection" },
  { value: "global", label: "Global" },
];

function getTargetName() {
  return targetInput.value === "axios" ? "Axios" : "Postman";
}

function updateTargetLabels() {
  const targetName = getTargetName();
  const totalSteps = targetName === "Postman" ? 4 : 3;
  inputIndex.textContent = `01 / 0${totalSteps} Input`;
  schemaIndex.textContent = `02 / 0${totalSteps} Structure`;
  extractionIndex.textContent = `03 / 0${totalSteps} Variables`;
  outputTitle.textContent = `${targetName} script`;
  outputIndex.textContent = targetName === "Postman" ? "04 / 04 Output" : "03 / 03 Output";
  schemaIntro.textContent = `Adjust types, nullability, or optional value rules before generating the ${targetName} script.`;
  if (schemaState !== undefined) {
    extractionPanel.hidden = targetName !== "Postman";
  }
}

function formatSchemaPath(path) {
  return path.reduce((label, part, index) => {
    if (index === 0) {
      return part;
    }

    if (part === "[*]") {
      return `${label}[*]`;
    }

    return `${label}.${part}`;
  }, "");
}

function flattenSchema(schema) {
  const rows = [];

  function visit(node, path) {
    rows.push({ label: formatSchemaPath(path), path, node });

    if (node.type === "object") {
      for (const [key, child] of Object.entries(node.children)) {
        visit(child, [...path, key]);
      }
    }

    if (node.type === "array" && node.item !== null) {
      visit(node.item, [...path, "[*]"]);
    }
  }

  visit(schema, ["response"]);
  return rows;
}

function addSelectOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function createSchemaSelect(values, labels, onChange) {
  const select = document.createElement("select");
  values.forEach((value, index) => addSelectOption(select, value, labels[index]));
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function supportsValueMatch(node) {
  return node.type !== "object" && node.type !== "array";
}

function parseMatchScalar(value) {
  const trimmedValue = value.trim();
  try {
    return JSON.parse(trimmedValue);
  } catch {
    return trimmedValue;
  }
}

function parseValueMatch(mode, value, regexPreset = "custom") {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return { match: null, error: "" };
  }

  if (mode === "regex") {
    try {
      new RegExp(value);
    } catch (error) {
      return { match: null, error: `Enter a valid regular expression: ${error.message}` };
    }

    return {
      match: { mode, pattern: value, preset: regexPreset },
      error: "",
    };
  }

  if (scalarValueMatchModes.has(mode)) {
    return {
      match: { mode, value: parseMatchScalar(value) },
      error: "",
    };
  }

  if (mode !== "oneOf") {
    return { match: null, error: "" };
  }

  let values;
  if (trimmedValue.startsWith("[")) {
    try {
      values = JSON.parse(trimmedValue);
    } catch {
      return { match: null, error: "Enter a valid JSON array or comma-separated values." };
    }

    if (!Array.isArray(values)) {
      return { match: null, error: "One-of values must be an array." };
    }
  } else {
    values = value.split(",").map((item) => item.trim());
    if (values.includes("")) {
      return { match: null, error: "One-of values cannot contain empty entries." };
    }
    values = values.map(parseMatchScalar);
  }

  if (values.length === 0) {
    return { match: null, error: "Provide at least one value for a one-of match." };
  }

  return { match: { mode, values }, error: "" };
}

function formatMatchInput(match) {
  if (match === null || match === undefined) {
    return "";
  }

  if (match.mode === "regex") {
    return match.pattern ?? "";
  }

  if (match.mode !== "oneOf") {
    return typeof match.value === "string" ? match.value : JSON.stringify(match.value);
  }

  return JSON.stringify(match.values);
}

function createValueMatchControls(row) {
  const wrapper = document.createElement("div");
  wrapper.className = "value-match-controls";

  const select = document.createElement("select");
  select.setAttribute("aria-label", `${row.label} value rule`);
  valueMatchOptions.forEach(({ value, label }) => addSelectOption(select, value, label));

  const regexPresetSelect = document.createElement("select");
  regexPresetSelect.className = "regex-preset-select";
  regexPresetSelect.setAttribute("aria-label", `${row.label} regex preset`);
  regexPresets.forEach(({ value, label }) => addSelectOption(regexPresetSelect, value, label));

  const input = document.createElement("input");
  input.className = "value-match-input";
  input.type = "text";
  input.setAttribute("aria-label", `${row.label} expected value`);
  let currentMode = row.node.valueMatch?.mode ?? "none";

  const sync = (preserveSelection = false) => {
    const matchable = supportsValueMatch(row.node);
    const match = matchable ? row.node.valueMatch : null;
    select.disabled = !matchable;
    if (!preserveSelection) {
      select.value = match?.mode ?? "none";
      regexPresetSelect.value = match?.preset ?? "custom";
      currentMode = select.value;
    }
    const regexSelected = select.value === "regex";
    regexPresetSelect.hidden = !regexSelected;
    regexPresetSelect.disabled = !regexSelected;
    input.disabled = !matchable || select.value === "none";
    input.hidden = !matchable || select.value === "none";
    input.value = formatMatchInput(match);
    let placeholder = "100, 200 or 2026-01-01";
    if (select.value === "oneOf") {
      placeholder = "ACTIVE, DRAFT or [\"ACTIVE\", \"DRAFT\"]";
    } else if (regexSelected) {
      placeholder = String.raw`^[A-Z]{3}-\d+$`;
    } else if (stringValueMatchModes.has(select.value)) {
      placeholder = "ACTIVE";
    }
    input.placeholder = placeholder;
    input.setCustomValidity(row.matchError ?? "");
  };

  const update = () => {
    if (!supportsValueMatch(row.node) || select.value === "none") {
      row.node.valueMatch = null;
      row.matchError = "";
      input.setCustomValidity("");
      return;
    }

    const result = parseValueMatch(select.value, input.value, regexPresetSelect.value);
    row.node.valueMatch = result.match;
    row.matchError = result.error;
    input.setCustomValidity(result.error);
  };

  select.addEventListener("change", () => {
    const nextMode = select.value;
    if (nextMode !== currentMode) {
      input.value = "";
      row.node.valueMatch = null;
      row.matchError = "";
    }
    if (select.value === "none") {
      input.value = "";
    }
    update();
    sync(true);
    currentMode = nextMode;
  });
  regexPresetSelect.addEventListener("change", () => {
    const preset = regexPresets.find(({ value }) => value === regexPresetSelect.value);
    if (preset !== undefined && preset.value !== "custom") {
      input.value = preset.pattern;
    }
    update();
    sync(true);
  });
  input.addEventListener("input", () => {
    if (select.value === "regex") {
      const selectedPreset = regexPresets.find(({ value }) => value === regexPresetSelect.value);
      if (selectedPreset !== undefined && selectedPreset.value !== "custom"
        && selectedPreset.pattern !== input.value) {
        regexPresetSelect.value = "custom";
      }
    }
    update();
  });

  wrapper.append(select, regexPresetSelect, input);
  sync();
  return { element: wrapper, sync };
}

function hasArrayWildcard(path) {
  return path.includes("[*]");
}

function pathsEqual(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function getDefaultExtractionPath() {
  const arrayField = schemaRows.find((row) => hasArrayWildcard(row.path) && supportsValueMatch(row.node));
  const primitiveField = schemaRows.find((row) => supportsValueMatch(row.node));
  return [...(arrayField ?? primitiveField ?? schemaRows[0]).path];
}

function toNamePart(value) {
  return String(value)
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map((part, index) => index === 0
      ? part
      : `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("") || "value";
}

function singularizeName(value) {
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }

  return value.endsWith("s") && !value.endsWith("ss") ? value.slice(0, -1) : value;
}

function pluralizeName(value) {
  if (value.endsWith("y") && !value.endsWith("ay") && !value.endsWith("ey")) {
    return `${value.slice(0, -1)}ies`;
  }

  return value.endsWith("s") ? value : `${value}s`;
}

function ordinalName(value) {
  return ["first", "second", "third", "fourth", "fifth"][value - 1] ?? `item${value}`;
}

function getSuggestedExtractionName(path, mode, index) {
  const wildcardIndex = path.indexOf("[*]");
  if (wildcardIndex === -1) {
    return toNamePart(path.at(-1));
  }

  const itemName = singularizeName(toNamePart(path[wildcardIndex - 1]));
  const fieldName = toNamePart(path.at(-1));
  const valueName = fieldName === itemName
    ? pluralizeName(itemName)
    : `${itemName}${fieldName[0].toUpperCase()}${fieldName.slice(1)}`;

  if (mode === "all") {
    return pluralizeName(valueName);
  }

  const itemIndex = mode === "index" ? (index ?? 0) + 1 : 1;
  const prefix = mode === "first" || mode === "index" ? ordinalName(itemIndex) : "first";
  return `${prefix}${valueName[0].toUpperCase()}${valueName.slice(1)}`;
}

function getExtractionError(extraction) {
  const wildcard = hasArrayWildcard(extraction.path);
  if (extraction.variableName.trim() === "") {
    return "Enter a variable name.";
  }

  if (!wildcard && extraction.mode !== "direct") {
    return "This path does not contain an array item.";
  }

  if (wildcard && !["first", "index", "all"].includes(extraction.mode)) {
    return "Choose how to select the array item.";
  }

  if (extraction.mode === "index"
    && (!Number.isInteger(extraction.index) || extraction.index < 0)) {
    return "Enter a zero-based index.";
  }

  return "";
}

function renderExtractionRows() {
  extractionRowsElement.replaceChildren();
  if (extractionRows.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "extraction-empty";
    emptyMessage.textContent = "No values selected for later requests.";
    extractionRowsElement.append(emptyMessage);
    return;
  }

  extractionRows.forEach((extraction, extractionIndex) => {
    const rowElement = document.createElement("div");
    rowElement.className = "extraction-row";

    const sourceSelect = document.createElement("select");
    sourceSelect.setAttribute("aria-label", `Extraction ${extractionIndex + 1} source path`);
    schemaRows.forEach((row, rowIndex) => addSelectOption(sourceSelect, String(rowIndex), row.label));
    const sourceIndex = schemaRows.findIndex((row) => pathsEqual(row.path, extraction.path));
    sourceSelect.value = String(sourceIndex === -1 ? 0 : sourceIndex);
    sourceSelect.addEventListener("change", () => {
      const sourceRow = schemaRows[Number(sourceSelect.value)];
      extraction.path = [...sourceRow.path];
      extraction.mode = hasArrayWildcard(extraction.path) ? "first" : "direct";
      extraction.index = undefined;
      if (extraction.autoName) {
        extraction.variableName = getSuggestedExtractionName(extraction.path, extraction.mode);
      }
      renderExtractionRows();
    });

    const selectionSelect = document.createElement("select");
    selectionSelect.setAttribute("aria-label", `Extraction ${extractionIndex + 1} selection`);
    if (hasArrayWildcard(extraction.path)) {
      [
        { value: "first", label: "First item" },
        { value: "index", label: "Index" },
        { value: "all", label: "All items" },
      ].forEach(({ value, label }) => addSelectOption(selectionSelect, value, label));
    } else {
      addSelectOption(selectionSelect, "direct", "Direct value");
    }
    selectionSelect.value = extraction.mode;
    selectionSelect.addEventListener("change", () => {
      extraction.mode = selectionSelect.value;
      if (extraction.mode === "index" && extraction.index === undefined) {
        extraction.index = 0;
      }
      if (extraction.autoName) {
        extraction.variableName = getSuggestedExtractionName(
          extraction.path,
          extraction.mode,
          extraction.index,
        );
      }
      renderExtractionRows();
    });

    const indexInput = document.createElement("input");
    indexInput.type = "number";
    indexInput.min = "0";
    indexInput.step = "1";
    indexInput.placeholder = "Index";
    indexInput.value = extraction.index ?? "";
    indexInput.disabled = extraction.mode !== "index";
    indexInput.setAttribute("aria-label", `Extraction ${extractionIndex + 1} array index`);
    indexInput.addEventListener("input", () => {
      extraction.index = indexInput.value === "" ? undefined : Number(indexInput.value);
      if (extraction.autoName) {
        extraction.variableName = getSuggestedExtractionName(
          extraction.path,
          extraction.mode,
          extraction.index,
        );
        variableInput.value = extraction.variableName;
      }
    });

    const variableInput = document.createElement("input");
    variableInput.type = "text";
    variableInput.placeholder = "Variable name";
    variableInput.value = extraction.variableName;
    variableInput.placeholder = "e.g. firstChannelId";
    variableInput.setAttribute("aria-label", `Extraction ${extractionIndex + 1} variable name`);
    variableInput.addEventListener("input", () => {
      extraction.variableName = variableInput.value;
      extraction.autoName = false;
    });

    const scopeSelect = document.createElement("select");
    scopeSelect.setAttribute("aria-label", `Extraction ${extractionIndex + 1} variable scope`);
    extractionScopeOptions.forEach(({ value, label }) => addSelectOption(scopeSelect, value, label));
    scopeSelect.value = extraction.scope;
    scopeSelect.addEventListener("change", () => {
      extraction.scope = scopeSelect.value;
    });

    const removeButton = document.createElement("button");
    removeButton.className = "extraction-remove";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove extraction ${extractionIndex + 1}`);
    removeButton.addEventListener("click", () => {
      extractionRows.splice(extractionIndex, 1);
      renderExtractionRows();
    });

    rowElement.append(sourceSelect, selectionSelect, indexInput, variableInput, scopeSelect, removeButton);
    const error = getExtractionError(extraction);
    if (error !== "") {
      rowElement.classList.add("has-error");
      rowElement.title = error;
    }
    extractionRowsElement.append(rowElement);
  });
}

function renderSchema(schema) {
  schemaRows = flattenSchema(schema);
  schemaRowsElement.replaceChildren();

  for (const row of schemaRows) {
    const tableRow = document.createElement("tr");
    const pathCell = document.createElement("td");
    const pathCode = document.createElement("code");
    pathCode.textContent = row.label;
    pathCell.append(pathCode);

    const typeCell = document.createElement("td");
    let valueMatchControls;
    const typeSelect = createSchemaSelect(
      typeOptions,
      typeOptions.map((type) => type === "any" ? "Any type" : type),
      (value) => {
        row.node.type = value;
        if (!supportsValueMatch(row.node)) {
          row.node.valueMatch = null;
          row.matchError = "";
        }
        valueMatchControls?.sync();
      },
    );
    typeSelect.value = row.node.type;
    typeCell.append(typeSelect);

    const nullableCell = document.createElement("td");
    const nullableSelect = createSchemaSelect(
      ["required", "nullable"],
      ["Required", "Nullable"],
      (value) => {
        row.node.nullable = value === "nullable";
      },
    );
    nullableSelect.value = row.node.nullable ? "nullable" : "required";
    nullableCell.append(nullableSelect);

    const valueMatchCell = document.createElement("td");
    valueMatchControls = createValueMatchControls(row);
    valueMatchCell.append(valueMatchControls.element);

    tableRow.append(pathCell, typeCell, nullableCell, valueMatchCell);
    schemaRowsElement.append(tableRow);
  }

  schemaSummary.textContent = `${Math.max(schemaRows.length - 1, 0)} fields`;
  schemaPanel.hidden = false;
  extractionPanel.hidden = getTargetName() !== "Postman";
  renderExtractionRows();
}

function setMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.classList.toggle("is-error", isError);
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toastMessage.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3200);
}

function setOutput(assertions) {
  codeOutput.textContent = assertions;
  copyButton.disabled = false;
  const targetName = getTargetName();
  outputState.textContent = `Ready to paste into ${targetName}`;
  outputCount.textContent = `${assertions.split("\n").length - 1} lines`;
}

function invalidateSchema() {
  if (schemaState === undefined) {
    return;
  }

  schemaState = undefined;
  schemaRows = [];
  extractionRows = [];
  schemaPanel.hidden = true;
  extractionPanel.hidden = true;
  generateButton.disabled = true;
}

responseInput.addEventListener("input", invalidateSchema);
targetInput.addEventListener("change", updateTargetLabels);
updateTargetLabels();

fetchStructureButton.addEventListener("click", () => {
  try {
    schemaState = inferSchema(responseInput.value);
    renderSchema(schemaState);
    generateButton.disabled = false;
    setMessage("Structure fetched. Review the fields, then generate assertions.");
    showToast(`Structure fetched · ${Math.max(schemaRows.length - 1, 0)} fields`);
  } catch (error) {
    invalidateSchema();
    setMessage(error.message, true);
    showToast(error.message, true);
  }
});

addExtractionButton.addEventListener("click", () => {
  if (schemaState === undefined || schemaRows.length === 0) {
    return;
  }

  const path = getDefaultExtractionPath();
  extractionRows.push({
    path,
    mode: hasArrayWildcard(path) ? "first" : "direct",
    index: undefined,
    variableName: getSuggestedExtractionName(path, hasArrayWildcard(path) ? "first" : "direct"),
    autoName: true,
    scope: "environment",
  });
  renderExtractionRows();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  setMessage("");

  if (schemaState === undefined) {
    setMessage("Fetch the response structure before generating assertions.", true);
    showToast("Fetch the response structure first.", true);
    return;
  }

  const invalidMatch = schemaRows.find((row) => row.matchError);
  if (invalidMatch !== undefined) {
    setMessage(`Invalid value rule for ${invalidMatch.label}: ${invalidMatch.matchError}`, true);
    showToast("Fix the value rule before generating.", true);
    return;
  }

  const invalidExtraction = extractionRows.find((extraction) => getExtractionError(extraction) !== "");
  if (invalidExtraction !== undefined) {
    const error = getExtractionError(invalidExtraction);
    setMessage(`Invalid extraction: ${error}`, true);
    showToast("Fix the extraction settings before generating.", true);
    return;
  }

  try {
    const assertions = generateAssertions(responseInput.value, {
      status: statusInput.value,
      schema: schemaState,
      target: targetInput.value,
      assertDataTypes: assertDataTypesInput.checked,
      extractions: targetInput.value === "postman"
        ? extractionRows.map(({ path, mode, index, variableName, scope }) => ({
          path,
          mode,
          index,
          variableName,
          scope,
        }))
        : [],
    });
    setOutput(assertions);
    setMessage("Assertions generated.");
    showToast(`${getTargetName()} assertions generated successfully · ${assertions.split("\n").length - 1} lines`);
  } catch (error) {
    copyButton.disabled = true;
    outputState.textContent = "Generation failed";
    outputCount.textContent = "0 lines";
    setMessage(error.message, true);
    showToast(error.message, true);
  }
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(codeOutput.textContent);
  copyButton.textContent = "Copied";
  setTimeout(() => {
    copyButton.textContent = "Copy";
  }, 1400);
});
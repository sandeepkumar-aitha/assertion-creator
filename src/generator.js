const INDENT = "    ";

function parseResponse(response) {
  if (typeof response === "string") {
    try {
      return JSON.parse(response);
    } catch (error) {
      throw new TypeError(`Response is not valid JSON: ${error.message}`);
    }
  }

  return response;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createSchemaNode(type, nullable = false, optional = false) {
  return {
    type,
    nullable,
    optional,
    valueMatch: null,
    children: {},
    item: null,
  };
}

function getPrimitiveType(value) {
  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "any";
}

function mergeSchemaNodes(nodes) {
  if (nodes.length === 0) {
    return createSchemaNode("any", true);
  }

  const nullable = nodes.some((node) => node.nullable);
  const optional = nodes.some((node) => node.optional);
  const types = [...new Set(nodes.map((node) => node.type).filter((type) => type !== "any"))];
  const type = types.length === 1 ? types[0] : "any";

  if (type === "object") {
    const keys = [...new Set(nodes.flatMap((node) => Object.keys(node.children)))];
    const children = {};
    for (const key of keys) {
      const childNodes = nodes.map((node) =>
        node.children[key] ?? createSchemaNode("any", false, true));
      children[key] = mergeSchemaNodes(childNodes);
    }

    return { ...createSchemaNode(type, nullable, optional), children };
  }

  if (type === "array") {
    const itemNodes = nodes
      .map((node) => node.item)
      .filter((node) => node !== null);
    return {
      ...createSchemaNode(type, nullable, optional),
      item: itemNodes.length > 0 ? mergeSchemaNodes(itemNodes) : null,
    };
  }

  return createSchemaNode(type, nullable, optional);
}

function inferSchemaValue(value) {
  if (value === null) {
    return createSchemaNode("any", true);
  }

  if (Array.isArray(value)) {
    return {
      ...createSchemaNode("array"),
      item: value.length > 0 ? mergeSchemaNodes(value.map(inferSchemaValue)) : null,
    };
  }

  if (isObject(value)) {
    const children = Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [key, inferSchemaValue(childValue)]),
    );
    return { ...createSchemaNode("object"), children };
  }

  return createSchemaNode(getPrimitiveType(value));
}

export function inferSchema(response) {
  return inferSchemaValue(parseResponse(response));
}

function isIdentifier(value) {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function formatProperty(expression, property) {
  return isIdentifier(property)
    ? `${expression}.${property}`
    : `${expression}[${JSON.stringify(property)}]`;
}

function formatKeys(keys) {
  return keys.map((key) => JSON.stringify(key)).join(", ");
}

function formatTypes(types) {
  return JSON.stringify(types);
}

function getTargetConfig(target = "postman") {
  if (target === "postman") {
    return {
      expectExpression: "pm.expect",
      rootExpression: "response",
      bodyIndent: 1,
      openingLines: ['pm.test("Positive Scenario", function () {'],
      setupLines: ["let response = pm.response.json();"],
      statusLine: (status) => `pm.response.to.have.status(${status});`,
      closingLines: ["});"],
    };
  }

  if (target === "axios") {
    return {
      expectExpression: "expect",
      rootExpression: "response.data",
      bodyIndent: 0,
      openingLines: ["// Assumes an Axios response is available as response."],
      setupLines: [],
      statusLine: (status) => `expect(response.status, "HTTP status should match expected status.").to.equal(${status});`,
      closingLines: [],
    };
  }

  throw new TypeError("Target must be either postman or axios.");
}

function addLine(lines, indent, content) {
  lines.push(`${INDENT.repeat(indent)}${content}`);
}

function formatLiteral(value) {
  const literal = JSON.stringify(value);
  if (literal === undefined) {
    throw new TypeError("Expected match values must be JSON-compatible.");
  }

  return literal;
}

const scalarValueMatchRules = {
  exact: { message: "equal the expected value", chain: "to.equal" },
  notEqual: { message: "not equal the expected value", chain: "to.not.equal" },
  greaterThan: { message: "be greater than the expected value", chain: "to.be.greaterThan" },
  greaterThanOrEqual: { message: "be greater than or equal to the expected value", chain: "to.be.at.least" },
  lessThan: { message: "be less than the expected value", chain: "to.be.lessThan" },
  lessThanOrEqual: { message: "be less than or equal to the expected value", chain: "to.be.at.most" },
  contains: {
    message: "contain the expected value",
    chain: "to.be.true",
    expression: (valueExpression, expectedValue) =>
      `typeof ${valueExpression} === "string" && ${valueExpression}.includes(${expectedValue})`,
  },
  startsWith: {
    message: "start with the expected value",
    chain: "to.be.true",
    expression: (valueExpression, expectedValue) =>
      `typeof ${valueExpression} === "string" && ${valueExpression}.startsWith(${expectedValue})`,
  },
  endsWith: {
    message: "end with the expected value",
    chain: "to.be.true",
    expression: (valueExpression, expectedValue) =>
      `typeof ${valueExpression} === "string" && ${valueExpression}.endsWith(${expectedValue})`,
  },
};

function createRegexValueMatchAssertion(valueExpression, labelExpression, valueMatch, expectExpression) {
  const pattern = valueMatch.pattern;
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new TypeError("Regex value matches must provide a pattern.");
  }

  try {
    new RegExp(pattern);
  } catch (error) {
    throw new TypeError(`Regex value match must be valid: ${error.message}`);
  }

  const regexLiteral = `new RegExp(${formatLiteral(pattern)})`;
  const message = `${labelExpression} + " should match the expected regular expression."`;
  return `${expectExpression}(typeof ${valueExpression} === "string" && ${regexLiteral}.test(${valueExpression}), ${message}).to.be.true;`;
}

function renderScalarValueMatch(rule, valueExpression, expectedValue, message, expectExpression) {
  const assertionValue = rule.expression === undefined
    ? valueExpression
    : rule.expression(valueExpression, expectedValue);
  const expectedArgument = rule.expression === undefined ? `(${expectedValue})` : "";
  return `${expectExpression}(${assertionValue}, ${message}).${rule.chain}${expectedArgument};`;
}

function createValueMatchAssertion(valueExpression, labelExpression, schemaNode, expectExpression) {
  const valueMatch = schemaNode.valueMatch;
  if (valueMatch === null || valueMatch === undefined) {
    return undefined;
  }

  if (!isObject(valueMatch)) {
    throw new TypeError("Value match must be an object.");
  }

  if (schemaNode.type === "object" || schemaNode.type === "array") {
    throw new TypeError("Value matching is supported only for primitive values.");
  }

  const mode = valueMatch.mode;
  if (mode === "regex") {
    return createRegexValueMatchAssertion(
      valueExpression,
      labelExpression,
      valueMatch,
      expectExpression,
    );
  }

  if (mode === "oneOf") {
    if (!Array.isArray(valueMatch.values) || valueMatch.values.length === 0) {
      throw new TypeError("One-of value matches must provide at least one value.");
    }

    return `${expectExpression}(${valueExpression}, ${labelExpression} + " should match one of the expected values.").to.be.oneOf(${formatLiteral(valueMatch.values)});`;
  }

  const rule = Object.hasOwn(scalarValueMatchRules, mode)
    ? scalarValueMatchRules[mode]
    : undefined;
  if (rule === undefined) {
    throw new TypeError("Value match mode must be exact, oneOf, regex, notEqual, greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual, contains, startsWith, or endsWith.");
  }

  if (!Object.hasOwn(valueMatch, "value")) {
    throw new TypeError(`${mode} value matches must provide a value.`);
  }

  const expectedValue = formatLiteral(valueMatch.value);
  const message = `${labelExpression} + " should ${rule.message}."`;
  return renderScalarValueMatch(rule, valueExpression, expectedValue, message, expectExpression);
}

function addValueMatchAssertion(
  valueExpression,
  labelExpression,
  schemaNode,
  expectExpression,
  lines,
  indent,
) {
  const valueMatchAssertion = createValueMatchAssertion(
    valueExpression,
    labelExpression,
    schemaNode,
    expectExpression,
  );
  if (valueMatchAssertion === undefined) {
    return;
  }

  if (schemaNode.nullable) {
    addLine(lines, indent, `if (${valueExpression} !== null) {`);
    addLine(lines, indent + 1, valueMatchAssertion);
    addLine(lines, indent, "}");
    return;
  }

  addLine(lines, indent, valueMatchAssertion);
}

function singularize(value) {
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }

  return value.endsWith("s") && !value.endsWith("ss") ? value.slice(0, -1) : value;
}

function toIdentifierName(value) {
  const name = String(value).replace(/[^A-Za-z0-9_$]/g, "");
  if (name === "") {
    return "";
  }

  return /^[A-Za-z_$]/.test(name) ? name : `field${name}`;
}

function formatNamePart(value) {
  const words = String(value).split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const name = words.map((word, index) => index === 0
    ? word
    : `${word[0].toUpperCase()}${word.slice(1)}`).join("");
  return toIdentifierName(name);
}

function deriveRegistryBaseName(baseName, path) {
  const contextPath = path[0] === "response" ? path.slice(1) : path;
  if (contextPath.length < 2) {
    return baseName;
  }

  const pathName = contextPath.map((part, index) => {
    const namePart = formatNamePart(part);
    return index === 0 || namePart === ""
      ? namePart
      : `${namePart[0].toUpperCase()}${namePart.slice(1)}`;
  }).join("");
  return pathName || baseName;
}

function inferObjectName(value, path) {
  const keys = isObject(value) ? Object.keys(value) : [];

  if (keys.includes("configName")) {
    return "config";
  }

  if (keys.includes("localeCode") && keys.includes("answerText")) {
    return "localization";
  }

  if (keys.includes("localizations") && keys.includes("displayLocale")) {
    return "answer";
  }

  if (keys.includes("content") && keys.includes("pageDetails") && keys.includes("sortDetails")) {
    return "responseData";
  }

  if (path.length === 0) {
    return "response";
  }

  return singularize(String(path.at(-1)));
}

function inferArrayItemName(value, path) {
  const objectValue = value.find(isObject);
  if (objectValue !== undefined) {
    return inferObjectName(objectValue, path);
  }

  if (path.length === 0) {
    return "item";
  }

  return singularize(String(path.at(-1)));
}

function mergeObjectArray(value) {
  const objects = value.filter(isObject);
  const allKeys = [...new Set(objects.flatMap((item) => Object.keys(item)))];
  const mergedValue = {};

  for (const key of allKeys) {
    const keyValues = objects
      .filter((item) => Object.hasOwn(item, key))
      .map((item) => item[key]);
    mergedValue[key] = keyValues.find((item) => item !== null) ?? null;
  }

  return mergedValue;
}

function areAllArraysNonEmpty(values) {
  return values.length > 0
    && values.every((value) => Array.isArray(value) && value.length > 0);
}

function createKeyRegistry() {
  const definitions = [];
  const namesBySignature = new Map();
  const usedNames = new Set();

  function register(keys, baseName) {
    const signature = `${baseName}:${JSON.stringify(keys)}`;
    const existingName = namesBySignature.get(signature);
    if (existingName !== undefined) {
      return existingName;
    }

    const safeBaseName = toIdentifierName(baseName) || "response";
    let name = `${safeBaseName}Keys`;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${safeBaseName}Keys${suffix}`;
      suffix += 1;
    }

    usedNames.add(name);
    namesBySignature.set(signature, name);
    definitions.push({ name, keys });
    return name;
  }

  return { definitions, register };
}

function createTypeRegistry() {
  const definitions = [];
  const namesBySignature = new Map();
  const usedNames = new Set();

  function register(types, baseName) {
    const signature = `${baseName}:${JSON.stringify(types)}`;
    const existingName = namesBySignature.get(signature);
    if (existingName !== undefined) {
      return existingName;
    }

    const safeBaseName = toIdentifierName(baseName) || "response";
    let name = `${safeBaseName}Types`;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${safeBaseName}Types${suffix}`;
      suffix += 1;
    }

    usedNames.add(name);
    namesBySignature.set(signature, name);
    definitions.push({ name, types });
    return name;
  }

  return { definitions, register };
}

function addValueLoop(
  valueExpression,
  keysName,
  keyMetadata,
  lines,
  indent,
  options = {},
) {
  const { assertDataTypes, typesName, valueMatches, expectExpression } = options;
  const { nullableKeysName, optionalKeysName } = keyMetadata;
  addLine(lines, indent, `${keysName}.forEach(function (key) {`);

  const hasOptionalKeys = optionalKeysName !== undefined;
  const optionalIndent = hasOptionalKeys ? indent + 1 : indent;
  if (hasOptionalKeys) {
    addLine(
      lines,
      indent + 1,
      `if (!${optionalKeysName}.includes(key) || Object.hasOwn(${valueExpression}, key)) {`,
    );
  }

  const loopIndent = optionalIndent + 1;
  const label = `\`\${key} of ${valueExpression}\``;
  const valueArguments = assertDataTypes
    ? `${valueExpression}[key], ${label}, ${typesName}[key], ${nullableKeysName ?? "[]"}.includes(key)`
    : `${valueExpression}[key], ${label}, ${nullableKeysName ?? "[]"}.includes(key)`;
  addLine(
    lines,
    loopIndent,
    `assertValue(${valueArguments});`,
  );
  for (const [key, schemaNode] of Object.entries(valueMatches ?? {})) {
    if (schemaNode.valueMatch === null || schemaNode.valueMatch === undefined) {
      continue;
    }

    addLine(lines, loopIndent, `if (key === ${formatLiteral(key)}) {`);
    addValueMatchAssertion(
      `${valueExpression}[key]`,
      label,
      schemaNode,
      expectExpression,
      lines,
      loopIndent + 1,
    );
    addLine(lines, loopIndent, "}");
  }

  if (hasOptionalKeys) {
    addLine(lines, indent + 1, "}");
  }

  addLine(lines, indent, "});");
}

function createRenderer(target, options = {}) {
  const assertDataTypes = options.assertDataTypes !== false;
  const keyRegistry = createKeyRegistry();
  const nullableKeyRegistry = createKeyRegistry();
  const optionalKeyRegistry = createKeyRegistry();
  const typeRegistry = createTypeRegistry();

  function addNestedObjectAssertions(
    value,
    expression,
    path,
    schemaNode,
    lines,
    indent,
    sampleValues = [value],
  ) {
    const children = schemaNode.children ?? {};

    for (const key of Object.keys(children)) {
      const childSchema = children[key];
      const childValue = value?.[key];
      if (childValue === null || childValue === undefined) {
        continue;
      }

      if (childSchema.type !== "object" && childSchema.type !== "array") {
        continue;
      }

      const childExpression = formatProperty(expression, key);
      const isOptional = childSchema.nullable;
      const childIndent = isOptional ? indent + 1 : indent;
      const childSampleValues = sampleValues
        .filter(isObject)
        .map((sampleValue) => sampleValue[key]);
      const presentChildValues = childSampleValues
        .filter((sampleValue) => sampleValue !== null && sampleValue !== undefined);
      const childMetadata = {
        schema: childSchema,
        assertValue: false,
      };
      if (childSchema.type === "array") {
        childMetadata.requireNonEmpty = areAllArraysNonEmpty(presentChildValues);
      }
      if (isOptional) {
        addLine(lines, indent, `if (${childExpression} !== null && ${childExpression} !== undefined) {`);
      }
      addValueAssertions(
        childValue,
        childExpression,
        [...path, key],
        lines,
        childIndent,
        childMetadata,
      );
      if (isOptional) {
        addLine(lines, indent, "}");
      }
    }
  }

  function addObjectAssertions(value, expression, path, lines, indent, metadata = {}) {
    const schemaNode = metadata.schema ?? inferSchema(value);
    const children = schemaNode.children ?? {};
    const keys = Object.keys(children);
    const baseName = metadata.baseName ?? inferObjectName(value, path);
    const registryBaseName = deriveRegistryBaseName(baseName, metadata.namePath ?? path);
    const keysName = keyRegistry.register(keys, registryBaseName);
    const nullableKeys = new Set(keys.filter((key) => children[key].nullable));
    const nullableKeysName = nullableKeys.size > 0
      ? nullableKeyRegistry.register([...nullableKeys], `${registryBaseName}Nullable`)
      : undefined;
    const optionalKeys = new Set(keys.filter((key) => children[key].optional));
    const optionalKeysName = optionalKeys.size > 0
      ? optionalKeyRegistry.register([...optionalKeys], `${registryBaseName}Optional`)
      : undefined;
    const typesName = assertDataTypes
      ? typeRegistry.register(
        Object.fromEntries(keys.map((key) => [key, children[key].type])),
        registryBaseName,
      )
      : undefined;
    const locationExpression = metadata.mismatchLocationExpression ?? JSON.stringify(expression);
    const expectedKeysArguments = optionalKeysName === undefined
      ? `${expression}, ${keysName}, ${locationExpression}`
      : `${expression}, ${keysName}, ${locationExpression}, ${optionalKeysName}`;

    addLine(lines, indent, `assertExpectedKeys(${expectedKeysArguments});`);
    addValueLoop(
      expression,
      keysName,
      { nullableKeysName, optionalKeysName },
      lines,
      indent,
      {
        assertDataTypes,
        typesName,
        expectExpression: target.expectExpression,
        valueMatches: children,
      },
    );
    addNestedObjectAssertions(
      value,
      expression,
      path,
      schemaNode,
      lines,
      indent,
      metadata.sampleValues ?? [value],
    );
  }

  function addArrayTypeAssertion(expression, lines, indent) {
    if (assertDataTypes) {
      addLine(lines, indent, `${target.expectExpression}(${expression}).to.be.an("array");`);
    }
  }

  function addArrayItemAssertion(itemName, itemLabel, itemSchema, lines, indent) {
    const assertion = assertDataTypes
      ? `assertValue(${itemName}, ${itemLabel}, ${JSON.stringify(itemSchema.type)}, ${itemSchema.nullable});`
      : `assertValue(${itemName}, ${itemLabel}, ${itemSchema.nullable});`;
    addLine(lines, indent, assertion);
    addValueMatchAssertion(
      itemName,
      itemLabel,
      itemSchema,
      target.expectExpression,
      lines,
      indent,
    );
  }

  function addArrayItemStructure(
    itemValue,
    itemName,
    itemSchema,
    context,
  ) {
    const { path, values, itemLabel, lines, indent } = context;
    if (itemSchema.type !== "object" && itemSchema.type !== "array") {
      return;
    }

    const structureIndent = itemSchema.nullable ? indent + 2 : indent + 1;
    if (itemSchema.nullable) {
      addLine(lines, indent + 1, `if (${itemName} !== null && ${itemName} !== undefined) {`);
    }

    if (itemSchema.type === "object") {
      addObjectAssertions(itemValue, itemName, [...path, itemName], lines, structureIndent, {
        baseName: itemName,
        namePath: path,
        schema: itemSchema,
        sampleValues: values.filter(isObject),
        mismatchLocationExpression: itemLabel,
      });
    } else {
      const arrayItemValues = values.filter((item) => Array.isArray(item));
      addArrayAssertions(itemValue, itemName, [...path, itemName], lines, structureIndent, {
        schema: itemSchema,
        requireNonEmpty: areAllArraysNonEmpty(arrayItemValues),
      });
    }

    if (itemSchema.nullable) {
      addLine(lines, indent + 1, "}");
    }
  }

  function addArrayAssertions(value, expression, path, lines, indent, metadata = {}) {
    const schemaNode = metadata.schema ?? inferSchema(value);
    const values = Array.isArray(value) ? value : [];
    addArrayTypeAssertion(expression, lines, indent);
    if (values.length === 0) {
      return;
    }

    if (metadata.requireNonEmpty !== false) {
      addLine(lines, indent, `${target.expectExpression}(${expression}.length).to.be.greaterThan(0);`);
    }
    const objectValues = values.filter(isObject);
    const itemSchema = schemaNode.item;
    const itemValue = itemSchema?.type === "object" && objectValues.length > 0
      ? mergeObjectArray(objectValues)
      : values.find((item) => item !== null);
    if (itemValue === undefined || itemSchema === null) {
      return;
    }

    const itemName = inferArrayItemName(values, path);
    addLine(lines, indent, `${expression}.forEach((${itemName}, index) => {`);

    const itemLabel = `\`${itemName} at [\${index}]\``;
    addArrayItemAssertion(itemName, itemLabel, itemSchema, lines, indent + 1);
    addArrayItemStructure(
      itemValue,
      itemName,
      itemSchema,
      { path, values, itemLabel, lines, indent },
    );

    addLine(lines, indent, "});");
  }

  function addValueAssertions(value, expression, path, lines, indent, metadata = {}) {
    const schemaNode = metadata.schema ?? inferSchema(value);
    if (metadata.assertValue !== false) {
      addLine(
        lines,
        indent,
        assertDataTypes
          ? `assertValue(${expression}, ${JSON.stringify(expression)}, ${JSON.stringify(schemaNode.type)}, ${schemaNode.nullable});`
          : `assertValue(${expression}, ${JSON.stringify(expression)}, ${schemaNode.nullable});`,
      );
    }

    addValueMatchAssertion(
      expression,
      JSON.stringify(expression),
      schemaNode,
      target.expectExpression,
      lines,
      indent,
    );

    if (schemaNode.type === "object") {
      addObjectAssertions(value, expression, path, lines, indent, { ...metadata, schema: schemaNode });
    } else if (schemaNode.type === "array") {
      addArrayAssertions(value, expression, path, lines, indent, { ...metadata, schema: schemaNode });
    }
  }

  return {
    assertDataTypes,
    keyRegistry,
    nullableKeyRegistry,
    optionalKeyRegistry,
    typeRegistry,
    addValueAssertions,
  };
}

function validateStatus(status) {
  if (status === undefined) {
    return undefined;
  }

  const numericStatus = Number(status);
  if (!Number.isInteger(numericStatus) || numericStatus < 100 || numericStatus > 599) {
    throw new TypeError("Status must be an HTTP status code between 100 and 599.");
  }

  return numericStatus;
}

const extractionSetters = {
  collection: "pm.collectionVariables",
  environment: "pm.environment",
  global: "pm.globals",
};
const reservedExtractionNames = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "finally", "for", "function", "if",
  "import", "in", "instanceof", "let", "new", "return", "static", "super", "switch",
  "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield",
]);

function formatExtractionPath(path) {
  return path.reduce((label, part, index) => {
    if (index === 0) {
      return part;
    }

    return part === "[*]" ? `${label}[*]` : `${label}.${part}`;
  }, "");
}

function normalizeExtractions(extractions, target) {
  if (extractions === undefined) {
    return [];
  }

  if (!Array.isArray(extractions)) {
    throw new TypeError("Extractions must be an array.");
  }

  if (extractions.length === 0) {
    return [];
  }

  if (target !== "postman") {
    throw new TypeError("Variable extraction is only supported for the postman target.");
  }

  return extractions.map((extraction, extractionIndex) => {
    if (!isObject(extraction)) {
      throw new TypeError(`Extraction ${extractionIndex + 1} must be an object.`);
    }

    const path = extraction.path;
    if (!Array.isArray(path) || path.length === 0 || path[0] !== "response"
      || path.some((part) => typeof part !== "string")) {
      throw new TypeError(`Extraction ${extractionIndex + 1} must use a response path array.`);
    }

    const wildcardIndexes = path
      .map((part, index) => part === "[*]" ? index : -1)
      .filter((index) => index !== -1);
    if (wildcardIndexes.length > 1) {
      throw new TypeError(`Extraction ${extractionIndex + 1} supports only one array wildcard.`);
    }

    const mode = extraction.mode ?? (wildcardIndexes.length === 0 ? "direct" : "first");
    const hasWildcard = wildcardIndexes.length === 1;
    if (!hasWildcard && mode !== "direct") {
      throw new TypeError(`Extraction ${extractionIndex + 1} must use direct mode for a non-array path.`);
    }
    if (hasWildcard && !["first", "index", "all"].includes(mode)) {
      throw new TypeError(`Extraction ${extractionIndex + 1} must use first, index, or all mode.`);
    }

    let index;
    if (mode === "index") {
      index = Number(extraction.index);
      if (!Number.isInteger(index) || index < 0) {
        throw new TypeError(`Extraction ${extractionIndex + 1} index must be a non-negative integer.`);
      }
    }

    const variableName = typeof extraction.variableName === "string"
      ? extraction.variableName.trim()
      : "";
    if (variableName === "") {
      throw new TypeError(`Extraction ${extractionIndex + 1} requires a variable name.`);
    }
    const formattedVariableName = formatNamePart(variableName) || `value${extractionIndex + 1}`;
    const localName = reservedExtractionNames.has(formattedVariableName)
      ? `value${formattedVariableName[0].toUpperCase()}${formattedVariableName.slice(1)}`
      : formattedVariableName;

    const scope = extraction.scope ?? "environment";
    if (!Object.hasOwn(extractionSetters, scope)) {
      throw new TypeError(`Extraction ${extractionIndex + 1} scope must be collection, environment, or global.`);
    }

    return {
      path,
      mode,
      index,
      variableName,
      localName,
      scope,
      label: formatExtractionPath(path),
    };
  });
}

function formatPathExpression(expression, path, optional = false) {
  return path.reduce((currentExpression, part) => {
    if (part === "[*]") {
      throw new TypeError("Array wildcards must be selected through an extraction mode.");
    }

    if (!optional) {
      return formatProperty(currentExpression, part);
    }

    return isIdentifier(part)
      ? `${currentExpression}?.${part}`
      : `${currentExpression}?.[${JSON.stringify(part)}]`;
  }, expression);
}

function createExtractionExpression(extraction, rootExpression, extractionNumber) {
  const path = extraction.path.slice(1);
  const wildcardIndex = path.indexOf("[*]");
  if (wildcardIndex === -1) {
    return formatPathExpression(rootExpression, path, true);
  }

  const arrayExpression = formatPathExpression(rootExpression, path.slice(0, wildcardIndex));
  const suffix = path.slice(wildcardIndex + 1);
  if (extraction.mode === "all") {
    const itemName = `extractedItem${extractionNumber}`;
    return `${arrayExpression}.map((${itemName}) => ${formatPathExpression(itemName, suffix, true)})`;
  }

  const selectedIndex = extraction.mode === "first" ? 0 : extraction.index;
  return formatPathExpression(`${arrayExpression}[${selectedIndex}]`, suffix, true);
}

function addExtractionAssertions(extractions, target, lines, indent) {
  if (extractions.length === 0) {
    return;
  }

  for (const [index, extraction] of extractions.entries()) {
    const extractionNumber = index + 1;
    const valueName = extraction.localName;
    const valueExpression = createExtractionExpression(extraction, target.rootExpression, extractionNumber);
    const label = JSON.stringify(`Unable to extract ${extraction.label}.`);
    addLine(lines, indent, "{");
    addLine(lines, indent + 1, `const ${valueName} = ${valueExpression};`);

    if (extraction.mode === "all") {
      addLine(lines, indent + 1, `${target.expectExpression}(${valueName}, ${label}).to.be.an("array");`);
      addLine(lines, indent + 1, `${target.expectExpression}(${valueName}.every((value) => value !== undefined), ${label} + " One or more values are missing.").to.be.true;`);
    } else {
      addLine(lines, indent + 1, `${target.expectExpression}(${valueName}, ${label}).to.not.equal(undefined);`);
    }

    addLine(
      lines,
      indent + 1,
      `${extractionSetters[extraction.scope]}.set(${JSON.stringify(extraction.variableName)}, typeof ${valueName} === "string" ? ${valueName} : JSON.stringify(${valueName}));`,
    );
    addLine(lines, indent, "}");
  }
}

export function generateAssertions(response, options = {}) {
  const parsedResponse = parseResponse(response);
  const status = validateStatus(options.status);
  const schema = options.schema ?? inferSchema(parsedResponse);
  const target = getTargetConfig(options.target);
  const extractions = normalizeExtractions(options.extractions, options.target ?? "postman");
  const renderer = createRenderer(target, options);
  const body = [];
  renderer.addValueAssertions(parsedResponse, target.rootExpression, [], body, target.bodyIndent, { schema });
  const lines = [...target.openingLines];
  const indent = target.bodyIndent;
  const expectExpression = target.expectExpression;

  if (renderer.assertDataTypes) {
    addLine(lines, indent, "function assertValue(value, label, expectedType, isNullable) {");
    addLine(lines, indent + 1, "if (value === null && isNullable) return;");
    addLine(lines, indent + 1, `${expectExpression}(value, label + " should not be null.").to.not.equal(null);`);
    addLine(lines, indent + 1, "if (expectedType === \"any\") return;");
    addLine(lines, indent + 1, "if (expectedType === \"integer\") {");
    addLine(lines, indent + 2, `${expectExpression}(Number.isInteger(value), label + " should be an integer.").to.be.true;`);
    addLine(lines, indent + 1, "} else {");
    addLine(lines, indent + 2, `${expectExpression}(value, label + " should be a " + expectedType + ".").to.be.a(expectedType);`);
    addLine(lines, indent + 1, "}");
    addLine(lines, indent + 1, "if (expectedType === \"string\") {");
    addLine(lines, indent + 2, `${expectExpression}(value, label + " should not be empty.").to.not.equal("");`);
    addLine(lines, indent + 1, "}");
  } else {
    addLine(lines, indent, "function assertValue(value, label, isNullable) {");
    addLine(lines, indent + 1, "if (value === null && isNullable) return;");
    addLine(lines, indent + 1, `${expectExpression}(value, label + " should not be null.").to.not.equal(null);`);
  }
  addLine(lines, indent, "}");
  lines.push("");

  addLine(lines, indent, "function assertExpectedKeys(value, expectedKeys, label, optionalKeys = []) {");
  addLine(lines, indent + 1, "const missingKeys = expectedKeys.filter((key) => !optionalKeys.includes(key) && !Object.hasOwn(value, key));");
  addLine(lines, indent + 1, "const unexpectedKeys = Object.keys(value).filter((key) => !expectedKeys.includes(key));");
  addLine(lines, indent + 1, `${expectExpression}(`);
  addLine(lines, indent + 2, "missingKeys.length === 0 && unexpectedKeys.length === 0,");
  addLine(lines, indent + 2, "`Key mismatch in ${label}. Missing: ${missingKeys.length > 0 ? missingKeys.join(\", \") : \"none\"}. Unexpected: ${unexpectedKeys.length > 0 ? unexpectedKeys.join(\", \") : \"none\"}.`,");
  addLine(lines, indent + 1, ").to.be.true;");
  addLine(lines, indent, "}");
  lines.push("");

  for (const definition of renderer.keyRegistry.definitions) {
    addLine(lines, indent, `let ${definition.name} = [${formatKeys(definition.keys)}];`);
  }

  for (const definition of renderer.nullableKeyRegistry.definitions) {
    addLine(lines, indent, `let ${definition.name} = [${formatKeys(definition.keys)}];`);
  }

  for (const definition of renderer.optionalKeyRegistry.definitions) {
    addLine(lines, indent, `let ${definition.name} = [${formatKeys(definition.keys)}];`);
  }

  for (const definition of renderer.typeRegistry.definitions) {
    addLine(lines, indent, `let ${definition.name} = ${formatTypes(definition.types)};`);
  }

  if (renderer.keyRegistry.definitions.length > 0
    || renderer.nullableKeyRegistry.definitions.length > 0
    || renderer.optionalKeyRegistry.definitions.length > 0
    || renderer.typeRegistry.definitions.length > 0) {
    lines.push("");
  }

  if (status !== undefined) {
    addLine(lines, indent, target.statusLine(status));
  }

  for (const setupLine of target.setupLines) {
    addLine(lines, indent, setupLine);
  }
  lines.push(...body);
  addExtractionAssertions(extractions, target, lines, indent);

  for (const closingLine of target.closingLines) {
    lines.push(closingLine);
  }

  return `${lines.join("\n")}\n`;
}

import test from "node:test";
import assert from "node:assert/strict";
import { generateAssertions, inferSchema } from "../src/generator.js";

function createPostmanContext(response, variables) {
  function expect(value, label) {
    const be = {
      a(expectedType) {
        const actualType = expectedType === "array"
          ? (Array.isArray(value) ? "array" : typeof value)
          : typeof value;
        assert.equal(actualType, expectedType, label);
      },
      an(expectedType) {
        const actualType = expectedType === "array"
          ? (Array.isArray(value) ? "array" : typeof value)
          : typeof value;
        assert.equal(actualType, expectedType, label);
      },
      oneOf(expectedValues) {
        assert.ok(expectedValues.includes(value), label);
      },
      greaterThan(expected) {
        assert.ok(value > expected, label);
      },
      lessThan(expected) {
        assert.ok(value < expected, label);
      },
      at: {
        least(expected) {
          assert.ok(value >= expected, label);
        },
        most(expected) {
          assert.ok(value <= expected, label);
        },
      },
    };
    Object.defineProperty(be, "true", {
      get() {
        assert.equal(value, true, label);
        return true;
      },
    });

    return {
      to: {
        not: {
          equal(expected) {
            assert.notStrictEqual(value, expected, label);
          },
        },
        equal(expected) {
          assert.strictEqual(value, expected, label);
        },
        be,
      },
    };
  }

  return {
    test(_name, callback) {
      callback();
    },
    expect,
    collectionVariables: {
      set(name, value) {
        variables.collection[name] = value;
      },
    },
    environment: {
      set(name, value) {
        variables.environment[name] = value;
      },
    },
    globals: {
      set(name, value) {
        variables.global[name] = value;
      },
    },
    response: {
      json() {
        return response;
      },
      to: {
        have: {
          status(expectedStatus) {
            assert.equal(expectedStatus, 200);
          },
        },
      },
    },
  };
}

function runPostmanAssertions(assertions, response, variables = {
  collection: {},
  environment: {},
  global: {},
}) {
  new Function("pm", assertions)(createPostmanContext(response, variables));
  return variables;
}

test("generates schema assertions for nested JSON values", () => {
  const assertions = generateAssertions({
    id: 123,
    active: true,
    profile: {
      name: "Ada",
    },
    tags: ["api", "test"],
  });

  assert.match(assertions, /pm\.test\("Positive Scenario"/);
  assert.match(assertions, /function assertExpectedKeys\(value, expectedKeys, label, optionalKeys = \[\]\)/);
  assert.match(assertions, /assertExpectedKeys\(response, responseKeys, "response"\)/);
  assert.match(assertions, /let responseKeys = \["id", "active", "profile", "tags"\];/);
  assert.match(assertions, /responseKeys\.forEach\(function \(key\)/);
  assert.match(assertions, /const missingKeys = expectedKeys\.filter/);
  assert.match(assertions, /const unexpectedKeys = Object\.keys\(value\)\.filter/);
  assert.match(assertions, /assertValue\(response\[key\], `\$\{key\} of response`, responseTypes\[key\],/);
  assert.match(assertions, /should not be empty/);
  assert.match(assertions, /let profileKeys = \["name"\];/);
  assert.match(assertions, /pm\.expect\(response\.tags\)\.to\.be\.an\("array"\)/);
  assert.match(assertions, /response\.tags\.forEach\(\(tag, index\) =>/);
  assert.doesNotMatch(assertions, /response\.tags\[0\]/);
  assert.doesNotMatch(assertions, /\.to\.eql\(/);
});

test("does not require mixed nested arrays to be non-empty", () => {
  const assertions = generateAssertions({
    content: [
      { subCategories: ["account-management"] },
      { subCategories: [] },
    ],
  });

  assert.doesNotMatch(
    assertions,
    /pm\.expect\(content\.subCategories\.length\)\.to\.be\.greaterThan\(0\)/,
  );
});

test("accepts a JSON string", () => {
  const assertions = generateAssertions('{"status":"ok"}');

  assert.match(assertions, /responseKeys\.forEach\(function \(key\)/);
});

test("generates exact and oneOf value assertions only when configured", () => {
  const response = {
    status: "ready",
    mode: "safe",
    tags: ["api", "test"],
  };
  const schema = inferSchema(response);
  schema.children.status.valueMatch = { mode: "exact", value: "ready" };
  schema.children.mode.valueMatch = { mode: "oneOf", values: ["safe", "strict"] };
  schema.children.tags.item.valueMatch = { mode: "oneOf", values: ["api", "test"] };

  const assertions = generateAssertions(response, { schema });

  assert.match(assertions, /\.to\.equal\("ready"\)/);
  assert.match(assertions, /\.to\.be\.oneOf\(\["safe","strict"\]\)/);
  assert.match(assertions, /\.to\.be\.oneOf\(\["api","test"\]\)/);
  assert.doesNotMatch(
    generateAssertions({ status: "ready" }),
    /should equal the expected value|should match one of the expected values/,
  );
  assert.doesNotThrow(() => runPostmanAssertions(assertions, response));

  const invalidResponse = structuredClone(response);
  invalidResponse.mode = "experimental";
  assert.throws(
    () => runPostmanAssertions(assertions, invalidResponse),
    /should match one of the expected values/,
  );
});

test("generates custom regex assertions and rejects invalid patterns", () => {
  const response = {
    email: "ada@example.com",
    requestId: "REQ-123",
  };
  const schema = inferSchema(response);
  schema.children.email.valueMatch = {
    mode: "regex",
    pattern: String.raw`^[^\s@]+@[^\s@]+\.[^\s@]+$`,
  };
  schema.children.requestId.valueMatch = {
    mode: "regex",
    pattern: String.raw`^REQ-\d+$`,
  };

  const assertions = generateAssertions(response, { schema });

  assert.match(assertions, /new RegExp\(/);
  assert.match(assertions, /should match the expected regular expression/);
  assert.doesNotThrow(() => runPostmanAssertions(assertions, response));

  const invalidResponse = { email: "not-an-email", requestId: "REQ-invalid" };
  assert.throws(
    () => runPostmanAssertions(assertions, invalidResponse),
    /should match the expected regular expression/,
  );
  assert.throws(
    () => generateAssertions(response, {
      schema: {
        ...schema,
        children: {
          ...schema.children,
          email: {
            ...schema.children.email,
            valueMatch: { mode: "regex", pattern: "[" },
          },
        },
      },
    }),
    /Regex value match must be valid/,
  );
});

test("generates common comparison and string value assertions", () => {
  const response = {
    greater: 50,
    atLeast: 50,
    less: 50,
    atMost: 50,
    state: "active",
    description: "ACTIVE account",
    requestId: "REQ-123",
    filename: "report.json",
  };
  const schema = inferSchema(response);
  schema.children.greater.valueMatch = { mode: "greaterThan", value: 10 };
  schema.children.atLeast.valueMatch = { mode: "greaterThanOrEqual", value: 50 };
  schema.children.less.valueMatch = { mode: "lessThan", value: 100 };
  schema.children.atMost.valueMatch = { mode: "lessThanOrEqual", value: 50 };
  schema.children.state.valueMatch = { mode: "notEqual", value: "inactive" };
  schema.children.description.valueMatch = { mode: "contains", value: "ACTIVE" };
  schema.children.requestId.valueMatch = { mode: "startsWith", value: "REQ-" };
  schema.children.filename.valueMatch = { mode: "endsWith", value: ".json" };

  const assertions = generateAssertions(response, { schema });

  assert.match(assertions, /\.to\.be\.greaterThan\(10\)/);
  assert.match(assertions, /\.to\.be\.at\.least\(50\)/);
  assert.match(assertions, /\.to\.be\.lessThan\(100\)/);
  assert.match(assertions, /\.to\.be\.at\.most\(50\)/);
  assert.match(assertions, /\.to\.not\.equal\("inactive"\)/);
  assert.match(assertions, /\.includes\("ACTIVE"\)/);
  assert.match(assertions, /\.startsWith\("REQ-"\)/);
  assert.match(assertions, /\.endsWith\("\.json"\)/);
  assert.doesNotThrow(() => runPostmanAssertions(assertions, response));

  const invalidValues = [
    ["greater", 10],
    ["atLeast", 49],
    ["less", 100],
    ["atMost", 51],
    ["state", "inactive"],
    ["description", "inactive account"],
    ["requestId", "ID-123"],
    ["filename", "report.txt"],
  ];
  for (const [key, value] of invalidValues) {
    const invalidResponse = structuredClone(response);
    invalidResponse[key] = value;
    assert.throws(() => runPostmanAssertions(assertions, invalidResponse), /should/);
  }
});

test("does not apply value comparisons to nullable null values", () => {
  const response = { threshold: null };
  const schema = inferSchema(response);
  schema.children.threshold.type = "number";
  schema.children.threshold.valueMatch = { mode: "greaterThan", value: 10 };

  const assertions = generateAssertions(response, { schema });

  assert.doesNotThrow(() => runPostmanAssertions(assertions, response));
  assert.throws(
    () => runPostmanAssertions(assertions, { threshold: 5 }),
    /should be greater than the expected value/,
  );
});

test("generates oneOf assertions for fields inside arrays of objects", () => {
  const response = {
    channels: [
      { channel: "email", id: 1 },
      { channel: "chat", id: 2 },
      { channel: "phone", id: 3 },
    ],
  };
  const schema = inferSchema(response);
  schema.children.channels.item.children.channel.valueMatch = {
    mode: "oneOf",
    values: ["email", "chat", "phone"],
  };
  const assertions = generateAssertions(response, { schema });

  assert.match(assertions, /channel\[key\].*one of the expected values/);
  assert.match(assertions, /\.to\.be\.oneOf\(\["email","chat","phone"\]\)/);
  assert.doesNotThrow(() => runPostmanAssertions(assertions, response));

  const invalidResponse = structuredClone(response);
  invalidResponse.channels[1].channel = "sms";
  assert.throws(
    () => runPostmanAssertions(assertions, invalidResponse),
    /should match one of the expected values/,
  );
});

test("extracts first, indexed, and all array values into Postman scopes", () => {
  const response = {
    channels: [
      { channel: "email", id: 101 },
      { channel: "chat", id: 202 },
      { channel: "phone", id: 303 },
    ],
  };
  const extractions = [
    {
      path: ["response", "channels", "[*]", "id"],
      mode: "first",
      variableName: "firstChannelId",
      scope: "environment",
    },
    {
      path: ["response", "channels", "[*]", "id"],
      mode: "index",
      index: 1,
      variableName: "secondChannelId",
      scope: "collection",
    },
    {
      path: ["response", "channels", "[*]", "id"],
      mode: "all",
      variableName: "channelIds",
      scope: "global",
    },
  ];
  const assertions = generateAssertions(response, { extractions });
  const variables = runPostmanAssertions(assertions, response);

  assert.match(assertions, /response\.channels\[0\]\?\.id/);
  assert.match(assertions, /response\.channels\[1\]\?\.id/);
  assert.match(assertions, /response\.channels\.map\(\(extractedItem3\) => extractedItem3\?\.id\)/);
  assert.match(assertions, /const firstChannelId = response\.channels\[0\]\?\.id/);
  assert.match(assertions, /const secondChannelId = response\.channels\[1\]\?\.id/);
  assert.match(assertions, /const channelIds = response\.channels\.map/);
  assert.doesNotMatch(assertions, /extractedValue[0-9]+|serializedValue[0-9]+/);
  assert.deepEqual(variables.environment, { firstChannelId: "101" });
  assert.deepEqual(variables.collection, { secondChannelId: "202" });
  assert.deepEqual(variables.global, { channelIds: "[101,202,303]" });

  const outOfRangeResponse = { channels: [{ channel: "email", id: 101 }] };
  assert.throws(
    () => runPostmanAssertions(assertions, outOfRangeResponse),
    /Unable to extract response\.channels\[\*\]\.id/,
  );
  assert.throws(
    () => generateAssertions(response, { target: "axios", extractions }),
    /only supported for the postman target/,
  );
});

test("derives nested registry names from their object paths", () => {
  const assertions = generateAssertions({
    left: { items: { id: 1 } },
    right: { items: { name: "Ada" } },
  });

  assert.match(assertions, /let leftItemsKeys = \["id"\];/);
  assert.match(assertions, /let rightItemsKeys = \["name"\];/);
  assert.match(assertions, /let leftItemsTypes = \{"id":"number"\};/);
  assert.match(assertions, /let rightItemsTypes = \{"name":"string"\};/);
  assert.doesNotMatch(assertions, /itemKeys2/);
  new Function(assertions);
});

test("adds status only when it is provided explicitly", () => {
  const assertions = generateAssertions('{"status":"created"}', { status: 201 });

  assert.match(assertions, /pm\.response\.to\.have\.status\(201\)/);
  assert.throws(
    () => generateAssertions("{}", { status: 99 }),
    /Status must be an HTTP status code/,
  );
});

test("distinguishes omitted properties from nullable properties", () => {
  const schema = inferSchema({
    items: [
      { id: 1, entityName: "Product" },
      { id: 2, entityName: null },
      { id: 3 },
    ],
  });
  const entityNameSchema = schema.children.items.item.children.entityName;

  assert.equal(entityNameSchema.optional, true);
  assert.equal(entityNameSchema.nullable, true);
});

test("generates optional key checks for mixed object arrays", () => {
  const assertions = generateAssertions({
    items: [
      { id: 1, entityName: "Product" },
      { id: 2 },
    ],
  });

  assert.match(assertions, /let \w+OptionalKeys = \["entityName"\];/);
  assert.match(assertions, /assertExpectedKeys\([^\n]+OptionalKeys\);/);
  assert.match(assertions, /Object\.hasOwn\(\w+, key\)/);
  new Function(assertions);
});

test("executes optional key assertions without weakening other checks", () => {
  const response = {
    items: [
      { id: 1, entityName: "Product" },
      { id: 2 },
    ],
  };
  const assertions = generateAssertions(response);

  assert.doesNotThrow(() => runPostmanAssertions(assertions, response));

  const invalidType = structuredClone(response);
  invalidType.items[1].entityName = 42;
  assert.throws(
    () => runPostmanAssertions(assertions, invalidType),
    /should be a string/,
  );

  const unexpectedKey = structuredClone(response);
  unexpectedKey.items[1].unexpected = true;
  assert.throws(
    () => runPostmanAssertions(assertions, unexpectedKey),
    /Key mismatch/,
  );
});

test("validates non-null values for nullable keys", () => {
  const response = {
    items: [
      { id: 1, note: null },
      { id: 2, note: "valid" },
    ],
  };
  const assertions = generateAssertions(response);

  assert.doesNotThrow(() => runPostmanAssertions(assertions, response));

  const invalidType = structuredClone(response);
  invalidType.items[1].note = 42;
  assert.throws(
    () => runPostmanAssertions(assertions, invalidType),
    /should be a string/,
  );
});

test("declares nullable keys once and reuses them in the item loop", () => {
  const responseText = JSON.stringify({
    content: [
      { id: 1, label: "first", note: null },
      { id: 2, label: "second", note: "visible" },
    ],
  });
  const assertions = generateAssertions(responseText);

  assert.match(assertions, /let contentNullableKeys = \[/);
  assert.match(assertions, /assertValue\(content\[key\].*contentNullableKeys\.includes\(key\)/);
  assert.doesNotMatch(assertions, /if \(!\["updatedBy"/);
});

test("uses edited schema types and nullability", () => {
  const response = { id: "123", note: null };
  const schema = inferSchema(response);
  schema.children.id.type = "number";
  schema.children.note.type = "string";
  schema.children.note.nullable = false;

  const assertions = generateAssertions(response, { schema });

  assert.match(assertions, /responseTypes = \{"id":"number","note":"string"\}/);
  assert.match(assertions, /assertValue\(response\[key\].*responseTypes\[key\]/);
  assert.match(assertions, /\[\].includes\(key\)/);
});

test("can omit data type assertions while retaining structure checks", () => {
  const assertions = generateAssertions({ id: 123, tags: ["api"] }, {
    assertDataTypes: false,
  });

  assert.match(assertions, /assertExpectedKeys\(response, responseKeys, "response"\)/);
  assert.match(assertions, /should not be null/);
  assert.doesNotMatch(assertions, /responseTypes/);
  assert.doesNotMatch(assertions, /Number\.isInteger/);
  assert.doesNotMatch(assertions, /\.to\.be\.a\(/);
  assert.doesNotMatch(assertions, /\.to\.be\.an\("array"\)/);
  new Function(assertions);
});

test("generates Axios assertions against response data", () => {
  const assertions = generateAssertions({ id: 1, name: "Ada" }, {
    target: "axios",
    status: 200,
  });

  assert.match(assertions, /expect\(response\.status.*\.to\.equal\(200\)/);
  assert.match(assertions, /assertValue\(response\.data, "response\.data"/);
  assert.match(assertions, /assertExpectedKeys\(response\.data, responseKeys, "response\.data"\)/);
  assert.match(assertions, /let responseKeys = \["id", "name"\];/);
  assert.doesNotMatch(assertions, /pm\./);
  new Function(assertions);
});

test("rejects invalid JSON strings", () => {
  assert.throws(() => generateAssertions("not-json"), /Response is not valid JSON/);
});
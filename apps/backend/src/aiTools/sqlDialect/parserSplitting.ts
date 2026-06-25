export type TopLevelClauseDefinition<TName extends string> = Readonly<{
  name: TName;
  keyword: string;
}>;

export type TopLevelClauseMatch<TName extends string> = Readonly<{
  name: TName;
  keyword: string;
  index: number;
}>;

export function upperCaseKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeSqlWhitespace(value: string): string {
  const trimmedValue = value.trim();
  let normalizedValue = "";
  let inString = false;
  let pendingWhitespace = false;

  for (let index = 0; index < trimmedValue.length; index += 1) {
    const character = trimmedValue[index];
    const nextCharacter = trimmedValue[index + 1];

    if (character === "'") {
      if (pendingWhitespace && normalizedValue !== "") {
        normalizedValue += " ";
        pendingWhitespace = false;
      }

      normalizedValue += character;
      if (inString && nextCharacter === "'") {
        normalizedValue += nextCharacter;
        index += 1;
        continue;
      }

      inString = !inString;
      continue;
    }

    if (inString) {
      normalizedValue += character;
      continue;
    }

    if (/\s/u.test(character)) {
      pendingWhitespace = true;
      continue;
    }

    if (character === ";" && trimmedValue.slice(index + 1).trim() === "") {
      break;
    }

    if (pendingWhitespace && normalizedValue !== "") {
      normalizedValue += " ";
      pendingWhitespace = false;
    }

    normalizedValue += character;
  }

  return normalizedValue;
}

export function splitSqlStatements(value: string): ReadonlyArray<string> {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return [];
  }

  const statements: Array<string> = [];
  let current = "";
  let inString = false;
  let depth = 0;

  for (let index = 0; index < trimmedValue.length; index += 1) {
    const character = trimmedValue[index];
    const nextCharacter = trimmedValue[index + 1];

    if (character === "'") {
      current += character;
      if (inString && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (inString) {
      current += character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      current += character;
      continue;
    }

    if (depth === 0 && character === ";") {
      const statement = current.trim();
      const remainingValue = trimmedValue.slice(index + 1).trim();
      if (statement === "") {
        throw new Error("SQL batch contains an empty statement");
      }

      statements.push(statement);
      current = "";

      if (remainingValue === "") {
        break;
      }

      continue;
    }

    current += character;
  }

  const statement = current.trim();
  if (statement !== "") {
    statements.push(statement);
  }

  return statements;
}

export function assert(condition: boolean, message: string): void {
  if (condition === false) {
    throw new Error(message);
  }
}

export function splitTopLevel(value: string, separator: string): ReadonlyArray<string> {
  const parts: Array<string> = [];
  let current = "";
  let inString = false;
  let inDoubleQuote = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];
    if (character === "'" && inDoubleQuote === false) {
      current += character;
      if (inString && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (inString) {
      current += character;
      continue;
    }

    // Double-quoted segments appear inside Postgres text-array literals ({"a,b"}).
    // Track them so a comma inside a quoted element is not treated as a separator.
    if (character === '"') {
      current += character;
      const isEscapedQuote = inDoubleQuote && value[index - 1] === "\\";
      if (isEscapedQuote === false) {
        inDoubleQuote = !inDoubleQuote;
      }

      continue;
    }

    if (inDoubleQuote) {
      current += character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      current += character;
      continue;
    }

    if (depth === 0 && value.slice(index, index + separator.length).toUpperCase() === separator) {
      parts.push(current.trim());
      current = "";
      index += separator.length - 1;
      continue;
    }

    current += character;
  }

  if (current.trim() !== "") {
    parts.push(current.trim());
  }

  return parts;
}

export function splitTopLevelByKeyword(value: string, keyword: "AND" | "OR"): ReadonlyArray<string> {
  const parts: Array<string> = [];
  let current = "";
  let inString = false;
  let inDoubleQuote = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];
    if (character === "'" && inDoubleQuote === false) {
      current += character;
      if (inString && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (inString) {
      current += character;
      continue;
    }

    // Double-quoted segments appear inside Postgres text-array literals ({"a,b"}).
    // Track them so a keyword inside a quoted element is not treated as a separator.
    if (character === '"') {
      current += character;
      const isEscapedQuote = inDoubleQuote && value[index - 1] === "\\";
      if (isEscapedQuote === false) {
        inDoubleQuote = !inDoubleQuote;
      }

      continue;
    }

    if (inDoubleQuote) {
      current += character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      current += character;
      continue;
    }

    if (
      depth === 0
      && value.slice(index, index + keyword.length).toUpperCase() === keyword
      && (index === 0 || /\s/.test(value[index - 1] ?? ""))
      && (index + keyword.length >= value.length || /\s/.test(value[index + keyword.length] ?? ""))
    ) {
      parts.push(current.trim());
      current = "";
      index += keyword.length - 1;
      continue;
    }

    current += character;
  }

  if (current.trim() !== "") {
    parts.push(current.trim());
  }

  return parts;
}

function isSqlBoundaryCharacter(value: string | undefined): boolean {
  return value === undefined || /\s/u.test(value);
}

export function findTopLevelClauseMatches<TName extends string>(
  value: string,
  definitions: ReadonlyArray<TopLevelClauseDefinition<TName>>,
): ReadonlyArray<TopLevelClauseMatch<TName>> {
  const matches: Array<TopLevelClauseMatch<TName>> = [];
  const normalizedDefinitions = [...definitions].sort((left, right) => right.keyword.length - left.keyword.length);
  let inString = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];
    if (character === "'") {
      if (inString && nextCharacter === "'") {
        index += 1;
        continue;
      }

      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      continue;
    }

    if (depth !== 0) {
      continue;
    }

    const matchedDefinition = normalizedDefinitions.find((definition) => {
      if (value.slice(index, index + definition.keyword.length).toUpperCase() !== definition.keyword) {
        return false;
      }

      return isSqlBoundaryCharacter(value[index - 1]) && isSqlBoundaryCharacter(value[index + definition.keyword.length]);
    });
    if (matchedDefinition === undefined) {
      continue;
    }

    matches.push({
      name: matchedDefinition.name,
      keyword: matchedDefinition.keyword,
      index,
    });
    index += matchedDefinition.keyword.length - 1;
  }

  return matches;
}

export function extractTopLevelClauses<TName extends string>(
  value: string,
  definitions: ReadonlyArray<TopLevelClauseDefinition<TName>>,
  context: string,
): Readonly<{
  leadingSegment: string;
  clauseValues: ReadonlyMap<TName, string>;
}> {
  const matches = findTopLevelClauseMatches(value, definitions);
  if (matches.length === 0) {
    return {
      leadingSegment: value.trim(),
      clauseValues: new Map(),
    };
  }

  const definitionOrder = new Map(definitions.map((definition, index) => [definition.name, index] as const));
  const clauseValues = new Map<TName, string>();
  let lastOrder = -1;

  for (const [index, match] of matches.entries()) {
    if (clauseValues.has(match.name)) {
      throw new Error(`Duplicate ${context} clause: ${match.keyword}`);
    }

    const order = definitionOrder.get(match.name);
    if (order === undefined) {
      throw new Error(`Unknown ${context} clause: ${match.keyword}`);
    }
    if (order < lastOrder) {
      throw new Error(`Invalid ${context} clause order near ${match.keyword}`);
    }

    const nextMatch = matches[index + 1];
    const clauseValue = value.slice(match.index + match.keyword.length, nextMatch?.index).trim();
    clauseValues.set(match.name, clauseValue);
    lastOrder = order;
  }

  const firstMatch = matches[0];
  assert(firstMatch !== undefined, `Expected at least one ${context} clause`);
  return {
    leadingSegment: value.slice(0, firstMatch.index).trim(),
    clauseValues,
  };
}

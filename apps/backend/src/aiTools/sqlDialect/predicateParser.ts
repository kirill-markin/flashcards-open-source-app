import {
  ensureSqlSourceColumnExists,
  getSqlSourceColumnDescriptors,
} from "./schema";
import {
  assert,
  splitTopLevel,
  splitTopLevelByKeyword,
} from "./parserSplitting";
import type {
  SqlComparisonOperator,
  SqlFromSource,
  SqlLiteral,
  SqlPredicate,
  SqlPredicateExpression,
  SqlPredicateValue,
} from "./types";

/**
 * Parenthesized WHERE groups nest, so recursion needs an explicit terminal
 * limit instead of relying on the JavaScript stack.
 */
const MAXIMUM_PREDICATE_GROUP_DEPTH = 16;

export function parseStringLiteral(value: string): string {
  assert(value.startsWith("'") && value.endsWith("'"), "Expected a quoted string literal");
  return value.slice(1, -1).replaceAll("''", "'");
}

export function parseSqlLiteral(value: string): SqlLiteral {
  const trimmedValue = value.trim();
  if (trimmedValue.toUpperCase() === "NULL") {
    return null;
  }

  if (trimmedValue.toUpperCase() === "TRUE") {
    return true;
  }

  if (trimmedValue.toUpperCase() === "FALSE") {
    return false;
  }

  if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
    return parseStringLiteral(trimmedValue);
  }

  if (/^-?\d+$/.test(trimmedValue)) {
    return Number.parseInt(trimmedValue, 10);
  }

  if (/^-?\d+\.\d+$/.test(trimmedValue)) {
    return Number.parseFloat(trimmedValue);
  }

  throw new Error(`Unsupported literal: ${trimmedValue}`);
}

function parsePredicateValue(value: string): SqlPredicateValue {
  const trimmedValue = value.trim();
  if (trimmedValue.toUpperCase() === "NOW()") {
    return { type: "now" };
  }

  return parseSqlLiteral(trimmedValue);
}

function parsePostgresTextArrayElement(item: string, columnName: string, trimmedValue: string): string {
  const trimmedItem = item.trim();
  if (trimmedItem.startsWith('"') && trimmedItem.endsWith('"') && trimmedItem.length >= 2) {
    return trimmedItem.slice(1, -1).replaceAll('\\"', '"');
  }

  if (trimmedItem === "" || trimmedItem.includes('"')) {
    throw new Error(
      `Array column "${columnName}" accepts only string elements, e.g. {a,b} or {"a","b"}. Got: ${trimmedValue}`,
    );
  }

  return trimmedItem;
}

export function parseStringArrayLiteralList(value: string, columnName: string): ReadonlyArray<string> {
  const trimmedValue = value.trim();

  const arrayPrefixMatch = trimmedValue.match(/^ARRAY\s*\[([\s\S]*)\]$/i);
  const bracketMatch = trimmedValue.startsWith("[") && trimmedValue.endsWith("]");
  const parenMatch = trimmedValue.startsWith("(") && trimmedValue.endsWith(")");
  const quotedBraceMatch = trimmedValue.startsWith("'{") && trimmedValue.endsWith("}'");
  const braceMatch = trimmedValue.startsWith("{") && trimmedValue.endsWith("}");

  // Postgres text-array literal: '{a,b}' or {a,b}, elements may be unquoted.
  if (quotedBraceMatch || braceMatch) {
    const innerValue = quotedBraceMatch ? trimmedValue.slice(2, -2).trim() : trimmedValue.slice(1, -1).trim();
    if (innerValue === "") {
      return [];
    }

    return splitTopLevel(innerValue, ",").map((item) =>
      parsePostgresTextArrayElement(item, columnName, trimmedValue),
    );
  }

  // Native ('a','b'), JSON-style ['a','b'], and ARRAY['a','b'] all unwrap to a
  // comma-separated list of quoted string literals.
  let innerValue: string | null = null;
  if (arrayPrefixMatch !== null) {
    innerValue = (arrayPrefixMatch[1] ?? "").trim();
  } else if (bracketMatch || parenMatch) {
    innerValue = trimmedValue.slice(1, -1).trim();
  }

  if (innerValue === null) {
    throw new Error(
      `Array column "${columnName}" expects a parenthesized list like ('tag1','tag2'), or () for an empty list. Got: ${trimmedValue}`,
    );
  }

  if (innerValue === "") {
    return [];
  }

  return splitTopLevel(innerValue, ",").map((item) => {
    const parsedValue = parseSqlLiteral(item);
    if (typeof parsedValue !== "string") {
      throw new Error(
        `Array column "${columnName}" accepts only quoted string literals, e.g. ('a','b'). Got: ${trimmedValue}`,
      );
    }

    return parsedValue;
  });
}

function parseLoweredStringLiteralList(value: string, operator: "IN" | "NOT IN"): ReadonlyArray<string> {
  const trimmedValue = value.trim();
  assert(trimmedValue.startsWith("(") && trimmedValue.endsWith(")"), "Expected a parenthesized value list");
  const innerValue = trimmedValue.slice(1, -1).trim();
  if (innerValue === "") {
    return [];
  }

  return splitTopLevel(innerValue, ",").map((item) => {
    const parsedValue = parseSqlLiteral(item);
    if (typeof parsedValue !== "string") {
      throw new Error(`LOWER(column) ${operator} (...) only supports string literals`);
    }

    return parsedValue;
  });
}

function parsePredicate(source: SqlFromSource, value: string): SqlPredicate {
  const trimmedValue = value.trim();
  const matchPredicate = trimmedValue.match(/^MATCH\s*\(\s*('(?:''|[^'])*')\s*\)$/i);
  if (matchPredicate !== null) {
    return {
      type: "match",
      query: parseStringLiteral(matchPredicate[1] ?? ""),
    };
  }

  const loweredLikePredicate = trimmedValue.match(
    /^LOWER\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s+(NOT\s+)?I?LIKE\s+('(?:''|[^'])*')$/i,
  );
  if (loweredLikePredicate !== null) {
    const columnName = (loweredLikePredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "like",
      columnName,
      pattern: parseStringLiteral(loweredLikePredicate[3] ?? ""),
      caseInsensitive: true,
      isNegated: loweredLikePredicate[2] !== undefined,
    };
  }

  const loweredEqualsPredicate = trimmedValue.match(/^LOWER\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s*=\s*('(?:''|[^'])*')$/i);
  if (loweredEqualsPredicate !== null) {
    const columnName = (loweredEqualsPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "like",
      columnName,
      pattern: parseStringLiteral(loweredEqualsPredicate[2] ?? ""),
      caseInsensitive: true,
      isNegated: false,
    };
  }

  const loweredInPredicate = trimmedValue.match(
    /^LOWER\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s+(NOT\s+IN|IN)\s*(\(.+\))$/i,
  );
  if (loweredInPredicate !== null) {
    const columnName = (loweredInPredicate[1] ?? "").toLowerCase();
    const operator = (loweredInPredicate[2] ?? "").toUpperCase().replace(/\s+/g, " ");
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "in",
      columnName,
      values: parseLoweredStringLiteralList(loweredInPredicate[3] ?? "", operator as "IN" | "NOT IN"),
      caseInsensitive: true,
      isNegated: operator === "NOT IN",
    };
  }

  const likePredicate = trimmedValue.match(
    /^([a-z_][a-z0-9_]*)\s+(NOT\s+)?(I?LIKE)\s+('(?:''|[^'])*')$/i,
  );
  if (likePredicate !== null) {
    const columnName = (likePredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "like",
      columnName,
      pattern: parseStringLiteral(likePredicate[4] ?? ""),
      caseInsensitive: (likePredicate[3] ?? "").toUpperCase() === "ILIKE",
      isNegated: likePredicate[2] !== undefined,
    };
  }

  const isNotNullPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IS\s+NOT\s+NULL$/i);
  if (isNotNullPredicate !== null) {
    const columnName = (isNotNullPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "is_not_null",
      columnName,
    };
  }

  const isNullPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IS\s+NULL$/i);
  if (isNullPredicate !== null) {
    const columnName = (isNullPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "is_null",
      columnName,
    };
  }

  const overlapPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+OVERLAP\s*(.+)$/i);
  if (overlapPredicate !== null) {
    const columnName = (overlapPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "overlap",
      columnName,
      values: parseStringArrayLiteralList(overlapPredicate[2] ?? "", columnName),
    };
  }

  const inPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IN\s*(\(.+\))$/i);
  if (inPredicate !== null) {
    const columnName = (inPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "in",
      columnName,
      values: splitTopLevel((inPredicate[2] ?? "").slice(1, -1), ",").map(parseSqlLiteral),
      caseInsensitive: false,
      isNegated: false,
    };
  }

  const comparisonPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s*(=|<=|>=|<|>)\s*(.+)$/i);
  if (comparisonPredicate !== null) {
    const columnName = (comparisonPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    const operator = (comparisonPredicate[2] ?? "=") as SqlComparisonOperator;
    const rightSideValue = comparisonPredicate[3] ?? "";
    if (operator === "=" && getSqlSourceColumnDescriptors(source)[columnName]?.type === "string[]") {
      return {
        type: "array_equals",
        columnName,
        values: parseStringArrayLiteralList(rightSideValue, columnName),
      };
    }

    return {
      type: "comparison",
      columnName,
      operator,
      value: parsePredicateValue(rightSideValue),
    };
  }

  throw new Error(`Unsupported predicate: ${trimmedValue}`);
}

/**
 * A segment is a parenthesized group only when its own wrapping parentheses are
 * balanced and enclose the whole segment, e.g. `(a = 1 OR b = 2)` but not
 * `(a = 1) AND (b = 2)`.
 */
function isParenthesizedGroup(value: string): boolean {
  if (value.startsWith("(") === false || value.endsWith(")") === false) {
    return false;
  }

  let depth = 0;
  let inString = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];
    if (character === "'" && inDoubleQuote === false) {
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

    if (character === '"') {
      const isEscapedQuote = inDoubleQuote && value[index - 1] === "\\";
      if (isEscapedQuote === false) {
        inDoubleQuote = !inDoubleQuote;
      }

      continue;
    }

    if (inDoubleQuote) {
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }

      if (depth === 0 && index !== value.length - 1) {
        return false;
      }
    }
  }

  return depth === 0;
}

function parsePredicateExpression(
  source: SqlFromSource,
  value: string,
  depth: number,
): SqlPredicateExpression {
  if (depth > MAXIMUM_PREDICATE_GROUP_DEPTH) {
    throw new Error(
      `WHERE clause nests parenthesized groups deeper than the supported limit of ${MAXIMUM_PREDICATE_GROUP_DEPTH}`,
    );
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw new Error("WHERE clause contains an empty predicate group");
  }

  const orSegments = splitTopLevelByKeyword(trimmedValue, "OR");
  if (orSegments.length > 1) {
    return {
      type: "or",
      operands: orSegments.map((segment) => parsePredicateExpression(source, segment, depth)),
    };
  }

  const orSegment = orSegments[0] ?? trimmedValue;
  const andSegments = splitTopLevelByKeyword(orSegment, "AND");
  if (andSegments.length > 1) {
    return {
      type: "and",
      operands: andSegments.map((segment) => parsePredicateExpression(source, segment, depth)),
    };
  }

  const primarySegment = andSegments[0] ?? orSegment;
  if (isParenthesizedGroup(primarySegment)) {
    return parsePredicateExpression(source, primarySegment.slice(1, -1), depth + 1);
  }

  return {
    type: "predicate",
    predicate: parsePredicate(source, primarySegment),
  };
}

export function parseWherePredicate(source: SqlFromSource, value: string): SqlPredicateExpression | null {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return null;
  }

  return parsePredicateExpression(source, trimmedValue, 0);
}

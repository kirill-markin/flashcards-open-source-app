import assert from "node:assert/strict";
import test from "node:test";
import {
  executeSqlSelect,
  parseSqlStatement,
  type SqlRow,
  type SqlSelectStatement,
} from "./sqlDialect";

function toSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildKeywordHeavyBackText(): string {
  return [
    "This text mentions where, order by, group by, limit, offset, and, or.",
    "It also keeps commas, equals = signs, and parentheses like fn(where_value).",
    "",
    "```python",
    "query = 'where order by limit'",
    "print('group by and or')",
    "```",
    "",
    "It's important that doubled quotes stay exact.",
  ].join("\n");
}

function parseSelectStatement(sql: string): SqlSelectStatement {
  const statement = parseSqlStatement(sql);
  assert.equal(statement.type, "select");
  return statement as SqlSelectStatement;
}

function withMockedRandom<T>(randomValues: ReadonlyArray<number>, callback: () => T): T {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    const fallbackValue = randomValues[randomValues.length - 1] ?? 0;
    const nextValue = randomValues[index] ?? fallbackValue;
    index += 1;
    return nextValue;
  };

  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

const sampleRows: ReadonlyArray<SqlRow> = [
  {
    card_id: "card-1",
    front_text: "Front 1",
    back_text: "Back 1",
    tags: ["grammar"],
    effort_level: "fast",
    due_at: null,
    created_at: "2026-03-10T09:00:00.000Z",
    reps: 1,
    lapses: 0,
    updated_at: "2026-03-10T09:00:00.000Z",
    deleted_at: null,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
  },
  {
    card_id: "card-2",
    front_text: "Front 2",
    back_text: "Back 2",
    tags: ["verbs"],
    effort_level: "medium",
    due_at: null,
    created_at: "2026-03-10T08:00:00.000Z",
    reps: 2,
    lapses: 0,
    updated_at: "2026-03-10T08:00:00.000Z",
    deleted_at: null,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
  },
  {
    card_id: "card-3",
    front_text: "Front 3",
    back_text: "Back 3",
    tags: ["reading"],
    effort_level: "long",
    due_at: null,
    created_at: "2026-03-10T07:00:00.000Z",
    reps: 3,
    lapses: 0,
    updated_at: "2026-03-10T07:00:00.000Z",
    deleted_at: null,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
  },
];

test("parseSqlStatement accepts standalone ORDER BY RANDOM()", () => {
  const statement = parseSelectStatement("SELECT card_id FROM cards ORDER BY RANDOM() LIMIT 3 OFFSET 0");

  assert.deepEqual(statement.orderBy, [{ type: "random" }]);
});

test("parseSqlStatement accepts standalone ORDER BY RANDOM ()", () => {
  const statement = parseSelectStatement("SELECT card_id FROM cards ORDER BY RANDOM () LIMIT 3 OFFSET 0");

  assert.deepEqual(statement.orderBy, [{ type: "random" }]);
});

test("parseSqlStatement rejects mixed ORDER BY RANDOM() items", () => {
  assert.throws(
    () => parseSqlStatement("SELECT card_id FROM cards ORDER BY RANDOM(), updated_at DESC LIMIT 3 OFFSET 0"),
    /RANDOM\(\) must be the only ORDER BY item/,
  );

  assert.throws(
    () => parseSqlStatement("SELECT card_id FROM cards ORDER BY updated_at DESC, RANDOM() LIMIT 3 OFFSET 0"),
    /RANDOM\(\) must be the only ORDER BY item/,
  );
});

test("parseSqlStatement rejects ORDER BY RANDOM() with direction", () => {
  assert.throws(
    () => parseSqlStatement("SELECT card_id FROM cards ORDER BY RANDOM() DESC LIMIT 3 OFFSET 0"),
    /RANDOM\(\) does not support ASC or DESC/,
  );
});

test("parseSqlStatement preserves multiline string literals in UPDATE assignments", () => {
  const backText = [
    "Dijkstra finds the shortest paths.",
    "",
    "```python",
    "print('hello')",
    "```",
  ].join("\n");
  const statement = parseSqlStatement(
    `UPDATE cards
     SET back_text = ${toSqlStringLiteral(backText)}
     WHERE card_id = 'card-1'`,
  );

  assert.equal(statement.type, "update");
  assert.equal(statement.assignments[0]?.columnName, "back_text");
  assert.equal(statement.assignments[0]?.value, backText);
  assert.match(statement.normalizedSql, /```python/);
});

test("parseSqlStatement preserves multiline string literals in INSERT rows", () => {
  const backText = [
    "Algorithm summary.",
    "",
    "```python",
    "dist = {start: 0}",
    "```",
  ].join("\n");
  const statement = parseSqlStatement(
    `INSERT INTO cards (front_text, back_text, tags, effort_level)
     VALUES ('What is Dijkstra?', ${toSqlStringLiteral(backText)}, ('dsa'), 'medium')`,
  );

  assert.equal(statement.type, "insert");
  assert.equal(statement.rows[0]?.[1], backText);
  assert.match(statement.normalizedSql, /dist = \{start: 0\}/);
});

test("parseSqlStatement preserves keyword-heavy multiline string literals in UPDATE assignments", () => {
  const backText = buildKeywordHeavyBackText();
  const statement = parseSqlStatement(
    `UPDATE cards
     SET back_text = ${toSqlStringLiteral(backText)}
     WHERE card_id = 'card-1'`,
  );

  assert.equal(statement.type, "update");
  assert.equal(statement.assignments[0]?.columnName, "back_text");
  assert.equal(statement.assignments[0]?.value, backText);
});

test("parseSqlStatement preserves keyword-heavy multiline string literals in INSERT rows", () => {
  const backText = buildKeywordHeavyBackText();
  const statement = parseSqlStatement(
    `INSERT INTO cards (front_text, back_text, tags, effort_level)
     VALUES ('What is RPC?', ${toSqlStringLiteral(backText)}, ('backend'), 'medium')`,
  );

  assert.equal(statement.type, "insert");
  assert.equal(statement.rows[0]?.[1], backText);
});

test("parseSqlStatement preserves keywords inside quoted LIKE patterns", () => {
  const statement = parseSelectStatement(
    "SELECT card_id FROM cards WHERE LOWER(back_text) LIKE '%order by%' ORDER BY updated_at DESC LIMIT 20 OFFSET 0",
  );

  assert.equal(statement.predicateClauses.length, 1);
  assert.equal(statement.orderBy.length, 1);
  assert.equal(statement.limit, 20);
  assert.equal(statement.offset, 0);
});

test("executeSqlSelect supports exact case-insensitive matches on UNNEST aliases", () => {
  const statement = parseSelectStatement(
    "SELECT card_id, tag FROM cards UNNEST tags AS tag WHERE LOWER(tag) = 'grammar' ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0",
  );

  const result = executeSqlSelect(statement, [
    {
      ...sampleRows[0],
      tags: ["Grammar", "verbs"],
    },
    sampleRows[1],
    sampleRows[2],
  ], 100);

  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows, [{ card_id: "card-1", tag: "Grammar" }]);
});

test("parseSqlStatement rejects duplicate top-level SELECT clauses", () => {
  assert.throws(
    () => parseSqlStatement("SELECT card_id FROM cards WHERE card_id = 'card-1' WHERE back_text = 'card-2' LIMIT 1 OFFSET 0"),
    /Duplicate SELECT clause: WHERE/,
  );
});

test("parseSqlStatement rejects invalid top-level SELECT clause order", () => {
  assert.throws(
    () => parseSqlStatement("SELECT card_id FROM cards ORDER BY updated_at DESC WHERE card_id = 'card-1' LIMIT 1 OFFSET 0"),
    /Invalid SELECT clause order near WHERE/,
  );
});

test("executeSqlSelect applies ORDER BY RANDOM() before pagination", () => {
  const statement = parseSelectStatement("SELECT card_id FROM cards ORDER BY RANDOM() LIMIT 2 OFFSET 1");

  const result = withMockedRandom([0.1, 0.8], () => executeSqlSelect(statement, sampleRows, 100));

  assert.equal(result.rowCount, 2);
  assert.equal(result.limit, 2);
  assert.equal(result.offset, 1);
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.rows.map((row) => row.card_id), ["card-2", "card-1"]);
});

test("executeSqlSelect supports wildcard, projected, and aggregate SELECT with ORDER BY RANDOM()", () => {
  const wildcardStatement = parseSelectStatement("SELECT * FROM cards ORDER BY RANDOM() LIMIT 2 OFFSET 0");
  const projectedStatement = parseSelectStatement("SELECT card_id, front_text FROM cards ORDER BY RANDOM() LIMIT 2 OFFSET 0");
  const aggregateStatement = parseSelectStatement("SELECT COUNT(*) AS total FROM cards ORDER BY RANDOM() LIMIT 1 OFFSET 0");

  const wildcardResult = withMockedRandom([0.2, 0.7], () => executeSqlSelect(wildcardStatement, sampleRows, 100));
  const projectedResult = withMockedRandom([0.4, 0.1], () => executeSqlSelect(projectedStatement, sampleRows, 100));
  const aggregateResult = withMockedRandom([0.5], () => executeSqlSelect(aggregateStatement, sampleRows, 100));

  assert.equal(wildcardResult.rowCount, 2);
  assert.equal(projectedResult.rowCount, 2);
  assert.deepEqual(Object.keys(projectedResult.rows[0] ?? {}).sort(), ["card_id", "front_text"]);
  assert.equal(aggregateResult.rowCount, 1);
  assert.deepEqual(aggregateResult.rows, [{ total: 3 }]);
});

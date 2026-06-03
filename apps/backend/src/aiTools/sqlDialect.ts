/**
 * Canonical SQL-dialect surface for backend and browser-local runtimes.
 *
 * Keep import paths stable by re-exporting the split runtime modules from this
 * file.
 */
export * from "./sqlDialect/types";
export {
  getSqlColumnDescriptor,
  getSqlResourceDescriptor,
  getSqlResourceDescriptors,
} from "./sqlDialect/schema";
export {
  parseSqlStatement,
  parseSqlStatements,
  splitSqlStatements,
} from "./sqlDialect/parser";
export {
  executeSqlSelect,
  likePatternToRegExp,
  normalizeSqlLimit,
  normalizeSqlOffset,
} from "./sqlDialect/selectExecutor";

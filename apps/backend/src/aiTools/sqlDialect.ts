/**
 * Canonical SQL-dialect surface for backend and browser-local runtimes.
 *
 * Keep import paths stable by re-exporting the split runtime modules from this
 * file.
 */
export * from "./sqlDialectTypes";
export {
  getSqlColumnDescriptor,
  getSqlResourceDescriptor,
  getSqlResourceDescriptors,
} from "./sqlDialectSchema";
export { parseSqlStatement } from "./sqlDialectParser";
export {
  executeSqlSelect,
  likePatternToRegExp,
  normalizeSqlLimit,
  normalizeSqlOffset,
} from "./sqlDialectSelectExecutor";

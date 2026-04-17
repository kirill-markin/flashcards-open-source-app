export function escapeSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

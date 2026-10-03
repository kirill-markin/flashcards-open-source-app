import { escapeSqlStringLiteral } from "../../sql";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * The user page's id - a raw `org.user_settings.user_id` or an analytics `actor_id` - as the SQL each
 * kind of key column is compared to. Text keys are folded with `pg_catalog.lower` on both sides,
 * because `actor_id` renders as lowercase hex while a stored TEXT id is unconstrained.
 */
export type UserSubjectSql = Readonly<{
  lowerIdSql: string;
  /** `NULL::uuid` for an id that is not a UUID, so a uuid column matches nothing instead of failing the cast. */
  uuidSql: string;
}>;

export function buildUserSubjectSql(userId: string): UserSubjectSql {
  const literal = escapeSqlStringLiteral(userId);
  return {
    lowerIdSql: `pg_catalog.lower(${literal})`,
    uuidSql: uuidPattern.test(userId) ? `${literal}::uuid` : "NULL::uuid",
  };
}

export function buildMatchesUserIdSql(textColumnSql: string, subject: UserSubjectSql): string {
  return `pg_catalog.lower(${textColumnSql}) = ${subject.lowerIdSql}`;
}

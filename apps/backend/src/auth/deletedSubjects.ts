import { createHash } from "node:crypto";
import type { DatabaseExecutor } from "../database";
import { unsafeQuery } from "../database/unsafe";
import { HttpError } from "../shared/errors";

type DeletedSubjectRow = Readonly<{
  subject_sha256: string;
}>;

export function hashDeletedSubject(userId: string): string {
  return createHash("sha256")
    .update(userId, "utf8")
    .digest("hex");
}

export async function isDeletedSubjectInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<boolean> {
  const subjectHash = hashDeletedSubject(userId);
  const result = await executor.query<DeletedSubjectRow>(
    "SELECT subject_sha256 FROM auth.deleted_subjects WHERE subject_sha256 = $1 LIMIT 1",
    [subjectHash],
  );
  return result.rows.length > 0;
}

export async function assertSubjectIsNotDeletedInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<void> {
  if (await isDeletedSubjectInExecutor(executor, userId)) {
    throw new HttpError(410, "This account has already been deleted.", "ACCOUNT_DELETED");
  }
}

export async function isDeletedSubject(userId: string): Promise<boolean> {
  const subjectHash = hashDeletedSubject(userId);
  const result = await unsafeQuery<DeletedSubjectRow>(
    "SELECT subject_sha256 FROM auth.deleted_subjects WHERE subject_sha256 = $1 LIMIT 1",
    [subjectHash],
  );
  return result.rows.length > 0;
}

export async function markDeletedSubjectInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<void> {
  const subjectHash = hashDeletedSubject(userId);
  await executor.query(
    [
      "INSERT INTO auth.deleted_subjects (subject_sha256)",
      "VALUES ($1)",
      "ON CONFLICT (subject_sha256) DO NOTHING",
    ].join(" "),
    [subjectHash],
  );
}

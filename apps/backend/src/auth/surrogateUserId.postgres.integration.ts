import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { ensureCognitoUserProfile } from "./ensureUser";

/**
 * Account provisioning from a verified Cognito subject, run against real PostgreSQL.
 *
 * The rule is that a new account's `user_id` is minted here and the subject is only bound to it,
 * and neither half can be seen without a database: the mint is invisible to a recorded fake
 * executor, and the `auth.user_identities.user_id -> org.user_settings(user_id)` foreign key that
 * forces profile-before-mapping is enforced nowhere else.
 *
 * Subjects are generated as UUIDs because that is the shape Cognito issues, which is what makes
 * "the id is not the subject" the assertion it is rather than a shape comparison.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the surrogate user id PostgreSQL integration test.",
    );
  }

  return databaseUrl;
}

type IdentityMappingRow = Readonly<{
  user_id: string;
}>;

async function readMappedUserIds(
  ownerPool: pg.Pool,
  providerSubject: string,
): Promise<ReadonlyArray<string>> {
  const result = await ownerPool.query<IdentityMappingRow>(
    "SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito' AND provider_subject = $1",
    [providerSubject],
  );

  return result.rows.map((row) => row.user_id);
}

async function countUserSettingsRows(
  ownerPool: pg.Pool,
  userIds: ReadonlyArray<string>,
): Promise<number> {
  const result = await ownerPool.query<Readonly<{ user_id: string }>>(
    "SELECT user_id FROM org.user_settings WHERE user_id = ANY($1::text[])",
    [[...userIds]],
  );

  return result.rows.length;
}

async function removeAccounts(
  ownerPool: pg.Pool,
  userIds: ReadonlyArray<string>,
  workspaceIds: ReadonlyArray<string>,
): Promise<void> {
  await ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [
    [...workspaceIds],
  ]);
  // auth.user_identities cascades from here, so the mapping goes with the profile.
  await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [
    [...userIds],
  ]);
}

test("a first-ever Cognito subject gets a minted user id, bound to it, and keeps it on the next request", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "surrogate-user-id-integration-owner",
  });
  const providerSubject = randomUUID();
  const email = `surrogate-user-id-${randomUUID()}@example.com`;
  const createdUserIds: Array<string> = [providerSubject];
  const createdWorkspaceIds: Array<string> = [];

  try {
    const firstProfile = await ensureCognitoUserProfile(providerSubject, email);
    createdUserIds.push(firstProfile.userId);
    if (firstProfile.selectedWorkspaceId !== null) {
      createdWorkspaceIds.push(firstProfile.selectedWorkspaceId);
    }

    // The whole point of the change: the identity provider's subject is not the account id.
    assert.notEqual(firstProfile.userId, providerSubject);
    assert.match(firstProfile.userId, UUID_PATTERN);
    assert.deepEqual(await readMappedUserIds(ownerPool, providerSubject), [firstProfile.userId]);
    // The minted id is the only account: nothing was written under the subject itself.
    assert.equal(await countUserSettingsRows(ownerPool, [providerSubject]), 0);

    // The second request resolves through the mapping rather than minting again, which is what
    // would otherwise leave this person with two accounts and no way back to the first.
    const secondProfile = await ensureCognitoUserProfile(providerSubject, email);
    if (secondProfile.selectedWorkspaceId !== null) {
      createdWorkspaceIds.push(secondProfile.selectedWorkspaceId);
    }

    assert.equal(secondProfile.userId, firstProfile.userId);
    assert.deepEqual(await readMappedUserIds(ownerPool, providerSubject), [firstProfile.userId]);
    assert.equal(
      await countUserSettingsRows(ownerPool, [providerSubject, firstProfile.userId]),
      1,
    );
  } finally {
    try {
      await removeAccounts(ownerPool, createdUserIds, createdWorkspaceIds);
    } finally {
      await ownerPool.end();
    }
  }
});

test("a subject that already owns an unmapped account adopts it instead of getting a second one", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "surrogate-user-id-integration-owner",
  });
  // An account stored under the subject itself with no mapping row, which an account can have until
  // something binds one. Minting a fresh id for it would strand everything it owns.
  const providerSubject = randomUUID();
  const email = `surrogate-user-id-adopted-${randomUUID()}@example.com`;
  const createdUserIds: Array<string> = [providerSubject];
  const createdWorkspaceIds: Array<string> = [];

  try {
    await ownerPool.query(
      "INSERT INTO org.user_settings (user_id, email) VALUES ($1, $2)",
      [providerSubject, email],
    );
    assert.deepEqual(await readMappedUserIds(ownerPool, providerSubject), []);

    const profile = await ensureCognitoUserProfile(providerSubject, email);
    if (profile.selectedWorkspaceId !== null) {
      createdWorkspaceIds.push(profile.selectedWorkspaceId);
    }

    assert.equal(profile.userId, providerSubject);
    // The account it adopted is now bound, so this subject can never be minted an id later.
    assert.deepEqual(await readMappedUserIds(ownerPool, providerSubject), [providerSubject]);
    assert.equal(await countUserSettingsRows(ownerPool, [providerSubject]), 1);
  } finally {
    try {
      await removeAccounts(ownerPool, createdUserIds, createdWorkspaceIds);
    } finally {
      await ownerPool.end();
    }
  }
});

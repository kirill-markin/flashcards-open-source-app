import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { ensureCognitoUserProfile, ensureUserProfile } from "./ensureUser";
import { unsafeTransaction } from "../database/unsafe";
import { linkProvedCognitoPrincipalInExecutor } from "./userIdentities";
import { deleteAccountForAuthenticatedUser, deleteAccountConfirmationText } from "./accountDeletion";
import { hashDeletedSubject } from "./deletedSubjects";

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

test("proved principals stay unprovisioned until bootstrap, share an immutable account, and delete/retry together", async () => {
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const primary = randomUUID();
  const alias = randomUUID();
  const outsider = randomUUID();
  const subjects = [primary, alias, outsider];
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  const email = `identity-lifecycle-${randomUUID()}@example.com`;
  try {
    const authClient = await ownerPool.connect();
    try {
      await authClient.query("BEGIN");
      await authClient.query("SET LOCAL ROLE auth_app");
      for (const subject of subjects) {
        await authClient.query("SELECT auth.register_cognito_principal($1, $2)", [subject, subject]);
      }
      await authClient.query("SELECT auth.bind_provider_identity('apple', $1, $2)", [primary, primary]);
      await authClient.query("SELECT auth.record_verified_login_email($1, $2, now())", [alias, email]);
      await authClient.query("COMMIT");
    } catch (error) {
      await authClient.query("ROLLBACK");
      throw error;
    } finally {
      authClient.release();
    }
    assert.equal(await countUserSettingsRows(ownerPool, subjects), 0);
    assert.deepEqual(await readMappedUserIds(ownerPool, primary), []);
    const account = await ensureCognitoUserProfile(primary, email);
    const other = await ensureCognitoUserProfile(outsider, email);
    userIds.push(account.userId, other.userId);
    for (const profile of [account, other]) {
      if (profile.selectedWorkspaceId !== null) workspaceIds.push(profile.selectedWorkspaceId);
    }
    assert.notEqual(other.userId, account.userId);
    await unsafeTransaction(async (executor) => {
      const linked = await linkProvedCognitoPrincipalInExecutor(executor, primary, alias);
      assert.equal(linked.userId, account.userId);
    });
    assert.equal((await ensureCognitoUserProfile(alias, email)).userId, account.userId);
    await assert.rejects(unsafeTransaction(async (executor) => {
      await linkProvedCognitoPrincipalInExecutor(executor, primary, outsider);
    }), { code: "23505" });
    await assert.rejects(unsafeTransaction(async (executor) => {
      await executor.query("SELECT auth.bind_provider_identity('apple', $1, $2)", [primary, outsider]);
    }), { code: "23505" });
    assert.deepEqual(await readMappedUserIds(ownerPool, outsider), [other.userId]);

    let failCleanup = true;
    const cleanedSubjects: Array<string> = [];
    const dependencies = {
      unsafeTransaction,
      isConfiguredDemoEmail: () => false,
      deleteCognitoUser: async (subject: string): Promise<void> => {
        if (failCleanup) throw new Error("Simulated unavailable Cognito cleanup transport");
        cleanedSubjects.push(subject);
      },
    };
    const deletion = {
      authSubjectUserId: primary, email, cognitoUsername: primary,
      confirmationText: deleteAccountConfirmationText,
    };
    const [provisioning, deleting] = await Promise.allSettled([
      ensureCognitoUserProfile(alias, email),
      deleteAccountForAuthenticatedUser(deletion, dependencies),
    ]);
    if (provisioning.status === "fulfilled") assert.equal(provisioning.value.userId, account.userId);
    else assert.equal((provisioning.reason as Error & { code: string }).code, "ACCOUNT_DELETED");
    assert.equal(deleting.status, "rejected");
    if (deleting.status === "rejected") assert.equal(deleting.reason.code, "ACCOUNT_DELETE_IDENTITY_DELETE_FAILED");
    assert.equal(await countUserSettingsRows(ownerPool, [account.userId]), 0);
    for (const subject of [primary, alias]) {
      await assert.rejects(ensureCognitoUserProfile(subject, email), { code: "ACCOUNT_DELETED" });
    }
    await assert.rejects(ensureUserProfile(account.userId, email), { code: "23514" });
    const bindings = await ownerPool.query(
      "SELECT cognito_subject FROM auth.provider_identities WHERE cognito_subject = ANY($1::text[]) UNION ALL SELECT cognito_subject FROM auth.verified_login_emails WHERE cognito_subject = ANY($1::text[])", [[primary, alias]],
    );
    assert.equal(bindings.rowCount, 0);
    failCleanup = false;
    await deleteAccountForAuthenticatedUser({ ...deletion, authSubjectUserId: alias, cognitoUsername: alias }, dependencies);
    assert.deepEqual(cleanedSubjects.sort(), [primary, alias].sort());
    const pending = await ownerPool.query(
      "SELECT 1 FROM auth.cognito_deletion_jobs WHERE deletion_id IN (SELECT deletion_id FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[]))",
      [[primary, alias].map(hashDeletedSubject)],
    );
    assert.equal(pending.rowCount, 0);
  } finally {
    try {
      await removeAccounts(ownerPool, userIds, workspaceIds);
      await ownerPool.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await ownerPool.query("DELETE FROM auth.cognito_deletion_jobs WHERE deletion_id IN (SELECT deletion_id FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[]))", [subjects.map(hashDeletedSubject)]);
      await ownerPool.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hashDeletedSubject)]);
      await ownerPool.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256 = ANY($1::text[])", [userIds.map(hashDeletedSubject)]);
    } finally {
      await ownerPool.end();
    }
  }
});

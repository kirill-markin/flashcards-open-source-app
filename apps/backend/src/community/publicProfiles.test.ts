import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue, UserDatabaseScope } from "../database";
import {
  getAnonymousDisplayNameWordPools,
  resolveAnonymousDisplayNameLocale,
  type AnonymousDisplayNameWordPools,
} from "./anonymousDisplayNames";
import {
  PublicProfileDisplayNamePoolError,
  PublicProfileIdCollisionLimitError,
  ensurePublicProfileForUserWithDependencies,
  readPublicProfileForUserWithDependencies,
  updateLeaderboardParticipationWithDependencies,
  type PublicProfileServiceDependencies,
} from "./publicProfiles";

type QueryResultRow = pg.QueryResultRow;

type StoredPublicProfile = Readonly<{
  userId: string;
  publicProfileId: string;
  leaderboardParticipationEnabled: boolean;
}>;

type PublicProfileRow = QueryResultRow & Readonly<{
  public_profile_id: string;
  leaderboard_participation_enabled: boolean;
}>;

type MutableProfileStoreState = {
  profilesByUserId: Map<string, StoredPublicProfile>;
  publicProfileIdsInUse: Set<string>;
  insertAttemptCount: number;
  updateAttemptCount: number;
};

type ProfileDependencyOverrides = Readonly<{
  uuids?: ReadonlyArray<string>;
  prefixPool?: ReadonlyArray<string>;
  adjectivePool?: ReadonlyArray<string>;
  nounPool?: ReadonlyArray<string>;
  separator?: string;
  resolveDisplayNameWordPoolsFn?: (localeHint: string) => AnonymousDisplayNameWordPools;
  maxCreateAttempts?: number;
}>;

function createQueryResult<Row extends QueryResultRow>(
  rows: ReadonlyArray<Row>,
): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createProfileStoreState(): MutableProfileStoreState {
  return {
    profilesByUserId: new Map<string, StoredPublicProfile>(),
    publicProfileIdsInUse: new Set<string>(),
    insertAttemptCount: 0,
    updateAttemptCount: 0,
  };
}

function toPublicProfileRow(profile: StoredPublicProfile): PublicProfileRow {
  return {
    public_profile_id: profile.publicProfileId,
    leaderboard_participation_enabled: profile.leaderboardParticipationEnabled,
  };
}

function readStringParam(params: ReadonlyArray<SqlValue>, index: number, label: string): string {
  const value = params[index];
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readBooleanParam(params: ReadonlyArray<SqlValue>, index: number, label: string): boolean {
  const value = params[index];
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function createPublicProfileExecutor(state: MutableProfileStoreState): DatabaseExecutor {
  return {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (
        text.startsWith("SELECT public_profile_id")
        && text.includes("FROM community.public_profiles")
        && text.includes("WHERE user_id = $1")
      ) {
        const userId = readStringParam(params, 0, "userId");
        const profile = state.profilesByUserId.get(userId);
        const rows = profile === undefined ? [] : [toPublicProfileRow(profile)];
        return createQueryResult(rows) as unknown as pg.QueryResult<Row>;
      }

      if (text.startsWith("WITH inserted_profile AS")) {
        state.insertAttemptCount += 1;

        const userId = readStringParam(params, 0, "userId");
        const publicProfileId = readStringParam(params, 1, "publicProfileId");
        const existingProfile = state.profilesByUserId.get(userId);
        if (existingProfile !== undefined) {
          return createQueryResult([toPublicProfileRow(existingProfile)]) as unknown as pg.QueryResult<Row>;
        }

        if (state.publicProfileIdsInUse.has(publicProfileId)) {
          return createQueryResult([]) as unknown as pg.QueryResult<Row>;
        }

        const profile: StoredPublicProfile = {
          userId,
          publicProfileId,
          leaderboardParticipationEnabled: true,
        };
        state.profilesByUserId.set(userId, profile);
        state.publicProfileIdsInUse.add(publicProfileId);
        return createQueryResult([toPublicProfileRow(profile)]) as unknown as pg.QueryResult<Row>;
      }

      if (text.startsWith("UPDATE community.public_profiles")) {
        state.updateAttemptCount += 1;

        const userId = readStringParam(params, 0, "userId");
        const leaderboardParticipationEnabled = readBooleanParam(
          params,
          1,
          "leaderboardParticipationEnabled",
        );
        const existingProfile = state.profilesByUserId.get(userId);
        if (existingProfile === undefined) {
          return createQueryResult([]) as unknown as pg.QueryResult<Row>;
        }

        const updatedProfile: StoredPublicProfile = {
          ...existingProfile,
          leaderboardParticipationEnabled,
        };
        state.profilesByUserId.set(userId, updatedProfile);
        return createQueryResult([toPublicProfileRow(updatedProfile)]) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected public profile query: ${text}`);
    },
  };
}

function readSequenceValue<Value>(
  values: ReadonlyArray<Value>,
  index: number,
  label: string,
): Value {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`${label} sequence was exhausted at index ${index}.`);
  }

  return value;
}

function createProfileServiceDependencies(
  state: MutableProfileStoreState,
  overrides: ProfileDependencyOverrides,
): PublicProfileServiceDependencies {
  const executor = createPublicProfileExecutor(state);
  const uuids = overrides.uuids ?? [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ];
  let nextUuidIndex = 0;

  return {
    transactionWithUserScopeFn: async <Result>(
      _scope: UserDatabaseScope,
      callback: (transactionExecutor: DatabaseExecutor) => Promise<Result>,
    ): Promise<Result> => callback(executor),
    randomUuidFn: (): string => {
      const value = readSequenceValue(uuids, nextUuidIndex, "uuid");
      nextUuidIndex += 1;
      return value;
    },
    resolveDisplayNameWordPoolsFn: overrides.resolveDisplayNameWordPoolsFn ?? (() => ({
      prefixPool: overrides.prefixPool ?? ["Silver"],
      adjectivePool: overrides.adjectivePool ?? ["Bright"],
      nounPool: overrides.nounPool ?? ["Harbor"],
      separator: overrides.separator ?? " ",
    })),
    maxCreateAttempts: overrides.maxCreateAttempts ?? 3,
  };
}

test("anonymous display-name locale resolver handles supported app locale aliases", () => {
  const cases = [
    ["en-US", "en"],
    ["ar", "ar"],
    ["zh-CN", "zh-Hans"],
    ["zh-Hans", "zh-Hans"],
    ["zh-rCN", "zh-Hans"],
    ["de-DE", "de"],
    ["de-rDE", "de"],
    ["hi-IN", "hi"],
    ["ja-JP", "ja"],
    ["ru-RU", "ru"],
    ["es", "es-ES"],
    ["es-419", "es-MX"],
    ["b+es+419", "es-MX"],
    ["es-MX", "es-MX"],
    ["es-ES", "es-ES"],
  ] as const;

  for (const [localeHint, expectedLocale] of cases) {
    assert.equal(resolveAnonymousDisplayNameLocale(localeHint), expectedLocale);
  }
});

test("anonymous display-name word pools are available for supported localized app aliases", () => {
  const localeHints = [
    "en",
    "ar",
    "zh-CN",
    "de",
    "hi",
    "ja",
    "ru",
    "es-MX",
    "es-ES",
  ] as const;

  for (const localeHint of localeHints) {
    const wordPools = getAnonymousDisplayNameWordPools(localeHint);

    assert.ok(wordPools.prefixPool.length > 0);
    assert.ok(wordPools.adjectivePool.length > 0);
    assert.ok(wordPools.nounPool.length > 0);
  }
});

test("community public profiles migration creates self-scoped backend RLS table", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0057_community_public_profiles.sql",
  );
  const migrationSql = readFileSync(migrationPath, "utf8");

  assert.match(migrationSql, /CREATE SCHEMA IF NOT EXISTS community/);
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS community\.public_profiles/);
  assert.match(migrationSql, /user_id TEXT PRIMARY KEY REFERENCES org\.user_settings\(user_id\) ON DELETE CASCADE/);
  assert.equal(migrationSql.includes("anonymous_display_name"), false);
  assert.match(migrationSql, /ALTER TABLE community\.public_profiles ENABLE ROW LEVEL SECURITY/);
  assert.match(migrationSql, /GRANT USAGE ON SCHEMA community TO backend_app/);
  assert.match(migrationSql, /GRANT INSERT \(\s*user_id,\s*public_profile_id\s*\) ON TABLE community\.public_profiles TO backend_app/);
  assert.match(migrationSql, /GRANT UPDATE \(\s*leaderboard_participation_enabled,\s*updated_at\s*\) ON TABLE community\.public_profiles TO backend_app/);
  assert.match(migrationSql, /FOR SELECT\s+TO backend_app\s+USING \(user_id = security\.current_user_id\(\)\)/);
  assert.match(migrationSql, /FOR UPDATE\s+TO backend_app\s+USING \(user_id = security\.current_user_id\(\)\)/);
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION community\.transfer_guest_public_profile/);
  assert.match(migrationSql, /GRANT EXECUTE ON FUNCTION community\.transfer_guest_public_profile\(TEXT, TEXT\) TO backend_app/);
});

test("ensurePublicProfileForUser creates a public profile without internal ids", async () => {
  const state = createProfileStoreState();
  const dependencies = createProfileServiceDependencies(state, {});

  const profile = await ensurePublicProfileForUserWithDependencies("user-1", "en", dependencies);

  assert.deepEqual(profile, {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: true,
  });
  assert.equal(Object.hasOwn(profile, "userId"), false);
  assert.equal(Object.hasOwn(profile, "workspaceId"), false);
  assert.equal(Object.hasOwn(profile, "subjectUserId"), false);
});

test("readPublicProfileForUser returns the same stored profile across repeated reads", async () => {
  const state = createProfileStoreState();
  const dependencies = createProfileServiceDependencies(state, {});

  const createdProfile = await ensurePublicProfileForUserWithDependencies("user-1", "en", dependencies);
  const firstRead = await readPublicProfileForUserWithDependencies("user-1", "en", dependencies);
  const secondRead = await readPublicProfileForUserWithDependencies("user-1", "en", dependencies);
  const ensuredAgain = await ensurePublicProfileForUserWithDependencies("user-1", "en", dependencies);

  assert.deepEqual(firstRead, createdProfile);
  assert.deepEqual(secondRead, createdProfile);
  assert.deepEqual(ensuredAgain, createdProfile);
  assert.equal(state.insertAttemptCount, 1);
});

test("updateLeaderboardParticipation changes only the participation preference", async () => {
  const state = createProfileStoreState();
  const dependencies = createProfileServiceDependencies(state, {});
  const createdProfile = await ensurePublicProfileForUserWithDependencies("user-1", "en", dependencies);

  const updatedProfile = await updateLeaderboardParticipationWithDependencies("user-1", false, "en", dependencies);

  assert.deepEqual(updatedProfile, {
    publicProfileId: createdProfile.publicProfileId,
    anonymousDisplayName: createdProfile.anonymousDisplayName,
    leaderboardParticipationEnabled: false,
  });
  assert.deepEqual(state.profilesByUserId.get("user-1"), {
    userId: "user-1",
    publicProfileId: createdProfile.publicProfileId,
    leaderboardParticipationEnabled: false,
  });
  assert.equal(state.updateAttemptCount, 1);
});

test("anonymous display name is derived at read time from the public profile id", async () => {
  const state = createProfileStoreState();
  const createDependencies = createProfileServiceDependencies(state, {
    prefixPool: ["Silver"],
    adjectivePool: ["Bright"],
    nounPool: ["Harbor"],
  });
  const localizedReadDependencies = createProfileServiceDependencies(state, {
    prefixPool: ["Gold"],
    adjectivePool: ["Bright"],
    nounPool: ["Harbor"],
  });

  const createdProfile = await ensurePublicProfileForUserWithDependencies("user-1", "en", createDependencies);
  const readProfile = await readPublicProfileForUserWithDependencies("user-1", "de", localizedReadDependencies);

  assert.equal(createdProfile.publicProfileId, "00000000-0000-4000-8000-000000000001");
  assert.equal(createdProfile.anonymousDisplayName, "Silver Bright Harbor");
  assert.deepEqual(readProfile, {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Gold Bright Harbor",
    leaderboardParticipationEnabled: true,
  });
  assert.deepEqual(state.profilesByUserId.get("user-1"), {
    userId: "user-1",
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    leaderboardParticipationEnabled: true,
  });
});

test("anonymous display name uses the current locale hint without storing localized text", async () => {
  const state = createProfileStoreState();
  const requestedLocales: string[] = [];
  const dependencies = createProfileServiceDependencies(state, {
    resolveDisplayNameWordPoolsFn: (localeHint) => {
      requestedLocales.push(localeHint);
      if (localeHint === "ru") {
        return {
          prefixPool: ["Серебро"],
          adjectivePool: ["Яркий"],
          nounPool: ["Маяк"],
          separator: " ",
        };
      }

      return {
        prefixPool: ["Silver"],
        adjectivePool: ["Bright"],
        nounPool: ["Beacon"],
        separator: " ",
      };
    },
  });

  const createdProfile = await ensurePublicProfileForUserWithDependencies("user-1", "en", dependencies);
  const localizedReadProfile = await readPublicProfileForUserWithDependencies("user-1", "ru", dependencies);

  assert.deepEqual(requestedLocales, ["en", "ru"]);
  assert.equal(createdProfile.publicProfileId, localizedReadProfile?.publicProfileId);
  assert.equal(createdProfile.anonymousDisplayName, "Silver Bright Beacon");
  assert.equal(localizedReadProfile?.anonymousDisplayName, "Серебро Яркий Маяк");
  assert.deepEqual(state.profilesByUserId.get("user-1"), {
    userId: "user-1",
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    leaderboardParticipationEnabled: true,
  });
});

test("ensurePublicProfileForUser retries public id collisions and succeeds with the next candidate", async () => {
  const state = createProfileStoreState();
  state.publicProfileIdsInUse.add("00000000-0000-4000-8000-000000000001");
  const dependencies = createProfileServiceDependencies(state, {
    prefixPool: ["Silver"],
    adjectivePool: ["Bright"],
    nounPool: ["Harbor"],
    uuids: [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ],
    maxCreateAttempts: 2,
  });

  const profile = await ensurePublicProfileForUserWithDependencies("user-1", "en", dependencies);

  assert.deepEqual(profile, {
    publicProfileId: "00000000-0000-4000-8000-000000000002",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: true,
  });
  assert.equal(state.insertAttemptCount, 2);
});

test("ensurePublicProfileForUser raises a bounded collision error after repeated public id conflicts", async () => {
  const state = createProfileStoreState();
  state.publicProfileIdsInUse.add("00000000-0000-4000-8000-000000000001");
  state.publicProfileIdsInUse.add("00000000-0000-4000-8000-000000000002");
  const dependencies = createProfileServiceDependencies(state, {
    prefixPool: ["Silver"],
    adjectivePool: ["Bright"],
    nounPool: ["Harbor"],
    uuids: [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ],
    maxCreateAttempts: 2,
  });

  await assert.rejects(
    ensurePublicProfileForUserWithDependencies("user-1", "en", dependencies),
    PublicProfileIdCollisionLimitError,
  );
  assert.equal(state.insertAttemptCount, 2);
});

test("ensurePublicProfileForUser raises a display-name pool error when a configured word pool is empty", async () => {
  const state = createProfileStoreState();
  const dependencies = createProfileServiceDependencies(state, {
    prefixPool: [],
    adjectivePool: ["Bright"],
    nounPool: ["Harbor"],
    maxCreateAttempts: 3,
  });

  await assert.rejects(
    ensurePublicProfileForUserWithDependencies("user-1", "en", dependencies),
    PublicProfileDisplayNamePoolError,
  );
  assert.equal(state.insertAttemptCount, 1);
});

import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { buildDataTableSqlClauses, type DataTableSqlClauses } from "../../table/dataTableSql";
import type { DataTableColumn, DataTableState } from "../../table/dataTableModel";
import {
  buildDistinctOptionsSql,
  buildNamedColumnsSql,
  parseEnumOptionsResponse,
  parsePageTotal,
} from "../../table/dataTableServerQuery";
import { utcInstantSql } from "../usersQuery";
import { readRowBoolean, readRowNullableString, readRowString } from "./queryRowValues";
import { buildMatchesUserIdSql, buildUserSubjectSql, type UserSubjectSql } from "./userSubjectSql";

// The profile's device lists, which run to thousands of rows for a few people, so each is sorted,
// filtered and paged in SQL apart from the profile query.

export type InstallationRow = Readonly<{
  installationId: string;
  platform: string;
  appVersion: string | null;
  isAutomation: boolean;
  createdAt: string;
  lastSeenAt: string;
}>;

export type InstallationProfileRow = Readonly<{
  anonymousId: string;
  platform: string;
  appVersion: string | null;
  osVersion: string | null;
  deviceLocale: string | null;
  timeZone: string | null;
  firstCountry: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}>;

export type ReplicaRow = Readonly<{
  replicaId: string;
  workspaceId: string;
  actorKind: string;
  installationId: string | null;
  platform: string;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string;
}>;

/**
 * One device list. `buildFromSql` is everything after the select list, ending in a `WHERE` over the
 * person's rows; `columnSqlById` is the SQL each column's filter and sort read, keyed by the column ids
 * its table declares; `rowFieldSql` selects each row field under its own name, which `parseRow` reads.
 */
export type DeviceListQuery<Row> = Readonly<{
  label: string;
  buildFromSql: (subject: UserSubjectSql) => string;
  columnSqlById: Readonly<Record<string, string>>;
  rowFieldSql: Readonly<Record<string, string>>;
  enumColumnIds: ReadonlyArray<string>;
  defaultOrderBySql: string;
  tiebreakOrderBySql: string;
  parseRow: (row: AdminQueryRow, location: string) => Row;
}>;

export const installationsQuery: DeviceListQuery<InstallationRow> = {
  label: "User sync installations",
  buildFromSql: (subject) => `FROM sync.installations AS installations
  WHERE ${buildMatchesUserIdSql("installations.user_id", subject)}`,
  columnSqlById: {
    "installation-id": "installations.installation_id::text",
    platform: "installations.platform",
    "app-version": "installations.app_version",
    automation: "installations.is_automation",
    created: "installations.created_at",
    "last-seen": "installations.last_seen_at",
  },
  rowFieldSql: {
    installationId: "installations.installation_id::text",
    platform: "installations.platform",
    appVersion: "installations.app_version",
    isAutomation: "installations.is_automation",
    createdAt: utcInstantSql("installations.created_at"),
    lastSeenAt: utcInstantSql("installations.last_seen_at"),
  } satisfies Readonly<Record<keyof InstallationRow, string>>,
  enumColumnIds: ["platform", "app-version"],
  defaultOrderBySql: "installations.last_seen_at DESC",
  tiebreakOrderBySql: "installations.installation_id",
  parseRow: (row, location) => ({
    installationId: readRowString(row, "installationId", location),
    platform: readRowString(row, "platform", location),
    appVersion: readRowNullableString(row, "appVersion", location),
    isAutomation: readRowBoolean(row, "isAutomation", location),
    createdAt: readRowString(row, "createdAt", location),
    lastSeenAt: readRowString(row, "lastSeenAt", location),
  }),
};

export const installationProfilesQuery: DeviceListQuery<InstallationProfileRow> = {
  label: "User analytics installation profiles",
  buildFromSql: (subject) => `FROM analytics.installation_profiles AS profiles
  WHERE profiles.user_id = ${subject.uuidSql}`,
  columnSqlById: {
    "anonymous-id": "profiles.anonymous_id::text",
    platform: "profiles.platform",
    "app-version": "profiles.app_version",
    "os-version": "profiles.os_version",
    "device-locale": "profiles.device_locale",
    timezone: "profiles.timezone",
    "first-country": "profiles.first_country",
    "first-seen": "profiles.first_seen",
    "last-seen": "profiles.last_seen",
  },
  rowFieldSql: {
    anonymousId: "profiles.anonymous_id::text",
    platform: "profiles.platform",
    appVersion: "profiles.app_version",
    osVersion: "profiles.os_version",
    deviceLocale: "profiles.device_locale",
    timeZone: "profiles.timezone",
    firstCountry: "profiles.first_country",
    firstSeenAt: utcInstantSql("profiles.first_seen"),
    lastSeenAt: utcInstantSql("profiles.last_seen"),
  } satisfies Readonly<Record<keyof InstallationProfileRow, string>>,
  enumColumnIds: ["platform", "app-version", "os-version", "device-locale", "timezone", "first-country"],
  defaultOrderBySql: "profiles.last_seen DESC",
  tiebreakOrderBySql: "profiles.anonymous_id, profiles.platform",
  parseRow: (row, location) => ({
    anonymousId: readRowString(row, "anonymousId", location),
    platform: readRowString(row, "platform", location),
    appVersion: readRowNullableString(row, "appVersion", location),
    osVersion: readRowNullableString(row, "osVersion", location),
    deviceLocale: readRowNullableString(row, "deviceLocale", location),
    timeZone: readRowNullableString(row, "timeZone", location),
    firstCountry: readRowNullableString(row, "firstCountry", location),
    firstSeenAt: readRowString(row, "firstSeenAt", location),
    lastSeenAt: readRowString(row, "lastSeenAt", location),
  }),
};

export const replicasQuery: DeviceListQuery<ReplicaRow> = {
  label: "User workspace replicas",
  buildFromSql: (subject) => `FROM sync.workspace_replicas AS replicas
  WHERE ${buildMatchesUserIdSql("replicas.user_id", subject)}`,
  columnSqlById: {
    "replica-id": "replicas.replica_id::text",
    "workspace-id": "replicas.workspace_id::text",
    "actor-kind": "replicas.actor_kind",
    "installation-id": "replicas.installation_id::text",
    platform: "replicas.platform",
    "app-version": "replicas.app_version",
    created: "replicas.created_at",
    "last-seen": "replicas.last_seen_at",
  },
  rowFieldSql: {
    replicaId: "replicas.replica_id::text",
    workspaceId: "replicas.workspace_id::text",
    actorKind: "replicas.actor_kind",
    installationId: "replicas.installation_id::text",
    platform: "replicas.platform",
    appVersion: "replicas.app_version",
    createdAt: utcInstantSql("replicas.created_at"),
    lastSeenAt: utcInstantSql("replicas.last_seen_at"),
  } satisfies Readonly<Record<keyof ReplicaRow, string>>,
  enumColumnIds: ["actor-kind", "platform", "app-version"],
  defaultOrderBySql: "replicas.last_seen_at DESC",
  tiebreakOrderBySql: "replicas.replica_id",
  parseRow: (row, location) => ({
    replicaId: readRowString(row, "replicaId", location),
    workspaceId: readRowString(row, "workspaceId", location),
    actorKind: readRowString(row, "actorKind", location),
    installationId: readRowNullableString(row, "installationId", location),
    platform: readRowString(row, "platform", location),
    appVersion: readRowNullableString(row, "appVersion", location),
    createdAt: readRowString(row, "createdAt", location),
    lastSeenAt: readRowString(row, "lastSeenAt", location),
  }),
};

/** True when any device list has a row for the person, so the profile can tell a device-only id from none. */
export function buildHasDeviceRowsSql(subject: UserSubjectSql): string {
  const fromSqls = [installationsQuery, installationProfilesQuery, replicasQuery].map((query) => query.buildFromSql(subject));
  return `(${fromSqls.map((fromSql) => `EXISTS (SELECT 1 ${fromSql})`).join(" OR ")})`;
}

function buildDeviceListPageSql<Row>(query: DeviceListQuery<Row>, fromSql: string, clauses: DataTableSqlClauses): string {
  return `SELECT ${buildNamedColumnsSql(query.rowFieldSql).join(",\n    ")}
  ${fromSql}
    AND ${clauses.whereConditionSql}
  ${clauses.orderBySql}
  ${clauses.limitOffsetSql}`;
}

function buildDeviceListTotalSql(fromSql: string, clauses: DataTableSqlClauses): string {
  return `SELECT count(*)::int AS total_count
  ${fromSql}
    AND ${clauses.whereConditionSql}`;
}

export type DeviceListPageResult<Row> = Readonly<{
  /** The rows matching the filters across every page. */
  totalCount: number;
  rows: ReadonlyArray<Row>;
}>;

/** The page at `state.page` of the person's rows and the matching total, in one request of two statements. */
export async function loadDeviceListPage<Row>(
  config: AdminAppConfig,
  userId: string,
  query: DeviceListQuery<Row>,
  state: DataTableState,
  columns: ReadonlyArray<DataTableColumn<Row>>,
): Promise<DeviceListPageResult<Row>> {
  const clauses = buildDataTableSqlClauses(state, columns, query.columnSqlById, query.defaultOrderBySql, query.tiebreakOrderBySql);
  const fromSql = query.buildFromSql(buildUserSubjectSql(userId));
  const response = await runAdminQuery(
    config,
    `${buildDeviceListPageSql(query, fromSql, clauses)};\n${buildDeviceListTotalSql(fromSql, clauses)}`,
  );
  const pageResult = response.resultSets[0];
  if (response.resultSets.length !== 2 || pageResult === undefined) {
    throw new Error(`${query.label} query must return exactly two result sets.`);
  }
  return {
    totalCount: parsePageTotal(response.resultSets[1]?.rows[0]?.total_count, query.label),
    rows: pageResult.rows.map((row, rowIndex) => query.parseRow(row, `${query.label} row ${rowIndex}`)),
  };
}

/** Every value each enum column holds across the person's rows, NULL as `""`, in one scan. */
function buildDeviceListEnumOptionsSql<Row>(query: DeviceListQuery<Row>, subject: UserSubjectSql): string {
  const optionsSql = query.enumColumnIds.map((columnId) => {
    const sqlExpression = query.columnSqlById[columnId];
    if (sqlExpression === undefined) {
      throw new Error(`${query.label} enum column "${columnId}" has no SQL expression.`);
    }
    return `'${columnId}', ${buildDistinctOptionsSql(`COALESCE(${sqlExpression}, '')`)}`;
  });
  return `SELECT json_build_object(
    ${optionsSql.join(",\n    ")}
  ) AS o
  ${query.buildFromSql(subject)}`;
}

export async function loadDeviceListEnumOptions<Row>(
  config: AdminAppConfig,
  userId: string,
  query: DeviceListQuery<Row>,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> {
  const response = await runAdminQuery(config, buildDeviceListEnumOptionsSql(query, buildUserSubjectSql(userId)));
  return parseEnumOptionsResponse(response, query.enumColumnIds, query.label);
}

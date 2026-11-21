import { breakdownUnknownValue } from "../../charts/stackedBreakdownChart";
import { escapeSqlStringLiteral } from "../../sql";
import { buildBreakdownResultsSql } from "./breakdownQuery";

const appleDevices = [
  { os: "ios", type: "phone", label: "iPhone" },
  { os: "ipados", type: "tablet", label: "iPad" },
  { os: "macos", type: "desktop", label: "Mac" },
  { os: "watchos", type: "watch", label: "Apple Watch" },
] as const;
const androidDevices = [
  { type: "phone", label: "Android phone" },
  { type: "tablet", label: "Android tablet" },
  { type: "desktop", label: "Android PC" },
  { type: "watch", label: "Wear OS" },
] as const;
const webDevices = [
  { type: "phone", label: "Web · Phone" },
  { type: "tablet", label: "Web · Tablet" },
  { type: "desktop", label: "Web · Desktop" },
] as const;
const webUnknownDevice = "Web · Unknown device";
const deviceLabels = [
  ...appleDevices.map((device) => device.label),
  ...androidDevices.map((device) => device.label),
  breakdownUnknownValue,
  ...webDevices.map((device) => device.label),
  webUnknownDevice,
];

/** Pass SQL NULL if the event source has no device model. A NULL result excludes the row from the device report. */
export function buildEventDeviceSql(eventAlias: string, deviceModelSql: string): string {
  const deviceType = `${eventAlias}.device_type`;
  // Older Apple builds still send only the hardware identifiers mapped by migration 0177.
  const appleOs = `COALESCE(${eventAlias}.os_name, CASE ${deviceType}
    ${appleDevices.map(({ type, os }) => `WHEN '${type}' THEN '${os}'`).join("\n    ")}
  END, CASE
    WHEN ${deviceType} IS NOT NULL THEN NULL
    WHEN ${deviceModelSql} LIKE 'iPhone%' THEN 'ios'
    WHEN ${deviceModelSql} LIKE 'iPad%' THEN 'ipados'
    WHEN ${deviceModelSql} = 'arm64' OR ${deviceModelSql} LIKE 'Mac%' THEN 'macos'
  END)`;
  const unknownSql = escapeSqlStringLiteral(breakdownUnknownValue);

  return `CASE ${eventAlias}.platform
    WHEN 'ios' THEN CASE ${appleOs}
      ${appleDevices.map(({ os, label }) => `WHEN '${os}' THEN ${escapeSqlStringLiteral(label)}`).join("\n      ")}
      ELSE ${unknownSql}
    END
    WHEN 'android' THEN CASE ${deviceType}
      ${androidDevices.map(({ type, label }) => `WHEN '${type}' THEN ${escapeSqlStringLiteral(label)}`).join("\n      ")}
      ELSE ${unknownSql}
    END
    WHEN 'web' THEN CASE ${deviceType}
      ${webDevices.map(({ type, label }) => `WHEN '${type}' THEN ${escapeSqlStringLiteral(label)}`).join("\n      ")}
      ELSE ${escapeSqlStringLiteral(webUnknownDevice)}
    END
  END`;
}

/** Keep every observed device category in a fixed order. */
export function buildDeviceBreakdownSql(ctesSql: string): string {
  const rankCases = deviceLabels.map((label, index) => `WHEN ${escapeSqlStringLiteral(label)} THEN ${index + 1}`);
  return buildBreakdownResultsSql(`${ctesSql}, series_counts AS (
  SELECT bucket_date, dimension_value AS series_value, value_count,
    CASE dimension_value ${rankCases.join(" ")} END AS series_rank
  FROM measured_values
)`);
}

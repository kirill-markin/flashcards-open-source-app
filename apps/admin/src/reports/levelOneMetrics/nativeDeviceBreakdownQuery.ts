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
const deviceLabels = [...appleDevices.map((device) => device.label), ...androidDevices.map((device) => device.label), breakdownUnknownValue];

/** Classify the event's own device. Pass SQL NULL if the event source has no model. A NULL result means the row is outside the native report. */
export function buildNativeDeviceSql(eventAlias: string, deviceModelSql: string): string {
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
  END`;
}

/** Keep every observed native device in a fixed order, even if a single event used it. */
export function buildNativeDeviceBreakdownSql(ctesSql: string): string {
  const rankCases = deviceLabels.map((label, index) => `WHEN ${escapeSqlStringLiteral(label)} THEN ${index + 1}`);
  return buildBreakdownResultsSql(`${ctesSql}, series_counts AS (
  SELECT bucket_date, dimension_value AS series_value, value_count,
    CASE dimension_value ${rankCases.join(" ")} END AS series_rank
  FROM measured_values
)`);
}

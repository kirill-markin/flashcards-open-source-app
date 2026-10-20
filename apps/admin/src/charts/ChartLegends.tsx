import type { JSX } from "react";
import { AdminLink } from "../navigation/AdminLink";
import { uniqueUserCohortColors, uniqueUserCohortKeys, uniqueUserCohortLabels } from "./chartPrimitives";

/** Where a key entry links: `getPath` gives an entry's admin path, or null to leave it plain. */
export type ChartColorKeyLink<Key extends string> = Readonly<{
  getPath: (key: Key) => string | null;
  onNavigate: (path: string) => void;
}>;

export function ChartColorKey<Key extends string>(
  props: Readonly<{
    ariaLabel: string;
    keys: ReadonlyArray<Key>;
    getColor: (key: Key) => string;
    getLabel: (key: Key) => string;
    /** Without it every entry is plain. */
    link?: ChartColorKeyLink<Key> | undefined;
  }>,
): JSX.Element {
  return (
    <div className="platform-key" aria-label={props.ariaLabel}>
      {props.keys.map((key) => {
        const content = (
          <>
            <span className="platform-key-swatch" style={{ backgroundColor: props.getColor(key) }} />
            <span>{props.getLabel(key)}</span>
          </>
        );
        const link = props.link;
        const path = link === undefined ? null : link.getPath(key);
        return link === undefined || path === null ? (
          <span key={key} className="platform-key-item">{content}</span>
        ) : (
          <AdminLink key={key} path={path} className="platform-key-item platform-key-link" onNavigate={link.onNavigate}>
            {content}
          </AdminLink>
        );
      })}
    </div>
  );
}

/** An invisible one-chip key that holds a data-derived key's row height until its keys load. */
export function ChartColorKeyPlaceholder(): JSX.Element {
  return (
    <div className="platform-key platform-key-placeholder" aria-hidden="true">
      <span className="platform-key-item">
        <span className="platform-key-swatch" />
        <span>{"\u00a0"}</span>
      </span>
    </div>
  );
}

export function UniqueUserCohortKey(): JSX.Element {
  return (
    <ChartColorKey
      ariaLabel="Unique users cohort color key"
      keys={uniqueUserCohortKeys}
      getColor={(cohort) => uniqueUserCohortColors[cohort]}
      getLabel={(cohort) => uniqueUserCohortLabels[cohort]}
    />
  );
}

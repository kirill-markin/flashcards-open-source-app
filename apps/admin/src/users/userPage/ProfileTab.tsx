import { useMemo, useState, type JSX, type ReactNode } from "react";
import { AdminLink } from "../../navigation/AdminLink";
import { getUserPath } from "../../routing";
import { DataTable } from "../../table/DataTable";
import { emptyDataTableState, type DataTableColumn, type DataTableState } from "../../table/dataTableModel";
import { formatInstant } from "./formatInstant";
import type {
  ProfileCell,
  ProfileField,
  ProfileListSection,
  ProfileSectionData,
  UserProfile,
} from "./profileQuery";

type ProfileListRow = Readonly<{ key: string; cells: ReadonlyArray<ProfileCell> }>;

export function renderUserLink(userId: string, onNavigate: (path: string) => void): JSX.Element {
  return <AdminLink className="data-table-link" path={getUserPath(userId, "profile")} onNavigate={onNavigate}>{userId}</AdminLink>;
}

/** `value` null renders the empty-value dash. */
export type ProfileRecordRow = Readonly<{ id: string; label: string; value: ReactNode }>;

/** The label and value rows of a record section; the event page renders its fields with it too. */
export function ProfileRecord(props: Readonly<{ rows: ReadonlyArray<ProfileRecordRow> }>): JSX.Element {
  return (
    <dl className="profile-record">
      {props.rows.map((row) => (
        <div key={row.id} className="profile-record-row">
          <dt>{row.label}</dt>
          <dd>{row.value === null ? <span className="profile-empty-value">—</span> : row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProfileRecordSection(props: Readonly<{
  title: string;
  testId: string;
  rows: ReadonlyArray<ProfileRecordRow>;
}>): JSX.Element {
  return (
    <section className="profile-section profile-section-record" data-testid={props.testId}>
      <h2>{props.title}</h2>
      <ProfileRecord rows={props.rows} />
    </section>
  );
}

function renderRecordValue(field: ProfileField, cell: ProfileCell, onNavigate: (path: string) => void): ReactNode {
  if (cell === null) {
    return null;
  }
  if (typeof cell === "boolean") {
    return cell ? "yes" : "no";
  }
  if (typeof cell === "number") {
    return cell.toLocaleString("en-US");
  }
  switch (field.kind) {
    case "date":
      return formatInstant(cell);
    case "user":
      return renderUserLink(cell, onNavigate);
    default:
      return cell;
  }
}

/** The parser has already checked every cell against its field kind; this only narrows the type. */
function readCell<Value extends ProfileCell>(row: ProfileListRow, index: number, isValue: (cell: ProfileCell) => cell is Value): Value | null {
  const cell = row.cells[index] ?? null;
  if (cell === null) {
    return null;
  }
  if (isValue(cell)) {
    return cell;
  }
  throw new Error(`Profile list cell ${index} of row ${row.key} has an unexpected type.`);
}

const isString = (cell: ProfileCell): cell is string => typeof cell === "string";
const isNumber = (cell: ProfileCell): cell is number => typeof cell === "number";
const isBoolean = (cell: ProfileCell): cell is boolean => typeof cell === "boolean";

function buildListColumn(
  field: ProfileField,
  index: number,
  onNavigate: (path: string) => void,
): DataTableColumn<ProfileListRow> {
  const base = { id: field.id, label: field.label };
  switch (field.kind) {
    case "text":
      return { ...base, kind: "text", value: (row) => readCell(row, index, isString), renderCell: null };
    case "enum":
      return { ...base, kind: "enum", value: (row) => readCell(row, index, isString), renderCell: null };
    case "date":
      return { ...base, kind: "date", value: (row) => readCell(row, index, isString), renderCell: null };
    case "user":
      return {
        ...base,
        kind: "text",
        value: (row) => readCell(row, index, isString),
        renderCell: (row) => {
          const userId = readCell(row, index, isString);
          return userId === null ? null : renderUserLink(userId, onNavigate);
        },
      };
    case "number":
      return { ...base, kind: "number", value: (row) => readCell(row, index, isNumber), renderCell: null };
    case "boolean":
      return { ...base, kind: "boolean", value: (row) => readCell(row, index, isBoolean), renderCell: null };
  }
}

function getListRowKey(row: ProfileListRow): string {
  return row.key;
}

function getListRowClassName(): string {
  return "";
}

function ProfileListTable(props: Readonly<{
  section: ProfileListSection;
  rows: ReadonlyArray<ReadonlyArray<ProfileCell>>;
  onNavigate: (path: string) => void;
}>): JSX.Element {
  const { section, rows, onNavigate } = props;
  const [tableState, setTableState] = useState<DataTableState>(emptyDataTableState);
  const columns = useMemo(
    () => section.fields.map((field, index) => buildListColumn(field, index, onNavigate)),
    [section, onNavigate],
  );
  const tableRows = useMemo(
    () => rows.map((cells, index): ProfileListRow => ({ key: String(index), cells })),
    [rows],
  );
  return (
    <DataTable
      testId={`user-profile-${section.id}-table`}
      columns={columns}
      rows={tableRows}
      rowKey={getListRowKey}
      rowClassName={getListRowClassName}
      state={tableState}
      onStateChange={setTableState}
    />
  );
}

function ProfileSectionView(props: Readonly<{ data: ProfileSectionData; onNavigate: (path: string) => void }>): JSX.Element {
  const { data, onNavigate } = props;
  const section = data.section;
  return (
    <section className={`profile-section profile-section-${data.kind}`} data-testid={`user-profile-${section.id}`}>
      <h2>{section.title}</h2>
      {data.kind === "record" ? (
        data.cells === null ? <p className="profile-section-empty">{data.section.emptyText}</p> : (
          <ProfileRecord
            rows={data.section.fields.map((field, index) => ({
              id: field.id,
              label: field.label,
              value: renderRecordValue(field, data.cells === null ? null : data.cells[index] ?? null, onNavigate),
            }))}
          />
        )
      ) : data.rows.length === 0 ? <p className="profile-section-empty">None.</p> : (
        <ProfileListTable section={data.section} rows={data.rows} onNavigate={onNavigate} />
      )}
    </section>
  );
}

export function ProfileTab(props: Readonly<{ profile: UserProfile; onNavigate: (path: string) => void }>): JSX.Element {
  const { header } = props.profile;
  return (
    <div className="profile-sections" data-testid="user-profile">
      <ProfileRecordSection
        title="Identity and exclusion"
        testId="user-profile-identity"
        rows={[
          {
            id: "kind",
            label: "Kind",
            value: header.kind ?? <span className="profile-empty-value">unknown: no settings row, sign-in identity or guest session</span>,
          },
          {
            id: "identity-created",
            label: "Sign-in identity created",
            value: header.identityCreatedAt === null ? <span className="profile-empty-value">no sign-in identity</span> : formatInstant(header.identityCreatedAt),
          },
          {
            id: "merged-into",
            label: "Analytics merged into",
            value: header.mergedInto === null ? null : renderUserLink(header.mergedInto.userId, props.onNavigate),
          },
          {
            id: "excluded",
            label: "Excluded from reports",
            value: header.exclusionReason === null ? "no" : `yes: ${header.exclusionReason}`,
          },
        ]}
      />
      {props.profile.sections.map((data) => (
        <ProfileSectionView key={data.section.id} data={data} onNavigate={props.onNavigate} />
      ))}
    </div>
  );
}

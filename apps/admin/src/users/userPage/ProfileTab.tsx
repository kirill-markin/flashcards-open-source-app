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

function renderUserLink(userId: string, onNavigate: (path: string) => void): JSX.Element {
  return <AdminLink className="data-table-link" path={getUserPath(userId, "profile")} onNavigate={onNavigate}>{userId}</AdminLink>;
}

function renderRecordValue(field: ProfileField, cell: ProfileCell, onNavigate: (path: string) => void): ReactNode {
  if (cell === null) {
    return <span className="profile-empty-value">—</span>;
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
          <dl className="profile-record">
            {data.section.fields.map((field, index) => (
              <div key={field.id} className="profile-record-row">
                <dt>{field.label}</dt>
                <dd>{renderRecordValue(field, data.cells === null ? null : data.cells[index] ?? null, onNavigate)}</dd>
              </div>
            ))}
          </dl>
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
      <section className="profile-section profile-section-record" data-testid="user-profile-identity">
        <h2>Identity and exclusion</h2>
        <dl className="profile-record">
          <div className="profile-record-row">
            <dt>Kind</dt>
            <dd>{header.kind ?? <span className="profile-empty-value">unknown: no settings row, sign-in identity or guest session</span>}</dd>
          </div>
          <div className="profile-record-row">
            <dt>Sign-in identity created</dt>
            <dd>{header.identityCreatedAt === null ? <span className="profile-empty-value">no sign-in identity</span> : formatInstant(header.identityCreatedAt)}</dd>
          </div>
          <div className="profile-record-row">
            <dt>Analytics merged into</dt>
            <dd>{header.mergedInto === null ? <span className="profile-empty-value">—</span> : renderUserLink(header.mergedInto.userId, props.onNavigate)}</dd>
          </div>
          <div className="profile-record-row">
            <dt>Excluded from reports</dt>
            <dd>{header.exclusionReason === null ? "no" : `yes: ${header.exclusionReason}`}</dd>
          </div>
        </dl>
      </section>
      {props.profile.sections.map((data) => (
        <ProfileSectionView key={data.section.id} data={data} onNavigate={props.onNavigate} />
      ))}
    </div>
  );
}

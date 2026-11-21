import type { ReactElement } from "react";

export type ProgressRecordView = Readonly<{
  key: string;
  label: string;
  valueLabel: string;
  detailLabel: string | null;
}>;

type ProgressRecordsSectionProps = Readonly<{
  title: string;
  records: ReadonlyArray<ProgressRecordView>;
  recentTitle: string;
  recentRecords: ReadonlyArray<ProgressRecordView>;
}>;

function ProgressRecordList(props: Readonly<{
  ariaLabel: string;
  records: ReadonlyArray<ProgressRecordView>;
}>): ReactElement {
  return (
    <dl className="progress-records-list" aria-label={props.ariaLabel}>
      {props.records.map((record) => (
        <div key={record.key} className="progress-records-row" data-testid={`progress-record-${record.key}`}>
          <dt className="progress-records-label">{record.label}</dt>
          <dd className="progress-records-values">
            <span className="progress-records-value">{record.valueLabel}</span>
            {record.detailLabel === null ? null : (
              <span className="progress-records-detail">{record.detailLabel}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressRecordsSection(props: ProgressRecordsSectionProps): ReactElement {
  const { title, records, recentTitle, recentRecords } = props;

  return (
    <section className="content-card progress-section" data-testid="progress-records-card">
      <div className="progress-section-head">
        <h2 className="progress-section-title">{title}</h2>
      </div>

      <ProgressRecordList ariaLabel={title} records={records} />

      <h3 className="progress-records-subtitle">{recentTitle}</h3>
      <ProgressRecordList ariaLabel={recentTitle} records={recentRecords} />
    </section>
  );
}

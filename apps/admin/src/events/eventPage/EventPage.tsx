import { useEffect, useState, type JSX, type ReactNode } from "react";
import type { AdminAppConfig } from "../../config";
import { AdminNavigation } from "../../navigation/AdminNavigation";
import { formatInstant } from "../../users/userPage/formatInstant";
import { ProfileRecordSection, renderUserLink, type ProfileRecordRow } from "../../users/userPage/ProfileTab";
import { loadAnalyticsEvent, type AnalyticsEvent, type LoadedAnalyticsEvent } from "./eventQuery";
import "../../table/dataTable.css";
import "../../users/userPage/userPage.css";

type EventLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; loaded: LoadedAnalyticsEvent | null }>;

function row(id: string, label: string, value: ReactNode): ProfileRecordRow {
  return { id, label, value };
}

function instantValue(value: string | null): string | null {
  return value === null ? null : formatInstant(value);
}

function booleanValue(value: boolean | null): string | null {
  if (value === null) return null;
  return value ? "yes" : "no";
}

function jsonValue(value: string | null): ReactNode {
  return value === null ? null : <pre className="json-preview-full">{value}</pre>;
}

function EventSections(props: Readonly<{ event: AnalyticsEvent; onNavigate: (path: string) => void }>): JSX.Element {
  const { event, onNavigate } = props;
  const userLink = (userId: string | null): ReactNode => userId === null ? null : renderUserLink(userId, onNavigate);
  return (
    <div className="profile-sections" data-testid="event-page-fields">
      <ProfileRecordSection
        title="Event"
        testId="event-page-event"
        rows={[
          row("event-id", "Event ID", event.eventId),
          row("event-name", "Event name", event.eventName),
          row("schema-version", "Schema version", event.schemaVersion.toLocaleString("en-US")),
          row("origin", "Origin", event.origin),
          row("trust-level", "Trust level", event.trustLevel),
          row("auth-transport", "Auth transport", event.authTransport),
          row("automated-client", "Automated client", booleanValue(event.automatedClient)),
          row("backfill-id", "Backfill ID", event.backfillId),
          row("request-id", "Request ID", event.requestId),
        ]}
      />
      <ProfileRecordSection
        title="Time"
        testId="event-page-time"
        rows={[
          row("occurred", "Occurred", formatInstant(event.occurredAt)),
          row("client-occurred", "Client occurred", instantValue(event.clientOccurredAt)),
          row("client-sent", "Client sent", instantValue(event.clientSentAt)),
          row("server-received", "Server received", formatInstant(event.serverReceivedAt)),
          row("ingested", "Ingested", formatInstant(event.ingestedAt)),
        ]}
      />
      <ProfileRecordSection
        title="Identity"
        testId="event-page-identity"
        rows={[
          row("actor-id", "Actor ID", userLink(event.actorId)),
          row("actor-email", "Actor email", event.actorEmail),
          row("excluded", "Excluded from reports", event.exclusionReason === null ? "no" : `yes: ${event.exclusionReason}`),
          row("user-id", "Recorded user ID", userLink(event.userId)),
          row("subject-user-id", "Subject user ID", userLink(event.subjectUserId)),
          row("anonymous-id", "Anonymous ID", event.anonymousId),
          row("guest-session-id", "Guest session ID", event.guestSessionId),
          row("workspace-id", "Workspace ID", event.workspaceId),
          row("session-id", "Session ID", event.sessionId),
          row("identity-state", "Identity state", event.identityState),
          row("daily-visitor-hash", "Daily visitor hash", event.dailyVisitorHash),
        ]}
      />
      <ProfileRecordSection
        title="Device and context"
        testId="event-page-context"
        rows={[
          row("platform", "Platform", event.platform),
          row("app-version", "App version", event.appVersion),
          row("os-version", "OS version", event.osVersion),
          row("device-model", "Device model", event.deviceModel),
          row("device-locale", "Device locale", event.deviceLocale),
          row("ui-locale", "UI locale", event.uiLocale),
          row("timezone", "Time zone", event.timezone),
          row("country", "Country", event.country),
          row("network-state", "Network state", event.networkState),
          row("screen", "Screen", event.screen),
        ]}
      />
      <ProfileRecordSection
        title="Properties"
        testId="event-page-properties"
        rows={[
          row("event-properties", "Event properties", jsonValue(event.eventProperties)),
          row("experiment-assignments", "Experiment assignments", jsonValue(event.experimentAssignments)),
          row("details", "Details", jsonValue(event.details)),
        ]}
      />
    </div>
  );
}

/** One analytics event by id, every stored field. The caller keys this page on the id. */
export function EventPage(props: Readonly<{
  config: AdminAppConfig;
  adminEmail: string;
  eventId: string;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, eventId, onTerminalAdminError } = props;
  const [loadState, setLoadState] = useState<EventLoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadAnalyticsEvent(config, eventId).then((loaded) => {
      if (!cancelled) setLoadState({ status: "ready", loaded });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "Unexpected analytics event query error." });
    });
    return () => { cancelled = true; };
  }, [config, eventId, onTerminalAdminError, revision]);

  const loaded = loadState.status === "ready" ? loadState.loaded : null;

  function renderContent(): ReactNode {
    switch (loadState.status) {
      case "loading":
        return <p className="report-state" aria-live="polite">Loading event…</p>;
      case "error":
        return (
          <div className="report-state report-state-error">
            <strong>Analytics event query failed.</strong><span>{loadState.message}</span>
            <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
          </div>
        );
      case "ready":
        return loadState.loaded === null ? (
          <div className="report-state" data-testid="event-page-not-found">
            <strong>No event matches this id.</strong>
            <span>No row of analytics.product_events_resolved has the event id {eventId}.</span>
          </div>
        ) : <EventSections event={loadState.loaded.event} onNavigate={props.onNavigate} />;
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Admin · Event</p>
          <h1 data-testid="event-page-title">{loaded === null ? "Event" : loaded.event.eventName}</h1>
        </div>
        <div className="hero-meta">
          <span className="hero-badge" data-testid="event-page-id">Event ID {eventId}</span>
          {loaded !== null && loaded.event.exclusionReason !== null
            ? <span className="hero-badge user-page-excluded-badge" data-testid="event-page-excluded">Excluded: {loaded.event.exclusionReason}</span>
            : null}
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          <span className="hero-badge">All dates and times in UTC</span>
          {loaded !== null ? <span className="hero-badge">Generated {loaded.generatedAtUtc}</span> : null}
        </div>
      </section>

      <AdminNavigation activePage={null} onNavigate={props.onNavigate} />

      <section className="dashboard-section" data-testid="event-page-section">
        {renderContent()}
      </section>
    </main>
  );
}

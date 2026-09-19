import type { JSX } from "react";
import { analyticsAreaLabels, analyticsAreas, getAnalyticsAreaPath } from "../routing";
import { AdminLink } from "./AdminLink";

export function AnalyticsIndexPage(props: Readonly<{ onNavigate: (path: string) => void }>): JSX.Element {
  return (
    <main className="shell centered-shell">
      <section className="state-panel">
        <p className="eyebrow">Admin Analytics</p>
        <h1>Analytics</h1>
        <p className="state-copy">Pick an analytics area.</p>
        <nav className="state-links" aria-label="Analytics sections">
          {analyticsAreas.map((area) => (
            <AdminLink
              key={area}
              className="state-link"
              path={getAnalyticsAreaPath(area)}
              onNavigate={props.onNavigate}
            >
              {analyticsAreaLabels[area]}
            </AdminLink>
          ))}
        </nav>
      </section>
    </main>
  );
}

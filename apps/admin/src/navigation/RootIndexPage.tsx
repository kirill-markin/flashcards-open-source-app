import type { JSX } from "react";
import {
  analyticsAreaLabels,
  analyticsAreas,
  analyticsIndexPath,
  getAnalyticsAreaPath,
} from "../routing";
import { AdminLink } from "./AdminLink";

export function RootIndexPage(props: Readonly<{ onNavigate: (path: string) => void }>): JSX.Element {
  return (
    <main className="shell centered-shell">
      <section className="state-panel">
        <p className="eyebrow">Admin</p>
        <h1>Admin</h1>
        <p className="state-copy">Product analytics for the admin team.</p>
        <nav className="state-links" aria-label="Admin pages">
          <AdminLink className="state-link" path={analyticsIndexPath} onNavigate={props.onNavigate}>Analytics</AdminLink>
          {analyticsAreas.map((area) => (
            <AdminLink
              key={area}
              className="state-link"
              path={getAnalyticsAreaPath(area)}
              onNavigate={props.onNavigate}
            >
              Analytics: {analyticsAreaLabels[area]}
            </AdminLink>
          ))}
        </nav>
      </section>
    </main>
  );
}

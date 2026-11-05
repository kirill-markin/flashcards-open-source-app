import type { Page } from "@playwright/test";

import { trackedClick } from "../live-smoke.actions";
import type { LiveSmokeDiagnostics } from "../live-smoke.diagnostics";
import { libraryRoute } from "../../src/routes";

/**
 * The primary navigation link for one app route. Matched on the end of `href` because the app
 * addresses every in-app link as `/w/<workspaceId><route>` and the workspace is only known at run
 * time; the suffix also still matches the flat address the legacy redirect keeps serving.
 */
export function primaryNavigationLinkSelector(route: string): string {
  return `nav.nav a[href$="${route}"]`;
}

/** Opens the Library tab, then one of its hub rows, the way a person reaches Cards, Tags or Decks. */
export async function openLibraryRow(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  rowTestId: string,
): Promise<void> {
  await trackedClick(diagnostics, `${actionName}: open Library navigation`, page.locator(primaryNavigationLinkSelector(libraryRoute)).first());
  await trackedClick(diagnostics, `${actionName}: open ${rowTestId}`, page.getByTestId(rowTestId));
}

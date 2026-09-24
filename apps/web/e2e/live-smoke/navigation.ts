/**
 * The primary navigation link for one app route. Matched on the end of `href` because the app
 * addresses every in-app link as `/w/<workspaceId><route>` and the workspace is only known at run
 * time; the suffix also still matches the flat address the legacy redirect keeps serving.
 */
export function primaryNavigationLinkSelector(route: string): string {
  return `nav.nav a[href$="${route}"]`;
}

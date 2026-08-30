package com.flashcardsopensourceapp.app.navigation

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import com.flashcardsopensourceapp.app.navigation.cards.CardEditorGraph
import com.flashcardsopensourceapp.app.navigation.settings.SettingsWorkspaceDecksDestination
import com.flashcardsopensourceapp.app.navigation.settings.SettingsWorkspaceTagsDestination

/**
 * A prefix owns the route when the route is the prefix itself or continues past it at a character
 * that closes the prefix's own path token: `/` opens a nested path segment or a path argument
 * (`settings/account/sign-in/code`), `?` opens the query arguments
 * (`settings/account/sign-in?origin={origin}`), `#` opens the fragment. The boundary is what
 * separates a step nested under the prefix from a sibling that merely opens with the same
 * characters: a future `settings/account/sign-in-later` is not the sign-in flow.
 *
 * Those three close the set, because the route grammar is Navigation's deep-link grammar whether
 * or not this module registers a deep link: `NavDestinationImpl`'s `route` setter builds a
 * `NavDeepLink` over `android-app://androidx.navigation/<route>` for every route it is given.
 * `NavDeepLink.parsePath` cuts the path at `(\?|#|$)`, so `?` and `#` are the only characters that
 * end it. Within the path `NavDeepLink.buildRegex` escapes as a literal only the spans outside the
 * `{name}` placeholders, replacing each placeholder with the path-argument pattern `PATH_REGEX`
 * (`([^/]*?|)`); `parsePath` then closes by restoring a glued `.*` to a live wildcard (below). So
 * a path argument absorbs anything but `/`, which leaves `/` the only literal that starts a new
 * segment rather than extending the prefix's own.
 *
 * `{` is excluded on purpose, and so is the `.` of a glued `.*`. Glued to the prefix
 * (`settings/account/sign-in{step}` or `settings/account/sign-in.*`), both forms match the very
 * sibling this boundary exists to reject: `buildRegex` splices `PATH_REGEX` into the prefix's own
 * segment, where `([^/]*?|)` takes `-later` as readily as the empty string, and `parsePath`'s
 * closing `saveWildcardInRegex` reopens `.*` into a wildcard that spans `/` and takes it too.
 * Write a nested argument as `.../sign-in/{step}`, which `/` already covers.
 *
 * Pass a prefix that does not itself end in a boundary. One that does — `"settings/"` rather than
 * `SettingsDestination.route` — makes this read the character past the separator, so
 * `settings/decks` would not be within `settings/` and every leaf would fall through. A call site
 * that spells the rule out longhand as an equality plus a trailing-slash `startsWith` converts by
 * passing the bare route, never the trailing form.
 *
 * `isWithinTopLevelDestination` in `AppNavHost` is this check over `/` and `?` only, not `#`.
 */
internal fun String.isWithinRoutePrefix(routePrefix: String): Boolean {
    if (!startsWith(prefix = routePrefix)) {
        return false
    }
    val boundary = getOrNull(index = routePrefix.length) ?: return true
    return boundary == '/' || boundary == '?' || boundary == '#'
}

@Composable
internal fun rememberRouteBackStackEntry(
    navController: NavHostController,
    currentBackStackEntry: NavBackStackEntry,
    route: String
): NavBackStackEntry = remember(currentBackStackEntry) {
    navController.getBackStackEntry(route)
}

internal fun navigateToCardEditor(
    navController: NavHostController,
    cardId: String?
) {
    navController.navigate(route = CardEditorGraph.createRoute(cardId = cardId ?: "new")) {
        launchSingleTop = true
    }
}

internal fun navigateToSettingsNavigationTarget(
    navController: NavHostController,
    target: SettingsNavigationTarget
) {
    navigateToTopLevelDestination(
        navController = navController,
        destination = SettingsDestination
    )
    navController.navigate(route = target.route) {
        launchSingleTop = true
    }
}

fun navigateToTopLevelDestination(
    navController: NavHostController,
    destination: TopLevelDestination
) {
    navController.navigate(route = destination.route) {
        popUpTo(id = navController.graph.findStartDestination().id) {
            saveState = true
        }
        launchSingleTop = true
        restoreState = true
    }
}

internal val SettingsNavigationTarget.route: String
    get() = when (this) {
        SettingsNavigationTarget.WORKSPACE_DECKS -> SettingsWorkspaceDecksDestination.route
        SettingsNavigationTarget.WORKSPACE_TAGS -> SettingsWorkspaceTagsDestination.route
    }

internal data class AppPackageInfo(
    val versionName: String,
    val longVersionCode: Long
)

@Suppress("DEPRECATION")
internal fun loadPackageInfo(context: Context): AppPackageInfo {
    // Use the overloads available since API 1 on purpose: some out-of-contract devices
    // (emulators, test farms, spoofed installs) report a higher Build.VERSION.SDK_INT than
    // their real framework, so SDK_INT-gated newer APIs (PackageInfoFlags API 33,
    // PackageInfo.longVersionCode API 28) link-fail there with NoSuchMethodError.
    val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
    val versionName = packageInfo.versionName?.trim().orEmpty()
    require(versionName.isNotEmpty()) {
        "Android package versionName is missing from PackageInfo."
    }

    return AppPackageInfo(
        versionName = versionName,
        longVersionCode = packageInfo.versionCode.toLong()
    )
}

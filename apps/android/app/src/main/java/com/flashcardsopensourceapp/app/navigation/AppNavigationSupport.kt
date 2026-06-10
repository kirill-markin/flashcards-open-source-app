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

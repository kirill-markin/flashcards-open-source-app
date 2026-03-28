package com.flashcardsopensourceapp.app.navigation

import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController

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
    navController.navigate(route = CardEditorDestination.createRoute(cardId = cardId ?: "new")) {
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
        SettingsNavigationTarget.WORKSPACE -> SettingsWorkspaceDestination.route
        SettingsNavigationTarget.WORKSPACE_DECKS -> SettingsWorkspaceDecksDestination.route
        SettingsNavigationTarget.WORKSPACE_TAGS -> SettingsWorkspaceTagsDestination.route
    }

internal data class AppPackageInfo(
    val versionName: String,
    val longVersionCode: Long
)

internal fun loadPackageInfo(context: Context): AppPackageInfo {
    val packageInfo = context.packageManager.getPackageInfo(
        context.packageName,
        PackageManager.PackageInfoFlags.of(0L)
    )

    return AppPackageInfo(
        versionName = packageInfo.versionName ?: "Unavailable",
        longVersionCode = packageInfo.longVersionCode
    )
}

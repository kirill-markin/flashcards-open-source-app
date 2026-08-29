package com.flashcardsopensourceapp.app.navigation.settings

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.navigation
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPermission
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPermissionOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.feature.settings.access.AccessCapability
import com.flashcardsopensourceapp.feature.settings.access.AccessDetailRoute
import com.flashcardsopensourceapp.feature.settings.access.AccessRoute

internal fun NavGraphBuilder.registerSettingsAccessNavGraph(
    appGraph: AppGraph,
    navController: NavHostController
) {
    navigation(
        startDestination = SettingsAccessDestination.route,
        route = SettingsAccessGraph.route
    ) {
        composable(route = SettingsAccessDestination.route) {
            AccessRoute(
                onOpenCapability = { capability ->
                    navController.navigate(
                        route = SettingsAccessDetailDestination.createRoute(capability = capability.name.lowercase())
                    )
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = SettingsAccessDetailDestination.routePattern,
            arguments = listOf(navArgument(name = SettingsAccessDetailDestination.routeArgument) {
                type = NavType.StringType
            })
        ) { backStackEntry ->
            val capabilityArgument = requireNotNull(
                backStackEntry.arguments?.getString(SettingsAccessDetailDestination.routeArgument)
            ) {
                "Access detail route requires capability."
            }
            val capability = AccessCapability.valueOf(capabilityArgument.uppercase())

            AccessDetailRoute(
                capability = capability,
                // The review flow and the AI screen ask for these same permissions, and
                // `permission_prompt_answered` carries no property naming the asker: its surface is
                // the event's own `screen`. Each entry point therefore names where its own person
                // is, so a refusal made here in settings stays distinguishable from one made there.
                onPermissionResult = { isGranted ->
                    val permission: AnalyticsPermission? = analyticsPermissionForAccessCapability(
                        capability = capability
                    )
                    if (permission != null) {
                        appGraph.analytics.track(
                            event = AnalyticsEvent.PermissionPromptAnswered(
                                permission = permission,
                                outcome = if (isGranted) {
                                    AnalyticsPermissionOutcome.GRANTED
                                } else {
                                    AnalyticsPermissionOutcome.DENIED
                                },
                                screen = AnalyticsSurface.SETTINGS
                            )
                        )
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}

/**
 * The catalog permission behind an access capability, or null when the capability is reached
 * without one.
 *
 * Null is not a gap: `accessCapabilityPermission` returns null for the same two, because photos and
 * files are read through the system pickers, which ask for nothing. This screen's launcher is only
 * ever started with a non-null Android permission, so the null branch never reports.
 */
private fun analyticsPermissionForAccessCapability(
    capability: AccessCapability
): AnalyticsPermission? {
    return when (capability) {
        AccessCapability.CAMERA -> AnalyticsPermission.CAMERA
        AccessCapability.MICROPHONE -> AnalyticsPermission.MICROPHONE
        AccessCapability.PHOTOS,
        AccessCapability.FILES -> null
    }
}

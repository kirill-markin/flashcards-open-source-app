package com.flashcardsopensourceapp.app.navigation

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.navigation
import com.flashcardsopensourceapp.feature.settings.AccessCapability
import com.flashcardsopensourceapp.feature.settings.AccessDetailRoute
import com.flashcardsopensourceapp.feature.settings.AccessRoute

internal fun NavGraphBuilder.registerSettingsAccessNavGraph(
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
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}

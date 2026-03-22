package com.flashcardsopensourceapp.app

import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.navigation.compose.rememberNavController
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.AppNavHost
import com.flashcardsopensourceapp.app.navigation.currentTopLevelDestination
import com.flashcardsopensourceapp.app.navigation.navigateToTopLevelDestination
import com.flashcardsopensourceapp.app.navigation.topLevelDestinations
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme

@Composable
fun FlashcardsApp(appGraph: AppGraph) {
    FlashcardsTheme {
        val navController = rememberNavController()
        val currentDestination = currentTopLevelDestination(navController = navController)
        NavigationSuiteScaffold(
            navigationSuiteItems = {
                topLevelDestinations.forEach { destination ->
                    item(
                        selected = currentDestination.route == destination.route,
                        onClick = {
                            navigateToTopLevelDestination(
                                navController = navController,
                                destination = destination
                            )
                        },
                        icon = {
                            Icon(
                                imageVector = destination.icon,
                                contentDescription = destination.label
                            )
                        },
                        label = {
                            Text(destination.label)
                        }
                    )
                }
            }
        ) {
            AppNavHost(
                appGraph = appGraph,
                navController = navController
            )
        }
    }
}

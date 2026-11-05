package com.flashcardsopensourceapp.app.navigation.settings

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.premium.PremiumPresenter
import com.flashcardsopensourceapp.app.premium.PremiumResult
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPaywallEntryPoint
import com.flashcardsopensourceapp.data.local.model.cloud.canUseLocalPremiumFeatures
import com.flashcardsopensourceapp.data.local.model.sync.AccountTheme
import com.flashcardsopensourceapp.feature.settings.theme.ThemeRoute
import com.flashcardsopensourceapp.feature.settings.theme.ThemeViewModel

internal fun NavGraphBuilder.registerThemeDestination(
    appGraph: AppGraph,
    navController: NavHostController,
    premiumPresenter: PremiumPresenter
) {
    composable(route = SettingsThemeDestination.route) {
        val themeViewModel = viewModel<ThemeViewModel>(
            viewModelStoreOwner = appGraph.themeViewModelStoreOwner,
            factory = appGraph.themeViewModelFactory
        )
        val uiState by themeViewModel.uiState.collectAsStateWithLifecycle()
        DisposableEffect(premiumPresenter, uiState.identityKey) {
            onDispose { premiumPresenter.dismiss() }
        }
        val canCustomizeStyle = canUseLocalPremiumFeatures(entitlement = premiumPresenter.entitlement)
        key(premiumPresenter, uiState.identityKey) {
            ThemeRoute(
                uiState = uiState,
                effectiveTheme = if (canCustomizeStyle) uiState.selectedTheme else AccountTheme.DARK,
                isPremiumRequired = canCustomizeStyle.not(),
                onSelectTheme = { theme ->
                    val identityKey = uiState.identityKey
                    when (theme) {
                        AccountTheme.DARK -> {
                            premiumPresenter.dismiss()
                            // Writing Dark here would overwrite the retained premium selection that resubscription restores.
                            if (canCustomizeStyle) {
                                themeViewModel.selectTheme(theme = theme, identityKey = identityKey)
                            }
                        }

                        AccountTheme.LIGHT -> {
                            premiumPresenter.requestFeature(
                                paywallEntryPoint = AnalyticsPaywallEntryPoint.THEME
                            ) { result ->
                                if (result == PremiumResult.ACCESS_GRANTED) {
                                    themeViewModel.selectTheme(theme = theme, identityKey = identityKey)
                                }
                            }
                        }
                    }
                },
                onBack = { navController.popBackStack() }
            )
        }
    }
}

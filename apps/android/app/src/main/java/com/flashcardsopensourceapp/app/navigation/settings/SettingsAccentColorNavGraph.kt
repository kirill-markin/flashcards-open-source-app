package com.flashcardsopensourceapp.app.navigation.settings

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.premium.PremiumPresenter
import com.flashcardsopensourceapp.app.premium.PremiumResult
import com.flashcardsopensourceapp.app.premium.hasPremiumAccess
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccentColor
import com.flashcardsopensourceapp.feature.settings.accent.AccentColorRoute
import com.flashcardsopensourceapp.feature.settings.accent.AccentColorViewModel
import com.flashcardsopensourceapp.feature.settings.accent.createAccentColorViewModelFactory

internal fun NavGraphBuilder.registerAccentColorDestination(
    appGraph: AppGraph,
    navController: NavHostController,
    premiumPresenter: PremiumPresenter
) {
    composable(route = SettingsAccentColorDestination.route) {
        val context = LocalContext.current
        val accentColorViewModel = viewModel<AccentColorViewModel>(
            factory = createAccentColorViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository,
                messageController = appGraph.appMessageBus,
                applicationContext = context.applicationContext
            )
        )
        val uiState by accentColorViewModel.uiState.collectAsStateWithLifecycle()
        DisposableEffect(premiumPresenter) {
            onDispose { premiumPresenter.dismiss() }
        }
        key(premiumPresenter) {
            AccentColorRoute(
                uiState = uiState,
                isPremiumRequired = premiumPresenter.entitlement != null &&
                    hasPremiumAccess(entitlement = premiumPresenter.entitlement).not(),
                onSelectColor = { color ->
                    if (color == defaultAccentColor) {
                        premiumPresenter.dismiss()
                        accentColorViewModel.selectColor(color = color)
                    } else {
                        premiumPresenter.requestFeature { result ->
                            if (result == PremiumResult.ACCESS_GRANTED) {
                                accentColorViewModel.selectColor(color = color)
                            }
                        }
                    }
                },
                onBack = { navController.popBackStack() }
            )
        }
    }
}

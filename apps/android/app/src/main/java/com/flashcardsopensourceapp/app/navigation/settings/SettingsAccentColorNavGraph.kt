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
import com.flashcardsopensourceapp.app.premium.hasPremiumAccess
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccentColor
import com.flashcardsopensourceapp.feature.settings.accent.AccentColorRoute
import com.flashcardsopensourceapp.feature.settings.accent.AccentColorViewModel

internal fun NavGraphBuilder.registerAccentColorDestination(
    appGraph: AppGraph,
    navController: NavHostController,
    premiumPresenter: PremiumPresenter
) {
    composable(route = SettingsAccentColorDestination.route) {
        val accentColorViewModel = viewModel<AccentColorViewModel>(
            viewModelStoreOwner = appGraph.accentColorViewModelStoreOwner,
            factory = appGraph.accentColorViewModelFactory
        )
        val uiState by accentColorViewModel.uiState.collectAsStateWithLifecycle()
        DisposableEffect(premiumPresenter, uiState.identityKey) {
            onDispose { premiumPresenter.dismiss() }
        }
        key(premiumPresenter, uiState.identityKey) {
            AccentColorRoute(
                uiState = uiState,
                isPremiumRequired = premiumPresenter.entitlement != null &&
                    hasPremiumAccess(entitlement = premiumPresenter.entitlement).not(),
                onSelectColor = { color ->
                    val identityKey = uiState.identityKey
                    if (color == defaultAccentColor) {
                        premiumPresenter.dismiss()
                        accentColorViewModel.selectColor(color = color, identityKey = identityKey)
                    } else {
                        premiumPresenter.requestFeature { result ->
                            if (result == PremiumResult.ACCESS_GRANTED) {
                                accentColorViewModel.selectColor(color = color, identityKey = identityKey)
                            }
                        }
                    }
                },
                onRequestCustom = { openDialog ->
                    val identityKey = uiState.identityKey
                    premiumPresenter.requestFeature { result ->
                        if (result == PremiumResult.ACCESS_GRANTED &&
                            accentColorViewModel.uiState.value.identityKey == identityKey
                        ) {
                            openDialog()
                        }
                    }
                },
                onBack = { navController.popBackStack() }
            )
        }
    }
}

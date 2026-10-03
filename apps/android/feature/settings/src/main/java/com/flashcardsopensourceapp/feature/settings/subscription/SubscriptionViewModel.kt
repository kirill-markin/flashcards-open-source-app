package com.flashcardsopensourceapp.feature.settings.subscription

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

class SubscriptionViewModel(
    cloudAccountRepository: CloudAccountRepository,
    private val strings: SettingsStringResolver
) : ViewModel() {
    val uiState: StateFlow<SubscriptionUiState> = cloudAccountRepository.observeEntitlement().map { entitlement ->
        makeSubscriptionUiState(
            entitlement = entitlement,
            strings = strings
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = makeSubscriptionUiState(
            entitlement = null,
            strings = strings
        )
    )
}

fun createSubscriptionViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SubscriptionViewModel(
                cloudAccountRepository = cloudAccountRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}

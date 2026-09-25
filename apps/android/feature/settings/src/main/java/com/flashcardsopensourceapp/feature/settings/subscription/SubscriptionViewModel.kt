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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Scoped to the Settings graph, so Google Play is asked once for it rather than on every return to
 * the Settings root.
 */
class SubscriptionViewModel(
    cloudAccountRepository: CloudAccountRepository,
    loadIsSubscriptionProductAvailable: suspend () -> Boolean,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val isSubscriptionProductAvailableState = MutableStateFlow(value = false)

    val uiState: StateFlow<SubscriptionUiState> = combine(
        cloudAccountRepository.observeEntitlement(),
        isSubscriptionProductAvailableState
    ) { entitlement, isSubscriptionProductAvailable ->
        makeSubscriptionUiState(
            entitlement = entitlement,
            isSubscriptionProductAvailable = isSubscriptionProductAvailable,
            strings = strings
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = makeSubscriptionUiState(
            entitlement = null,
            isSubscriptionProductAvailable = false,
            strings = strings
        )
    )

    init {
        viewModelScope.launch {
            isSubscriptionProductAvailableState.value = loadIsSubscriptionProductAvailable()
        }
    }
}

fun createSubscriptionViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    loadIsSubscriptionProductAvailable: suspend () -> Boolean,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SubscriptionViewModel(
                cloudAccountRepository = cloudAccountRepository,
                loadIsSubscriptionProductAvailable = loadIsSubscriptionProductAvailable,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}

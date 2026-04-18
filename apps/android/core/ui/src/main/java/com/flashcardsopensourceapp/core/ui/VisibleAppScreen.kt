package com.flashcardsopensourceapp.core.ui

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class VisibleAppScreen {
    REVIEW,
    PROGRESS,
    CARDS,
    SETTINGS_ROOT,
    SETTINGS_CURRENT_WORKSPACE,
    SETTINGS_WORKSPACE_OVERVIEW,
    OTHER
}

interface VisibleAppScreenRepository {
    fun observeVisibleAppScreen(): Flow<VisibleAppScreen>
}

class VisibleAppScreenController : VisibleAppScreenRepository {
    private val visibleAppScreenState = MutableStateFlow(VisibleAppScreen.OTHER)

    override fun observeVisibleAppScreen(): Flow<VisibleAppScreen> {
        return visibleAppScreenState.asStateFlow()
    }

    fun updateVisibleAppScreen(screen: VisibleAppScreen) {
        visibleAppScreenState.value = screen
    }
}

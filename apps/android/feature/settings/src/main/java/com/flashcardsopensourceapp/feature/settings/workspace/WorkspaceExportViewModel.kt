package com.flashcardsopensourceapp.feature.settings.workspace

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private data class WorkspaceExportDraftState(
    val isExporting: Boolean,
    val errorMessage: String
)

class WorkspaceExportViewModel(
    private val workspaceRepository: WorkspaceRepository,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = WorkspaceExportDraftState(
            isExporting = false,
            errorMessage = ""
        )
    )

    val uiState: StateFlow<WorkspaceExportUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        draftState
    ) { overview, draft ->
        WorkspaceExportUiState(
            workspaceName = overview?.workspaceName ?: strings.get(R.string.settings_unavailable),
            activeCardsCount = overview?.totalCards ?: 0,
            isExporting = draft.isExporting,
            errorMessage = draft.errorMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceExportUiState(
            workspaceName = strings.get(R.string.settings_loading),
            activeCardsCount = 0,
            isExporting = false,
            errorMessage = ""
        )
    )

    suspend fun prepareExportData(): WorkspaceExportData? {
        draftState.update { state ->
            state.copy(
                isExporting = true,
                errorMessage = ""
            )
        }

        return try {
            val exportData = workspaceRepository.loadWorkspaceExportData()
            if (exportData == null) {
                draftState.update { state ->
                    state.copy(
                        isExporting = false,
                        errorMessage = strings.get(R.string.settings_export_unavailable)
                    )
                }
            }
            exportData
        } catch (error: IllegalArgumentException) {
            draftState.update { state ->
                state.copy(
                    isExporting = false,
                    errorMessage = error.message ?: strings.get(R.string.settings_export_prepare_failed)
                )
            }
            null
        } catch (error: IllegalStateException) {
            draftState.update { state ->
                state.copy(
                    isExporting = false,
                    errorMessage = error.message ?: strings.get(R.string.settings_export_prepare_failed)
                )
            }
            null
        }
    }

    fun finishExport() {
        draftState.update { state ->
            state.copy(isExporting = false)
        }
    }

    fun showExportError(message: String) {
        draftState.update { state ->
            state.copy(
                isExporting = false,
                errorMessage = message
            )
        }
    }

    fun clearErrorMessage() {
        draftState.update { state ->
            state.copy(errorMessage = "")
        }
    }
}

fun createWorkspaceExportViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceExportViewModel(
                workspaceRepository = workspaceRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}

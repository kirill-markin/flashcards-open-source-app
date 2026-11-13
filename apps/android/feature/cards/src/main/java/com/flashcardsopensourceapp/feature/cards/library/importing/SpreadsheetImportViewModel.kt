package com.flashcardsopensourceapp.feature.cards.library.importing

import android.content.Context
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.data.local.cloud.sync.LocalOutboxWritesBlockedException
import com.flashcardsopensourceapp.data.local.model.cards.CardImportText
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTagKey
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTags
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.repository.CardImportWorkspaceChangedException
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.cards.R
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal data class SpreadsheetImportUiState(
    val draft: SpreadsheetImportDraft,
    val workspaceId: String?,
    val hasWorkspaceChanged: Boolean,
    val availableTags: List<WorkspaceTagSummary>,
    val selectedTags: List<String>,
    @StringRes val tagError: Int?,
    @StringRes val importError: Int?,
    val isImporting: Boolean,
    val importedCount: Int?
) {
    val canImport: Boolean
        get() = workspaceId != null && !hasWorkspaceChanged && !isImporting &&
            draft.rows.isNotEmpty() && draft.rows.all(SpreadsheetImportRow::isValid)
}

class SpreadsheetImportViewModel(
    private val cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    private val technicalErrorController: AppTechnicalErrorController,
    private val applicationContext: Context
) : ViewModel() {
    private val state = MutableStateFlow(
        SpreadsheetImportUiState(
            draft = emptySpreadsheetImportDraft(),
            workspaceId = null,
            hasWorkspaceChanged = false,
            availableTags = emptyList(),
            selectedTags = emptyList(),
            tagError = null,
            importError = null,
            isImporting = false,
            importedCount = null
        )
    )
    internal val uiState = state.asStateFlow()

    init {
        viewModelScope.launch {
            workspaceRepository.observeWorkspaceTagsSummary().collect { summary ->
                state.update { current ->
                    val workspaceId = current.workspaceId ?: summary.workspaceId
                    val hasWorkspaceChanged = workspaceId != summary.workspaceId
                    current.copy(
                        workspaceId = workspaceId,
                        hasWorkspaceChanged = hasWorkspaceChanged,
                        availableTags = if (hasWorkspaceChanged) emptyList() else summary.tags
                    )
                }
            }
        }
    }

    internal fun updateSourceText(text: String) {
        reparse { draft -> draft.copy(sourceText = text) }
    }

    internal fun updateFieldSeparator(separator: SpreadsheetSeparator) {
        reparse { draft -> draft.copy(fieldSeparator = separator) }
    }

    internal fun updateRowSeparator(separator: SpreadsheetSeparator) {
        reparse { draft -> draft.copy(rowSeparator = separator) }
    }

    internal fun updateCustomFieldSeparator(separator: String) {
        reparse { draft -> draft.copy(customFieldSeparator = separator) }
    }

    internal fun updateCustomRowSeparator(separator: String) {
        reparse { draft -> draft.copy(customRowSeparator = separator) }
    }

    internal fun updateRow(id: Int, text: CardImportText) {
        updateDraft { draft ->
            draft.copy(rows = draft.rows.map { row -> if (row.id == id) row.copy(text = text) else row })
        }
    }

    internal fun removeRow(id: Int) {
        updateDraft { draft -> draft.copy(rows = draft.rows.filterNot { row -> row.id == id }) }
    }

    internal fun removeInvalidRows() {
        updateDraft { draft -> draft.copy(rows = draft.rows.filter(SpreadsheetImportRow::isValid)) }
    }

    internal fun toggleTag(tag: String) {
        val key = normalizeTagKey(tag)
        if (state.value.selectedTags.any { selected -> normalizeTagKey(selected) == key }) {
            removeTag(tag)
        } else {
            addTag(tag)
        }
    }

    internal fun addTag(tag: String) {
        state.update { current ->
            if (tag.isBlank()) {
                current.copy(tagError = R.string.cards_enter_tag_before_adding)
            } else {
                current.copy(
                    selectedTags = normalizeTags(
                        values = current.selectedTags + tag,
                        referenceTags = current.availableTags.map(WorkspaceTagSummary::tag)
                    ),
                    tagError = null,
                    importedCount = null
                )
            }
        }
    }

    internal fun removeTag(tag: String) {
        val key = normalizeTagKey(tag)
        state.update { current ->
            current.copy(
                selectedTags = current.selectedTags.filterNot { selected -> normalizeTagKey(selected) == key },
                tagError = null,
                importedCount = null
            )
        }
    }

    internal fun importCards() {
        val current = state.value
        val workspaceId = current.workspaceId ?: return
        if (!current.canImport) return
        state.value = current.copy(isImporting = true, importError = null, importedCount = null)
        viewModelScope.launch {
            try {
                cardsRepository.importSpreadsheetCards(
                    workspaceId = workspaceId,
                    rows = current.draft.rows.map(SpreadsheetImportRow::text),
                    tags = current.selectedTags
                )
                state.update { latest ->
                    latest.copy(
                        draft = latest.draft.copy(sourceText = "", rows = emptyList()),
                        selectedTags = emptyList(),
                        tagError = null,
                        importedCount = current.draft.rows.size
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: CardImportWorkspaceChangedException) {
                state.update { latest -> latest.copy(importError = R.string.spreadsheet_import_workspace_changed) }
            } catch (_: LocalOutboxWritesBlockedException) {
                state.update { latest -> latest.copy(importError = R.string.cards_editor_writes_blocked) }
            } catch (error: Exception) {
                val message = applicationContext.getString(R.string.spreadsheet_import_failed)
                state.update { latest -> latest.copy(importError = R.string.spreadsheet_import_failed) }
                technicalErrorController.showTechnicalError(
                    error = makeAppTechnicalError(
                        title = applicationContext.getString(R.string.library_import_spreadsheet_title),
                        message = message,
                        throwable = error
                    ),
                    throwable = error
                )
            } finally {
                state.update { latest -> latest.copy(isImporting = false) }
            }
        }
    }

    private fun reparse(transform: (SpreadsheetImportDraft) -> SpreadsheetImportDraft) {
        updateDraft { draft -> transform(draft).reparse() }
    }

    private fun updateDraft(transform: (SpreadsheetImportDraft) -> SpreadsheetImportDraft) {
        state.update { current ->
            if (current.isImporting) current else current.copy(
                draft = transform(current.draft),
                importError = null,
                importedCount = null
            )
        }
    }
}

fun createSpreadsheetImportViewModelFactory(
    cardsRepository: CardsRepository,
    workspaceRepository: WorkspaceRepository,
    technicalErrorController: AppTechnicalErrorController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SpreadsheetImportViewModel(
                cardsRepository = cardsRepository,
                workspaceRepository = workspaceRepository,
                technicalErrorController = technicalErrorController,
                applicationContext = applicationContext
            )
        }
    }
}

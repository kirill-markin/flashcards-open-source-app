package com.flashcardsopensourceapp.feature.settings.localSyncDiagnostics

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsCardOutboxProblem
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsCardsSync
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsManagedMediaSync
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsMediaTransferProblem
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsMissingMediaBlobProblem
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsMissingMediaReferenceProblem
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsProblemRecords
import com.flashcardsopensourceapp.data.local.model.sync.LocalSyncDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.formatTimestampLabel
import java.util.Locale
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import org.json.JSONArray
import org.json.JSONObject

private const val emptyDiagnosticsValue: String = "-"

@OptIn(ExperimentalCoroutinesApi::class)
class LocalSyncDiagnosticsViewModel(
    private val workspaceRepository: WorkspaceRepository,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val refreshRequests = MutableStateFlow(0)

    val uiState: StateFlow<LocalSyncDiagnosticsUiState> = refreshRequests
        .flatMapLatest {
            workspaceRepository.observeLocalSyncDiagnostics()
        }
        .map { summary ->
            summary?.let {
                toReadyUiState(summary = it, strings = strings)
            } ?: LocalSyncDiagnosticsUiState.NoWorkspace
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
            initialValue = LocalSyncDiagnosticsUiState.Loading
        )

    fun refresh() {
        refreshRequests.value = refreshRequests.value + 1
    }
}

fun createLocalSyncDiagnosticsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            LocalSyncDiagnosticsViewModel(
                workspaceRepository = workspaceRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}

private fun toReadyUiState(
    summary: LocalSyncDiagnosticsSummary,
    strings: SettingsStringResolver
): LocalSyncDiagnosticsUiState.Ready {
    return LocalSyncDiagnosticsUiState.Ready(
        cardsSyncRows = cardsSyncRows(cardsSync = summary.cardsSync, strings = strings),
        managedMediaSyncRows = managedMediaSyncRows(
            managedMediaSync = summary.managedMediaSync,
            strings = strings
        ),
        problemSections = problemSections(problemRecords = summary.problemRecords, strings = strings),
        reportText = buildReportText(summary = summary)
    )
}

private fun cardsSyncRows(
    cardsSync: LocalSyncDiagnosticsCardsSync,
    strings: SettingsStringResolver
): List<LocalSyncDiagnosticsRowUiState> {
    return listOf(
        row(strings.get(R.string.settings_local_sync_diagnostics_workspace_id_label), cardsSync.workspaceId),
        row(strings.get(R.string.settings_local_sync_diagnostics_installation_id_label), cardsSync.installationId),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_cloud_state_label),
            cardsSync.cloudState.name.lowercase(Locale.US)
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_local_active_cards_label),
            cardsSync.localActiveCards.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_local_deleted_cards_label),
            cardsSync.localDeletedCards.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_pending_card_operations_label),
            cardsSync.pendingCardOperations.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_failed_card_operations_label),
            cardsSync.failedCardOperations.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_oldest_pending_card_operation_label),
            timestampValue(timestampMillis = cardsSync.oldestPendingCardOperationAtMillis, strings = strings)
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_latest_card_sync_success_label),
            timestampValue(timestampMillis = cardsSync.latestCardSyncSuccessAtMillis, strings = strings)
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_hot_state_hydrated_label),
            cardsSync.hotStateHydrated.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_hot_cursor_label),
            textValue(value = cardsSync.hotCursor)
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_review_cursor_label),
            longValue(value = cardsSync.reviewCursor)
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_latest_sync_error_label),
            textValue(value = cardsSync.latestSyncError)
        )
    )
}

private fun managedMediaSyncRows(
    managedMediaSync: LocalSyncDiagnosticsManagedMediaSync,
    strings: SettingsStringResolver
): List<LocalSyncDiagnosticsRowUiState> {
    return listOf(
        row(
            strings.get(R.string.settings_local_sync_diagnostics_local_active_media_assets_label),
            managedMediaSync.localActiveMediaAssets.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_deleted_media_assets_label),
            managedMediaSync.deletedMediaAssets.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_local_media_blobs_label),
            managedMediaSync.localMediaBlobs.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_local_media_bytes_label),
            managedMediaSync.localMediaBytes.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_referenced_media_in_cards_label),
            managedMediaSync.referencedMediaInCards.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_references_missing_local_asset_label),
            managedMediaSync.referencesMissingLocalAsset.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_assets_missing_local_blob_label),
            managedMediaSync.assetsMissingLocalBlob.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_pending_media_uploads_label),
            managedMediaSync.pendingMediaUploads.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_failed_media_uploads_label),
            managedMediaSync.failedMediaUploads.toString()
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_pending_media_downloads_label),
            intValue(value = managedMediaSync.pendingMediaDownloads)
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_failed_media_downloads_label),
            intValue(value = managedMediaSync.failedMediaDownloads)
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_oldest_pending_media_transfer_label),
            timestampValue(timestampMillis = managedMediaSync.oldestPendingMediaTransferAtMillis, strings = strings)
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_latest_media_upload_success_label),
            timestampValue(timestampMillis = managedMediaSync.latestMediaUploadSuccessAtMillis, strings = strings)
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_latest_media_download_cache_success_label),
            timestampValue(
                timestampMillis = managedMediaSync.latestMediaDownloadCacheSuccessAtMillis,
                strings = strings
            )
        ),
        row(
            strings.get(R.string.settings_local_sync_diagnostics_latest_media_transfer_error_label),
            textValue(value = managedMediaSync.latestMediaTransferError)
        )
    )
}

private fun problemSections(
    problemRecords: LocalSyncDiagnosticsProblemRecords,
    strings: SettingsStringResolver
): List<LocalSyncDiagnosticsProblemSectionUiState> {
    return listOf(
        LocalSyncDiagnosticsProblemSectionUiState(
            title = strings.get(R.string.settings_local_sync_diagnostics_failed_card_outbox_section),
            records = problemRecords.failedCardOutboxEntries.map { problem ->
                failedCardOutboxProblemRecord(problem = problem, strings = strings)
            }
        ),
        LocalSyncDiagnosticsProblemSectionUiState(
            title = strings.get(R.string.settings_local_sync_diagnostics_failed_media_transfers_section),
            records = problemRecords.failedMediaTransfers.map { problem ->
                failedMediaTransferProblemRecord(problem = problem, strings = strings)
            }
        ),
        LocalSyncDiagnosticsProblemSectionUiState(
            title = strings.get(R.string.settings_local_sync_diagnostics_missing_media_refs_section),
            records = problemRecords.missingMediaReferences.map { problem ->
                missingMediaReferenceProblemRecord(problem = problem, strings = strings)
            }
        ),
        LocalSyncDiagnosticsProblemSectionUiState(
            title = strings.get(R.string.settings_local_sync_diagnostics_assets_missing_blob_section),
            records = problemRecords.assetsMissingLocalBlob.map { problem ->
                missingMediaBlobProblemRecord(problem = problem, strings = strings)
            }
        )
    ).filter { section -> section.records.isNotEmpty() }
}

private fun failedCardOutboxProblemRecord(
    problem: LocalSyncDiagnosticsCardOutboxProblem,
    strings: SettingsStringResolver
): LocalSyncDiagnosticsProblemRecordUiState {
    return LocalSyncDiagnosticsProblemRecordUiState(
        title = strings.get(R.string.settings_local_sync_diagnostics_card_problem_title, problem.cardId),
        rows = listOf(
            row(strings.get(R.string.settings_local_sync_diagnostics_operation_id_label), problem.operationId),
            row(strings.get(R.string.settings_local_sync_diagnostics_card_id_label), problem.cardId),
            row(
                strings.get(R.string.settings_local_sync_diagnostics_created_at_label),
                timestampValue(timestampMillis = problem.createdAtMillis, strings = strings)
            ),
            row(strings.get(R.string.settings_local_sync_diagnostics_attempt_count_label), problem.attemptCount.toString()),
            row(strings.get(R.string.settings_local_sync_diagnostics_last_error_label), textValue(value = problem.lastError))
        )
    )
}

private fun failedMediaTransferProblemRecord(
    problem: LocalSyncDiagnosticsMediaTransferProblem,
    strings: SettingsStringResolver
): LocalSyncDiagnosticsProblemRecordUiState {
    return LocalSyncDiagnosticsProblemRecordUiState(
        title = strings.get(R.string.settings_local_sync_diagnostics_media_transfer_problem_title, problem.transferId),
        rows = listOf(
            row(strings.get(R.string.settings_local_sync_diagnostics_transfer_id_label), problem.transferId),
            row(strings.get(R.string.settings_local_sync_diagnostics_media_asset_id_label), problem.mediaAssetId),
            row(strings.get(R.string.settings_local_sync_diagnostics_kind_label), problem.kind),
            row(strings.get(R.string.settings_local_sync_diagnostics_status_label), problem.status),
            row(
                strings.get(R.string.settings_local_sync_diagnostics_created_at_label),
                timestampValue(timestampMillis = problem.createdAtMillis, strings = strings)
            ),
            row(strings.get(R.string.settings_local_sync_diagnostics_attempt_count_label), problem.attemptCount.toString()),
            row(strings.get(R.string.settings_local_sync_diagnostics_last_error_label), textValue(value = problem.lastError))
        )
    )
}

private fun missingMediaReferenceProblemRecord(
    problem: LocalSyncDiagnosticsMissingMediaReferenceProblem,
    strings: SettingsStringResolver
): LocalSyncDiagnosticsProblemRecordUiState {
    return LocalSyncDiagnosticsProblemRecordUiState(
        title = strings.get(R.string.settings_local_sync_diagnostics_missing_ref_problem_title, problem.mediaAssetId),
        rows = listOf(
            row(strings.get(R.string.settings_local_sync_diagnostics_card_id_label), problem.cardId),
            row(strings.get(R.string.settings_local_sync_diagnostics_media_asset_id_label), problem.mediaAssetId)
        )
    )
}

private fun missingMediaBlobProblemRecord(
    problem: LocalSyncDiagnosticsMissingMediaBlobProblem,
    strings: SettingsStringResolver
): LocalSyncDiagnosticsProblemRecordUiState {
    return LocalSyncDiagnosticsProblemRecordUiState(
        title = strings.get(R.string.settings_local_sync_diagnostics_missing_blob_problem_title, problem.mediaAssetId),
        rows = listOf(
            row(strings.get(R.string.settings_local_sync_diagnostics_media_asset_id_label), problem.mediaAssetId),
            row(strings.get(R.string.settings_local_sync_diagnostics_sha256_label), problem.sha256)
        )
    )
}

private fun row(label: String, value: String): LocalSyncDiagnosticsRowUiState {
    return LocalSyncDiagnosticsRowUiState(label = label, value = value)
}

private fun timestampValue(timestampMillis: Long?, strings: SettingsStringResolver): String {
    return timestampMillis?.let { timestamp ->
        formatTimestampLabel(timestampMillis = timestamp, strings = strings)
    } ?: emptyDiagnosticsValue
}

private fun textValue(value: String?): String {
    return value?.trim()?.ifEmpty { null } ?: emptyDiagnosticsValue
}

private fun intValue(value: Int?): String {
    return value?.toString() ?: emptyDiagnosticsValue
}

private fun longValue(value: Long?): String {
    return value?.toString() ?: emptyDiagnosticsValue
}

private fun buildReportText(summary: LocalSyncDiagnosticsSummary): String {
    return JSONObject()
        .put("cardsSync", cardsSyncJson(cardsSync = summary.cardsSync))
        .put("managedMediaSync", managedMediaSyncJson(managedMediaSync = summary.managedMediaSync))
        .put("problemRecords", problemRecordsJson(problemRecords = summary.problemRecords))
        .toString()
}

private fun cardsSyncJson(cardsSync: LocalSyncDiagnosticsCardsSync): JSONObject {
    return JSONObject()
        .put("workspaceId", cardsSync.workspaceId)
        .put("installationId", cardsSync.installationId)
        .put("cloudState", cardsSync.cloudState.name.lowercase(Locale.US))
        .put("localActiveCards", cardsSync.localActiveCards)
        .put("localDeletedCards", cardsSync.localDeletedCards)
        .put("pendingCardOperations", cardsSync.pendingCardOperations)
        .put("failedCardOperations", cardsSync.failedCardOperations)
        .putNullableLong("oldestPendingCardOperationAtMillis", cardsSync.oldestPendingCardOperationAtMillis)
        .putNullableLong("latestCardSyncSuccessAtMillis", cardsSync.latestCardSyncSuccessAtMillis)
        .put("hotStateHydrated", cardsSync.hotStateHydrated)
        .putNullableString("hotCursor", cardsSync.hotCursor)
        .putNullableLong("reviewCursor", cardsSync.reviewCursor)
        .putNullableString("latestSyncError", cardsSync.latestSyncError)
}

private fun managedMediaSyncJson(managedMediaSync: LocalSyncDiagnosticsManagedMediaSync): JSONObject {
    return JSONObject()
        .put("localActiveMediaAssets", managedMediaSync.localActiveMediaAssets)
        .put("deletedMediaAssets", managedMediaSync.deletedMediaAssets)
        .put("localMediaBlobs", managedMediaSync.localMediaBlobs)
        .put("localMediaBytes", managedMediaSync.localMediaBytes)
        .put("referencedMediaInCards", managedMediaSync.referencedMediaInCards)
        .put("referencesMissingLocalAsset", managedMediaSync.referencesMissingLocalAsset)
        .put("assetsMissingLocalBlob", managedMediaSync.assetsMissingLocalBlob)
        .put("pendingMediaUploads", managedMediaSync.pendingMediaUploads)
        .put("failedMediaUploads", managedMediaSync.failedMediaUploads)
        .putNullableInt("pendingMediaDownloads", managedMediaSync.pendingMediaDownloads)
        .putNullableInt("failedMediaDownloads", managedMediaSync.failedMediaDownloads)
        .putNullableLong("oldestPendingMediaTransferAtMillis", managedMediaSync.oldestPendingMediaTransferAtMillis)
        .putNullableLong("latestMediaUploadSuccessAtMillis", managedMediaSync.latestMediaUploadSuccessAtMillis)
        .putNullableLong(
            "latestMediaDownloadCacheSuccessAtMillis",
            managedMediaSync.latestMediaDownloadCacheSuccessAtMillis
        )
        .putNullableString("latestMediaTransferError", managedMediaSync.latestMediaTransferError)
}

private fun problemRecordsJson(problemRecords: LocalSyncDiagnosticsProblemRecords): JSONObject {
    return JSONObject()
        .put("failedCardOutboxEntries", cardOutboxProblemsJson(problems = problemRecords.failedCardOutboxEntries))
        .put("failedMediaTransfers", mediaTransferProblemsJson(problems = problemRecords.failedMediaTransfers))
        .put("missingMediaReferences", missingMediaReferencesJson(problems = problemRecords.missingMediaReferences))
        .put("assetsMissingLocalBlob", missingMediaBlobsJson(problems = problemRecords.assetsMissingLocalBlob))
}

private fun cardOutboxProblemsJson(problems: List<LocalSyncDiagnosticsCardOutboxProblem>): JSONArray {
    val array = JSONArray()
    problems.forEach { problem ->
        array.put(
            JSONObject()
                .put("operationId", problem.operationId)
                .put("cardId", problem.cardId)
                .put("createdAtMillis", problem.createdAtMillis)
                .put("attemptCount", problem.attemptCount)
                .putNullableString("lastError", problem.lastError)
        )
    }
    return array
}

private fun mediaTransferProblemsJson(problems: List<LocalSyncDiagnosticsMediaTransferProblem>): JSONArray {
    val array = JSONArray()
    problems.forEach { problem ->
        array.put(
            JSONObject()
                .put("transferId", problem.transferId)
                .put("mediaAssetId", problem.mediaAssetId)
                .put("kind", problem.kind)
                .put("status", problem.status)
                .put("createdAtMillis", problem.createdAtMillis)
                .put("attemptCount", problem.attemptCount)
                .putNullableString("lastError", problem.lastError)
        )
    }
    return array
}

private fun missingMediaReferencesJson(
    problems: List<LocalSyncDiagnosticsMissingMediaReferenceProblem>
): JSONArray {
    val array = JSONArray()
    problems.forEach { problem ->
        array.put(
            JSONObject()
                .put("cardId", problem.cardId)
                .put("mediaAssetId", problem.mediaAssetId)
        )
    }
    return array
}

private fun missingMediaBlobsJson(problems: List<LocalSyncDiagnosticsMissingMediaBlobProblem>): JSONArray {
    val array = JSONArray()
    problems.forEach { problem ->
        array.put(
            JSONObject()
                .put("mediaAssetId", problem.mediaAssetId)
                .put("sha256", problem.sha256)
        )
    }
    return array
}

private fun JSONObject.putNullableString(name: String, value: String?): JSONObject {
    return put(name, value ?: JSONObject.NULL)
}

private fun JSONObject.putNullableInt(name: String, value: Int?): JSONObject {
    return put(name, value ?: JSONObject.NULL)
}

private fun JSONObject.putNullableLong(name: String, value: Long?): JSONObject {
    return put(name, value ?: JSONObject.NULL)
}

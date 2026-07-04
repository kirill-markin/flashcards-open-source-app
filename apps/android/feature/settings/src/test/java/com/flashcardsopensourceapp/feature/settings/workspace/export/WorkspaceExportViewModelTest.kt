package com.flashcardsopensourceapp.feature.settings.workspace.export

import com.flashcardsopensourceapp.core.ui.AppTechnicalError
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDefaultPackageMetadata
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportSelection
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagCount
import com.flashcardsopensourceapp.feature.settings.FakeCloudAccountRepository
import com.flashcardsopensourceapp.feature.settings.TestSettingsStringResolver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class WorkspaceExportViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun previewPackageExportAppliesDefaultMetadataAndTagPolicy() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val cloudRepository = FakeCloudAccountRepository()
        cloudRepository.setCloudSettings(settings = linkedCloudSettings())
        val preview = workspacePackageExportPreview()
        cloudRepository.nextWorkspacePackageExportPreview = preview
        val viewModel = workspaceExportViewModel(cloudRepository = cloudRepository)
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewPackageExport()
        advanceUntilIdle()

        val request = cloudRepository.previewedWorkspacePackageExportRequests.single()
        assertEquals(WorkspacePackageExportSelection.AllActiveCards, request.selection)
        assertEquals(emptyList<String>(), request.tagPolicy.additionalRemovedTags)
        assertNull(request.packageMetadata.label)
        assertSame(preview, viewModel.uiState.value.packagePreview)
        assertEquals("Primary export", viewModel.uiState.value.packageMetadataDraft.label)
        assertEquals("Export author", viewModel.uiState.value.packageMetadataDraft.author)
        assertEquals(emptySet<String>(), viewModel.uiState.value.packageCardSelectionTags)
        assertEquals(preview.availableTagCounts, viewModel.uiState.value.packageCardSelectionTagCounts)
        assertEquals(setOf("geography", "temporary"), viewModel.uiState.value.packageIncludedTags)

        stateJob.cancel()
    }

    @Test
    fun preparePackageExportDownloadSendsAllCardsSelectionAndIncludedTags() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val cloudRepository = FakeCloudAccountRepository()
        cloudRepository.setCloudSettings(settings = linkedCloudSettings())
        cloudRepository.nextWorkspacePackageExportPreview = workspacePackageExportPreview()
        cloudRepository.nextWorkspacePackageExportDownloadResponse = WorkspacePackageExportDownloadResponse(
            packageBytes = byteArrayOf(80, 75, 3, 4),
            fileName = "flashcards.zip",
            contentType = "application/zip"
        )
        val viewModel = workspaceExportViewModel(cloudRepository = cloudRepository)
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewPackageExport()
        advanceUntilIdle()
        viewModel.updatePackageLabel(label = "Edited export")
        viewModel.updatePackageAuthor(author = "Edited author")
        viewModel.updatePackageCreatedAt(createdAt = "2026-07-01T10:00:00.000Z")
        viewModel.updatePackageSourceUrl(sourceUrl = "https://example.com/edited")
        viewModel.updatePackageComment(comment = "Edited comment")
        viewModel.togglePackageIncludedTag(tag = "geography")
        advanceUntilIdle()
        val response = viewModel.preparePackageExportDownload()

        val request = cloudRepository.exportedWorkspacePackageRequests.single()
        assertArrayEquals(byteArrayOf(80, 75, 3, 4), response?.packageBytes)
        assertEquals(WorkspacePackageExportSelection.AllActiveCards, request.selection)
        assertEquals(listOf("geography"), request.tagPolicy.additionalRemovedTags)
        assertEquals("Edited export", request.packageMetadata.label)
        assertEquals("Edited author", request.packageMetadata.author)
        assertEquals("Edited comment", request.packageMetadata.comment)
        assertEquals("2026-07-01T10:00:00.000Z", request.packageMetadata.createdAt)
        assertEquals("https://example.com/edited", request.packageMetadata.sourceUrl)

        stateJob.cancel()
    }

    @Test
    fun preparePackageExportDownloadPreservesDraftAfterCardSelectionRefresh() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val cloudRepository = FakeCloudAccountRepository()
        cloudRepository.setCloudSettings(settings = linkedCloudSettings())
        cloudRepository.nextWorkspacePackageExportPreview = workspacePackageExportPreview()
        cloudRepository.nextWorkspacePackageExportDownloadResponse = WorkspacePackageExportDownloadResponse(
            packageBytes = byteArrayOf(80, 75, 3, 4),
            fileName = "flashcards.zip",
            contentType = "application/zip"
        )
        val viewModel = workspaceExportViewModel(cloudRepository = cloudRepository)
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewPackageExport()
        advanceUntilIdle()
        viewModel.updatePackageLabel(label = "Filtered export")
        viewModel.updatePackageAuthor(author = "Filtered author")
        viewModel.updatePackageCreatedAt(createdAt = "2026-07-02T10:00:00.000Z")
        viewModel.updatePackageSourceUrl(sourceUrl = "https://example.com/filtered")
        viewModel.updatePackageComment(comment = "Filtered comment")
        viewModel.togglePackageIncludedTag(tag = "geography")
        advanceUntilIdle()
        viewModel.togglePackageCardSelectionTag(tag = "geography")
        advanceUntilIdle()
        val response = viewModel.preparePackageExportDownload()

        val request = cloudRepository.exportedWorkspacePackageRequests.single()
        assertArrayEquals(byteArrayOf(80, 75, 3, 4), response?.packageBytes)
        assertEquals(
            WorkspacePackageExportSelection.TagFilters(
                includeTags = listOf("geography"),
                excludeTags = emptyList()
            ),
            cloudRepository.previewedWorkspacePackageExportRequests.last().selection
        )
        assertEquals(
            WorkspacePackageExportSelection.TagFilters(
                includeTags = listOf("geography"),
                excludeTags = emptyList()
            ),
            request.selection
        )
        assertEquals(listOf("geography"), request.tagPolicy.additionalRemovedTags)
        assertEquals("Filtered export", request.packageMetadata.label)
        assertEquals("Filtered author", request.packageMetadata.author)
        assertEquals("Filtered comment", request.packageMetadata.comment)
        assertEquals("2026-07-02T10:00:00.000Z", request.packageMetadata.createdAt)
        assertEquals("https://example.com/filtered", request.packageMetadata.sourceUrl)

        stateJob.cancel()
    }

    @Test
    fun cardSelectionRefreshPreservesIncludedPackageTags() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val cloudRepository = FakeCloudAccountRepository()
        cloudRepository.setCloudSettings(settings = linkedCloudSettings())
        cloudRepository.nextWorkspacePackageExportPreview = workspacePackageExportPreview()
        cloudRepository.nextWorkspacePackageExportDownloadResponse = WorkspacePackageExportDownloadResponse(
            packageBytes = byteArrayOf(80, 75, 3, 4),
            fileName = "flashcards.zip",
            contentType = "application/zip"
        )
        val viewModel = workspaceExportViewModel(cloudRepository = cloudRepository)
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewPackageExport()
        advanceUntilIdle()
        viewModel.togglePackageIncludedTag(tag = "geography")
        advanceUntilIdle()
        cloudRepository.nextWorkspacePackageExportPreview = workspacePackageExportPreviewWithoutTemporary()
        viewModel.togglePackageCardSelectionTag(tag = "geography")
        advanceUntilIdle()
        cloudRepository.nextWorkspacePackageExportPreview = workspacePackageExportPreview()
        viewModel.togglePackageCardSelectionTag(tag = "geography")
        advanceUntilIdle()
        val response = viewModel.preparePackageExportDownload()

        val request = cloudRepository.exportedWorkspacePackageRequests.single()
        assertArrayEquals(byteArrayOf(80, 75, 3, 4), response?.packageBytes)
        assertEquals(WorkspacePackageExportSelection.AllActiveCards, request.selection)
        assertEquals(listOf("geography"), request.tagPolicy.additionalRemovedTags)
        assertEquals(setOf("temporary"), viewModel.uiState.value.packageIncludedTags)

        stateJob.cancel()
    }

    @Test
    fun cardSelectionRefreshIncludesNewPackageTagsByDefault() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val cloudRepository = FakeCloudAccountRepository()
        cloudRepository.setCloudSettings(settings = linkedCloudSettings())
        cloudRepository.nextWorkspacePackageExportPreview = workspacePackageExportPreview()
        cloudRepository.nextWorkspacePackageExportDownloadResponse = WorkspacePackageExportDownloadResponse(
            packageBytes = byteArrayOf(80, 75, 3, 4),
            fileName = "flashcards.zip",
            contentType = "application/zip"
        )
        val viewModel = workspaceExportViewModel(cloudRepository = cloudRepository)
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewPackageExport()
        advanceUntilIdle()
        viewModel.togglePackageIncludedTag(tag = "geography")
        advanceUntilIdle()
        cloudRepository.nextWorkspacePackageExportPreview = workspacePackageExportPreviewWithSharedTag()
        viewModel.togglePackageCardSelectionTag(tag = "geography")
        advanceUntilIdle()
        val response = viewModel.preparePackageExportDownload()

        val request = cloudRepository.exportedWorkspacePackageRequests.single()
        assertArrayEquals(byteArrayOf(80, 75, 3, 4), response?.packageBytes)
        assertEquals(
            WorkspacePackageExportSelection.TagFilters(
                includeTags = listOf("geography"),
                excludeTags = emptyList()
            ),
            request.selection
        )
        assertEquals(listOf("geography"), request.tagPolicy.additionalRemovedTags)
        assertEquals(setOf("temporary", "shared"), viewModel.uiState.value.packageIncludedTags)

        stateJob.cancel()
    }

    @Test
    fun failedCardSelectionRefreshRestoresPreviousDraft() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val cloudRepository = FakeCloudAccountRepository()
        cloudRepository.setCloudSettings(settings = linkedCloudSettings())
        cloudRepository.nextWorkspacePackageExportPreview = workspacePackageExportPreview()
        cloudRepository.nextWorkspacePackageExportDownloadResponse = WorkspacePackageExportDownloadResponse(
            packageBytes = byteArrayOf(80, 75, 3, 4),
            fileName = "flashcards.zip",
            contentType = "application/zip"
        )
        val viewModel = workspaceExportViewModel(cloudRepository = cloudRepository)
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewPackageExport()
        advanceUntilIdle()
        viewModel.updatePackageLabel(label = "Recoverable export")
        viewModel.updatePackageAuthor(author = "Recoverable author")
        viewModel.updatePackageCreatedAt(createdAt = "2026-07-03T10:00:00.000Z")
        viewModel.updatePackageSourceUrl(sourceUrl = "https://example.com/recoverable")
        viewModel.updatePackageComment(comment = "Recoverable comment")
        viewModel.togglePackageIncludedTag(tag = "geography")
        advanceUntilIdle()
        cloudRepository.nextWorkspacePackageExportPreview = null
        viewModel.togglePackageCardSelectionTag(tag = "geography")
        advanceUntilIdle()

        assertEquals("Package export preview failed.", viewModel.uiState.value.errorMessage)
        assertEquals(
            WorkspacePackageExportSelection.TagFilters(
                includeTags = listOf("geography"),
                excludeTags = emptyList()
            ),
            cloudRepository.previewedWorkspacePackageExportRequests.last().selection
        )
        assertEquals(emptySet<String>(), viewModel.uiState.value.packageCardSelectionTags)
        assertEquals(setOf("temporary"), viewModel.uiState.value.packageIncludedTags)
        val response = viewModel.preparePackageExportDownload()

        val request = cloudRepository.exportedWorkspacePackageRequests.single()
        assertArrayEquals(byteArrayOf(80, 75, 3, 4), response?.packageBytes)
        assertEquals(WorkspacePackageExportSelection.AllActiveCards, request.selection)
        assertEquals(listOf("geography"), request.tagPolicy.additionalRemovedTags)
        assertEquals("Recoverable export", request.packageMetadata.label)
        assertEquals("Recoverable author", request.packageMetadata.author)
        assertEquals("Recoverable comment", request.packageMetadata.comment)
        assertEquals("2026-07-03T10:00:00.000Z", request.packageMetadata.createdAt)
        assertEquals("https://example.com/recoverable", request.packageMetadata.sourceUrl)

        stateJob.cancel()
    }

    private fun workspaceExportViewModel(cloudRepository: FakeCloudAccountRepository): WorkspaceExportViewModel {
        return WorkspaceExportViewModel(
            cloudAccountRepository = cloudRepository,
            technicalErrorController = RecordingTechnicalErrorController(),
            strings = TestSettingsStringResolver()
        )
    }
}

private fun linkedCloudSettings(): CloudSettings {
    return CloudSettings(
        installationId = "installation-1",
        cloudState = CloudAccountState.LINKED,
        linkedUserId = "user-1",
        linkedWorkspaceId = "workspace-local",
        linkedEmail = "person@example.com",
        activeWorkspaceId = "workspace-local",
        updatedAtMillis = 1L
    )
}

private fun workspacePackageExportPreview(): WorkspacePackageExportPreview {
    return workspacePackageExportPreviewWithAvailableTags(
        availableTagCounts = listOf(
            WorkspacePackageExportTagCount(
                tag = "geography",
                cardsCount = 2
            ),
            WorkspacePackageExportTagCount(
                tag = "temporary",
                cardsCount = 1
            ),
            WorkspacePackageExportTagCount(
                tag = "import:old",
                cardsCount = 1
            )
        )
    )
}

private fun workspacePackageExportPreviewWithoutTemporary(): WorkspacePackageExportPreview {
    return workspacePackageExportPreviewWithAvailableTags(
        availableTagCounts = listOf(
            WorkspacePackageExportTagCount(
                tag = "geography",
                cardsCount = 2
            ),
            WorkspacePackageExportTagCount(
                tag = "import:old",
                cardsCount = 1
            )
        )
    )
}

private fun workspacePackageExportPreviewWithSharedTag(): WorkspacePackageExportPreview {
    return workspacePackageExportPreviewWithAvailableTags(
        availableTagCounts = listOf(
            WorkspacePackageExportTagCount(
                tag = "geography",
                cardsCount = 2
            ),
            WorkspacePackageExportTagCount(
                tag = "temporary",
                cardsCount = 1
            ),
            WorkspacePackageExportTagCount(
                tag = "shared",
                cardsCount = 1
            ),
            WorkspacePackageExportTagCount(
                tag = "import:old",
                cardsCount = 1
            )
        )
    )
}

private fun workspacePackageExportPreviewWithAvailableTags(
    availableTagCounts: List<WorkspacePackageExportTagCount>
): WorkspacePackageExportPreview {
    return WorkspacePackageExportPreview(
        selectedCardCount = 3,
        availableTagCounts = availableTagCounts,
        tagsSelectedForRemoval = listOf(
            WorkspacePackageExportTagCount(
                tag = "import:old",
                cardsCount = 1
            )
        ),
        referencedMediaCount = 2,
        approximateReferencedMediaBytes = 1_536L,
        defaultPackageMetadata = WorkspacePackageExportDefaultPackageMetadata(
            label = "Primary export",
            author = "Export author",
            comment = "Export comment",
            createdAt = "2026-04-01T09:00:00.000Z",
            sourceUrl = "https://example.com/export"
        )
    )
}

private class RecordingTechnicalErrorController : AppTechnicalErrorController {
    val errors: MutableList<AppTechnicalError> = mutableListOf()

    override fun showTechnicalError(
        error: AppTechnicalError,
        throwable: Throwable
    ) {
        errors += error
    }
}

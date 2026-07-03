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
        assertEquals(setOf("temporary", "import:old"), viewModel.uiState.value.packageRemovedTags)

        stateJob.cancel()
    }

    @Test
    fun preparePackageExportDownloadSendsEditedMetadataAndRemovedTags() = runTest(dispatcher) {
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
        viewModel.togglePackageRemovedTag(tag = "geography")
        advanceUntilIdle()
        val response = viewModel.preparePackageExportDownload()

        val request = cloudRepository.exportedWorkspacePackageRequests.single()
        assertArrayEquals(byteArrayOf(80, 75, 3, 4), response?.packageBytes)
        assertEquals(listOf("geography", "temporary", "import:old"), request.tagPolicy.additionalRemovedTags)
        assertEquals("Edited export", request.packageMetadata.label)
        assertEquals("Edited author", request.packageMetadata.author)
        assertEquals("Edited comment", request.packageMetadata.comment)
        assertEquals("2026-07-01T10:00:00.000Z", request.packageMetadata.createdAt)
        assertEquals("https://example.com/edited", request.packageMetadata.sourceUrl)

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
    return WorkspacePackageExportPreview(
        selectedCardCount = 3,
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
        ),
        tagsSelectedForRemoval = listOf(
            WorkspacePackageExportTagCount(
                tag = "temporary",
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

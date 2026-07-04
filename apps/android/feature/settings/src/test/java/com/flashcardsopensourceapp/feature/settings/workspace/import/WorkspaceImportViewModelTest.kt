package com.flashcardsopensourceapp.feature.settings.workspace.importing

import com.flashcardsopensourceapp.core.ui.AppTechnicalError
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmResult
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmSummary
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportDefaultOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportMetadata
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportSourceKind
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportTagCount
import com.flashcardsopensourceapp.feature.settings.FakeCloudAccountRepository
import com.flashcardsopensourceapp.feature.settings.TestSettingsStringResolver
import kotlinx.coroutines.CompletableDeferred
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
class WorkspaceImportViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun previewSelectedFileAppliesServerDefaultImportOptions() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.setCloudSettings(settings = linkedCloudSettings())
        val preview = workspacePackageImportPreview()
        repository.nextWorkspacePackageImportPreview = preview
        val viewModel = workspaceImportViewModel(repository = repository)
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewSelectedFile(
            selectedFile = WorkspaceImportSelectedFile(
                fileName = "flashcards.zip",
                packageBytes = byteArrayOf(1, 2, 3)
            )
        )
        advanceUntilIdle()

        assertArrayEquals(byteArrayOf(1, 2, 3), repository.previewedWorkspacePackageImportBytes.single())
        assertSame(preview, viewModel.uiState.value.preview)
        assertEquals("flashcards.zip", viewModel.uiState.value.selectedFileName)
        assertEquals(preview.defaultOptions.addImportTag, viewModel.uiState.value.addImportTag)
        assertEquals("import-tag", viewModel.uiState.value.importTag)
        assertEquals(setOf("drop"), viewModel.uiState.value.removedTags)

        stateJob.cancel()
    }

    @Test
    fun previewSelectedFileIgnoresStaleResultAfterNewerSelection() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.setCloudSettings(settings = linkedCloudSettings())
        val firstPreviewGate = CompletableDeferred<Unit>()
        val secondPreviewGate = CompletableDeferred<Unit>()
        val firstPreview = workspacePackageImportPreviewWithLabel(label = "First package")
        val secondPreview = workspacePackageImportPreviewWithLabel(label = "Second package")
        repository.enqueueWorkspacePackageImportPreview(
            gate = firstPreviewGate,
            preview = firstPreview
        )
        repository.enqueueWorkspacePackageImportPreview(
            gate = secondPreviewGate,
            preview = secondPreview
        )
        val viewModel = workspaceImportViewModel(repository = repository)
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewSelectedFile(
            selectedFile = WorkspaceImportSelectedFile(
                fileName = "first.zip",
                packageBytes = byteArrayOf(1)
            )
        )
        advanceUntilIdle()
        viewModel.previewSelectedFile(
            selectedFile = WorkspaceImportSelectedFile(
                fileName = "second.zip",
                packageBytes = byteArrayOf(2)
            )
        )
        advanceUntilIdle()

        secondPreviewGate.complete(Unit)
        advanceUntilIdle()
        assertSame(secondPreview, viewModel.uiState.value.preview)
        assertEquals("second.zip", viewModel.uiState.value.selectedFileName)

        firstPreviewGate.complete(Unit)
        advanceUntilIdle()
        assertSame(secondPreview, viewModel.uiState.value.preview)
        assertEquals("second.zip", viewModel.uiState.value.selectedFileName)

        stateJob.cancel()
    }

    @Test
    fun confirmImportSendsSelectedOptionsAndClearsPreview() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.setCloudSettings(settings = linkedCloudSettings())
        repository.nextWorkspacePackageImportPreview = workspacePackageImportPreview()
        val confirmGate = CompletableDeferred<Unit>()
        repository.nextWorkspacePackageImportConfirmGate = confirmGate
        repository.nextWorkspacePackageImportConfirmResult = WorkspacePackageImportConfirmResult(
            summary = WorkspacePackageImportConfirmSummary(
                cardCount = 1,
                cardBatchCount = 1,
                referencedMediaCount = 2,
                importedMediaAssetCount = 2,
                appliedMediaAssetCount = 2,
                keptTagCount = 0,
                removedTagCount = 2,
                importTag = null
            )
        )
        val viewModel = workspaceImportViewModel(
            repository = repository,
            currentTimeMillis = { 123_456L },
            newImportId = { "IMPORT-ID-1" }
        )
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewSelectedFile(
            selectedFile = WorkspaceImportSelectedFile(
                fileName = "flashcards.zip",
                packageBytes = byteArrayOf(4, 5, 6)
            )
        )
        advanceUntilIdle()
        viewModel.updateImportTag(importTag = "edited-import-tag")
        viewModel.updateAddImportTag(isEnabled = false)
        viewModel.toggleTag(tag = "keep")
        advanceUntilIdle()
        viewModel.confirmImport()
        viewModel.confirmImport()
        advanceUntilIdle()
        assertEquals(1, repository.confirmedWorkspacePackageImports.size)
        confirmGate.complete(Unit)
        advanceUntilIdle()

        val confirmedImport = repository.confirmedWorkspacePackageImports.single()
        assertEquals("flashcards.zip", confirmedImport.fileName)
        assertArrayEquals(byteArrayOf(4, 5, 6), confirmedImport.packageBytes)
        assertEquals(false, confirmedImport.options.addImportTag)
        assertEquals("edited-import-tag", confirmedImport.options.importTag)
        assertEquals(listOf("keep", "drop"), confirmedImport.options.removeTags)
        assertEquals(123_456L, confirmedImport.options.importedAtMillis)
        assertEquals(123_456L, confirmedImport.options.clientUpdatedAtMillis)
        assertEquals("import-id-1", confirmedImport.options.importId)
        assertEquals("import-id-1", confirmedImport.options.operationIdPrefix)
        assertNull(viewModel.uiState.value.preview)
        assertEquals("Imported 1 card.", viewModel.uiState.value.successMessage)

        stateJob.cancel()
    }

    @Test
    fun confirmImportRejectsBlankImportTagWhenEnabled() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.setCloudSettings(settings = linkedCloudSettings())
        repository.nextWorkspacePackageImportPreview = workspacePackageImportPreview()
        val viewModel = workspaceImportViewModel(repository = repository)
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }
        advanceUntilIdle()

        viewModel.previewSelectedFile(
            selectedFile = WorkspaceImportSelectedFile(
                fileName = "flashcards.zip",
                packageBytes = byteArrayOf(7, 8, 9)
            )
        )
        advanceUntilIdle()
        viewModel.updateImportTag(importTag = " ")
        viewModel.confirmImport()
        advanceUntilIdle()

        assertEquals(0, repository.confirmedWorkspacePackageImports.size)
        assertEquals("Enter an import tag.", viewModel.uiState.value.errorMessage)

        stateJob.cancel()
    }

    private fun workspaceImportViewModel(
        repository: FakeCloudAccountRepository,
        currentTimeMillis: () -> Long,
        newImportId: () -> String
    ): WorkspaceImportViewModel {
        return WorkspaceImportViewModel(
            cloudAccountRepository = repository,
            technicalErrorController = RecordingTechnicalErrorController(),
            strings = TestSettingsStringResolver(),
            currentTimeMillis = currentTimeMillis,
            newImportId = newImportId
        )
    }

    private fun workspaceImportViewModel(repository: FakeCloudAccountRepository): WorkspaceImportViewModel {
        return workspaceImportViewModel(
            repository = repository,
            currentTimeMillis = { 100L },
            newImportId = { "import-id" }
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

private fun workspacePackageImportPreview(): WorkspacePackageImportPreview {
    return workspacePackageImportPreviewWithLabel(label = "Shared deck")
}

private fun workspacePackageImportPreviewWithLabel(label: String): WorkspacePackageImportPreview {
    return WorkspacePackageImportPreview(
        sourceKind = WorkspacePackageImportSourceKind.ZIP,
        packageMetadata = WorkspacePackageImportMetadata(
            label = label,
            author = "Author",
            comment = "Comment",
            createdAt = "2026-01-01T00:00:00.000Z",
            sourceUrl = "https://example.com/package"
        ),
        cardCount = 3,
        tagCounts = listOf(
            WorkspacePackageImportTagCount(
                tag = "keep",
                cardsCount = 2
            ),
            WorkspacePackageImportTagCount(
                tag = "drop",
                cardsCount = 1
            )
        ),
        referencedMediaCount = 2,
        packageMediaFileCount = 2,
        warnings = emptyList(),
        defaultOptions = WorkspacePackageImportDefaultOptions(
            addImportTag = true,
            suggestedImportTag = "import-tag",
            keptTags = listOf("keep"),
            removedTags = listOf("drop")
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

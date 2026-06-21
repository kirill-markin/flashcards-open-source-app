package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.core.ui.AppTechnicalError
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.data.local.model.cloud.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.feature.settings.server.ServerSettingsViewModel
import java.io.IOException
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ServerSettingsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val strings: SettingsStringResolver = TestSettingsStringResolver()

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun customOriginPreviewCanonicalizesApiHostToRootOrigin() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val viewModel = ServerSettingsViewModel(
            cloudAccountRepository = repository,
            technicalErrorController = RecordingTechnicalErrorController(),
            strings = strings
        )
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }

        viewModel.updateCustomOrigin(customOrigin = "https://api.deepseek.com")
        advanceUntilIdle()

        assertEquals("https://api.deepseek.com/v1", viewModel.uiState.value.previewApiBaseUrl)
        assertEquals("https://auth.deepseek.com", viewModel.uiState.value.previewAuthBaseUrl)

        stateJob.cancel()
    }

    @Test
    fun applyPreviewConfigurationValidatesBeforePersistingCustomServer() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        repository.validateCustomServerError = IOException("Unable to resolve host")
        val viewModel = ServerSettingsViewModel(
            cloudAccountRepository = repository,
            technicalErrorController = RecordingTechnicalErrorController(),
            strings = strings
        )
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }

        viewModel.updateCustomOrigin(customOrigin = "https://api.deepseek.com")
        viewModel.applyPreviewConfiguration()
        advanceUntilIdle()

        assertEquals(listOf("https://deepseek.com"), repository.validatedCustomOrigins)
        assertTrue(repository.appliedCustomServerConfigurations.isEmpty())
        assertEquals("Custom server validation failed.", viewModel.uiState.value.errorMessage)

        stateJob.cancel()
    }

    @Test
    fun applyPreviewConfigurationPersistsValidatedCustomServerConfiguration() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        val repository = FakeCloudAccountRepository()
        val validatedConfiguration = makeCustomCloudServiceConfiguration(
            customOrigin = "https://validated.example.com"
        )
        repository.nextValidatedCustomServerConfiguration = validatedConfiguration
        val viewModel = ServerSettingsViewModel(
            cloudAccountRepository = repository,
            technicalErrorController = RecordingTechnicalErrorController(),
            strings = strings
        )
        val stateJob = backgroundScope.launch {
            viewModel.uiState.collect()
        }

        viewModel.updateCustomOrigin(customOrigin = "https://api.example.com")
        viewModel.applyPreviewConfiguration()
        advanceUntilIdle()

        assertEquals(listOf("https://example.com"), repository.validatedCustomOrigins)
        assertEquals(listOf(validatedConfiguration), repository.appliedCustomServerConfigurations)
        assertEquals(validatedConfiguration.apiBaseUrl, viewModel.uiState.value.apiBaseUrl)
        assertEquals(validatedConfiguration.authBaseUrl, viewModel.uiState.value.authBaseUrl)

        stateJob.cancel()
    }
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

package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator

internal class CloudServerConfigurationCoordinator(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator
) {
    suspend fun currentServerConfiguration(): CloudServiceConfiguration {
        return preferencesStore.currentServerConfiguration()
    }

    suspend fun validateCustomServer(customOrigin: String): CloudServiceConfiguration {
        val configuration: CloudServiceConfiguration = makeCustomCloudServiceConfiguration(
            customOrigin = customOrigin
        )
        remoteService.validateConfiguration(configuration)
        return configuration
    }

    suspend fun applyCustomServer(configuration: CloudServiceConfiguration) {
        operationCoordinator.runExclusive {
            preferencesStore.applyCustomServer(configuration)
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }

    suspend fun resetToOfficialServer() {
        operationCoordinator.runExclusive {
            preferencesStore.resetToOfficialServer()
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }
}

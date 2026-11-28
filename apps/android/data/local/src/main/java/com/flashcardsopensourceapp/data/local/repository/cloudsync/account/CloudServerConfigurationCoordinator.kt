package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.targetsSameServer
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
            if (targetsSameServer(current = preferencesStore.currentServerConfiguration(), requested = configuration)) {
                return@runExclusive
            }
            preferencesStore.applyCustomServer(configuration)
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }

    suspend fun resetToOfficialServer() {
        operationCoordinator.runExclusive {
            if (preferencesStore.currentServerConfiguration().mode == CloudServiceConfigurationMode.OFFICIAL) {
                return@runExclusive
            }
            preferencesStore.resetToOfficialServer()
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }
}

package com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.identity.syncWorkspaceForkRequiredErrorCode

internal fun isRemoteAccountDeletedError(error: Exception): Boolean {
    return error is CloudRemoteException
        && error.statusCode == 410
        && error.errorCode == "ACCOUNT_DELETED"
}

internal fun isCloudIdentityConflictError(error: Exception): Boolean {
    return error is CloudRemoteException && (
        error.errorCode == "SYNC_INSTALLATION_PLATFORM_MISMATCH" ||
            error.errorCode == "SYNC_REPLICA_CONFLICT" ||
            error.errorCode == syncWorkspaceForkRequiredErrorCode
        )
}

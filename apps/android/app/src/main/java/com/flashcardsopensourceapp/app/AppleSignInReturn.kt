package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingAccountMethod

sealed interface AppleSignInReturnState {
    data object Idle : AppleSignInReturnState
    data object Unowned : AppleSignInReturnState
    data object OwnershipStorageFailed : AppleSignInReturnState
    data class Accepted(val pending: CloudPendingSocialSignIn) : AppleSignInReturnState
    data class ManagementAccepted(val pending: CloudPendingAccountMethod) : AppleSignInReturnState
    data object ManagementRejected : AppleSignInReturnState
    data object ManagementStorageFailed : AppleSignInReturnState
    data object Rejected : AppleSignInReturnState
    data object StorageFailed : AppleSignInReturnState
}

val AppleSignInReturnState.isLoginReturn: Boolean get() = when (this) {
    AppleSignInReturnState.Idle, AppleSignInReturnState.Unowned, AppleSignInReturnState.Rejected,
    AppleSignInReturnState.OwnershipStorageFailed, is AppleSignInReturnState.ManagementAccepted,
    AppleSignInReturnState.ManagementRejected, AppleSignInReturnState.ManagementStorageFailed -> false
    is AppleSignInReturnState.Accepted, AppleSignInReturnState.StorageFailed -> true
}

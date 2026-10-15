package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn

sealed interface AppleSignInReturnState {
    data object Idle : AppleSignInReturnState
    data class Accepted(val pending: CloudPendingSocialSignIn) : AppleSignInReturnState
    data object Rejected : AppleSignInReturnState
    data object StorageFailed : AppleSignInReturnState
}

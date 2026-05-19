package com.flashcardsopensourceapp.core.observability

data class CloudObservationIdentity(
    val userId: String?,
    val workspaceId: String?,
    val installationId: String,
    val appVersion: String?,
    val clientVersion: String?,
    val versionCode: Int?
)

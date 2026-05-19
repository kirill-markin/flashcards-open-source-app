package com.flashcardsopensourceapp.core.observability

interface AppObservability {
    fun setCloudIdentity(identity: CloudObservationIdentity)

    fun clearCloudIdentity()

    fun addBreadcrumb(event: AndroidBreadcrumbEvent)

    fun captureWarning(event: AndroidWarningIssueEvent)

    fun captureException(event: AndroidExceptionIssueEvent)
}

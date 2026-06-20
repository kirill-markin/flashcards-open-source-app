package com.flashcardsopensourceapp.core.observability

interface AppObservability {
    fun setCloudIdentity(identity: CloudObservationIdentity)

    fun clearCloudIdentity()

    fun addBreadcrumb(event: AndroidBreadcrumbEvent)

    fun captureWarning(event: AndroidWarningIssueEvent)

    fun captureException(event: AndroidExceptionIssueEvent)
}

interface AndroidAlreadyObservedThrowable {
    val androidObservationAlreadyCaptured: Boolean
}

fun shouldCaptureAndroidThrowable(throwable: Throwable): Boolean {
    var currentThrowable: Throwable? = throwable
    while (currentThrowable != null) {
        if ((currentThrowable as? AndroidAlreadyObservedThrowable)?.androidObservationAlreadyCaptured == true) {
            return false
        }
        currentThrowable = currentThrowable.cause
    }
    return true
}

fun alreadyObservedAndroidThrowable(throwable: Throwable): Throwable {
    val message = throwable.message ?: throwable::class.java.name
    return AndroidAlreadyObservedException(message = message, cause = throwable)
        .also { observedThrowable -> observedThrowable.stackTrace = throwable.stackTrace }
}

private class AndroidAlreadyObservedException(
    message: String,
    cause: Throwable
) : Exception(message, cause), AndroidAlreadyObservedThrowable {
    override val androidObservationAlreadyCaptured: Boolean = true
}

package com.flashcardsopensourceapp.app.runtime

private const val jobSchedulerClassName: String = "android.app.job.JobScheduler"
private const val jobSchedulerForNamespaceMethodName: String = "forNamespace"

internal fun isAndroidRuntimeSupported(): Boolean {
    return hasJobSchedulerNamespaceSupport()
}

private fun hasJobSchedulerNamespaceSupport(): Boolean {
    return try {
        val jobSchedulerClass: Class<*> = Class.forName(jobSchedulerClassName)
        jobSchedulerClass.getMethod(jobSchedulerForNamespaceMethodName, String::class.java)
        true
    } catch (error: ClassNotFoundException) {
        false
    } catch (error: NoSuchMethodException) {
        false
    }
}

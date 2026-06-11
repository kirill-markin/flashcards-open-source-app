package com.flashcardsopensourceapp.app.runtime

import android.os.Build
import com.flashcardsopensourceapp.app.BuildConfig

private const val jobSchedulerClassName: String = "android.app.job.JobScheduler"
private const val jobSchedulerForNamespaceMethodName: String = "forNamespace"

internal fun isAndroidRuntimeSupported(): Boolean {
    if (Build.VERSION.SDK_INT < BuildConfig.ANDROID_MIN_SDK) {
        return false
    }

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

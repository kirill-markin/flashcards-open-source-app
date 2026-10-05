package com.flashcardsopensourceapp.app.runtime

import android.os.Build
import com.flashcardsopensourceapp.app.BuildConfig

internal fun isAndroidRuntimeSupported(): Boolean {
    return Build.VERSION.SDK_INT >= BuildConfig.ANDROID_MIN_SDK
}

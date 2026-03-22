package com.flashcardsopensourceapp.feature.settings

import org.junit.Assert.assertEquals
import org.junit.Test

class AccessSupportTest {
    @Test
    fun runtimePermissionStatusMarksFreshPermissionAsAskEveryTime() {
        val status = resolveRuntimePermissionStatus(
            isAvailable = true,
            isGranted = false,
            shouldShowRationale = false,
            hasRequestedPermission = false
        )

        assertEquals(AccessStatus.ASK_EVERY_TIME, status)
    }

    @Test
    fun runtimePermissionStatusMarksGrantedPermissionAsAllowed() {
        val status = resolveRuntimePermissionStatus(
            isAvailable = true,
            isGranted = true,
            shouldShowRationale = false,
            hasRequestedPermission = true
        )

        assertEquals(AccessStatus.ALLOWED, status)
    }

    @Test
    fun runtimePermissionStatusMarksBlockedPermissionAfterHardDenial() {
        val status = resolveRuntimePermissionStatus(
            isAvailable = true,
            isGranted = false,
            shouldShowRationale = false,
            hasRequestedPermission = true
        )

        assertEquals(AccessStatus.BLOCKED, status)
    }

    @Test
    fun photosAndFilesStaySystemPickerBased() {
        assertEquals(
            "Android 14+ uses the system photo picker here, so broad storage access is not required.",
            accessCapabilityGuidance(
                capability = AccessCapability.PHOTOS,
                status = AccessStatus.SYSTEM_PICKER
            )
        )
        assertEquals(
            "Android uses the system document picker here, so broad storage access is not required.",
            accessCapabilityGuidance(
                capability = AccessCapability.FILES,
                status = AccessStatus.SYSTEM_PICKER
            )
        )
    }
}

package com.flashcardsopensourceapp.feature.settings

/**
 * Distinguishes the two valid navigation paths after `sendCode()`.
 *
 * Review accounts can be fully verified by backend during the initial
 * send-code call. Those accounts must skip the OTP screen, but they still need
 * the normal post-auth workspace linking and initial sync flow.
 */
sealed interface CloudSendCodeNavigationOutcome {
    data object OtpRequired : CloudSendCodeNavigationOutcome
    data object Verified : CloudSendCodeNavigationOutcome
    data object NoNavigation : CloudSendCodeNavigationOutcome
}

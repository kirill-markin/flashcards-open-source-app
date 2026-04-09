package com.flashcardsopensourceapp.app

import java.util.concurrent.TimeUnit
import org.junit.Rule
import org.junit.rules.TestRule
import org.junit.rules.Timeout

private const val firebaseAppTestTimeoutMinutes: Long = 7L

abstract class FirebaseAppInstrumentationTimeoutTest {
    @get:Rule
    val firebaseAppTestTimeout: TestRule = Timeout.builder()
        .withTimeout(firebaseAppTestTimeoutMinutes, TimeUnit.MINUTES)
        .withLookingForStuckThread(true)
        .build()
}

package com.flashcardsopensourceapp.data.local.cloud

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudRemoteServiceMainThreadTest {
    @Test
    fun validateConfigurationCanBeCalledFromMainThread() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            runBlocking {
                CloudRemoteService().validateConfiguration(
                    configuration = makeOfficialCloudServiceConfiguration()
                )
            }
        }
    }
}

package com.flashcardsopensourceapp.data.local.cloud

import kotlin.coroutines.Continuation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudRemoteGatewayContractTest {
    @Test
    fun cloudRemoteGatewayMethodsRemainSuspend() {
        val gatewayMethods = CloudRemoteGateway::class.java.declaredMethods
        assertTrue(gatewayMethods.isNotEmpty())

        gatewayMethods.forEach { method ->
            val parameters = method.parameterTypes.toList()
            assertTrue(
                "Expected suspend signature for ${method.name}.",
                parameters.isNotEmpty()
            )
            assertEquals(
                "Expected Continuation as the last parameter for ${method.name}.",
                Continuation::class.java,
                parameters.last()
            )
        }
    }
}

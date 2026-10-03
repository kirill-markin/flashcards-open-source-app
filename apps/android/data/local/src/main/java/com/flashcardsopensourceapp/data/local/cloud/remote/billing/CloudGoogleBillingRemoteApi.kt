package com.flashcardsopensourceapp.data.local.cloud.remote.billing

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal class CloudGoogleBillingRemoteApi(private val httpClient: CloudJsonHttpClient) : CloudGoogleBillingGateway {
    override suspend fun loadGoogleBillingAccount(apiBaseUrl: String, authorizationHeader: String): String {
        return sanitizedBillingRequest {
            val response = httpClient.getJson(
                baseUrl = apiBaseUrl,
                path = "/billing/google/account",
                authorizationHeader = authorizationHeader
            )
            response.requireCloudString("obfuscatedAccountId", "google.account.obfuscatedAccountId").also { value ->
                require(value.isNotBlank() && value.length <= 64) { "Invalid Google billing account identifier." }
            }
        }
    }

    override suspend fun verifyGooglePurchase(
        apiBaseUrl: String,
        authorizationHeader: String,
        purchaseToken: String,
        intent: GooglePurchaseIntent
    ) {
        sanitizedBillingRequest {
            require(purchaseToken.isNotBlank()) { "Google purchase token is missing." }
            val response = httpClient.postJson(
                baseUrl = apiBaseUrl,
                path = "/billing/google/purchases",
                authorizationHeader = authorizationHeader,
                body = JSONObject().put("purchaseToken", purchaseToken).put("intent", intent.wireValue)
            )
            check(response.requireCloudBoolean("attached", "google.purchase.attached")) {
                "Google purchase was not attached. Use Restore to attach it to this account."
            }
        }
    }
}

// Never propagate provider response bodies or a cause that can contain the purchase token.
private suspend fun <Result> sanitizedBillingRequest(block: suspend () -> Result): Result {
    try {
        return block()
    } catch (error: CancellationException) {
        throw error
    } catch (error: CloudRemoteException) {
        throw GoogleBillingRequestException(statusCode = error.statusCode)
    } catch (error: Exception) {
        throw GoogleBillingRequestException(statusCode = null)
    }
}

class GoogleBillingRequestException(val statusCode: Int?) : IllegalStateException(
    "Google purchase verification could not finish. Retry or use Restore. HTTP status: ${statusCode ?: "unavailable"}."
)

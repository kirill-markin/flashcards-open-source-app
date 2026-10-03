package com.flashcardsopensourceapp.data.local.cloud.remote.billing

enum class GooglePurchaseIntent(val wireValue: String) {
    EXPLICIT("explicit"),
    PASSIVE("passive")
}

interface CloudGoogleBillingGateway {
    suspend fun loadGoogleBillingAccount(apiBaseUrl: String, authorizationHeader: String): String

    suspend fun verifyGooglePurchase(
        apiBaseUrl: String,
        authorizationHeader: String,
        purchaseToken: String,
        intent: GooglePurchaseIntent
    )
}

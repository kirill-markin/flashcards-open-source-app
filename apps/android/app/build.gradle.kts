import org.gradle.api.GradleException
import java.util.Locale

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.sentry.android)
}

fun readSupportedAndroidLocales(): List<String> {
    val localesConfig = layout.projectDirectory.file("src/main/res/xml/locales_config.xml").asFile
    val localeNamePattern = Regex("""<locale\s+android:name="([^"]+)"""")
    val supportedLocales = localeNamePattern.findAll(localesConfig.readText())
        .map { matchResult ->
            matchResult.groupValues[1]
        }
        .toList()

    if (supportedLocales.isEmpty()) {
        throw GradleException("apps/android/app/src/main/res/xml/locales_config.xml must declare at least one supported locale.")
    }

    return supportedLocales
}

fun toAndroidLocaleFilter(localeTag: String): String {
    val locale = Locale.forLanguageTag(localeTag)
    val language = locale.language

    if (language.isBlank()) {
        throw GradleException("Unsupported locale tag in locales_config.xml: $localeTag")
    }

    val script = locale.script
    val country = locale.country

    return when {
        script.isNotBlank() -> buildList {
            add("b")
            add(language)
            add(script)
            if (country.isNotBlank()) {
                add(country)
            }
        }.joinToString(separator = "+")

        country.any(Char::isDigit) -> listOf("b", language, country).joinToString(separator = "+")
        country.isNotBlank() -> "$language-r$country"
        else -> language
    }
}

val requestedTaskNames: List<String> = gradle.startParameter.taskNames
val isReleaseTaskRequested: Boolean = requestedTaskNames.any { taskName ->
    taskName.contains("Release", ignoreCase = true)
}
val isMarketingScreenshotTaskRequested: Boolean = requestedTaskNames.any { taskName ->
    taskName.contains("MarketingScreenshot", ignoreCase = true)
}
val supportedAndroidLocales: List<String> = readSupportedAndroidLocales()
val supportedAndroidLocaleFilters: List<String> = supportedAndroidLocales.map(::toAndroidLocaleFilter)
val marketingScreenshotLocales: List<String> = listOf(
    "en-US",
    "ar",
    "zh-CN",
    "de-DE",
    "hi-IN",
    "ja-JP",
    "ru-RU",
    "es-419",
    "es-ES",
    "es-US"
)
val marketingScreenshotLocaleFilters: List<String> = marketingScreenshotLocales.map(::toAndroidLocaleFilter)

val androidVersionCodeValue: String? = providers.environmentVariable("ANDROID_VERSION_CODE").orNull
val androidVersionCode: Int? = androidVersionCodeValue?.toIntOrNull()
val androidReleaseStoreFile: String? = providers.environmentVariable("ANDROID_RELEASE_STORE_FILE").orNull
val androidReleaseStorePassword: String? = providers.environmentVariable("ANDROID_RELEASE_STORE_PASSWORD").orNull
val androidReleaseKeyAlias: String? = providers.environmentVariable("ANDROID_RELEASE_KEY_ALIAS").orNull
val androidReleaseKeyPassword: String? = providers.environmentVariable("ANDROID_RELEASE_KEY_PASSWORD").orNull
val androidSentryDsn: String = providers.environmentVariable("ANDROID_SENTRY_DSN").orNull?.trim().orEmpty()
val androidSentryEnvironmentOverride: String =
    providers.environmentVariable("ANDROID_SENTRY_ENVIRONMENT").orNull?.trim().orEmpty()
val androidSentryTracesSampleRateOverride: String =
    providers.environmentVariable("ANDROID_SENTRY_TRACES_SAMPLE_RATE").orNull?.trim().orEmpty()

if (isReleaseTaskRequested && androidVersionCode == null) {
    throw GradleException("ANDROID_VERSION_CODE must be set to an integer for Android release builds.")
}

if (isReleaseTaskRequested && androidSentryDsn.isBlank()) {
    throw GradleException("ANDROID_SENTRY_DSN must be set for Android release builds.")
}

if (isReleaseTaskRequested) {
    val missingSigningVariables: List<String> = listOf(
        "ANDROID_RELEASE_STORE_FILE" to androidReleaseStoreFile,
        "ANDROID_RELEASE_STORE_PASSWORD" to androidReleaseStorePassword,
        "ANDROID_RELEASE_KEY_ALIAS" to androidReleaseKeyAlias,
        "ANDROID_RELEASE_KEY_PASSWORD" to androidReleaseKeyPassword
    ).mapNotNull { (variableName, variableValue) ->
        if (variableValue.isNullOrBlank()) variableName else null
    }

    if (missingSigningVariables.isNotEmpty()) {
        throw GradleException(
            "Missing Android release signing environment variables: ${missingSigningVariables.joinToString(", ")}."
        )
    }
}

// Single source for defaultConfig.minSdk, also surfaced to runtime via BuildConfig so
// observability can skip telemetry from below-minSdk (out-of-contract) devices.
val androidMinSdk: Int = 34

fun toBuildConfigString(value: String): String {
    return "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""
}

fun sentryTracesSampleRateLiteral(buildTypeName: String): String {
    if (androidSentryTracesSampleRateOverride.isBlank()) {
        return if (buildTypeName == "release") "0.0" else "1.0"
    }

    val sampleRate = androidSentryTracesSampleRateOverride.toDoubleOrNull()
        ?: throw GradleException("ANDROID_SENTRY_TRACES_SAMPLE_RATE must be a decimal value between 0 and 1.")

    if (!sampleRate.isFinite() || sampleRate < 0.0 || sampleRate > 1.0) {
        throw GradleException("ANDROID_SENTRY_TRACES_SAMPLE_RATE must be a finite decimal value between 0 and 1.")
    }

    return sampleRate.toString()
}

android {
    namespace = "com.flashcardsopensourceapp.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.flashcardsopensourceapp.app"
        minSdk = androidMinSdk
        targetSdk = 36
        versionCode = androidVersionCode ?: 1
        versionName = "1.12.0"
        testInstrumentationRunner = "com.flashcardsopensourceapp.app.FlashcardsAndroidTestRunner"
        testInstrumentationRunnerArguments["clearPackageData"] = "true"
        buildConfigField("int", "ANDROID_MIN_SDK", androidMinSdk.toString())
        buildConfigField("String", "ANDROID_SENTRY_DSN", toBuildConfigString(androidSentryDsn))
        buildConfigField(
            "String",
            "ANDROID_SENTRY_ENVIRONMENT",
            toBuildConfigString(androidSentryEnvironmentOverride)
        )
    }

    signingConfigs {
        create("release") {
            if (!androidReleaseStoreFile.isNullOrBlank()) {
                storeFile = file(androidReleaseStoreFile)
            }

            if (!androidReleaseStorePassword.isNullOrBlank()) {
                storePassword = androidReleaseStorePassword
            }

            if (!androidReleaseKeyAlias.isNullOrBlank()) {
                keyAlias = androidReleaseKeyAlias
            }

            if (!androidReleaseKeyPassword.isNullOrBlank()) {
                keyPassword = androidReleaseKeyPassword
            }
        }
    }

    buildTypes {
        getByName("debug") {
            buildConfigField(
                "double",
                "ANDROID_SENTRY_TRACES_SAMPLE_RATE",
                sentryTracesSampleRateLiteral(name)
            )
        }

        create("marketingScreenshot") {
            initWith(getByName("debug"))
            matchingFallbacks += listOf("debug")
            buildConfigField(
                "double",
                "ANDROID_SENTRY_TRACES_SAMPLE_RATE",
                sentryTracesSampleRateLiteral(name)
            )
        }

        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
            buildConfigField(
                "double",
                "ANDROID_SENTRY_TRACES_SAMPLE_RATE",
                sentryTracesSampleRateLiteral(name)
            )
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    androidResources {
        localeFilters += supportedAndroidLocaleFilters
        if (isMarketingScreenshotTaskRequested) {
            localeFilters += marketingScreenshotLocaleFilters
        }
    }

    bundle {
        language {
            enableSplit = false
        }
    }

    testOptions {
        animationsDisabled = true
        execution = "ANDROIDX_TEST_ORCHESTRATOR"
    }

    testBuildType = if (isMarketingScreenshotTaskRequested) {
        "marketingScreenshot"
    } else {
        "debug"
    }
}

sentry {
    org = providers.environmentVariable("SENTRY_ORG").orNull
    projectName = providers.environmentVariable("SENTRY_ANDROID_PROJECT").orNull
    authToken = providers.environmentVariable("SENTRY_AUTH_TOKEN").orNull
    ignoredBuildTypes = setOf("debug", "marketingScreenshot")
    includeProguardMapping = true
    autoUploadProguardMapping = true
    includeSourceContext = true
    includeDependenciesReport = true

    tracingInstrumentation {
        enabled = false
    }

    autoInstallation {
        enabled = false
    }
}

dependencies {
    implementation(project(":core:observability"))
    implementation(project(":core:ui"))
    implementation(project(":data:local"))
    implementation(project(":feature:review"))
    implementation(project(":feature:cards"))
    implementation(project(":feature:ai"))
    implementation(project(":feature:friendinvite"))
    implementation(project(":feature:progress"))
    implementation(project(":feature:settings"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.compose.adaptive)
    implementation(libs.androidx.compose.adaptive.navigation.suite)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.google.play.review)
    implementation(libs.okhttp)
    implementation(libs.sentry.android)
    implementation(libs.sentry.okhttp)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)

    testImplementation(libs.junit4)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(libs.androidx.test.uiautomator)
    androidTestUtil(libs.androidx.test.orchestrator)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    add("marketingScreenshotImplementation", libs.androidx.compose.ui.tooling)
    add("marketingScreenshotImplementation", libs.androidx.compose.ui.test.manifest)
}

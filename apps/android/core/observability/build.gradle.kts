plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.flashcardsopensourceapp.core.observability"
    compileSdk = 37

    defaultConfig {
        minSdk = 34
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.org.jetbrains.kotlinx.coroutines.android)

    // The analytics queue is durable and lives on its own Room database, deliberately separate from
    // the product data layer in `:data:local`.
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // `OkHttpClient` appears in the public analytics client constructor.
    api(libs.okhttp)
}

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)

    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "flashcards-open-source-app-android"

include(":app")
include(":core:ui")
include(":core:observability")
include(":data:local")
include(":feature:review")
include(":feature:cards")
include(":feature:ai")
include(":feature:friendinvite")
include(":feature:progress")
include(":feature:settings")

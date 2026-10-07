FROM eclipse-temurin:17-jdk-jammy

ARG ANDROID_CMDLINE_TOOLS_VERSION=16111833
ARG ANDROID_BUILD_TOOLS_VERSION=37.0.0
ARG ANDROID_PLATFORM_VERSION=37.0

ENV JAVA_HOME=/opt/java/openjdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH="${PATH}:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools"

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl gnupg jq unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl --fail --silent --show-error https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --dearmor -o /usr/share/keyrings/google-cloud-cli.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/google-cloud-cli.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    > /etc/apt/sources.list.d/google-cloud-sdk.list \
  && apt-get update \
  && apt-get install --yes --no-install-recommends google-cloud-cli=588.0.0-0 \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p "${ANDROID_SDK_ROOT}/cmdline-tools" \
  && curl --fail --location --silent --show-error \
    "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip" \
    --output /tmp/commandlinetools.zip \
  && unzip -q /tmp/commandlinetools.zip -d "${ANDROID_SDK_ROOT}/cmdline-tools" \
  && mv "${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools" "${ANDROID_SDK_ROOT}/cmdline-tools/latest" \
  && yes | sdkmanager --sdk_root="${ANDROID_SDK_ROOT}" --licenses >/dev/null \
  && sdkmanager --sdk_root="${ANDROID_SDK_ROOT}" \
    "platform-tools" \
    "platforms;android-${ANDROID_PLATFORM_VERSION}" \
    "build-tools;${ANDROID_BUILD_TOOLS_VERSION}" \
  && rm -f /tmp/commandlinetools.zip

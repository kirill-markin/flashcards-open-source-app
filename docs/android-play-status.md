# Read Android Play release status

Use **Android Play Status** in GitHub Actions to inspect the production lifecycle
of an exact version code. It uses the existing `GCP_WORKLOAD_IDENTITY_PROVIDER`,
`GCP_PLAY_SERVICE_ACCOUNT_EMAIL`, `GCP_PROJECT_ID`, and `ANDROID_PLAY_PACKAGE_NAME`
repository variables. The package must be `com.flashcardsopensourceapp.app`.

1. Find the exact version code in the original Android Release run summary.
2. Open **Actions → Android Play Status → Run workflow**, select `main`, and enter
   that positive version code. Alternatively:

   ```sh
   gh workflow run android-play-status.yml --ref main -f version_code=EXACT_VERSION_CODE
   ```

3. Inspect the run summary and retained `android-play-status` JSON artifact.
   A successful lookup reports one release name, its exact active artifact version
   codes, lifecycle state, and check time. Missing or ambiguous matches fail the
   run and retain a result when the response is valid; authentication, network,
   or malformed-provider errors fail explicitly in the step log.

The workflow only calls the [release-list GET API](https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases/list)
with the `androidpublisher` scope. It creates no Play edit and changes no release.
The API returns a maximum of 20 non-obsolete releases. An absent version code is
unconfirmed, including when its release has become obsolete.

The [published lifecycle](https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases#ReleaseLifecycleState)
includes staged and halted releases as well as full rollouts. This result does
not establish full rollout, country/device availability, or public propagation.
Review rollout details in Play Console before making those claims.

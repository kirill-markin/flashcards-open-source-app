# Read Android Play release status

Use **Android Play Status** ([workflow](../.github/workflows/android-play-status.yml))
in GitHub Actions to inspect the production lifecycle of an exact version code.
It reads with the existing Play repository variables, creates no Play edit and
changes no release.

1. Find the exact version code in the original Android Release run summary.
2. Open **Actions → Android Play Status → Run workflow**, select `main`, and enter
   that positive version code. Alternatively:

   ```sh
   gh workflow run android-play-status.yml --ref main -f version_code=EXACT_VERSION_CODE
   ```

3. Inspect the run summary and retained `android-play-status` JSON artifact.
   A successful lookup reports one release name, its exact active artifact version
   codes, lifecycle state, and check time. Missing or ambiguous matches fail the
   run; [the reader](../scripts/android/read-play-release-status.py) states the
   API's limits in its result. An absent version code is unconfirmed, including
   when its release has become obsolete.
4. The [published lifecycle](https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases#ReleaseLifecycleState)
   includes staged and halted releases as well as full rollouts, so this result
   does not establish full rollout, country/device availability, or public
   propagation. Review rollout details in Play Console before making those claims.

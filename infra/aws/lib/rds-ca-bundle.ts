const rdsGlobalCaBundleUrl = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";
const downloadRetries = 3;
const downloadRetryDelaySeconds = 2;
const downloadMaxSecondsPerAttempt = 60;

/**
 * Amazon rotates this bundle, so every Lambda asset downloads it while bundling
 * rather than vendoring a copy that would go stale without any signal.
 *
 * `--retry` on its own treats only timeouts and a few HTTP statuses as
 * transient, so `--retry-all-errors` is what covers the transport-level receive
 * failure (curl exit 56) that once failed a production deploy during bundling.
 * `-f` must stay so an HTTP error is a non-zero exit those retries can act on,
 * and `--max-time` bounds a hung socket per attempt because curl resets that
 * counter on every retry.
 */
export function createRdsCaBundleDownloadCommand(outputDir: string): string {
  return `curl -sfo ${outputDir}/rds-global-bundle.pem --retry ${downloadRetries} --retry-all-errors --retry-delay ${downloadRetryDelaySeconds} --max-time ${downloadMaxSecondsPerAttempt} ${rdsGlobalCaBundleUrl}`;
}

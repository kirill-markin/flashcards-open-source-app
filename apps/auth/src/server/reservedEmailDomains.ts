/**
 * RFC 2606 reserved names exist for documentation and testing and can never
 * receive mail, so the transactional email provider refuses them permanently.
 *
 * Entries are matched as domain suffixes: the reserved second-level domains and
 * the reserved top-level domains, each also covering everything below them.
 */
const RESERVED_EMAIL_DOMAIN_SUFFIXES: ReadonlyArray<string> = [
  "example.com",
  "example.net",
  "example.org",
  "test",
  "example",
  "invalid",
  "localhost",
];

function matchesDomainSuffix(domain: string, suffix: string): boolean {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

/**
 * Expects an address that already passed the caller's email format check.
 */
export function isReservedEmailDomain(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
  if (domain === "") {
    return false;
  }

  return RESERVED_EMAIL_DOMAIN_SUFFIXES.some((suffix) => matchesDomainSuffix(domain, suffix));
}

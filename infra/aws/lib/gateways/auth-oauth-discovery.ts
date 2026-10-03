/**
 * The auth host's two OAuth discovery documents, served by API Gateway as static
 * responses so agent-fleet bursts never reach the auth Lambda. They must stay
 * byte-identical (field order included) to the runtime routes in
 * apps/auth/src/routes/oauth/metadata.ts, which the local dev server still serves.
 */

// Must match OAUTH_SCOPES in apps/auth/src/server/oauth/scopes.ts, the list the
// auth Lambda enforces at runtime; infra/aws cannot import from apps/.
const oauthScopes = ["flashcards", "openid", "email"] as const;

type AuthorizationServerMetadata = Readonly<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  response_types_supported: ReadonlyArray<string>;
  grant_types_supported: ReadonlyArray<string>;
  code_challenge_methods_supported: ReadonlyArray<string>;
  token_endpoint_auth_methods_supported: ReadonlyArray<string>;
  scopes_supported: ReadonlyArray<string>;
  authorization_response_iss_parameter_supported: boolean;
}>;

function buildAuthorizationServerMetadata(issuer: string): AuthorizationServerMetadata {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: oauthScopes,
    authorization_response_iss_parameter_supported: true,
  };
}

// The body becomes a literal VTL response template, where `$` and `#` are syntax.
function assertVtlLiteralSafe(documentName: string, body: string): string {
  if (body.includes("$") || body.includes("#")) {
    throw new Error(`${documentName} contains "$" or "#", which a VTL response template would interpret: ${body}`);
  }
  return body;
}

export function buildAuthorizationServerMetadataJson(issuer: string): string {
  return assertVtlLiteralSafe(
    "oauth-authorization-server",
    JSON.stringify(buildAuthorizationServerMetadata(issuer)),
  );
}

export function buildOpenIdConfigurationJson(issuer: string): string {
  return assertVtlLiteralSafe(
    "openid-configuration",
    JSON.stringify({
      ...buildAuthorizationServerMetadata(issuer),
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      claims_supported: ["iss", "sub", "aud", "exp", "iat", "nonce", "email", "email_verified"],
      claims_parameter_supported: false,
      request_parameter_supported: false,
      request_uri_parameter_supported: false,
    }),
  );
}

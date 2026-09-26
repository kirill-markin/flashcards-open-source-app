import { Hono } from "hono";
import type { AuthAppEnv } from "../../server/apiErrors.js";
import { getPublicAuthBaseUrl } from "../../server/publicUrls.js";
import { getOidcPublicKey } from "../../server/oauth/oidcSigning.js";
import { OAUTH_SCOPES } from "../../server/oauth/scopes.js";

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

const app = new Hono<AuthAppEnv>();

app.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json(buildAuthorizationServerMetadata(getPublicAuthBaseUrl(c.req.url)));
});

app.get("/.well-known/openid-configuration", (c) => {
  return c.json({
    ...buildAuthorizationServerMetadata(getPublicAuthBaseUrl(c.req.url)),
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    claims_supported: ["iss", "sub", "aud", "exp", "iat", "nonce", "email", "email_verified"],
    claims_parameter_supported: false,
    request_parameter_supported: false,
    request_uri_parameter_supported: false,
  });
});

app.get("/.well-known/jwks.json", async (c) => {
  const key = await getOidcPublicKey();
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ keys: [key] });
});

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
    scopes_supported: OAUTH_SCOPES,
    authorization_response_iss_parameter_supported: true,
  };
}

export default app;

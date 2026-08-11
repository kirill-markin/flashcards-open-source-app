import {
  getPublicApiBaseUrl,
  getPublicLegalLinks,
  getPublicSourceLinks,
  type PublicSourceLinks,
} from "./publicUrls";

export type SourceDiscoveryResponse = Readonly<{
  ok: true;
  openapiAvailable: false;
  message: string;
  discoveryUrl: string;
  docsUrl: string;
  source: PublicSourceLinks;
}>;

export function createSourceDiscoveryResponse(requestUrl: string): SourceDiscoveryResponse {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return {
    ok: true,
    openapiAvailable: false,
    message: "Use runtime discovery and the open-source implementation instead.",
    discoveryUrl: `${apiBaseUrl}/`,
    docsUrl: getPublicLegalLinks(requestUrl).docsUrl,
    source: getPublicSourceLinks(),
  };
}

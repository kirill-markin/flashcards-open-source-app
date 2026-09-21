import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { DistributionHosts } from "./cloudfront-additional-host";

export interface WebAppProps {
  baseDomain: string;
  // Aliases and the single viewer certificate of the web distribution, resolved
  // in stack.ts against every alias the stack claims; see
  // ./cloudfront-additional-host.ts.
  hosts: DistributionHosts;
  apexRedirectCertificateArnUsEast1: string | undefined;
  // The host `app.<baseDomain>` redirects to instead of serving the bundle,
  // resolved by resolveWebPrimaryHostRedirectTarget above and undefined while
  // that host still serves the app itself.
  primaryHostRedirectTarget: string | undefined;
}

export function getPrimaryWebHost(baseDomain: string): string {
  return `app.${baseDomain}`;
}

export interface WebAppResult {
  bucket: s3.Bucket;
  distribution: cloudfront.Distribution;
  customDomain: string | undefined;
  apexRedirectDistribution: cloudfront.Distribution | undefined;
  apexRedirectCustomDomain: string | undefined;
}

export class WebPrimaryHostRetirementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebPrimaryHostRetirementError";
  }
}

/**
 * The host `app.<baseDomain>` redirects to once it is retired, or `undefined`
 * while it still serves the bundle itself.
 *
 * Retirement is its own switch, off until the context value is exactly "true",
 * so the redirect ships dark and is turned on by a later deploy. The same switch
 * decides where server-generated links point (`PUBLIC_APP_BASE_URL`): the origin
 * the browser clients run on and the origin the backend accepts have to move in
 * one deploy, or the host still serving the app loses its own API access.
 */
export function resolveWebPrimaryHostRedirectTarget(
  webPrimaryHostRetired: string | undefined,
  hosts: DistributionHosts,
): string | undefined {
  if ((webPrimaryHostRetired ?? "").trim().toLowerCase() !== "true") {
    return undefined;
  }

  if (hosts.primaryCustomDomain === undefined) {
    throw new WebPrimaryHostRetirementError(
      "webPrimaryHostRetired is set, but this distribution does not serve the primary web host, "
      + "so there is nothing to retire. Unset CDK_WEB_PRIMARY_HOST_RETIRED.",
    );
  }

  if (hosts.additionalCustomDomain === undefined) {
    throw new WebPrimaryHostRetirementError(
      "webPrimaryHostRetired is set, but no additional web host is configured to redirect to. "
      + "Set CDK_WEB_ADDITIONAL_DOMAIN_NAME with CDK_WEB_ADDITIONAL_CERTIFICATE_ARN_US_EAST_1, "
      + "or unset CDK_WEB_PRIMARY_HOST_RETIRED.",
    );
  }

  return hosts.additionalCustomDomain;
}

/**
 * CloudFront Functions runtime 1.0 (ES5) helpers shared by both redirect
 * functions below. `renderQueryString` is how a redirect keeps the query and
 * `redirectTo` is how it keeps the path, so an invite or catalog-install link
 * sent before the move still lands on the page it named.
 *
 * 308 rather than 301: both are permanent, but 308 also keeps the method and
 * body, and the short `cache-control` bounds how long a client remembers it,
 * which is what makes a permanent redirect reversible within minutes.
 */
const redirectFunctionHelpers = `
function encode(value) {
  return encodeURIComponent(value);
}

function renderQueryString(querystring) {
  if (!querystring) {
    return "";
  }

  var parts = [];
  var keys = Object.keys(querystring);
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    var entry = querystring[key];

    if (entry.multiValue && entry.multiValue.length > 0) {
      for (var j = 0; j < entry.multiValue.length; j += 1) {
        var item = entry.multiValue[j];
        if (item.value === "") {
          parts.push(encode(key));
        } else {
          parts.push(encode(key) + "=" + encode(item.value));
        }
      }
      continue;
    }

    if (entry.value === "") {
      parts.push(encode(key));
      continue;
    }

    parts.push(encode(key) + "=" + encode(entry.value));
  }

  return parts.length === 0 ? "" : "?" + parts.join("&");
}

function redirectTo(targetHost, request) {
  var path = request.uri || "/";
  var location = "https://" + targetHost + path + renderQueryString(request.querystring);

  return {
    statusCode: 308,
    statusDescription: "Permanent Redirect",
    headers: {
      location: { value: location },
      "cache-control": { value: "public, max-age=300" }
    }
  };
}
`;

/** Redirects every request to the same path and query on `targetHost`. */
function buildRedirectFunctionCode(targetHost: string): string {
  return `${redirectFunctionHelpers}
function handler(event) {
  return redirectTo("${targetHost}", event.request);
}
`;
}

/**
 * Redirects the requests whose `Host` is `sourceHost` and serves every other
 * request unchanged, so one distribution can retire one of its aliases while
 * still serving the rest.
 *
 * This runs on every viewer request of a distribution that still serves an app,
 * so it stays one header comparison. A response produced by a viewer-request
 * function is never stored in the cache, so the redirect cannot leak into a
 * cached object and reach the host that is still being served.
 */
function buildHostScopedRedirectFunctionCode(sourceHost: string, targetHost: string): string {
  // The case of the Host header is the client's choice; the alias it has to match is not.
  return `${redirectFunctionHelpers}
function handler(event) {
  var request = event.request;
  var hostHeader = request.headers.host;
  if (!hostHeader || hostHeader.value.toLowerCase() !== "${sourceHost.toLowerCase()}") {
    return request;
  }

  return redirectTo("${targetHost}", request);
}
`;
}

function createPrimaryHostRedirectAssociations(
  scope: Construct,
  sourceHost: string,
  targetHost: string,
): cloudfront.FunctionAssociation[] {
  return [
    {
      eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
      function: new cloudfront.Function(scope, "WebPrimaryHostRedirectFunction", {
        code: cloudfront.FunctionCode.fromInline(
          buildHostScopedRedirectFunctionCode(sourceHost, targetHost),
        ),
      }),
    },
  ];
}

export function webApp(scope: Construct, props: WebAppProps): WebAppResult {
  const bucket = new s3.Bucket(scope, "WebBucket", {
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
  });

  const primaryDomain = getPrimaryWebHost(props.baseDomain);
  const customDomain = props.hosts.primaryCustomDomain;
  const certificate = props.hosts.certificateArn === undefined
    ? undefined
    : acm.Certificate.fromCertificateArn(scope, "WebCertificate", props.hosts.certificateArn);

  // The primary and the additional host are two aliases of this one
  // distribution. CloudFront serves one alias per distribution nowhere, and an
  // alias cannot be moved to a second distribution without a window where it
  // answers nothing, so the distribution that serves both redirects one of them.
  const primaryHostRedirectAssociations = props.primaryHostRedirectTarget === undefined
    ? undefined
    : createPrimaryHostRedirectAssociations(scope, primaryDomain, props.primaryHostRedirectTarget);

  const distribution = new cloudfront.Distribution(scope, "WebDistribution", {
    comment: "flashcards-open-source-app web app",
    defaultRootObject: "index.html",
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
      functionAssociations: primaryHostRedirectAssociations,
    },
    domainNames: props.hosts.domainNames,
    certificate,
    errorResponses: [
      {
        httpStatus: 403,
        responseHttpStatus: 200,
        responsePagePath: "/index.html",
      },
      {
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: "/index.html",
      },
    ],
  });

  if (props.apexRedirectCertificateArnUsEast1 === undefined) {
    return {
      bucket,
      distribution,
      customDomain,
      apexRedirectDistribution: undefined,
      apexRedirectCustomDomain: undefined,
    };
  }

  const redirectBucket = new s3.Bucket(scope, "ApexRedirectBucket", {
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
  });

  const apexRedirectFunction = new cloudfront.Function(scope, "ApexRedirectFunction", {
    code: cloudfront.FunctionCode.fromInline(
      // Once the primary host is retired the apex skips it, rather than
      // sending every visitor through two redirects.
      buildRedirectFunctionCode(props.primaryHostRedirectTarget ?? primaryDomain),
    ),
  });

  const apexRedirectCertificate = acm.Certificate.fromCertificateArn(
    scope,
    "ApexRedirectCertificate",
    props.apexRedirectCertificateArnUsEast1,
  );

  const apexRedirectDistribution = new cloudfront.Distribution(scope, "ApexRedirectDistribution", {
    comment: "flashcards-open-source-app apex redirect",
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(redirectBucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      compress: true,
      functionAssociations: [
        {
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: apexRedirectFunction,
        },
      ],
    },
    domainNames: [props.baseDomain],
    certificate: apexRedirectCertificate,
  });

  return {
    bucket,
    distribution,
    customDomain,
    apexRedirectDistribution,
    apexRedirectCustomDomain: props.baseDomain,
  };
}

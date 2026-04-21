import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface WebAppProps {
  baseDomain: string;
  webCertificateArnUsEast1: string | undefined;
  apexRedirectCertificateArnUsEast1: string | undefined;
}

export interface WebAppResult {
  bucket: s3.Bucket;
  distribution: cloudfront.Distribution;
  customDomain: string | undefined;
  apexRedirectDistribution: cloudfront.Distribution | undefined;
  apexRedirectCustomDomain: string | undefined;
}

function buildApexRedirectFunctionCode(appDomain: string): string {
  return `
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

function handler(event) {
  var request = event.request;
  var path = request.uri || "/";
  var location = "https://${appDomain}" + path + renderQueryString(request.querystring);

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
}

export function webApp(scope: Construct, props: WebAppProps): WebAppResult {
  const bucket = new s3.Bucket(scope, "WebBucket", {
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
  });

  const customDomain = props.webCertificateArnUsEast1 === undefined
    ? undefined
    : `app.${props.baseDomain}`;
  const certificate = props.webCertificateArnUsEast1 === undefined
    ? undefined
    : acm.Certificate.fromCertificateArn(scope, "WebCertificate", props.webCertificateArnUsEast1);

  const distribution = new cloudfront.Distribution(scope, "WebDistribution", {
    comment: "flashcards-open-source-app web app",
    defaultRootObject: "index.html",
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
    },
    domainNames: customDomain === undefined ? undefined : [customDomain],
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
      buildApexRedirectFunctionCode(`app.${props.baseDomain}`),
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

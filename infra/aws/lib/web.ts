import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface WebAppProps {
  baseDomain: string;
  webCertificateArnUsEast1: string | undefined;
}

export interface WebAppResult {
  bucket: s3.Bucket;
  distribution: cloudfront.Distribution;
  customDomain: string | undefined;
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
      origin: new origins.S3Origin(bucket),
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

  return { bucket, distribution, customDomain };
}

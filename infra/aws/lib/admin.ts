import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { DistributionHosts } from "./cloudfront-additional-host";

export interface AdminAppProps {
  baseDomain: string;
  // Aliases and the single viewer certificate of the admin distribution,
  // resolved in stack.ts against every alias the stack claims; see
  // ./cloudfront-additional-host.ts.
  hosts: DistributionHosts;
}

export function getPrimaryAdminHost(baseDomain: string): string {
  return `admin.${baseDomain}`;
}

export interface AdminAppResult {
  bucket: s3.Bucket;
  distribution: cloudfront.Distribution;
  customDomain: string | undefined;
}

export function adminApp(scope: Construct, props: AdminAppProps): AdminAppResult {
  const bucket = new s3.Bucket(scope, "AdminBucket", {
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
  });

  const customDomain = props.hosts.primaryCustomDomain;
  const certificate = props.hosts.certificateArn === undefined
    ? undefined
    : acm.Certificate.fromCertificateArn(scope, "AdminCertificate", props.hosts.certificateArn);

  const distribution = new cloudfront.Distribution(scope, "AdminDistribution", {
    comment: "flashcards-open-source-app admin app",
    defaultRootObject: "index.html",
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
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

  return {
    bucket,
    distribution,
    customDomain,
  };
}

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface MediaAssetsProps {
  baseDomain: string;
  // Second host for the web bundle, owned by the CloudFront distribution and
  // already resolved (./cloudfront-additional-host.ts). The browser reads and
  // writes media with signed requests straight to this bucket
  // (apps/web/src/apiContracts/mediaAssets.ts), so the allowlist below, not the
  // API's, is the one a bundle served from that host is checked against.
  webAdditionalHost: string | undefined;
}

export interface MediaAssetsResult {
  bucket: s3.Bucket;
}

export function mediaAssets(scope: Construct, props: MediaAssetsProps): MediaAssetsResult {
  const bucket = new s3.Bucket(scope, "MediaAssetsBucket", {
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
    lifecycleRules: [
      {
        prefix: "media/uploads/",
        expiration: cdk.Duration.days(7),
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
      },
    ],
    cors: [
      {
        // Appended, never substituted: the primary host keeps serving browsers,
        // and with no additional host configured this list is unchanged.
        allowedOrigins: [
          `https://app.${props.baseDomain}`,
          "http://localhost:3000",
          "http://localhost:3001",
          ...(props.webAdditionalHost === undefined
            ? []
            : [`https://${props.webAdditionalHost}`]),
        ],
        allowedMethods: [
          s3.HttpMethods.GET,
          s3.HttpMethods.HEAD,
          s3.HttpMethods.PUT,
        ],
        allowedHeaders: ["*"],
        exposedHeaders: [
          "Accept-Ranges",
          "Content-Length",
          "Content-Range",
          "ETag",
          "x-amz-checksum-crc32",
          "x-amz-checksum-crc32c",
          "x-amz-checksum-sha256",
          "x-amz-checksum-type",
        ],
        maxAge: 3_600,
      },
    ],
  });

  return { bucket };
}

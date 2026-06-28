import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface MediaAssetsProps {
  baseDomain: string;
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
      },
    ],
    cors: [
      {
        allowedOrigins: [
          `https://app.${props.baseDomain}`,
          "http://localhost:3000",
          "http://localhost:3001",
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
          "x-amz-checksum-sha256",
        ],
        maxAge: 3_600,
      },
    ],
  });

  return { bucket };
}

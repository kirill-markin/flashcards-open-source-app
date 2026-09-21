import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export const geoLiteCountryObjectKey = "GeoLite2-Country.mmdb";
// Re-armed by every daily upload, so it counts from the write that `GeoLiteCountryDatabaseStaleAlarm`
// in ./monitoring.ts measures: once refreshes stop landing, this is what deletes the object.
export const geoLiteCountryObjectExpirationDays = 7;

export function geoLiteCountry(scope: Construct, backendFn: lambda.Function): s3.Bucket {
  const bucket = new s3.Bucket(scope, "GeoLiteCountryBucket", {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    versioned: false,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    lifecycleRules: [{
      expiration: cdk.Duration.days(geoLiteCountryObjectExpirationDays),
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
    }],
  });
  backendFn.addEnvironment("GEOLITE_COUNTRY_BUCKET", bucket.bucketName);
  backendFn.addEnvironment("GEOLITE_COUNTRY_OBJECT_KEY", geoLiteCountryObjectKey);
  backendFn.addToRolePolicy(new iam.PolicyStatement({
    actions: ["s3:GetObject"],
    resources: [bucket.arnForObjects(geoLiteCountryObjectKey)],
  }));
  new cdk.CfnOutput(scope, "GeoLiteCountryBucketName", { value: bucket.bucketName });
  return bucket;
}

import type { ProgressReviewSchedule } from "../types";
import { progressReviewScheduleBucketKeys } from "../types";

export type ProgressReviewScheduleValidationIssue = Readonly<{
  path: string;
  expected: string;
}>;

function joinPath(parentPath: string, key: string): string {
  return parentPath === "" ? key : `${parentPath}.${key}`;
}

function joinIndexPath(parentPath: string, index: number): string {
  return `${parentPath}[${index}]`;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function findProgressReviewScheduleValidationIssue(
  schedule: ProgressReviewSchedule,
  rootPath: string,
): ProgressReviewScheduleValidationIssue | null {
  const bucketsPath = joinPath(rootPath, "buckets");

  if (schedule.buckets.length !== progressReviewScheduleBucketKeys.length) {
    return {
      path: bucketsPath,
      expected: "complete review schedule bucket array",
    };
  }

  let bucketTotal = 0;
  for (let index = 0; index < progressReviewScheduleBucketKeys.length; index += 1) {
    const expectedBucketKey = progressReviewScheduleBucketKeys[index];
    const bucket = schedule.buckets[index];
    const bucketPath = joinIndexPath(bucketsPath, index);

    if (bucket?.key !== expectedBucketKey) {
      return {
        path: joinPath(bucketPath, "key"),
        expected: `bucket key ${expectedBucketKey}`,
      };
    }

    if (isNonNegativeInteger(bucket.count) === false) {
      return {
        path: joinPath(bucketPath, "count"),
        expected: "non-negative integer",
      };
    }

    bucketTotal += bucket.count;
  }

  if (isNonNegativeInteger(schedule.totalCards) === false) {
    return {
      path: joinPath(rootPath, "totalCards"),
      expected: "non-negative integer",
    };
  }

  if (schedule.totalCards !== bucketTotal) {
    return {
      path: joinPath(rootPath, "totalCards"),
      expected: `sum of bucket counts (${bucketTotal})`,
    };
  }

  return null;
}

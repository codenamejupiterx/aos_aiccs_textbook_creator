// src/lib/jobs.ts
/* eslint-disable */

import { PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE } from "@/lib/dynamo";

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface ChapterJobRow {
  userId: string;
  entity: string; // "chapterJob#<jobId>"
  jobId: string;
  status: JobStatus;

  // ✅ optional queue keys (Fix 2)
  gsi1pk?: string;
  gsi1sk?: string;

  // optional fields once finished / failed
  outputBucket?: string;
  outputKey?: string;
  errorMessage?: string;

  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Fix 2: GSI queue helpers                                            */
/* ------------------------------------------------------------------ */

function jobGsiPk(status: JobStatus) {
  switch (status) {
    case "pending":
      return "JOB#PENDING";
    case "running":
      return "JOB#RUNNING";
    case "done":
      return "JOB#DONE";
    case "failed":
      return "JOB#FAILED";
    default:
      return "JOB#UNKNOWN";
  }
}

function jobGsiSk(jobType: string, createdAtIso: string, jobId: string) {
  return `${jobType}#${createdAtIso}#${jobId}`;
}

/**
 * Create a new chapter job row with status = "pending".
 * Called from the chapter route when the user clicks "Generate".
 */
export async function createChapterJob(
  userId: string,
  jobId: string
): Promise<void> {
  const now = new Date().toISOString();
  console.log("[jobs] createChapterJob", { userId, jobId });

  const jobType = "chapterJob";
  const status: JobStatus = "pending";

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        userId,
        entity: `chapterJob#${jobId}`,
        type: jobType, // ✅ helpful for filtering/debugging
        jobId,
        status,
        createdAt: now,
        updatedAt: now,

        // ✅ Fix 2: queue keys
        gsi1pk: jobGsiPk(status),
        gsi1sk: jobGsiSk(jobType, now, jobId),
      },
    })
  );
}

// NOTE: you can keep this as-is. Fix 2 "proper" queue uses a GSI Query,
// but leaving this doesn’t break anything.
export async function getPendingJob(): Promise<ChapterJobRow | null> {
  console.log("[jobs] scanning table for pending chapter jobs...");

  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      Limit: 20,
    })
  );

  console.log("[jobs] raw scan items:", JSON.stringify(res.Items ?? [], null, 2));

  const item = (res.Items ?? []).find((it: any) => {
    return (
      it.status === "pending" &&
      typeof it.entity === "string" &&
      it.entity.startsWith("chapterJob#")
    );
  });

  if (!item) {
    console.log("[jobs] no matching pending chapter jobs");
    return null;
  }

  console.log("[jobs] found pending job:", {
    userId: item.userId,
    jobId: item.jobId,
    entity: item.entity,
  });

  return item as ChapterJobRow;
}

export async function markJobRunning(userId: string, jobId: string) {
  console.log("[jobs] markJobRunning", { userId, jobId });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { userId, entity: `chapterJob#${jobId}` },

      // ✅ Fix 2: move gsi1pk with status transitions
      UpdateExpression: "SET #status = :running, gsi1pk = :gpk, #u = :u",
      ExpressionAttributeNames: {
        "#status": "status",
        "#u": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":running": "running",
        ":gpk": jobGsiPk("running"),
        ":u": new Date().toISOString(),
      },
    })
  );
}

export async function markJobFailed(
  userId: string,
  jobId: string,
  errorMessage: string
) {
  console.log("[jobs] markJobFailed", { userId, jobId, errorMessage });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { userId, entity: `chapterJob#${jobId}` },

      // ✅ Fix 2: move gsi1pk with status transitions
      UpdateExpression: "SET #status = :failed, gsi1pk = :gpk, #err = :e, #u = :u",
      ExpressionAttributeNames: {
        "#status": "status",
        "#err": "errorMessage",
        "#u": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":failed": "failed",
        ":gpk": jobGsiPk("failed"),
        ":e": errorMessage,
        ":u": new Date().toISOString(),
      },
    })
  );
}

/**
 * Optional helper: if you ever want to mark done from here instead of inside
 * runChapterJob, you can call this.
 */
export async function markJobDone(
  userId: string,
  jobId: string,
  outputBucket: string,
  outputKey: string
): Promise<void> {
  console.log("[jobs] markJobDone", {
    userId,
    jobId,
    outputBucket,
    outputKey,
  });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { userId, entity: `chapterJob#${jobId}` },

      // ✅ Fix 2: move gsi1pk with status transitions
      UpdateExpression:
        "SET #status = :done, gsi1pk = :gpk, outputBucket = :b, outputKey = :k, #u = :u",
      ExpressionAttributeNames: {
        "#status": "status",
        "#u": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":done": "done",
        ":gpk": jobGsiPk("done"),
        ":b": outputBucket,
        ":k": outputKey,
        ":u": new Date().toISOString(),
      },
    })
  );
}

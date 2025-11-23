// src/lib/jobs.ts
/* eslint-disable */

import { PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE } from "@/lib/dynamo";
//import type { ChapterJobInput, ExportFormat } from "@/lib/chapterWorker";

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface ChapterJobRow {
  userId: string;
  entity: string; // "chapterJob#<jobId>"
  jobId: string;
  status: JobStatus;
  //input: ChapterJobInput;

  // optional fields once finished / failed
  outputBucket?: string;
  outputKey?: string;
  //format?: ExportFormat;
  errorMessage?: string;

  createdAt: string;
  updatedAt: string;
}

/**
 * Create a new chapter job row with status = "pending".
 * Called from the chapter route when the user clicks "Generate".
 */
export async function createChapterJob(
  userId: string,
  jobId: string,
  //input: ChapterJobInput
): Promise<void> {
  const now = new Date().toISOString();
  console.log("[jobs] createChapterJob", { userId, jobId });

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        userId,
        entity: `chapterJob#${jobId}`,
        jobId,
        status: "pending",
       // input,
        createdAt: now,
        updatedAt: now,
      },
    })
  );
}

// /**
//  * Grab ONE pending job from the table.
//  * (Using Scan is fine for your small job volume.)
//  */
// export async function getPendingJob(): Promise<ChapterJobRow | null> {
//   console.log("[jobs] scanning for pending jobs...");
//   const res = await ddb.send(
//     new ScanCommand({
//       TableName: TABLE,
//       FilterExpression:
//         "#status = :pending AND begins_with(#entity, :prefix)",
//       ExpressionAttributeNames: {
//         "#status": "status",
//         "#entity": "entity",
//       },
//       ExpressionAttributeValues: {
//         ":pending": "pending",
//         ":prefix": "chapterJob#",
//       },
//       Limit: 1,
//     })
//   );

//   const item = res.Items?.[0];
//   if (!item) {
//     console.log("[jobs] no pending jobs found");
//     return null;
//   }

//   console.log("[jobs] found pending job:", (item as any).jobId);
//   return item as ChapterJobRow;
// }



// **
//  * SUPER SIMPLE: scan table and filter in JS.
//  * This avoids any subtle FilterExpression issues.
//  */
export async function getPendingJob(): Promise<ChapterJobRow | null> {
  console.log("[jobs] scanning table for pending chapter jobs...");

  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      Limit: 20, // plenty for your current volume
    })
  );

  console.log(
    "[jobs] raw scan items:",
    JSON.stringify(res.Items ?? [], null, 2)
  );

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
      UpdateExpression: "SET #status = :running, #u = :u",
      ExpressionAttributeNames: {
        "#status": "status",
        "#u": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":running": "running",
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
      UpdateExpression:
        "SET #status = :failed, #err = :e, #u = :u",
      ExpressionAttributeNames: {
        "#status": "status",
        "#err": "errorMessage",
        "#u": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":failed": "failed",
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
  outputKey: string,
  //format: ExportFormat
): Promise<void> {
  console.log("[jobs] markJobDone", {
    userId,
    jobId,
    outputBucket,
    outputKey,
    //format,
  });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { userId, entity: `chapterJob#${jobId}` },
      UpdateExpression:
        "SET #status = :done, outputBucket = :b, outputKey = :k, format = :f, #u = :u",
      ExpressionAttributeNames: {
        "#status": "status",
        "#u": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":done": "done",
        ":b": outputBucket,
        ":k": outputKey,
        //":f": format,
        ":u": new Date().toISOString(),
      },
    })
  );
}

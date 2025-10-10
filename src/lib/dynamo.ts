// src/lib/dynamo.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const ENDPOINT = process.env.DDB_ENDPOINT; // optional (DynamoDB Local)
export const TABLE =
  process.env.DDB_TABLE || process.env.DYNAMO_TABLE || "TextbookCreator";

// Low-level client + DocumentClient (marshals JS objects automatically)
const client = new DynamoDBClient({ region: REGION, endpoint: ENDPOINT });
export const ddb = DynamoDBDocumentClient.from(client);

/** Basic puts/gets --------------------------------------------------------- */
export async function putItem(item: Record<string, any>) {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}

/**
 * Get by actual table keys. Matches your schema:
 *   PK: userId (string, plain email, e.g. "benjaforge@gmail.com")
 *   SK: entity (string, e.g. "passion#<uuid>")
 */
export async function getItem(userId: string, entity: string) {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { userId, entity } })
  );
  return res.Item ?? null;
}

/**
 * Alias/wrapper kept for clarity and for callers expecting this name.
 * Same behavior as getItem(userId, entity).
 */
export async function getItemByUserEntity(userId: string, entity: string) {
  return getItem(userId, entity);
}

export async function queryByUser(userId: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "#u = :u",
      ExpressionAttributeNames: { "#u": "userId" },
      ExpressionAttributeValues: { ":u": userId },
    })
  );
  return res.Items ?? [];
}

/** Patch/update a passion row (e.g., flip status -> "ready") --------------- */
export async function updatePassion(
  userId: string,
  entity: string, // must be "passion#<uuid>"
  attrs: Record<string, any>
) {
  const names: Record<string, string> = {};
  const values: Record<string, any> = {};
  const sets: string[] = [];

  Object.entries(attrs).forEach(([k, v], i) => {
    const nk = `#n${i}`;
    const vk = `:v${i}`;
    names[nk] = k;
    values[vk] = v;
    sets.push(`${nk} = ${vk}`);
  });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { userId, entity },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

/** List all "passion" items for a user (raw Items) ------------------------ */
export async function listPassions(userId: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "userId = :u AND begins_with(#e, :pfx)",
      ExpressionAttributeNames: { "#e": "entity" },
      ExpressionAttributeValues: { ":u": userId, ":pfx": "passion#" },
      ScanIndexForward: false,
    })
  );
  return res.Items ?? [];
}

/** Convenience helpers kept for backward compatibility -------------------- */
export async function savePassion(item: {
  userId: string;
  entity: string; // "passion#<id>"
  id: string;
  ownerEmail: string;
  createdAt: string;
  subject: string;
  passion: string;
  ageRange: string;
  notes?: string;
  passionLikes?: string[];
}) {
  await putItem(item);
  return item.id;
}

export async function listPassionsForUser(userId: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "#u = :u AND begins_with(#e, :pfx)",
      ExpressionAttributeNames: { "#u": "userId", "#e": "entity" },
      ExpressionAttributeValues: { ":u": userId, ":pfx": "passion#" },
      ScanIndexForward: false,
    })
  );
  return (res.Items ?? []).map((it: any) => ({
    id: it.id ?? it.passionId, // tolerate either field name
    createdAt: it.createdAt,
    subject: it.subject,
    passion: it.passion,
    ageRange: it.ageRange,
  }));
}

export async function getPassionById(userId: string, passionId: string) {
  const entity = `passion#${passionId}`; // matches your table
  return getItem(userId, entity);
}

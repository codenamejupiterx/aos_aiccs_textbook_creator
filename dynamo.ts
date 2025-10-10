import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE  = process.env.DDB_TABLE || "TextbookCreator";

const ddb = new DynamoDBClient({ region: REGION });

export async function putItem(item: Record<string, any>) {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}

export async function updatePassion(
  userId: string,
  entity: string,
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

export async function listPassions(userId: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "userId = :u AND begins_with(#e, :p)",
      ExpressionAttributeValues: { ":u": userId, ":p": "passion#" },
      ExpressionAttributeNames: { "#e": "entity" },
      ScanIndexForward: false,
    })
  );
  return res.Items ?? [];
}

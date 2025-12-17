/* eslint-disable */
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import "dotenv/config";
const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DDB_TABLE!;
const ddb = new DynamoDBClient({ region: REGION });

async function main() {
  if (!TABLE) throw new Error("DDB_TABLE missing");

  console.log("Scanning for items with ggsi1pk...");

  let lastKey: any | undefined;

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        ProjectionExpression: "userId, entity, ggsi1pk, gsi1pk",
        FilterExpression: "attribute_exists(ggsi1pk) AND attribute_not_exists(gsi1pk)",
        ExclusiveStartKey: lastKey,
      })
    );

    const items = res.Items || [];
    console.log(`Found ${items.length} items to fix in this page`);

    for (const it of items) {
      const userId = it.userId?.S;
      const entity = it.entity?.S;
      const pending = it.ggsi1pk?.S;

      if (!userId || !entity || !pending) continue;

      await ddb.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: {
            userId: { S: userId },
            entity: { S: entity },
          },
          UpdateExpression: "SET gsi1pk = :v REMOVE ggsi1pk",
          ExpressionAttributeValues: {
            ":v": { S: pending },
          },
        })
      );

      console.log("Fixed:", entity);
    }

    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

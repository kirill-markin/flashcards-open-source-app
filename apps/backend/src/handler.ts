import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { query } from "./db";

function json(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> {
  if (!event.body) {
    return {};
  }
  try {
    return JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  if (routeKey === "GET /health") {
    const result = await query("SELECT now() AS now", []);
    return json(200, {
      status: "ok",
      service: "flashcards-open-source-app-backend",
      dbTime: result.rows[0]?.["now"] ?? null,
    });
  }

  if (routeKey === "POST /sync/push") {
    const body = parseBody(event);
    return json(200, {
      status: "accepted",
      endpoint: "sync/push",
      note: "Sync push v1 stub. Replace with full outbox processing.",
      receivedKeys: Object.keys(body),
    });
  }

  if (routeKey === "POST /sync/pull") {
    const body = parseBody(event);
    return json(200, {
      status: "accepted",
      endpoint: "sync/pull",
      note: "Sync pull v1 stub. Replace with cursor-based delta sync.",
      receivedKeys: Object.keys(body),
    });
  }

  return json(404, { error: "Route not found", routeKey });
}

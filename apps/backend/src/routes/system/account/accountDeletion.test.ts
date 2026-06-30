import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("API Gateway predeclares POST /me/delete", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(apiGatewaySource, /me\.addResource\("delete"\)\.addMethod\("POST", integration\);/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("API Gateway proxy forwards POST /me/delete", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /restApi\.root\.addResource\("\{proxy\+}"\)\.addMethod\("ANY", integration\);/,
  );
});

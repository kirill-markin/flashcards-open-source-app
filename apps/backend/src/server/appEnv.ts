import type { LambdaEvent } from "hono/aws-lambda";

export type AppEnv = {
  Bindings: {
    event?: LambdaEvent;
  };
  Variables: {
    requestId: string;
    clientAppVersion: string | null;
    clientPlatform: string | null;
    clientOsName: string | null;
    clientDeviceType: string | null;
  };
};

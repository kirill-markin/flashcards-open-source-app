export type AppEnv = {
  Variables: {
    requestId: string;
    clientAppVersion: string | null;
    clientPlatform: string | null;
  };
};

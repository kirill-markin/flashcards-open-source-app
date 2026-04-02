export type ChatRunState = "idle" | "running" | "interrupted";
export type ChatComposerAction = "send" | "stop";

export function isChatRunActive(runState: ChatRunState): boolean {
  return runState === "running";
}

export function getChatComposerAction(runState: ChatRunState): ChatComposerAction {
  return isChatRunActive(runState) ? "stop" : "send";
}

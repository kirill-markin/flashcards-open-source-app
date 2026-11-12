import { createContext, useContext, useRef, useState, type ReactElement, type ReactNode } from "react";

type AiImportTarget = Readonly<{
  workspaceId: string;
  sessionId: string;
  draftUpdatedAt: number;
}>;

type AiImportHandoff = Readonly<{
  target: AiImportTarget | null;
  arm: (target: AiImportTarget) => void;
  consume: (target: AiImportTarget) => boolean;
}>;

const AiImportHandoffContext = createContext<AiImportHandoff | null>(null);

export function AiImportHandoffProvider(props: Readonly<{ children: ReactNode }>): ReactElement {
  const [target, setTarget] = useState<AiImportTarget | null>(null);
  const targetRef = useRef<AiImportTarget | null>(null);

  function arm(nextTarget: AiImportTarget): void {
    targetRef.current = nextTarget;
    setTarget(nextTarget);
  }

  function consume(expectedTarget: AiImportTarget): boolean {
    if (targetRef.current !== expectedTarget) {
      return false;
    }

    targetRef.current = null;
    setTarget(null);
    return true;
  }

  return (
    <AiImportHandoffContext.Provider value={{ target, arm, consume }}>
      {props.children}
    </AiImportHandoffContext.Provider>
  );
}

export function useAiImportHandoff(): AiImportHandoff | null {
  return useContext(AiImportHandoffContext);
}

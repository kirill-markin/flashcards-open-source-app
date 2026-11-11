import { createContext, useContext, useRef, useState, type ReactElement, type ReactNode } from "react";

type AnkiImportTarget = Readonly<{
  workspaceId: string;
  sessionId: string;
  draftUpdatedAt: number;
}>;

type AnkiImportHandoff = Readonly<{
  target: AnkiImportTarget | null;
  arm: (target: AnkiImportTarget) => void;
  consume: (target: AnkiImportTarget) => boolean;
}>;

const AnkiImportHandoffContext = createContext<AnkiImportHandoff | null>(null);

export function AnkiImportHandoffProvider(props: Readonly<{ children: ReactNode }>): ReactElement {
  const [target, setTarget] = useState<AnkiImportTarget | null>(null);
  const targetRef = useRef<AnkiImportTarget | null>(null);

  function arm(nextTarget: AnkiImportTarget): void {
    targetRef.current = nextTarget;
    setTarget(nextTarget);
  }

  function consume(expectedTarget: AnkiImportTarget): boolean {
    if (targetRef.current !== expectedTarget) {
      return false;
    }

    targetRef.current = null;
    setTarget(null);
    return true;
  }

  return (
    <AnkiImportHandoffContext.Provider value={{ target, arm, consume }}>
      {props.children}
    </AnkiImportHandoffContext.Provider>
  );
}

export function useAnkiImportHandoff(): AnkiImportHandoff | null {
  return useContext(AnkiImportHandoffContext);
}

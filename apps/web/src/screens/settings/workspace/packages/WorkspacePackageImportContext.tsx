import { createContext, useContext, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { WorkspacePackageImportConfirmSummary } from "../../../../types";

type PackageImportState =
  | Readonly<{ stage: "confirming" | "syncing"; fileName: string }>
  | Readonly<{ stage: "confirmFailed"; message: string }>
  | Readonly<{ stage: "syncFailed"; fileName: string; summary: WorkspacePackageImportConfirmSummary; message: string }>
  | Readonly<{ stage: "complete"; summary: WorkspacePackageImportConfirmSummary }>;

type PackageImportContextValue = Readonly<{
  states: ReadonlyMap<string, PackageImportState>;
  read: (destination: string) => PackageImportState | undefined;
  update: (destination: string, state: PackageImportState | null) => void;
}>;

const WorkspacePackageImportContext = createContext<PackageImportContextValue | null>(null);

export function WorkspacePackageImportProvider({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const [states, setStates] = useState<ReadonlyMap<string, PackageImportState>>(new Map());
  const statesRef = useRef(states);

  function update(destination: string, state: PackageImportState | null): void {
    const next = new Map(statesRef.current);
    if (state === null) {
      next.delete(destination);
    } else {
      next.set(destination, state);
    }
    statesRef.current = next;
    setStates(next);
  }

  return (
    <WorkspacePackageImportContext.Provider value={{ states, read: (destination) => statesRef.current.get(destination), update }}>
      {children}
    </WorkspacePackageImportContext.Provider>
  );
}

export function useWorkspacePackageImport(destination: string) {
  const context = useContext(WorkspacePackageImportContext);
  if (context === null) {
    throw new Error("WorkspacePackageImportProvider is missing");
  }

  return {
    state: context.states.get(destination),
    read: () => context.read(destination),
    update: (state: PackageImportState | null) => context.update(destination, state),
  };
}

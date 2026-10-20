import { useCallback, useEffect, useRef, useState } from "react";
import { loadCatalogPackageInstallContext } from "../../api";
import type { CatalogPackageInstallContext } from "../../types/catalog";

export type CatalogPackageInstallContextLoadState =
  | Readonly<{ status: "idle" | "loading" }>
  | Readonly<{ status: "ready"; context: CatalogPackageInstallContext }>
  | Readonly<{ status: "error"; error: unknown }>;

export type CatalogPackageInstallContextLoader = Readonly<{
  state: CatalogPackageInstallContextLoadState;
  retry: () => void;
}>;

export function useCatalogPackageInstallContext(
  packageVersionId: string,
  userId: string | null,
): CatalogPackageInstallContextLoader {
  const [retryRevision, setRetryRevision] = useState<number>(0);
  const [loaded, setLoaded] = useState<Readonly<{
    ownerRevision: number;
    state: CatalogPackageInstallContextLoadState;
  }> | null>(null);
  const ownerRef = useRef({ packageVersionId, userId, retryRevision, revision: 0 });
  if (ownerRef.current.packageVersionId !== packageVersionId
    || ownerRef.current.userId !== userId
    || ownerRef.current.retryRevision !== retryRevision) {
    ownerRef.current = { packageVersionId, userId, retryRevision, revision: ownerRef.current.revision + 1 };
  }
  const ownerRevision = ownerRef.current.revision;
  const retry = useCallback((): void => {
    setRetryRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    if (userId === null) {
      return;
    }
    let isCurrent = true;
    void loadCatalogPackageInstallContext(packageVersionId).then(
      (context) => {
        if (isCurrent) {
          setLoaded({ ownerRevision, state: { status: "ready", context } });
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setLoaded({ ownerRevision, state: { status: "error", error } });
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [ownerRevision, packageVersionId, userId]);

  const state: CatalogPackageInstallContextLoadState = userId === null
    ? { status: "idle" }
    : loaded !== null
      && loaded.ownerRevision === ownerRevision
      ? loaded.state
      : { status: "loading" };
  return { state, retry };
}

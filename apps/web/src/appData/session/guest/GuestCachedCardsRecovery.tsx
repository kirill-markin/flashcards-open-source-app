import { useEffect, useState, type ReactElement } from "react";
import { useI18n } from "../../../i18n";
import { MathText } from "../../../components/MathText";
import { loadAllActiveCardsForSql } from "../../../localDb/cards/cards";
import { normalizeCaughtError } from "../../../observability/webObservability";
import type { Card } from "../../../types";
import { loadCachedBrowserGuestOwner } from "./browserGuestSession";
import { runWithBrowserGuestLock, subscribeToBrowserGuestChanges } from "./browserGuestStorage";

type Props = Readonly<{
  userId: string;
  workspaceId: string;
  errorMessage: string;
  retry: () => Promise<void>;
}>;

export function GuestCachedCardsRecovery(props: Props): ReactElement {
  const { userId, workspaceId, errorMessage, retry } = props;
  const { t } = useI18n();
  const [cards, setCards] = useState<ReadonlyArray<Card>>([]);
  const [readError, setReadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    let current = true;
    const stopReading = subscribeToBrowserGuestChanges(() => {
      current = false;
      setCards([]);
      setIsLoading(false);
      setReadError(t("guest.recovery"));
    });
    void runWithBrowserGuestLock("shared", async () => {
      const owner = await loadCachedBrowserGuestOwner();
      if (owner?.linkedUserId !== userId || owner.linkedWorkspaceId !== workspaceId) {
        throw new Error("Cached cards do not match the saved guest owner.");
      }
      const cached = await loadAllActiveCardsForSql(workspaceId);
      if (current) {
        setCards(cached);
        setIsLoading(false);
      }
    }).catch((error: unknown) => {
      if (current) {
        setReadError(normalizeCaughtError(error).message);
        setIsLoading(false);
      }
    });
    return () => { current = false; stopReading(); };
  }, [userId, workspaceId, t]);

  return (
    <main className="page-state" data-testid="guest-cache-recovery">
      <section className="panel state-panel">
        <h1 className="title">{t("cardsScreen.title")}</h1>
        <p>{t("guest.recovery")}</p>
        <p className="error-banner" role="status">{errorMessage}</p>
        <button className="primary-btn" type="button" onClick={() => void retry()}>{t("common.retry")}</button>
        {readError !== "" && <p className="error-banner">{readError}</p>}
        {isLoading && <p>{t("loading.generic")}</p>}
        {cards.map((card) => (
          <article className="panel" key={card.cardId} data-testid="guest-cached-card">
            <h2>{t("cardsScreen.table.front")}</h2>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><MathText text={card.frontText} /></div>
            <h2>{t("cardsScreen.table.back")}</h2>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><MathText text={card.backText} /></div>
          </article>
        ))}
      </section>
    </main>
  );
}

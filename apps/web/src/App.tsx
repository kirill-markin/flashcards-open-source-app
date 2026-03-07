import { useEffect, useState } from "react";
import { ApiError, buildLoginUrl, createCard, getCards, getReviewQueue, getSession, submitReview } from "./api";
import type { Card, SessionInfo } from "./types";

type LoadState = "loading" | "ready" | "redirecting" | "error";

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "new";
  }

  return new Date(value).toLocaleString();
}

export default function App(): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [cards, setCards] = useState<ReadonlyArray<Card>>([]);
  const [reviewQueue, setReviewQueue] = useState<ReadonlyArray<Card>>([]);
  const [frontText, setFrontText] = useState<string>("");
  const [backText, setBackText] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmittingCard, setIsSubmittingCard] = useState<boolean>(false);
  const [activeReviewCardId, setActiveReviewCardId] = useState<string>("");

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize(): Promise<void> {
    setLoadState("loading");
    setErrorMessage("");

    try {
      const currentSession = await getSession();
      setSession(currentSession);
      await reloadData();
      setLoadState("ready");
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        setLoadState("redirecting");
        window.location.href = buildLoginUrl();
        return;
      }

      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function reloadData(): Promise<void> {
    const [nextCards, nextQueue] = await Promise.all([getCards(), getReviewQueue()]);
    setCards(nextCards);
    setReviewQueue(nextQueue);
  }

  async function handleCreateCard(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (frontText.trim() === "" || backText.trim() === "") {
      setErrorMessage("frontText and backText are required");
      return;
    }

    setIsSubmittingCard(true);
    setErrorMessage("");

    try {
      await createCard(frontText, backText);
      setFrontText("");
      setBackText("");
      await reloadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmittingCard(false);
    }
  }

  async function handleReview(cardId: string, rating: 0 | 1 | 2 | 3): Promise<void> {
    setActiveReviewCardId(cardId);
    setErrorMessage("");

    try {
      await submitReview(cardId, rating);
      await reloadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setActiveReviewCardId("");
    }
  }

  if (loadState === "loading" || loadState === "redirecting") {
    return (
      <main className="page">
        <section className="panel panel-center">
          <p className="muted">{loadState === "redirecting" ? "Redirecting to login..." : "Loading..."}</p>
        </section>
      </main>
    );
  }

  if (loadState === "error") {
    return (
      <main className="page">
        <section className="panel panel-center">
          <h1 className="title">Flashcards</h1>
          <p className="error">{errorMessage}</p>
          <button className="button" type="button" onClick={() => void initialize()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="header">
        <div>
          <p className="eyebrow">First launch</p>
          <h1 className="title">Flashcards</h1>
        </div>
        <div className="session-box">
          <div>{session?.profile.email ?? session?.userId}</div>
          <div className="muted">workspace {session?.workspaceId}</div>
          <div className="muted">auth {session?.authTransport}</div>
        </div>
      </section>

      {errorMessage !== "" ? <p className="error-banner">{errorMessage}</p> : null}

      <section className="grid">
        <article className="panel">
          <h2 className="panel-title">Create card</h2>
          <form className="stack" onSubmit={(event) => void handleCreateCard(event)}>
            <label className="field">
              <span>Front</span>
              <textarea value={frontText} onChange={(event) => setFrontText(event.target.value)} rows={4} />
            </label>
            <label className="field">
              <span>Back</span>
              <textarea value={backText} onChange={(event) => setBackText(event.target.value)} rows={5} />
            </label>
            <button className="button" type="submit" disabled={isSubmittingCard}>
              {isSubmittingCard ? "Creating..." : "Create card"}
            </button>
          </form>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Review queue</h2>
            <span className="counter">{reviewQueue.length}</span>
          </div>
          <div className="stack">
            {reviewQueue.length === 0 ? <p className="muted">No due cards.</p> : null}
            {reviewQueue.map((card) => (
              <section key={card.cardId} className="card">
                <div className="card-front">{card.frontText}</div>
                <div className="card-back">{card.backText}</div>
                <div className="muted">due {formatTimestamp(card.dueAt)}</div>
                <div className="rating-row">
                  {[0, 1, 2, 3].map((rating) => (
                    <button
                      key={rating}
                      className="button button-small"
                      type="button"
                      disabled={activeReviewCardId === card.cardId}
                      onClick={() => void handleReview(card.cardId, rating as 0 | 1 | 2 | 3)}
                    >
                      {activeReviewCardId === card.cardId ? "..." : rating}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Cards</h2>
          <span className="counter">{cards.length}</span>
        </div>
        <div className="cards-list">
          {cards.map((card) => (
            <article key={card.cardId} className="list-row">
              <div>
                <div className="list-front">{card.frontText}</div>
                <div className="list-back">{card.backText}</div>
              </div>
              <div className="list-meta">
                <div>due {formatTimestamp(card.dueAt)}</div>
                <div>reps {card.reps}</div>
                <div>lapses {card.lapses}</div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ApiError,
  createDeck,
  buildLoginUrl,
  createCard,
  getCard,
  getCards,
  getDecks,
  getReviewQueue,
  getSession,
  submitReview,
  updateCard,
} from "./api";
import type { Card, CreateCardInput, CreateDeckInput, Deck, SessionInfo, UpdateCardInput } from "./types";

type LoadState = "loading" | "ready" | "redirecting" | "error";

type AppDataContextValue = Readonly<{
  loadState: LoadState;
  session: SessionInfo | null;
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
  reviewQueue: ReadonlyArray<Card>;
  errorMessage: string;
  setErrorMessage: (message: string) => void;
  initialize: () => Promise<void>;
  reloadData: () => Promise<void>;
  getCardById: (cardId: string) => Promise<Card>;
  createCardItem: (input: CreateCardInput) => Promise<Card>;
  createDeckItem: (input: CreateDeckInput) => Promise<Deck>;
  updateCardItem: (cardId: string, input: UpdateCardInput) => Promise<Card>;
  submitReviewItem: (cardId: string, rating: 0 | 1 | 2 | 3) => Promise<Card>;
}>;

const AppDataContext = createContext<AppDataContextValue | null>(null);

function upsertCard(
  items: ReadonlyArray<Card>,
  nextCard: Card,
): ReadonlyArray<Card> {
  const existingIndex = items.findIndex((item) => item.cardId === nextCard.cardId);
  if (existingIndex === -1) {
    return [nextCard, ...items];
  }

  return items.map((item) => (item.cardId === nextCard.cardId ? nextCard : item));
}

function upsertDeck(
  items: ReadonlyArray<Deck>,
  nextDeck: Deck,
): ReadonlyArray<Deck> {
  const existingIndex = items.findIndex((item) => item.deckId === nextDeck.deckId);
  if (existingIndex === -1) {
    return [nextDeck, ...items];
  }

  return items.map((item) => (item.deckId === nextDeck.deckId ? nextDeck : item));
}

type Props = Readonly<{
  children: ReactNode;
}>;

export function AppDataProvider(props: Props): ReactElement {
  const { children } = props;
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [cards, setCards] = useState<ReadonlyArray<Card>>([]);
  const [decks, setDecks] = useState<ReadonlyArray<Deck>>([]);
  const [reviewQueue, setReviewQueue] = useState<ReadonlyArray<Card>>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function reloadData(): Promise<void> {
    const [nextCards, nextDecks, nextQueue] = await Promise.all([getCards(), getDecks(), getReviewQueue()]);
    setCards(nextCards);
    setDecks(nextDecks);
    setReviewQueue(nextQueue);
  }

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

  useEffect(() => {
    void initialize();
  }, []);

  async function getCardById(cardId: string): Promise<Card> {
    const existingCard = cards.find((card) => card.cardId === cardId);
    if (existingCard !== undefined) {
      return existingCard;
    }

    const nextCard = await getCard(cardId);
    setCards((currentCards) => upsertCard(currentCards, nextCard));
    return nextCard;
  }

  async function createCardItem(input: CreateCardInput): Promise<Card> {
    const card = await createCard(input);
    await reloadData();
    setCards((currentCards) => upsertCard(currentCards, card));
    return card;
  }

  async function createDeckItem(input: CreateDeckInput): Promise<Deck> {
    const deck = await createDeck(input);
    await reloadData();
    setDecks((currentDecks) => upsertDeck(currentDecks, deck));
    return deck;
  }

  async function updateCardItem(cardId: string, input: UpdateCardInput): Promise<Card> {
    const card = await updateCard(cardId, input);
    await reloadData();
    setCards((currentCards) => upsertCard(currentCards, card));
    return card;
  }

  async function submitReviewItem(cardId: string, rating: 0 | 1 | 2 | 3): Promise<Card> {
    const card = await submitReview(cardId, rating);
    await reloadData();
    return card;
  }

  return (
    <AppDataContext.Provider
      value={{
        loadState,
        session,
        cards,
        decks,
        reviewQueue,
        errorMessage,
        setErrorMessage,
        initialize,
        reloadData,
        getCardById,
        createCardItem,
        createDeckItem,
        updateCardItem,
        submitReviewItem,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (context === null) {
    throw new Error("useAppData must be used within AppDataProvider");
  }

  return context;
}

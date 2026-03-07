import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
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

type SessionLoadState = "loading" | "ready" | "redirecting" | "error";
type ResourceLoadStatus = "idle" | "loading" | "ready" | "error";

export type ResourceState<Item> = Readonly<{
  status: ResourceLoadStatus;
  items: ReadonlyArray<Item>;
  errorMessage: string;
  hasLoaded: boolean;
}>;

type AppDataContextValue = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionErrorMessage: string;
  session: SessionInfo | null;
  cardsState: ResourceState<Card>;
  decksState: ResourceState<Deck>;
  reviewQueueState: ResourceState<Card>;
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
  reviewQueue: ReadonlyArray<Card>;
  errorMessage: string;
  setErrorMessage: (message: string) => void;
  initialize: () => Promise<void>;
  ensureCardsLoaded: () => Promise<void>;
  ensureDecksLoaded: () => Promise<void>;
  ensureReviewQueueLoaded: () => Promise<void>;
  refreshCards: () => Promise<void>;
  refreshDecks: () => Promise<void>;
  refreshReviewQueue: () => Promise<void>;
  getCardById: (cardId: string) => Promise<Card>;
  createCardItem: (input: CreateCardInput) => Promise<Card>;
  createDeckItem: (input: CreateDeckInput) => Promise<Deck>;
  updateCardItem: (cardId: string, input: UpdateCardInput) => Promise<Card>;
  submitReviewItem: (cardId: string, rating: 0 | 1 | 2 | 3) => Promise<Card>;
}>;

const AppDataContext = createContext<AppDataContextValue | null>(null);

function createIdleResourceState<Item>(): ResourceState<Item> {
  return {
    status: "idle",
    items: [],
    errorMessage: "",
    hasLoaded: false,
  };
}

function createLoadingResourceState<Item>(currentState: ResourceState<Item>): ResourceState<Item> {
  return {
    status: "loading",
    items: currentState.items,
    errorMessage: "",
    hasLoaded: currentState.hasLoaded,
  };
}

function createReadyResourceState<Item>(items: ReadonlyArray<Item>): ResourceState<Item> {
  return {
    status: "ready",
    items,
    errorMessage: "",
    hasLoaded: true,
  };
}

function createErrorResourceState<Item>(
  currentState: ResourceState<Item>,
  errorMessage: string,
): ResourceState<Item> {
  return {
    status: "error",
    items: currentState.items,
    errorMessage,
    hasLoaded: currentState.hasLoaded,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

function replaceCardIfPresent(
  items: ReadonlyArray<Card>,
  nextCard: Card,
): ReadonlyArray<Card> {
  const existingIndex = items.findIndex((item) => item.cardId === nextCard.cardId);
  if (existingIndex === -1) {
    return items;
  }

  return items.map((item) => (item.cardId === nextCard.cardId ? nextCard : item));
}

type Props = Readonly<{
  children: ReactNode;
}>;

export function AppDataProvider(props: Props): ReactElement {
  const { children } = props;
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>("loading");
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string>("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [cardsState, setCardsState] = useState<ResourceState<Card>>(createIdleResourceState<Card>());
  const [decksState, setDecksState] = useState<ResourceState<Deck>>(createIdleResourceState<Deck>());
  const [reviewQueueState, setReviewQueueState] = useState<ResourceState<Card>>(createIdleResourceState<Card>());
  const [errorMessage, setErrorMessage] = useState<string>("");
  const cardsRequestRef = useRef<Promise<void> | null>(null);
  const decksRequestRef = useRef<Promise<void> | null>(null);
  const reviewQueueRequestRef = useRef<Promise<void> | null>(null);

  const cards = cardsState.items;
  const decks = decksState.items;
  const reviewQueue = reviewQueueState.items;

  const loadResource = useCallback(async function loadResource<Item>(
    hasLoaded: boolean,
    requestRef: MutableRefObject<Promise<void> | null>,
    setState: Dispatch<SetStateAction<ResourceState<Item>>>,
    fetchItems: () => Promise<ReadonlyArray<Item>>,
    forceRefresh: boolean,
  ): Promise<void> {
    if (!forceRefresh && hasLoaded) {
      return;
    }

    const activeRequest = requestRef.current;
    if (activeRequest !== null) {
      return activeRequest;
    }

    setState((currentState) => createLoadingResourceState(currentState));
    const request = (async (): Promise<void> => {
      try {
        const items = await fetchItems();
        setState(createReadyResourceState(items));
      } catch (error) {
        const nextErrorMessage = getErrorMessage(error);
        setState((currentState) => createErrorResourceState(currentState, nextErrorMessage));
        throw error;
      } finally {
        requestRef.current = null;
      }
    })();
    requestRef.current = request;
    return request;
  }, []);

  const ensureCardsLoaded = useCallback(async function ensureCardsLoaded(): Promise<void> {
    return loadResource(cardsState.hasLoaded, cardsRequestRef, setCardsState, getCards, false);
  }, [cardsState.hasLoaded, loadResource]);

  const ensureDecksLoaded = useCallback(async function ensureDecksLoaded(): Promise<void> {
    return loadResource(decksState.hasLoaded, decksRequestRef, setDecksState, getDecks, false);
  }, [decksState.hasLoaded, loadResource]);

  const ensureReviewQueueLoaded = useCallback(async function ensureReviewQueueLoaded(): Promise<void> {
    return loadResource(reviewQueueState.hasLoaded, reviewQueueRequestRef, setReviewQueueState, getReviewQueue, false);
  }, [loadResource, reviewQueueState.hasLoaded]);

  const refreshCards = useCallback(async function refreshCards(): Promise<void> {
    return loadResource(cardsState.hasLoaded, cardsRequestRef, setCardsState, getCards, true);
  }, [cardsState.hasLoaded, loadResource]);

  const refreshDecks = useCallback(async function refreshDecks(): Promise<void> {
    return loadResource(decksState.hasLoaded, decksRequestRef, setDecksState, getDecks, true);
  }, [decksState.hasLoaded, loadResource]);

  const refreshReviewQueue = useCallback(async function refreshReviewQueue(): Promise<void> {
    return loadResource(reviewQueueState.hasLoaded, reviewQueueRequestRef, setReviewQueueState, getReviewQueue, true);
  }, [loadResource, reviewQueueState.hasLoaded]);

  const initialize = useCallback(async function initialize(): Promise<void> {
    setSessionLoadState("loading");
    setSessionErrorMessage("");
    setErrorMessage("");

    try {
      const currentSession = await getSession();
      setSession(currentSession);
      setSessionLoadState("ready");
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        setSessionLoadState("redirecting");
        window.location.href = buildLoginUrl();
        return;
      }

      setSessionLoadState("error");
      setSessionErrorMessage(getErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const getCardById = useCallback(async function getCardById(cardId: string): Promise<Card> {
    const existingCard = cards.find((card) => card.cardId === cardId);
    if (existingCard !== undefined) {
      return existingCard;
    }

    const nextCard = await getCard(cardId);
    setCardsState((currentState) => createReadyResourceState(upsertCard(currentState.items, nextCard)));
    return nextCard;
  }, [cards]);

  const createCardItem = useCallback(async function createCardItem(input: CreateCardInput): Promise<Card> {
    const card = await createCard(input);
    await refreshCards();
    return card;
  }, [refreshCards]);

  const createDeckItem = useCallback(async function createDeckItem(input: CreateDeckInput): Promise<Deck> {
    const deck = await createDeck(input);
    await refreshDecks();
    return deck;
  }, [refreshDecks]);

  const updateCardItem = useCallback(async function updateCardItem(cardId: string, input: UpdateCardInput): Promise<Card> {
    const card = await updateCard(cardId, input);
    setCardsState((currentState) => createReadyResourceState(upsertCard(currentState.items, card)));

    if (reviewQueueState.hasLoaded) {
      setReviewQueueState((currentState) => createReadyResourceState(replaceCardIfPresent(currentState.items, card)));
    }

    return card;
  }, [reviewQueueState.hasLoaded]);

  const submitReviewItem = useCallback(async function submitReviewItem(cardId: string, rating: 0 | 1 | 2 | 3): Promise<Card> {
    const card = await submitReview(cardId, rating);

    await refreshReviewQueue();
    if (cardsState.hasLoaded) {
      await refreshCards();
    }

    return card;
  }, [cardsState.hasLoaded, refreshCards, refreshReviewQueue]);

  return (
    <AppDataContext.Provider
      value={{
        sessionLoadState,
        sessionErrorMessage,
        session,
        cardsState,
        decksState,
        reviewQueueState,
        cards,
        decks,
        reviewQueue,
        errorMessage,
        setErrorMessage,
        initialize,
        ensureCardsLoaded,
        ensureDecksLoaded,
        ensureReviewQueueLoaded,
        refreshCards,
        refreshDecks,
        refreshReviewQueue,
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

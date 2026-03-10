import type { ResourceState } from "./types";

export function createIdleResourceState<Item>(): ResourceState<Item> {
  return {
    status: "idle",
    items: [],
    errorMessage: "",
    hasLoaded: false,
  };
}

export function createLoadingResourceState<Item>(currentState: ResourceState<Item>): ResourceState<Item> {
  return {
    status: "loading",
    items: currentState.items,
    errorMessage: "",
    hasLoaded: currentState.hasLoaded,
  };
}

export function createReadyResourceState<Item>(items: ReadonlyArray<Item>): ResourceState<Item> {
  return {
    status: "ready",
    items,
    errorMessage: "",
    hasLoaded: true,
  };
}

export function createErrorResourceState<Item>(
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

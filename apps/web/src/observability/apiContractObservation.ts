import { ApiContractError } from "../api";
import {
  captureWebException,
  type WebObservationScope,
} from "./webObservability";

export type ApiContractObservationFeature = "auth" | "cards" | "review" | "progress" | "settings" | "sync";

type ApiContractObservationContext = Readonly<{
  feature: ApiContractObservationFeature;
  sourceAction: string;
  userId: string | null;
  workspaceId: string | null;
  installationId: string | null;
}>;

type RouteApiContractObservationContext = Readonly<{
  sourceAction: string;
  userId: string | null;
  workspaceId: string | null;
  installationId: string | null;
}>;

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function resolveApiContractObservationFeature(route: string | null): ApiContractObservationFeature | null {
  if (route === null) {
    return null;
  }

  const routePathWithQueryRemoved = route.split("?", 1)[0] ?? route;
  const routePath = routePathWithQueryRemoved.split("#", 1)[0] ?? routePathWithQueryRemoved;

  if (routePath === "/cards" || routePath.startsWith("/cards/")) {
    return "cards";
  }

  if (routePath === "/review" || routePath.startsWith("/review/")) {
    return "review";
  }

  if (routePath === "/progress" || routePath.startsWith("/progress/")) {
    return "progress";
  }

  if (routePath === "/settings" || routePath.startsWith("/settings/")) {
    return "settings";
  }

  return null;
}

function buildApiContractObservationScope(
  error: ApiContractError,
  context: ApiContractObservationContext,
  route: string | null,
): WebObservationScope {
  return {
    app: "web",
    feature: context.feature,
    userId: context.userId,
    workspaceId: context.workspaceId,
    installationId: context.installationId,
    route,
    requestId: error.requestId,
    statusCode: error.statusCode,
    code: error.code,
  };
}

function captureApiContractErrorWithRoute(
  error: ApiContractError,
  context: ApiContractObservationContext,
  route: string | null,
): void {
  captureWebException({
    action: "api_contract_failed",
    error,
    scope: buildApiContractObservationScope(error, context, route),
    details: {
      endpoint: error.endpoint,
      fieldPath: error.fieldPath,
      expected: error.expected,
      sourceAction: context.sourceAction,
    },
  });
}

export function captureApiContractError(error: unknown, context: ApiContractObservationContext): void {
  if (error instanceof ApiContractError === false) {
    return;
  }

  captureApiContractErrorWithRoute(error, context, getCurrentRoute());
}

export function captureRouteApiContractError(error: unknown, context: RouteApiContractObservationContext): void {
  if (error instanceof ApiContractError === false) {
    return;
  }

  const route = getCurrentRoute();
  const feature = resolveApiContractObservationFeature(route);
  if (feature === null) {
    return;
  }

  captureApiContractErrorWithRoute(error, {
    feature,
    sourceAction: context.sourceAction,
    userId: context.userId,
    workspaceId: context.workspaceId,
    installationId: context.installationId,
  }, route);
}

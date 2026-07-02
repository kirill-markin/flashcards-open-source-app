import { Hono } from "hono";
import type { AppEnv } from "../../server/app";
import {
  createWorkspacePackageExportRoutes,
  type WorkspacePackageExportRoutesOptions,
} from "./export";
import {
  createWorkspacePackageImportRoutes,
  type WorkspacePackageImportRoutesOptions,
} from "./import";

export {
  parseWorkspacePackageExportRouteInput,
} from "./export";
export {
  workspacePackageImportConfirmRouteMaxZipBytes,
  workspacePackageImportPreviewRouteMaxZipBytes,
} from "./import";

export type {
  WorkspacePackageExportRouteInput,
  WorkspacePackageExportRoutesOptions,
} from "./export";
export type {
  WorkspacePackageImportRoutesOptions,
} from "./import";

export type WorkspacePackageRoutesOptions =
  WorkspacePackageExportRoutesOptions & WorkspacePackageImportRoutesOptions;

export function createWorkspacePackageRoutes(options: WorkspacePackageRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route("/", createWorkspacePackageExportRoutes(options));
  app.route("/", createWorkspacePackageImportRoutes(options));
  return app;
}

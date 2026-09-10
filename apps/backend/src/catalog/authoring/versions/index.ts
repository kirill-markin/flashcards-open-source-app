import { unsafeTransaction } from "../../../database/core";
import type {
  CatalogPackageEducationalAlignmentCorrection,
  CatalogPackageVersion,
  CorrectCatalogPackageEducationalAlignmentInput,
  CreateCatalogPackageVersionFromWorkspaceInput,
  CreateCatalogPackageVersionInput,
  UpdateCatalogPackageVersionStatusInput,
} from "../../types";
import {
  correctCatalogPackageEducationalAlignmentInExecutor,
} from "./educationalAlignment";
import {
  createCatalogPackageVersionFromCardsInExecutor,
} from "./creation";
import {
  createCatalogPackageVersionFromWorkspaceSelectionInExecutor,
} from "./workspaceSnapshots";
import {
  delistCatalogPackageVersionInExecutor,
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageVersionReviewStatusInExecutor,
} from "./publication";

export {
  listCatalogPackageVersionsForAudit,
  listCatalogPackageVersionsForAuditInExecutor,
} from "./audit";

export {
  correctCatalogPackageEducationalAlignmentInExecutor,
} from "./educationalAlignment";
export {
  createCatalogPackageVersionFromCardsInExecutor,
} from "./creation";
export {
  createCatalogPackageVersionFromWorkspaceSelectionInExecutor,
} from "./workspaceSnapshots";
export {
  assertCatalogPackageVersionStatusTransitionAllowed,
  delistCatalogPackageVersionInExecutor,
  isCatalogPackageVersionStatusTransitionAllowed,
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageVersionReviewStatusInExecutor,
} from "./publication";

export async function correctCatalogPackageEducationalAlignment(
  packageId: string,
  input: CorrectCatalogPackageEducationalAlignmentInput,
): Promise<CatalogPackageEducationalAlignmentCorrection> {
  return unsafeTransaction(async (executor) => (
    correctCatalogPackageEducationalAlignmentInExecutor(executor, packageId, input)
  ));
}

export async function createCatalogPackageVersionFromCards(
  packageId: string,
  input: CreateCatalogPackageVersionInput,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    createCatalogPackageVersionFromCardsInExecutor(executor, packageId, input, adminEmail)
  ));
}

export async function createCatalogPackageVersionFromWorkspaceSelection(
  packageId: string,
  input: CreateCatalogPackageVersionFromWorkspaceInput,
  adminUserId: string,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
      executor,
      packageId,
      input,
      adminUserId,
      adminEmail,
    )
  ));
}

export async function updateCatalogPackageVersionReviewStatus(
  packageVersionId: string,
  input: UpdateCatalogPackageVersionStatusInput,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    updateCatalogPackageVersionReviewStatusInExecutor(executor, packageVersionId, input, adminEmail)
  ));
}

export async function publishCatalogPackageVersion(
  packageVersionId: string,
  adminEmail: string,
  note: string | null,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    publishCatalogPackageVersionInExecutor(executor, packageVersionId, adminEmail, note)
  ));
}

export async function delistCatalogPackageVersion(
  packageVersionId: string,
  adminEmail: string,
  note: string | null,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    delistCatalogPackageVersionInExecutor(executor, packageVersionId, adminEmail, note)
  ));
}

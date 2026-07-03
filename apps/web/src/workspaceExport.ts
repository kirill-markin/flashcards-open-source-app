type WorkspaceExportUrlApi = Readonly<{
  createObjectURL: (object: Blob) => string;
  revokeObjectURL: (url: string) => void;
}>;

type TriggerBlobDownloadParams = Readonly<{
  blob: Blob;
  filename: string;
  document: Document;
  urlApi: WorkspaceExportUrlApi;
}>;

export function triggerBlobDownload(params: TriggerBlobDownloadParams): void {
  const { blob, filename, document, urlApi } = params;
  if (document.body === null) {
    throw new Error(`Document body is unavailable for workspace download: filename=${filename}`);
  }

  const objectUrl = urlApi.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  urlApi.revokeObjectURL(objectUrl);
}

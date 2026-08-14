import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
} from "../../../appError/AppErrorContext";
import {
  ApiError,
  isAuthRedirectError,
  transcribeChatAudio,
} from "../../../api";
import {
  explainBrowserMediaPermissionError,
  isExpectedBrowserMediaPermissionError,
  queryBrowserPermissionState,
} from "../../../access/browserAccess";
import type { TranslationKey, TranslationValues } from "../../../i18n";
import {
  insertDictationTranscriptIntoDraft,
  type ChatDictationState,
  type ChatDraftSelection,
} from "./chatDictation";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type ChatDictationTechnicalOperation = "chat_dictation_start" | "chat_dictation_transcribe";

type UseChatDictationCaptureParams = Readonly<{
  activeWorkspaceId: string | null;
  currentSessionId: string | null;
  ensureRemoteSession: () => Promise<string>;
  focusComposerRequestVersion: number;
  inputText: string;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  onTechnicalError: (error: unknown, operation: ChatDictationTechnicalOperation) => boolean;
  t: Translate;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  updateInputText: (updateDraftText: (currentInputText: string) => string) => void;
}>;

export type ChatDictationCapture = Readonly<{
  clearTrackedDraftSelection: () => void;
  dictationState: ChatDictationState;
  discardDictation: () => void;
  handleMicrophoneClick: (canStartDictation: boolean) => Promise<void>;
  requestComposerFocusRestore: () => void;
  updateTrackedDraftSelection: (textarea: HTMLTextAreaElement) => void;
}>;

function stopMediaStream(stream: MediaStream | null): void {
  if (stream === null) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function chooseSupportedRecordingMimeType(): string | null {
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return null;
  }

  const supportedMimeTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  for (const mimeType of supportedMimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null;
}

function cleanupDictationResources(
  mediaRecorderRef: MutableRefObject<MediaRecorder | null>,
  mediaStreamRef: MutableRefObject<MediaStream | null>,
  recordedChunksRef: MutableRefObject<Array<Blob>>,
): void {
  stopMediaStream(mediaStreamRef.current);
  mediaRecorderRef.current = null;
  mediaStreamRef.current = null;
  recordedChunksRef.current = [];
}

function isExpectedDictationApiError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.statusCode >= 500) {
    return false;
  }

  if (error.statusCode === 401) {
    return true;
  }

  switch (error.code) {
    case "AI_CHAT_V2_HUMAN_AUTH_REQUIRED":
    case "AUTH_UNAUTHORIZED":
    case "CHAT_SESSION_ID_CONFLICT":
    case "CHAT_TRANSCRIPTION_RATE_LIMITED":
    case "CHAT_TRANSCRIPTION_FILE_EMPTY":
    case "CHAT_TRANSCRIPTION_FILE_REQUIRED":
    case "CHAT_TRANSCRIPTION_FILE_UNSUPPORTED":
    case "CHAT_TRANSCRIPTION_INVALID_AUDIO":
    case "CHAT_TRANSCRIPTION_INVALID_MULTIPART":
    case "CHAT_TRANSCRIPTION_SOURCE_INVALID":
    case "GUEST_AUTH_INVALID":
    case "SESSION_CSRF_TOKEN_INVALID":
    case "WORKSPACE_NOT_FOUND":
    case "WORKSPACE_SELECTION_REQUIRED":
      return true;
  }

  return error.statusCode === 400
    && error.code === null
    && error.responseBodyKind === "json";
}

function stopMediaRecorder(
  recorder: MediaRecorder,
  recordedChunksRef: MutableRefObject<Array<Blob>>,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    function handleStop(): void {
      recorder.removeEventListener("error", handleError as EventListener);
      resolve(new Blob(recordedChunksRef.current, {
        type: recorder.mimeType === "" ? "audio/webm" : recorder.mimeType,
      }));
    }

    function handleError(event: Event): void {
      recorder.removeEventListener("stop", handleStop);
      if (event instanceof ErrorEvent && event.error instanceof Error) {
        reject(event.error);
        return;
      }

      reject(new Error("MICROPHONE_RECORDING_FAILED"));
    }

    recorder.addEventListener("stop", handleStop, { once: true });
    recorder.addEventListener("error", handleError as EventListener, { once: true });
    recorder.stop();
  });
}

export function useChatDictationCapture(params: UseChatDictationCaptureParams): ChatDictationCapture {
  const {
    activeWorkspaceId,
    currentSessionId,
    ensureRemoteSession,
    focusComposerRequestVersion,
    inputText,
    indexedDbOpenRecoveryState,
    onTechnicalError,
    t,
    textareaRef,
    updateInputText,
  } = params;
  const [dictationState, setDictationState] = useState<ChatDictationState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const transcriptionAbortControllerRef = useRef<AbortController | null>(null);
  const recordedChunksRef = useRef<Array<Blob>>([]);
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  const draftSelectionRef = useRef<ChatDraftSelection | null>(null);
  const pendingTextareaSelectionRef = useRef<ChatDraftSelection | null>(null);
  const pendingComposerFocusRestoreRef = useRef<boolean>(false);
  const shouldRestoreTextareaFocusAfterDictationRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  const stopActiveDictationResources = useCallback((): void => {
    transcriptionAbortControllerRef.current?.abort(new DOMException("Chat dictation stopped", "AbortError"));
    transcriptionAbortControllerRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder !== null && recorder.state !== "inactive") {
      recorder.stop();
    }
    cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
  }, []);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    if (
      indexedDbOpenRecoveryState.hasFailed()
      || pendingComposerFocusRestoreRef.current === false
      || dictationState !== "idle"
    ) {
      return;
    }

    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }

    pendingComposerFocusRestoreRef.current = false;
    textarea.focus();
  });

  useEffect(() => {
    if (indexedDbOpenRecoveryState.hasFailed() || dictationState !== "idle") {
      return;
    }

    textareaRef.current?.focus();
  }, [dictationState, focusComposerRequestVersion, indexedDbOpenRecoveryState, textareaRef]);

  useEffect(() => {
    if (indexedDbOpenRecoveryState.hasFailed() || dictationState !== "idle") {
      return;
    }

    const textarea = textareaRef.current;
    const pendingSelection = pendingTextareaSelectionRef.current;
    if (textarea === null || pendingSelection === null) {
      return;
    }

    const start = Math.max(0, Math.min(pendingSelection.start, textarea.value.length));
    const end = Math.max(0, Math.min(pendingSelection.end, textarea.value.length));

    if (shouldRestoreTextareaFocusAfterDictationRef.current) {
      textarea.focus();
    }

    textarea.setSelectionRange(start, end);
    draftSelectionRef.current = { start, end };
    pendingTextareaSelectionRef.current = null;
    shouldRestoreTextareaFocusAfterDictationRef.current = false;
  }, [dictationState, indexedDbOpenRecoveryState, inputText, textareaRef]);

  useEffect(() => {
    const handleRecoveryAbort = (): void => {
      stopActiveDictationResources();
      draftSelectionRef.current = null;
      pendingTextareaSelectionRef.current = null;
      pendingComposerFocusRestoreRef.current = false;
      shouldRestoreTextareaFocusAfterDictationRef.current = false;
    };

    if (indexedDbOpenRecoveryState.signal.aborted) {
      handleRecoveryAbort();
      return undefined;
    }

    indexedDbOpenRecoveryState.signal.addEventListener("abort", handleRecoveryAbort, { once: true });
    return (): void => {
      indexedDbOpenRecoveryState.signal.removeEventListener("abort", handleRecoveryAbort);
    };
  }, [indexedDbOpenRecoveryState.signal, stopActiveDictationResources]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      stopActiveDictationResources();
    };
  }, [stopActiveDictationResources]);

  function updateTrackedDraftSelection(textarea: HTMLTextAreaElement): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    draftSelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function clearTrackedDraftSelection(): void {
    draftSelectionRef.current = null;
    pendingTextareaSelectionRef.current = null;
  }

  function requestComposerFocusRestore(): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    pendingComposerFocusRestoreRef.current = true;
  }

  function discardDictation(): void {
    stopActiveDictationResources();
    draftSelectionRef.current = null;
    pendingTextareaSelectionRef.current = null;
    shouldRestoreTextareaFocusAfterDictationRef.current = false;
    if (isMountedRef.current) {
      setDictationState("idle");
    }
  }

  async function startDictation(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed() || dictationState !== "idle") {
      return;
    }

    const textarea = textareaRef.current;
    const shouldRestoreFocus = textarea !== null && document.activeElement === textarea;
    shouldRestoreTextareaFocusAfterDictationRef.current = shouldRestoreFocus;
    draftSelectionRef.current = shouldRestoreFocus && textarea !== null
      ? {
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
      }
      : null;

    if (typeof MediaRecorder === "undefined") {
      window.alert(t("chatPanel.alerts.microphoneUnavailable"));
      return;
    }

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices === undefined || typeof mediaDevices.getUserMedia !== "function") {
      window.alert(t("chatPanel.alerts.microphoneUnavailable"));
      return;
    }

    setDictationState("requesting_permission");

    let stream: MediaStream | null = null;
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      indexedDbOpenRecoveryState.throwIfFailed();
      const recorderMimeType = chooseSupportedRecordingMimeType();
      const recorder = recorderMimeType === null
        ? new MediaRecorder(stream)
        : new MediaRecorder(stream, { mimeType: recorderMimeType });
      recordedChunksRef.current = [];
      recorder.addEventListener("dataavailable", (event: BlobEvent) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      });
      recorder.start();
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      if (isMountedRef.current) {
        setDictationState("recording");
      }
    } catch (error) {
      const isRecoveryActive = markIndexedDbOpenRecoveryFailureAndCheckActive(
        indexedDbOpenRecoveryState,
        error,
      );
      stopMediaStream(stream);
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      if (isRecoveryActive) {
        return;
      }
      const permissionState = await queryBrowserPermissionState("microphone");
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      if (isMountedRef.current) {
        if (isExpectedBrowserMediaPermissionError(error)) {
          window.alert(explainBrowserMediaPermissionError("microphone", error, permissionState, t));
        } else if (isAuthRedirectError(error) === false && onTechnicalError(error, "chat_dictation_start") === false) {
          window.alert(t("chatPanel.errors.genericFailure"));
        }
        setDictationState("idle");
      }
    }
  }

  async function stopDictation(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      stopActiveDictationResources();
      pendingComposerFocusRestoreRef.current = false;
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder === null || recorder.state === "inactive") {
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      setDictationState("idle");
      return;
    }

    setDictationState("transcribing");

    let transcriptionAbortController: AbortController | null = null;
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const audioBlob = await stopMediaRecorder(recorder, recordedChunksRef);
      indexedDbOpenRecoveryState.throwIfFailed();
      stopMediaStream(mediaStreamRef.current);
      if (audioBlob.size <= 0) {
        if (isMountedRef.current) {
          setDictationState("idle");
        }
        return;
      }

      if (activeWorkspaceId === null) {
        throw new Error(t("chatPanel.transientErrors.workspaceRequired"));
      }

      const sessionId = await ensureRemoteSession();
      indexedDbOpenRecoveryState.throwIfFailed();
      transcriptionAbortController = new AbortController();
      transcriptionAbortControllerRef.current = transcriptionAbortController;
      const transcription = await transcribeChatAudio(
        audioBlob,
        "web",
        sessionId,
        activeWorkspaceId,
        transcriptionAbortController.signal,
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      if (transcription.sessionId !== sessionId) {
        throw new Error(t("chatPanel.errors.transcriptionUnexpectedSessionId"));
      }

      if (currentSessionIdRef.current !== sessionId) {
        return;
      }

      if (isMountedRef.current) {
        updateInputText((currentText) => {
          const insertionResult = insertDictationTranscriptIntoDraft(
            currentText,
            transcription.text,
            draftSelectionRef.current,
          );
          const nextSelection = shouldRestoreTextareaFocusAfterDictationRef.current
            ? insertionResult.selection
            : null;
          draftSelectionRef.current = nextSelection;
          pendingTextareaSelectionRef.current = nextSelection;
          return insertionResult.text;
        });
      }
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }

      if (isMountedRef.current) {
        if (error instanceof Error && error.message === "MICROPHONE_RECORDING_FAILED") {
          window.alert(t("chatPanel.alerts.microphoneUnavailable"));
        } else if (error instanceof Error && error.message === t("chatPanel.transientErrors.workspaceRequired")) {
          window.alert(t("chatPanel.transientErrors.workspaceRequired"));
        } else if (isAuthRedirectError(error)) {
          return;
        } else if (isExpectedDictationApiError(error)) {
          window.alert(t("chatPanel.errors.genericFailure"));
        } else if (onTechnicalError(error, "chat_dictation_transcribe") === false) {
          window.alert(t("chatPanel.errors.genericFailure"));
        }
      }
    } finally {
      if (transcriptionAbortControllerRef.current === transcriptionAbortController) {
        transcriptionAbortControllerRef.current = null;
      }
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      if (isMountedRef.current && indexedDbOpenRecoveryState.hasFailed() === false) {
        setDictationState("idle");
      }
    }
  }

  async function handleMicrophoneClick(canStartDictation: boolean): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (dictationState === "recording") {
      await stopDictation();
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      return;
    }

    if (!canStartDictation) {
      return;
    }

    await startDictation();
  }

  return {
    clearTrackedDraftSelection,
    dictationState,
    discardDictation,
    handleMicrophoneClick,
    requestComposerFocusRestore,
    updateTrackedDraftSelection,
  };
}

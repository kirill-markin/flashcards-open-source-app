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
// The two analytics modules directly rather than the barrel: the barrel also carries the consent
// UI and the account-preferences calls, which would pull the whole analytics delivery graph into
// every chat bundle and test that renders the composer.
import { track } from "../../../analytics/client";
import { toAnalyticsDictationFailureReason } from "../../../analytics/failureReasons";
import type { TranslationKey, TranslationValues } from "../../../i18n";
import { isAiLimitReachedError } from "../../shared/chatAiLimitPolicy";
import {
  formatOwnOpenAIKeyErrorMessage,
  isOwnOpenAIKeyError,
} from "../../shared/chatOwnOpenAIKeyErrorPolicy";
import {
  insertDictationTranscriptIntoDraft,
  type ChatDictationState,
  type ChatDraftSelection,
} from "./chatDictation";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type ChatDictationTechnicalOperation = "chat_dictation_start" | "chat_dictation_transcribe";
// One object per `stopDictation` invocation, so the abandonment mark belongs to the attempt that
// carries it and a later attempt cannot clear it while an earlier request is still in flight.
type ChatDictationAttempt = { abandoned: boolean };

type UseChatDictationCaptureParams = Readonly<{
  activeWorkspaceId: string | null;
  currentSessionId: string | null;
  ensureRemoteSession: () => Promise<string>;
  focusComposerRequestVersion: number;
  inputText: string;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  onTechnicalError: (error: unknown, operation: ChatDictationTechnicalOperation) => boolean;
  formatAiLimitReachedMessage: () => string;
  refreshAiUsage: () => void;
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
    formatAiLimitReachedMessage,
    refreshAiUsage,
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
  const dictationStateRef = useRef<ChatDictationState>("idle");
  const currentDictationAttemptRef = useRef<ChatDictationAttempt | null>(null);
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

  /**
   * The terminal report for an abandoned attempt, called from the only two paths that abandon one:
   * `discardDictation` and the unmount cleanup. While the recorder is running nothing else could
   * report it — there is no in-flight request to abort — so `dictation_started` would stay unpaired
   * and the abandonment would read as a transcript forever; the event is emitted here.
   *
   * While transcribing, `stopDictation` is still awaiting the recorder or the request, so this
   * marks that attempt, hands the shared resources back, and leaves the invocation holding it to
   * report from whichever branch it reaches:
   * `cancelled` instead of the `no_speech` its dropped chunks would produce, `cancelled` instead of
   * the transport reason its failing request would map to, and `cancelled` when the request
   * succeeds but the transcript reaches no draft. A marked attempt whose transcript does land in
   * the draft stays eventless on purpose: the person received the text, so it did not fail.
   *
   * `dictationStateRef` is written back here rather than left to the effect below: a discard
   * followed by an unmount in the same commit never re-renders, so both would otherwise still read
   * `recording`.
   */
  const reportDictationAbandoned = useCallback((): void => {
    if (dictationStateRef.current === "transcribing") {
      // Null in three windows, none of which has anything left to mark: between a terminal report
      // and the state effect that clears `transcribing`, after an IndexedDB recovery return, which
      // clears the attempt with the state still `transcribing` and reports nothing on purpose, and
      // after an earlier abandonment released the attempt just below.
      const abandonedAttempt = currentDictationAttemptRef.current;
      if (abandonedAttempt !== null) {
        abandonedAttempt.abandoned = true;
        // Ownership ends here, not at the next `stopDictation`: the caller releases the recorder,
        // the stream and the dictation state in the same tick, so a recording started before the
        // marked invocation settles must not be cleaned up by it. Its own `attempt` closure carries
        // the mark, so every terminal report still fires.
        currentDictationAttemptRef.current = null;
      }
      return;
    }

    if (dictationStateRef.current !== "recording") {
      return;
    }

    dictationStateRef.current = "idle";
    track({ name: "dictation_failed", reason: "cancelled" });
  }, []);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    dictationStateRef.current = dictationState;
  }, [dictationState]);

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
      reportDictationAbandoned();
      stopActiveDictationResources();
    };
  }, [reportDictationAbandoned, stopActiveDictationResources]);

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
    reportDictationAbandoned();
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

    // A browser that cannot record at all lands in `server_error`, the catalog's remaining bucket:
    // the attempt ended for a reason that is neither the person's answer nor the transport.
    if (typeof MediaRecorder === "undefined") {
      track({ name: "dictation_failed", reason: "server_error" });
      window.alert(t("chatPanel.alerts.microphoneUnavailable"));
      return;
    }

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices === undefined || typeof mediaDevices.getUserMedia !== "function") {
      track({ name: "dictation_failed", reason: "server_error" });
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
        // The recorder is running, which is what `dictation_started` means. Reporting the button
        // click instead would count a refused microphone as a start with no end. An unmounted
        // composer reports nothing either: it is left with a recorder no cancel path can end.
        track({ name: "dictation_started", screen: "ai" });
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
      // Reported here rather than beside each alert below, because the branches that stay silent —
      // an auth redirect, an unmounted panel — failed the attempt just as much as the ones that
      // speak. The IndexedDB recovery return above is the exception: it replaces the whole app
      // rather than ending a dictation.
      track({ name: "dictation_failed", reason: toAnalyticsDictationFailureReason(error) });
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
      // Only reachable while the state says `recording`, so the recorder stopped on its own —
      // a revoked permission, a device taken away — and the attempt ended with no audio to send.
      track({ name: "dictation_failed", reason: "server_error" });
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      setDictationState("idle");
      return;
    }

    // The stream this invocation recorded with, read before the first await: a discard during the
    // recorder flush lets a later recording own `mediaStreamRef`, and stopping that would cut a
    // live recording.
    const ownedStream = mediaStreamRef.current;
    const attempt: ChatDictationAttempt = { abandoned: false };
    currentDictationAttemptRef.current = attempt;
    setDictationState("transcribing");

    let transcriptionAbortController: AbortController | null = null;
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const audioBlob = await stopMediaRecorder(recorder, recordedChunksRef);
      indexedDbOpenRecoveryState.throwIfFailed();
      stopMediaStream(ownedStream);
      if (audioBlob.size <= 0) {
        track({
          name: "dictation_failed",
          reason: attempt.abandoned ? "cancelled" : "no_speech",
        });
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

      // The transcript reaches the draft only while the composer is mounted and still on the
      // session it was recorded for; a composer that left either one drops it.
      if (currentSessionIdRef.current !== sessionId || isMountedRef.current === false) {
        // A dropped transcript alone is not a failure and stays eventless. An abandoned attempt is:
        // its request was created too late to be aborted and resolved anyway, so nobody received
        // the text and this is the only branch left to pair its `dictation_started`.
        if (attempt.abandoned) {
          track({ name: "dictation_failed", reason: "cancelled" });
        }
        return;
      }

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
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }

      // An attempt abandoned before the request existed has no abort to raise `AbortError`, so the
      // request it left running maps to a transport reason the person never experienced.
      track({
        name: "dictation_failed",
        reason: attempt.abandoned
          ? "cancelled"
          : toAnalyticsDictationFailureReason(error),
      });
      if (isMountedRef.current) {
        if (error instanceof Error && error.message === "MICROPHONE_RECORDING_FAILED") {
          window.alert(t("chatPanel.alerts.microphoneUnavailable"));
        } else if (error instanceof Error && error.message === t("chatPanel.transientErrors.workspaceRequired")) {
          window.alert(t("chatPanel.transientErrors.workspaceRequired"));
        } else if (isAuthRedirectError(error)) {
          return;
        } else if (error instanceof ApiError && isAiLimitReachedError({ code: error.code })) {
          // Brings the remaining-messages notice down to zero; the refusal does not wait for it.
          refreshAiUsage();
          window.alert(formatAiLimitReachedMessage());
        } else if (error instanceof ApiError && isOwnOpenAIKeyError(error.code)) {
          window.alert(formatOwnOpenAIKeyErrorMessage(t("chatPanel.errors.ownOpenAIKeyPrefix"), error.message));
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
      // The shared recorder and dictation state belong to whoever owns the current attempt. A
      // discard or an unmount releases this invocation's ownership as it marks the attempt, so an
      // abandoned one owns neither: it would stop a later recording's live stream and its `idle`
      // reset would strand that recording's `dictation_started` with no path left to pair it. The
      // discard already stopped the resources this invocation had and set `idle` itself.
      const ownsAttempt = currentDictationAttemptRef.current === attempt;
      if (ownsAttempt) {
        currentDictationAttemptRef.current = null;
        cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
        if (isMountedRef.current && indexedDbOpenRecoveryState.hasFailed() === false) {
          setDictationState("idle");
        }
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

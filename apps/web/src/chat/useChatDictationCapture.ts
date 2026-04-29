import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { transcribeChatAudio } from "../api";
import {
  explainBrowserMediaPermissionError,
  queryBrowserPermissionState,
} from "../access/browserAccess";
import type { TranslationKey, TranslationValues } from "../i18n";
import {
  insertDictationTranscriptIntoDraft,
  type ChatDictationState,
  type ChatDraftSelection,
} from "./chatDictation";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

type UseChatDictationCaptureParams = Readonly<{
  activeWorkspaceId: string | null;
  currentSessionId: string | null;
  ensureRemoteSession: () => Promise<string>;
  focusComposerRequestVersion: number;
  inputText: string;
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
    t,
    textareaRef,
    updateInputText,
  } = params;
  const [dictationState, setDictationState] = useState<ChatDictationState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Array<Blob>>([]);
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  const draftSelectionRef = useRef<ChatDraftSelection | null>(null);
  const pendingTextareaSelectionRef = useRef<ChatDraftSelection | null>(null);
  const pendingComposerFocusRestoreRef = useRef<boolean>(false);
  const shouldRestoreTextareaFocusAfterDictationRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    if (pendingComposerFocusRestoreRef.current === false || dictationState !== "idle") {
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
    if (dictationState !== "idle") {
      return;
    }

    textareaRef.current?.focus();
  }, [dictationState, focusComposerRequestVersion, textareaRef]);

  useEffect(() => {
    if (dictationState !== "idle") {
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
  }, [dictationState, inputText, textareaRef]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder !== null && recorder.state !== "inactive") {
        recorder.stop();
      }
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
    };
  }, []);

  function updateTrackedDraftSelection(textarea: HTMLTextAreaElement): void {
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
    pendingComposerFocusRestoreRef.current = true;
  }

  function discardDictation(): void {
    const recorder = mediaRecorderRef.current;
    if (recorder !== null && recorder.state !== "inactive") {
      recorder.stop();
    }

    cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
    draftSelectionRef.current = null;
    pendingTextareaSelectionRef.current = null;
    shouldRestoreTextareaFocusAfterDictationRef.current = false;
    if (isMountedRef.current) {
      setDictationState("idle");
    }
  }

  async function startDictation(): Promise<void> {
    if (dictationState !== "idle") {
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
      stream = await mediaDevices.getUserMedia({ audio: true, video: false });
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
      stopMediaStream(stream);
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      const permissionState = await queryBrowserPermissionState("microphone");
      if (isMountedRef.current) {
        window.alert(explainBrowserMediaPermissionError("microphone", error, permissionState, t));
        setDictationState("idle");
      }
    }
  }

  async function stopDictation(): Promise<void> {
    const recorder = mediaRecorderRef.current;
    if (recorder === null || recorder.state === "inactive") {
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      setDictationState("idle");
      return;
    }

    setDictationState("transcribing");

    try {
      const audioBlob = await stopMediaRecorder(recorder, recordedChunksRef);
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
      const transcription = await transcribeChatAudio(
        audioBlob,
        "web",
        sessionId,
        activeWorkspaceId,
      );
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
      if (isMountedRef.current) {
        const message = error instanceof Error && error.message === "MICROPHONE_RECORDING_FAILED"
          ? t("chatPanel.alerts.microphoneUnavailable")
          : error instanceof Error
            ? error.message
            : String(error);
        window.alert(message);
      }
    } finally {
      cleanupDictationResources(mediaRecorderRef, mediaStreamRef, recordedChunksRef);
      if (isMountedRef.current) {
        setDictationState("idle");
      }
    }
  }

  async function handleMicrophoneClick(canStartDictation: boolean): Promise<void> {
    if (dictationState === "recording") {
      await stopDictation();
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

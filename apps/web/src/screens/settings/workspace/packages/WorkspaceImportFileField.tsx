import { useRef, type ReactElement, type ReactNode } from "react";
import { useI18n } from "../../../../i18n";

type WorkspaceImportFileFieldProps = Readonly<{
  accept: string;
  multiple: boolean;
  label: string;
  isDisabled: boolean;
  isBusy: boolean;
  inputTestId: string;
  pickerTestId: string;
  onSelect: (files: ReadonlyArray<File>) => void;
  children: ReactNode;
}>;

export function WorkspaceImportFileField(props: WorkspaceImportFileFieldProps): ReactElement {
  const { accept, multiple, label, isDisabled, isBusy, inputTestId, pickerTestId, onSelect, children } = props;
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="workspace-import-file-field"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = isDisabled ? "none" : "copy";
        }
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
          event.preventDefault();
          if (!isDisabled) {
            onSelect(files);
          }
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        disabled={isDisabled}
        data-testid={inputTestId}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length > 0 && !isDisabled) {
            onSelect(files);
          }
        }}
      />
      <button
        className="ghost-btn workspace-import-file-picker"
        type="button"
        disabled={isDisabled}
        aria-busy={isBusy}
        data-testid={pickerTestId}
        onClick={() => inputRef.current?.click()}
      >
        <span>{label}</span>
        <span className="subtitle workspace-import-file-drop-hint">{t("workspaceImport.fileDropHint")}</span>
      </button>
      {children}
    </div>
  );
}

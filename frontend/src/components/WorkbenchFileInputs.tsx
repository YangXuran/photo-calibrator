import type { Ref } from "react";
import type { PickedFiles } from "../hooks/useWorkbench";

type WorkbenchFileInputsProps = {
  fileInputRef: Ref<HTMLInputElement>;
  bindDirectoryInput: (node: HTMLInputElement | null) => void;
  onPickFiles: (files: PickedFiles) => void;
};

export function WorkbenchFileInputs({ fileInputRef, bindDirectoryInput, onPickFiles }: WorkbenchFileInputsProps) {
  return (
    <>
      <input data-testid="topbar-file-input" hidden multiple onChange={(event) => onPickFiles(event.target.files)} ref={fileInputRef} type="file" />
      <input data-testid="topbar-directory-input" hidden multiple onChange={(event) => onPickFiles(event.target.files)} ref={bindDirectoryInput} type="file" />
    </>
  );
}

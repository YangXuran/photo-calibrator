export function createWorkspaceController({
  els,
  state,
  folderName,
  objectUrlFor,
  replaceFiles,
  ensureDocumentState,
  isBrowserDisplayable,
  clearStrengthPreviewTimer,
  renderActiveTool,
  renderInspectorPanel,
  renderCompareMode,
  renderCropOverlay,
  syncCompareImages,
  onSelectForCalibration,
}) {
  function applyWorkspaceMetadata() {
    const currentFolderName = state.files.length ? folderName(state.files) : "未加载文件夹";
    els.folderLabel.textContent = currentFolderName;
    els.countLabel.textContent = `${state.files.length} 张`;
    els.librarySource.textContent = currentFolderName;
    els.libraryCount.textContent = String(state.files.length);
    els.viewerFolderLabel.textContent = currentFolderName;
    els.sessionStatus.textContent = state.files.length ? "就绪" : "空闲";
  }

  function renderFilmstrip() {
    els.filmstrip.innerHTML = "";
    state.files.forEach((file, index) => {
      const button = document.createElement("button");
      button.className = `thumb${index === state.selectedIndex ? " active" : ""}`;
      button.type = "button";
      button.dataset.testid = "thumbnail";
      button.addEventListener("click", () => selectFile(index));

      const img = document.createElement("img");
      img.alt = file.name;
      img.src = objectUrlFor(file);
      const label = document.createElement("span");
      label.textContent = file.name;

      button.append(img, label);
      els.filmstrip.append(button);
    });
  }

  function setFiles(files) {
    clearStrengthPreviewTimer();
    replaceFiles(files);
    applyWorkspaceMetadata();
    renderFilmstrip();
    renderActiveTool();
    renderInspectorPanel();
    renderCompareMode();
    renderCropOverlay();
    if (files.length) {
      selectFile(0);
    }
  }

  function selectFile(index) {
    clearStrengthPreviewTimer();
    const file = state.files[index];
    if (!file) return;
    ensureDocumentState(file);
    state.selectedIndex = index;
    state.requestId += 1;
    renderFilmstrip();

    els.emptyState.classList.add("hidden");
    els.imageGrid.classList.remove("hidden");
    els.fileTitle.textContent = file.webkitRelativePath || file.name;
    els.viewerFileLabel.textContent = file.name;
    els.originalImage.src = isBrowserDisplayable(file) ? objectUrlFor(file) : "";
    els.calibratedImage.removeAttribute("src");
    syncCompareImages();
    renderCompareMode();
    renderCropOverlay();
    onSelectForCalibration(file, index, state.requestId);
  }

  return {
    applyWorkspaceMetadata,
    renderFilmstrip,
    setFiles,
    selectFile,
  };
}

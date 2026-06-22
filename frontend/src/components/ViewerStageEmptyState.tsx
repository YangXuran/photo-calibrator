export function ViewerStageEmptyState() {
  return (
    <div className="pc-stage-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      <strong>导入照片后开始校准</strong>
      <span>拖拽文件到窗口，或使用顶部按钮打开照片、文件夹和 session。</span>
      <span className="pc-stage-empty-hint">底部胶片条用于快速切换，右侧参数实时驱动 backend 预览。</span>
    </div>
  );
}

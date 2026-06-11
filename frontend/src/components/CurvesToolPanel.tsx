import type { WorkbenchController } from "../hooks/useWorkbench";
import { CurveEditor } from "./CurveEditor";
import { LutRadarChart } from "./LutRadarChart";
import { PaneSection } from "./PaneSection";

type CurvesToolPanelProps = {
  workbench: WorkbenchController;
};

export function CurvesToolPanel({ workbench }: CurvesToolPanelProps) {
  const collapseScope = "workbench";
  const lutVectors = workbench.selectedFile?.result?.charts?.lut_analysis?.vectors;
  const rgbHistogram = workbench.localCurvePreviewHistogram ?? workbench.selectedFile?.result?.charts?.calibrated_rgb_histogram ?? workbench.selectedFile?.result?.charts?.rgb_histogram;

  return (
    <div className="pc-tool-panel" data-testid="curves-tool-panel">
      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="tool-curves-editor"
        collapsible
        emphasis="primary"
        testId="curves-editor-section"
        title="曲线编辑器"
        meta=""
      >
        <CurveEditor
          curves={{ l: workbench.lCurve, r: workbench.rCurve, g: workbench.gCurve, b: workbench.bCurve }}
          histogram={rgbHistogram}
          onChange={workbench.setCurves}
        />
      </PaneSection>

      {lutVectors?.length ? (
        <PaneSection
          collapseStorageScope={collapseScope}
          collapseStorageKey="tool-curves-lut"
          collapsible
          testId="curves-lut-section"
          title="LUT 雷达图"
        >
          <LutRadarChart vectors={lutVectors} />
        </PaneSection>
      ) : null}
    </div>
  );
}

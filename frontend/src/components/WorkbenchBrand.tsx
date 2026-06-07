import type { RuntimeConfig } from "../runtime/config";
import { getRuntimePresentation } from "../runtime/presentation";

type WorkbenchBrandProps = {
  runtime: RuntimeConfig;
};

export function WorkbenchBrand({ runtime }: WorkbenchBrandProps) {
  const presentation = getRuntimePresentation(runtime);

  return (
    <div className="pc-brand">
      <span className="pc-brand-dot" />
      <div>
        <strong>Photo Calibrator</strong>
        <span>{presentation.brandSubtitle}</span>
      </div>
    </div>
  );
}

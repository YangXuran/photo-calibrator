import type { RuntimeConfig } from "../runtime/config";
import { getRuntimePresentation } from "../runtime/presentation";
import appIconUrl from "../../assets/app-icon.svg";

type WorkbenchBrandProps = {
  runtime: RuntimeConfig;
};

export function WorkbenchBrand({ runtime }: WorkbenchBrandProps) {
  const presentation = getRuntimePresentation(runtime);

  return (
    <div className="pc-brand">
      <img alt="" aria-hidden="true" className="pc-brand-icon" src={appIconUrl} />
      <div>
        <strong>ChromaFrame</strong>
        <span>{presentation.brandSubtitle}</span>
      </div>
    </div>
  );
}

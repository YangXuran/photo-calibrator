import type { EvaluatorInfo, PluginInfo } from "../types";

type PluginListProps = {
  plugins: PluginInfo[];
  evaluators: EvaluatorInfo[];
};

export function PluginList({ plugins, evaluators }: PluginListProps) {
  return (
    <div className="pc-stack">
      <div className="pc-list pc-list-compact">
        {plugins.map((plugin) => (
          <article className="pc-list-item pc-plugin-item" key={plugin.id}>
            <div className="pc-list-main">
              <strong>{plugin.name}</strong>
              <span>{plugin.id}</span>
            </div>
            <div className="pc-tag-row pc-tag-row-compact">
              {(plugin.hooks ?? []).map((hook) => (
                <span className="pc-tag pc-tag-compact" key={hook}>
                  {hook}
                </span>
              ))}
            </div>
          </article>
        ))}
        {!plugins.length ? <div className="pc-empty-panel">未发现插件</div> : null}
      </div>
      <div className="pc-list pc-list-compact">
        {evaluators.map((evaluator) => (
          <article className="pc-list-item pc-plugin-item" key={evaluator.id}>
            <div className="pc-list-main">
              <strong>{evaluator.name}</strong>
              <span>{evaluator.id}</span>
            </div>
            <div className="pc-tag-row pc-tag-row-compact">
              <span className="pc-tag pc-tag-compact">{evaluator.source ?? "native"}</span>
              <span className="pc-tag pc-tag-compact">{evaluator.supports_network ? "network" : "local"}</span>
            </div>
          </article>
        ))}
        {!evaluators.length ? <div className="pc-empty-panel">未发现评估器</div> : null}
      </div>
    </div>
  );
}

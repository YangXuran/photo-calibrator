import type { ReactNode } from "react";

export type DetailListItem = {
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
  code?: string | null;
};

type DetailListProps = {
  items: DetailListItem[];
  empty?: ReactNode;
};

export function DetailList({ items, empty }: DetailListProps) {
  if (!items.length) {
    return empty ? <div className="pc-empty-panel">{empty}</div> : null;
  }

  return (
    <div className="pc-list">
      {items.map((item, index) => (
        <article className="pc-list-item" key={`${index}`}>
          <div className="pc-list-main">
            <strong>{item.title}</strong>
            {item.meta ? <span>{item.meta}</span> : null}
          </div>
          {item.body ? <span className="pc-body-text">{item.body}</span> : null}
          {item.code ? <pre className="pc-code-block">{item.code}</pre> : null}
        </article>
      ))}
    </div>
  );
}

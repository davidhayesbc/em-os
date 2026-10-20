import { type WidgetDefinition, widgets } from "../widgets/registry.js";

/** 4-column grid; the default layout is registry order (layout persistence arrives in P1). */
export function WidgetGrid({ items = widgets }: { items?: WidgetDefinition[] }) {
  return (
    <div class="widget-grid">
      {items.map(({ id, title, defaultSize, Component }) => (
        <section
          key={id}
          class="widget"
          aria-labelledby={`widget-${id}-title`}
          style={{
            gridColumn: `span ${defaultSize.w}`,
            gridRow: `span ${defaultSize.h}`,
          }}
        >
          <h2 id={`widget-${id}-title`} class="widget-title">
            {title}
          </h2>
          <Component size={defaultSize} />
        </section>
      ))}
    </div>
  );
}

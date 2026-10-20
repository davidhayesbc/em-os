import type { JSX } from "preact";
import { ServiceStatus } from "./ServiceStatus.js";

export interface WidgetDefinition {
  id: string;
  title: string;
  defaultSize: { w: 1 | 2 | 3 | 4; h: 1 | 2 | 3 };
  Component: (p: { size: { w: number; h: number } }) => JSX.Element;
}

/** Append-only: the default dashboard layout follows this order. */
export const widgets: WidgetDefinition[] = [
  {
    id: "service-status",
    title: "Service status",
    defaultSize: { w: 2, h: 1 },
    Component: ServiceStatus,
  },
];

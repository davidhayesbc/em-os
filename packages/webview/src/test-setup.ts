import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

// Vitest has no globals, so Testing Library's automatic cleanup never registers.
afterEach(cleanup);

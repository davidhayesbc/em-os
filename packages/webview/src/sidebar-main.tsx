import { render } from "preact";
import { installBridge } from "./bridge.js";
import { Sidebar } from "./Sidebar.js";

installBridge();
const root = document.getElementById("root");
if (root) render(<Sidebar />, root);

import { render } from "preact";
import { App } from "./App.js";
import { installBridge } from "./bridge.js";

installBridge();
const root = document.getElementById("root");
if (root) render(<App />, root);

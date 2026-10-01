/**
 * The browser entry point.
 *
 * Everything testable lives elsewhere: this creates the one real socket, mounts
 * React, and does nothing else.
 */
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { connect, serverUrl } from "./socket";
import "./index.css";

// The scenario viewer, in builds that carry it: development, or a build made with
// VITE_SCENARIOS=1 (the screenshot harness). Written out here rather than imported
// as a flag, because the bundler drops the import with the branch only when it
// can see the condition is a constant in this module.
const ScenarioApp =
  import.meta.env.DEV || import.meta.env.VITE_SCENARIOS === "1"
    ? lazy(() => import("./scenarios/ScenarioApp"))
    : null;
const scenarios = ScenarioApp !== null && window.location.pathname.startsWith("/scenarios");

const root = document.getElementById("root");
// The element is in index.html; if it is missing the build is broken, and failing
// loudly beats mounting into nothing and showing a blank page.
if (!root) throw new Error("no #root element to mount into");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      {scenarios ? (
        // No socket: the viewer runs the engine itself.
        <Suspense fallback={null}>
          <ScenarioApp />
        </Suspense>
      ) : (
        <App socket={connect(serverUrl())} />
      )}
    </BrowserRouter>
  </StrictMode>,
);

/**
 * The browser entry point.
 *
 * Everything testable lives elsewhere: this creates the one real socket, mounts
 * React, and does nothing else.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { connect, serverUrl } from "./socket";
import "./index.css";

const root = document.getElementById("root");
// The element is in index.html; if it is missing the build is broken, and failing
// loudly beats mounting into nothing and showing a blank page.
if (!root) throw new Error("no #root element to mount into");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App socket={connect(serverUrl())} />
    </BrowserRouter>
  </StrictMode>,
);

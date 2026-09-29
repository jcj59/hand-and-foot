import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
// Adds the DOM matchers — toBeDisabled, toHaveValue, toBeInTheDocument and the
// rest. Worth the dependency for the failure messages alone: a bare
// `expect(el.textContent).toMatch(...)` prints the whole node on failure, while
// these say which attribute or value was wrong.
import "@testing-library/jest-dom/vitest";

// Testing Library only unmounts automatically when vitest's globals are enabled,
// and this package keeps them off to match the rest of the repo. Without this a
// component from one test stays in the document and the next test's query finds
// two of everything.
afterEach(cleanup);

// A saved seat lives in both of the browser's stores (see `browserStore`), and a
// test that clears only one would leak a seat from the last test into the next.
beforeEach(() => {
  // The real-server suites run in plain Node, which has no browser storage.
  if (typeof window === "undefined") return;
  window.sessionStorage.clear();
  window.localStorage.clear();
});

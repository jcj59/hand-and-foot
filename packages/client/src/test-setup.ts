import { afterEach } from "vitest";
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

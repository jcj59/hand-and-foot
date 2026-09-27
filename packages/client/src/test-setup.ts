import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library only unmounts automatically when vitest's globals are enabled,
// and this package keeps them off to match the rest of the repo. Without this a
// component from one test stays in the document and the next test's query finds
// two of everything.
afterEach(cleanup);

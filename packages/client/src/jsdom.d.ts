// jsdom ships no types, and the one test that builds its own document
// (`laydown.integration.test.tsx`) needs only this much of it, so it is declared
// here rather than adding `@types/jsdom`.
declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: { url?: string; pretendToBeVisual?: boolean });
    readonly window: Window & typeof globalThis;
  }
}

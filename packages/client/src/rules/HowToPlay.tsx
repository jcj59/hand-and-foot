/**
 * The rules page: how to play, for one table's rules. Reached from the home screen,
 * where it describes a preset, and from the table, where it describes that table.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PRESETS, type RulesConfig, type RulesPreset } from "@hf/shared";
import { howToPlay } from "./howToPlay";
import { PRESET_NAMES } from "./ruleText";

/** The sections themselves, for whichever frame shows them. */
export function RulesText({ config }: { readonly config: RulesConfig }): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {howToPlay(config).map((section) => (
        <section
          key={section.id}
          aria-labelledby={`rules-${section.id}`}
          className="flex flex-col gap-1.5"
        >
          <h2 id={`rules-${section.id}`} className="text-base font-semibold text-amber-100">
            {section.title}
          </h2>
          {section.paragraphs.map((text) => (
            <p key={text} className="text-sm leading-relaxed text-white/85">
              {text}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** The page on its own, from the home screen: a preset's rules, either preset. */
export function HowToPlayPage(): React.ReactElement {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<RulesPreset>("east-coast");
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">How to play</h1>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded border border-white/25 px-3 py-1 text-sm"
        >
          Main menu
        </button>
      </header>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-white/70">Rules</span>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as RulesPreset)}
          className="rounded border border-white/20 bg-black/30 px-2 py-1"
        >
          {(Object.keys(PRESETS) as RulesPreset[]).map((p) => (
            <option key={p} value={p}>
              {PRESET_NAMES[p]}
            </option>
          ))}
        </select>
      </label>
      <RulesText config={PRESETS[preset]} />
    </main>
  );
}

/** The same, over the table, for the table's own rules. */
export function RulesDialog({
  config,
  onClose,
}: {
  readonly config: RulesConfig;
  readonly onClose: () => void;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="How to play"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-lg border border-white/15 bg-felt-900 p-5 shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">How to play at this table</h1>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded border border-white/25 px-3 py-1 text-sm"
          >
            Close
          </button>
        </header>
        <RulesText config={config} />
      </section>
    </div>
  );
}

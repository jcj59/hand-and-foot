/**
 * The rules page: how to play, as section cards with an icon each and a contents
 * list to jump between them. Away from a table (`/rules`) it states the rules every
 * preset shares and gives the one rule they differ on, the wild ratio, for each;
 * at a table (`RulesDialog`) it states that table's own rules, house rules and all.
 * The words are `howToPlay.ts`'s, generated from the rules config.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { RulesConfig } from "@hf/shared";
import { LESSONS } from "@hf/scenarios";
import { IconBox, type IconBoxColor } from "../ui/IconBox";
import type { IconName } from "../ui/icons";
import { PageHeader } from "../ui/PageHeader";
import { Sheet } from "../ui/Sheet";
import { usePhone } from "../usePhone";
import { generalRules, howToPlay, type RulesSection } from "./howToPlay";

/** Each section's icon and color, by section id, as the design draws them. */
const LOOKS: Readonly<Record<string, { icon: IconName; color: IconBoxColor }>> = {
  objective: { icon: "target", color: "accent" },
  deal: { icon: "deal", color: "blue" },
  turn: { icon: "lessonTurn", color: "blue" },
  melds: { icon: "meldBook", color: "lime" },
  wilds: { icon: "lessonWild", color: "violet" },
  threes: { icon: "lessonThree", color: "salmon" },
  pile: { icon: "lessonPile", color: "gold" },
  "getting-down": { icon: "getDown", color: "teal" },
  marva: { icon: "heart", color: "salmon" },
  foot: { icon: "lessonFoot", color: "orange" },
  "going-out": { icon: "lessonOut", color: "accent" },
  scoring: { icon: "trophy", color: "gold" },
};

function lookOf(id: string): { icon: IconName; color: IconBoxColor } {
  return LOOKS[id] ?? { icon: "rules", color: "accent" };
}

/** The anchor a contents link jumps to. */
const anchor = (id: string): string => `rules-${id}`;

/** A section's card: icon and title, the words, the presets' call-out, the lesson. */
function SectionCard({
  section,
  phone,
  lessons,
}: {
  readonly section: RulesSection;
  readonly phone: boolean;
  /** Whether to link the section's lesson, where one teaches it. Not from a table. */
  readonly lessons: boolean;
}): React.ReactElement {
  const look = lookOf(section.id);
  const lesson = lessons ? LESSONS.findIndex((l) => l.id === section.id) : -1;
  const coasts = section.coasts;
  return (
    <section
      id={anchor(section.id)}
      aria-labelledby={`${anchor(section.id)}-title`}
      className={`flex scroll-mt-5 flex-col rounded-[18px] border border-white/6 bg-surface ${
        phone ? "gap-2 p-4" : "gap-2.5 p-[22px]"
      }`}
    >
      <h2
        id={`${anchor(section.id)}-title`}
        className={`m-0 flex items-center font-display font-semibold ${
          phone ? "gap-2.5 text-[17px]" : "gap-3 text-xl"
        }`}
      >
        <IconBox icon={look.icon} color={look.color} size={phone ? 30 : 36} />
        {section.title}
      </h2>
      {section.paragraphs.map((text) => (
        <p
          key={text}
          className={`m-0 text-ink-soft ${phone ? "text-sm leading-[1.55]" : "text-[15px] leading-[1.6]"}`}
        >
          {text}
        </p>
      ))}
      {coasts && coasts.length > 0 && (
        <div
          className={`rounded-xl border border-gold/30 bg-gold/8 ${
            phone
              ? "flex flex-col gap-2 p-3"
              : "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5 rounded-[14px] p-3.5"
          }`}
        >
          <p
            className={`m-0 font-semibold text-gold ${phone ? "text-xs" : "col-span-full text-[13px]"}`}
          >
            {phone
              ? `${coasts.map((c) => c.name).join(" and ")} differ here`
              : `The one rule ${coasts.map((c) => c.name).join(" and ")} play differently`}
          </p>
          {coasts.map((coast) =>
            phone ? (
              <p key={coast.name} className="m-0 text-[13px] leading-normal text-gold-ink">
                <span className="font-semibold text-ink">{coast.name}:</span> {coast.text}
              </p>
            ) : (
              <div key={coast.name}>
                <p className="m-0 text-sm font-semibold">{coast.name}</p>
                <p className="mt-1 mb-0 text-sm leading-normal text-gold-ink">{coast.text}</p>
              </div>
            ),
          )}
        </div>
      )}
      {lesson >= 0 && (
        <Link
          to={`/learn/${LESSONS[lesson]!.id}`}
          className={`flex items-center gap-1.5 self-start rounded-[10px] bg-accent/10 font-semibold text-accent no-underline hover:bg-accent/15 ${
            phone ? "min-h-[34px] px-3 text-[13px]" : "min-h-[38px] px-3.5 text-sm"
          }`}
        >
          <svg
            aria-hidden="true"
            width={phone ? 11 : 12}
            height={phone ? 11 : 12}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M7 4v16l13-8z" />
          </svg>
          Try it: Lesson {lesson + 1}
        </Link>
      )}
    </section>
  );
}

/** The section cards on their own, for whichever frame shows them. */
function RulesText({
  sections,
  phone,
  lessons,
}: {
  readonly sections: readonly RulesSection[];
  readonly phone: boolean;
  readonly lessons: boolean;
}): React.ReactElement {
  return (
    <div className={`flex min-w-0 flex-col ${phone ? "gap-3" : "gap-3.5"}`}>
      {sections.map((section) => (
        <SectionCard key={section.id} section={section} phone={phone} lessons={lessons} />
      ))}
    </div>
  );
}

/**
 * Which section the reader is at: the first one in the top third of the window.
 * A jump from the contents names its section at once, and the sections scrolled
 * past on the way there do not take it back.
 */
function useCurrentSection(
  sections: readonly RulesSection[],
): readonly [string, (id: string) => void] {
  const [current, setCurrent] = useState(sections[0]!.id);
  const jumping = useRef(0);
  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^rules-/, "");
          if (entry.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        const first = sections.find((s) => seen.has(s.id));
        if (first && Date.now() > jumping.current) setCurrent(first.id);
      },
      { rootMargin: "0px 0px -66% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(anchor(s.id));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);
  const jump = (id: string): void => {
    jumping.current = Date.now() + 1000;
    setCurrent(id);
    document.getElementById(anchor(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return [current, jump];
}

/** The contents: a grid of tiles on a phone, a list beside the sections on a computer. */
function Contents({
  sections,
  phone,
  current,
  onJump,
}: {
  readonly sections: readonly RulesSection[];
  readonly phone: boolean;
  readonly current: string;
  readonly onJump: (id: string) => void;
}): React.ReactElement {
  return (
    <nav
      aria-label="Contents"
      className={
        phone
          ? "grid grid-cols-4 gap-2"
          : "sticky top-8 flex w-[220px] shrink-0 flex-col gap-1 self-start"
      }
    >
      {sections.map((section) => {
        const look = lookOf(section.id);
        const here = section.id === current;
        return (
          <a
            key={section.id}
            href={`#${anchor(section.id)}`}
            aria-current={here ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onJump(section.id);
            }}
            className={
              phone
                ? `flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[14px] border px-1 py-2 text-ink-soft no-underline ${
                    here ? "border-accent/35 bg-raised" : "border-white/5 hover:bg-white/3"
                  }`
                : `flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium no-underline ${
                    here ? "bg-surface text-ink" : "text-muted hover:bg-white/3 hover:text-ink"
                  }`
            }
          >
            <IconBox icon={look.icon} color={look.color} size={phone ? 34 : 30} />
            {phone ? (
              <span className="text-center text-[11px] leading-[1.2] font-medium">
                {section.title}
              </span>
            ) : (
              section.title
            )}
          </a>
        );
      })}
    </nav>
  );
}

const GENERAL = generalRules();

/** The page in the app: the rules away from a table, both presets' wild ratios given. */
export function HowToPlayPage(): React.ReactElement {
  const phone = usePhone();
  const [current, jump] = useCurrentSection(GENERAL);
  const contents = <Contents sections={GENERAL} phone={phone} current={current} onJump={jump} />;
  return phone ? (
    <main className="flex w-full flex-col gap-3.5 px-5 pt-5 pb-5">
      <PageHeader title="Rules" />
      {contents}
      <RulesText sections={GENERAL} phone lessons />
    </main>
  ) : (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-10 pt-8 pb-12">
      <PageHeader
        title="How to play"
        subtitle="At a table, this page shows that table's own rules, including any house rules the host changed."
      />
      <div className="flex items-start gap-8">
        {contents}
        <div className="max-w-[46rem] min-w-0 flex-1">
          <RulesText sections={GENERAL} phone={false} lessons />
        </div>
      </div>
    </main>
  );
}

/** The same over the table, for the table's own rules. */
export function RulesDialog({
  config,
  onClose,
}: {
  readonly config: RulesConfig;
  readonly onClose: () => void;
}): React.ReactElement {
  const phone = usePhone();
  return (
    <Sheet title="How to play" onClose={onClose} wide id="rules">
      <p className="m-0 -mt-2 text-muted">
        This table's own rules, including any house rules the host changed.
      </p>
      <RulesText sections={howToPlay(config)} phone={phone} lessons={false} />
    </Sheet>
  );
}

/**
 * How the Learn page shows each lesson: its icon and color, a line saying what it
 * teaches, and where the learner is in the course. The lessons themselves (their
 * tables, steps and words for the coach) are `@hf/scenarios`'; this is only their
 * face on the page, so it lives with the page.
 */
import type { Lesson } from "@hf/scenarios";
import type { IconBoxColor } from "../ui/IconBox";
import type { IconName } from "../ui/icons";

export interface LessonLook {
  readonly icon: IconName;
  readonly color: IconBoxColor;
  /** What the lesson is about, in one line, for the "Up next" card. */
  readonly blurb: string;
}

/** By lesson id. A lesson missing here is shown with `FALLBACK`. */
export const LESSON_LOOKS: Readonly<Record<string, LessonLook>> = {
  turn: { icon: "lessonTurn", color: "blue", blurb: "Draw, play what you can, then discard." },
  "getting-down": {
    icon: "lessonDown",
    color: "teal",
    blurb: "Your first melds have to add up to the round's minimum.",
  },
  melds: {
    icon: "lessonAdd",
    color: "lime",
    blurb: "Grow the melds you have down, on to a book of seven.",
  },
  pile: {
    icon: "lessonPile",
    color: "gold",
    blurb: "When the discard pile is worth grabbing, and what it takes.",
  },
  wilds: {
    icon: "lessonWild",
    color: "violet",
    blurb: "Twos and jokers stand in for any rank, within limits.",
  },
  threes: {
    icon: "lessonThree",
    color: "salmon",
    blurb: "Red threes cost you; black threes block the pile.",
  },
  foot: {
    icon: "lessonFoot",
    color: "orange",
    blurb: "Play out your hand and pick up your second one.",
  },
  "going-out": {
    icon: "lessonOut",
    color: "accent",
    blurb: "The books you need, and ending the round on your terms.",
  },
};

export const FALLBACK: LessonLook = { icon: "book", color: "accent", blurb: "" };

export function lookOf(lesson: Lesson): LessonLook {
  return LESSON_LOOKS[lesson.id] ?? FALLBACK;
}

export type LessonStatus = "done" | "next" | "todo";

export interface Course {
  /** How many of the lessons this device has finished. */
  readonly done: number;
  /** The first lesson not yet finished, or null once all of them are. */
  readonly next: Lesson | null;
  readonly status: (lesson: Lesson) => LessonStatus;
}

/**
 * Where the learner is: the lessons are meant in order, so the one up next is the
 * first not finished, even if a later one was done out of turn.
 */
export function courseOf(lessons: readonly Lesson[], finished: ReadonlySet<string>): Course {
  const next = lessons.find((lesson) => !finished.has(lesson.id)) ?? null;
  return {
    done: lessons.filter((lesson) => finished.has(lesson.id)).length,
    next,
    status: (lesson) => (finished.has(lesson.id) ? "done" : lesson === next ? "next" : "todo"),
  };
}

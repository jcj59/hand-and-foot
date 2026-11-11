import { describe, it, expect } from "vitest";
import { LESSONS } from "@hf/scenarios";
import { FALLBACK, LESSON_LOOKS, courseOf, lookOf } from "./lessonMeta";

describe("each lesson's look", () => {
  it("is drawn for every lesson there is, each its own icon", () => {
    for (const lesson of LESSONS) {
      expect(LESSON_LOOKS[lesson.id], lesson.id).toBeDefined();
      expect(lookOf(lesson)).toBe(LESSON_LOOKS[lesson.id]);
      expect(lookOf(lesson).blurb.length).toBeGreaterThan(0);
    }
    expect(new Set(LESSONS.map((l) => lookOf(l).icon)).size).toBe(LESSONS.length);
  });

  it("falls back to a plain one for a lesson it does not know", () => {
    expect(lookOf({ ...LESSONS[0]!, id: "new-lesson" })).toBe(FALLBACK);
  });
});

describe("where the learner is in the course", () => {
  it("starts at the first lesson with nothing done", () => {
    const course = courseOf(LESSONS, new Set());
    expect(course.done).toBe(0);
    expect(course.next).toBe(LESSONS[0]);
    expect(course.status(LESSONS[0]!)).toBe("next");
    expect(course.status(LESSONS[1]!)).toBe("todo");
  });

  it("puts the first lesson not finished up next, even with a later one done", () => {
    const course = courseOf(LESSONS, new Set(["turn", "pile", "unknown"]));
    expect(course.done).toBe(2);
    expect(course.next).toBe(LESSONS[1]);
    expect(course.status(LESSONS[0]!)).toBe("done");
    expect(course.status(LESSONS[1]!)).toBe("next");
    expect(course.status(LESSONS[3]!)).toBe("done");
    expect(course.status(LESSONS[4]!)).toBe("todo");
  });

  it("has nothing up next once every lesson is done", () => {
    const course = courseOf(LESSONS, new Set(LESSONS.map((l) => l.id)));
    expect(course.done).toBe(8);
    expect(course.next).toBeNull();
    expect(LESSONS.every((l) => course.status(l) === "done")).toBe(true);
  });
});

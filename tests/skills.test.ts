import { describe, expect, test } from "bun:test";
import {
  BUNDLED_SKILLS,
  composeAgentSystem,
  isVagueRequest,
  parseSkill,
  selectSkills,
  type Skill,
} from "../src/agent/skills";
import { GENERATE_PLAYLIST_SYSTEM } from "../src/agent/prompts";

function skillFile(meta: Record<string, string>, body = "Do the thing."): string {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return ["---", ...lines, "---", body].join("\n");
}

describe("parseSkill", () => {
  test("round-trips name/description/always/triggers/body", () => {
    const s = parseSkill(
      skillFile(
        { name: "demo", description: "a demo", always: "false", triggers: "New, LATEST , 202" },
        "Line one.\nLine two.",
      ),
    );
    expect(s.name).toBe("demo");
    expect(s.description).toBe("a demo");
    expect(s.always).toBe(false);
    expect(s.triggers).toEqual(["new", "latest", "202"]);
    expect(s.body).toBe("Line one.\nLine two.");
  });

  test("always is true only on the exact string 'true'", () => {
    expect(parseSkill(skillFile({ name: "a", description: "d", always: "true" })).always).toBe(true);
    expect(parseSkill(skillFile({ name: "a", description: "d", always: "yes" })).always).toBe(false);
    expect(parseSkill(skillFile({ name: "a", description: "d" })).always).toBe(false);
  });

  test("throws on missing leading frontmatter fence", () => {
    expect(() => parseSkill("name: x\n---\nbody")).toThrow(/must start with '---'/);
  });

  test("throws on missing closing fence", () => {
    expect(() => parseSkill("---\nname: x\ndescription: d\nbody")).toThrow(/invalid frontmatter line|closing '---'/);
    expect(() => parseSkill("---\nname: x\ndescription: d")).toThrow(/closing '---'/);
  });

  test("throws when name or description is missing", () => {
    expect(() => parseSkill(skillFile({ name: "x" }))).toThrow(/requires 'name' and 'description'/);
    expect(() => parseSkill(skillFile({ description: "d" }))).toThrow(/requires 'name' and 'description'/);
  });
});

describe("BUNDLED_SKILLS", () => {
  test("all five bundled skill files parse with expected names", () => {
    expect(BUNDLED_SKILLS.map((s) => s.name).sort()).toEqual(
      ["clarify", "continuity", "curation", "freshness", "research"],
    );
  });

  test("clarify, curation, and research are always-on", () => {
    const always = BUNDLED_SKILLS.filter((s) => s.always).map((s) => s.name).sort();
    expect(always).toEqual(["clarify", "curation", "research"]);
  });
});

describe("selectSkills", () => {
  test("always-on skills are selected for any prompt", () => {
    const names = selectSkills("sad songs").map((s) => s.name);
    expect(names).toContain("clarify");
    expect(names).toContain("curation");
    expect(names).toContain("research");
    expect(names).not.toContain("freshness");
    expect(names).not.toContain("continuity");
  });

  test("freshness is trigger-gated on RU and EN recency words", () => {
    expect(selectSkills("новый релиз этого года").map((s) => s.name)).toContain("freshness");
    expect(selectSkills("latest hits").map((s) => s.name)).toContain("freshness");
    expect(selectSkills("sad songs").map((s) => s.name)).not.toContain("freshness");
  });
});

describe("composeAgentSystem", () => {
  test("starts with the base curator contract and pins clarify as the first skill", () => {
    const out = composeAgentSystem({ prompt: "sad songs" });
    expect(out.startsWith(GENERATE_PLAYLIST_SYSTEM)).toBe(true);
    const firstSkill = out.indexOf("## Skill:");
    expect(out.slice(firstSkill).startsWith("## Skill: clarify")).toBe(true);
  });

  test("hasPriorPlaylist force-includes the continuity skill", () => {
    expect(composeAgentSystem({ prompt: "sad songs" })).not.toContain("## Skill: continuity");
    expect(composeAgentSystem({ prompt: "sad songs", hasPriorPlaylist: true })).toContain(
      "## Skill: continuity",
    );
  });

  test("footer carries the provided date", () => {
    const out = composeAgentSystem({ prompt: "sad songs", now: new Date("2026-07-08T12:00:00Z") });
    expect(out).toContain("Today's date is 2026-07-08");
  });

  test("skill registry override is respected", () => {
    const custom: Skill[] = [
      { name: "only", description: "d", always: true, triggers: [], body: "Custom body." },
    ];
    const out = composeAgentSystem({ prompt: "anything", skills: custom });
    expect(out).toContain("## Skill: only\nCustom body.");
    expect(out).not.toContain("## Skill: clarify");
  });
});

describe("isVagueRequest", () => {
  test("short unpinned requests are vague (EN and RU)", () => {
    expect(isVagueRequest("sad songs")).toBe(true);
    expect(isVagueRequest("workout")).toBe(true);
    expect(isVagueRequest("молчат дома vibes")).toBe(true);
    // 6 raw words, but only 2 content words after filler stripping.
    expect(isVagueRequest("сделай мне плейлист для грустного вечера")).toBe(true);
    expect(isVagueRequest("make me a playlist of sad songs please")).toBe(true);
  });

  test("empty prompt is not vague (nothing to clarify against)", () => {
    expect(isVagueRequest("")).toBe(false);
    expect(isVagueRequest("   ")).toBe(false);
  });

  test("concrete pins disable forcing: year, decade, track count", () => {
    expect(isVagueRequest("music from 1987")).toBe(false);
    expect(isVagueRequest("80s japanese city pop, 25 tracks")).toBe(false);
    expect(isVagueRequest("90-е русский рок")).toBe(false);
    expect(isVagueRequest("90-х русский рок")).toBe(false);
    expect(isVagueRequest("30 треков русского рока")).toBe(false);
    expect(isVagueRequest("25 tracks of shoegaze")).toBe(false);
  });

  test("long descriptive requests are not vague", () => {
    expect(isVagueRequest("late night neon city drive, synthwave and dark electro")).toBe(false);
    expect(isVagueRequest("плейлист из меланхоличного русского построка и эмбиента для дождливой осени")).toBe(false);
  });
});

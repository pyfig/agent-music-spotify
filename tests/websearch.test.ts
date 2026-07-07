import { describe, expect, test } from "bun:test";
import { parseDuckDuckGoHtml } from "../src/agent/websearch";

const FIXTURE = `
<div class="results">
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Falbum&amp;rut=abc">New Album &#x27;Echoes&#x27; &amp; More</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Falbum">Tracklist for the <b>new album</b> released in 2026.</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://plain.example.org/page">Plain Result</a>
    <a class="result__snippet" href="#">Second snippet here.</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://third.example.org">Third</a>
  </div>
</div>`;

describe("parseDuckDuckGoHtml", () => {
  test("extracts title, unwrapped url, and snippet", () => {
    const out = parseDuckDuckGoHtml(FIXTURE);
    expect(out[0]).toEqual({
      title: "New Album 'Echoes' & More",
      url: "https://example.com/album",
      snippet: "Tracklist for the new album released in 2026.",
    });
    expect(out[1]).toEqual({
      title: "Plain Result",
      url: "https://plain.example.org/page",
      snippet: "Second snippet here.",
    });
    expect(out.length).toBe(3);
  });

  test("honors limit", () => {
    expect(parseDuckDuckGoHtml(FIXTURE, 1).length).toBe(1);
  });

  test("garbage input yields empty array", () => {
    expect(parseDuckDuckGoHtml("<html><body>nothing</body></html>")).toEqual([]);
    expect(parseDuckDuckGoHtml("")).toEqual([]);
  });
});

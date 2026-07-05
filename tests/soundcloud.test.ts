import { afterEach, describe, expect, test } from "bun:test";
import { SoundCloudClient } from "../src/music/soundcloud/client";
import { scrapeClientId } from "../src/music/soundcloud/auth";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SoundCloud stream resolve", () => {
  test("progressive transcoding preferred, second request returns stream url", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/tracks/12345")) {
        return jsonResponse({
          media: {
            transcodings: [
              { url: "https://api-v2.soundcloud.com/t/hls", format: { protocol: "hls" } },
              {
                url: "https://api-v2.soundcloud.com/t/progressive",
                format: { protocol: "progressive" },
              },
            ],
          },
        });
      }
      if (url.includes("/t/progressive")) {
        return jsonResponse({ url: "https://cdn.example/stream.mp3" });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const client = new SoundCloudClient("cid");
    const streamUrl = await client.resolvePlayableUrl({
      uri: "sc:12345",
      title: "Song",
      artist: "Artist",
    });
    expect(streamUrl).toBe("https://cdn.example/stream.mp3");
    expect(seen.some((u) => u.includes("/t/progressive") && u.includes("client_id=cid"))).toBe(
      true,
    );
    expect(seen.some((u) => u.includes("/t/hls"))).toBe(false);
  });

  test("falls back to HLS when no progressive transcoding", async () => {
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("/tracks/1")) {
        return jsonResponse({
          media: {
            transcodings: [{ url: "https://api-v2.soundcloud.com/t/hls", format: { protocol: "hls" } }],
          },
        });
      }
      if (url.includes("/t/hls")) return jsonResponse({ url: "https://cdn.example/playlist.m3u8" });
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const client = new SoundCloudClient("cid");
    const streamUrl = await client.resolvePlayableUrl({ uri: "sc:1", title: "x", artist: "y" });
    expect(streamUrl).toBe("https://cdn.example/playlist.m3u8");
  });

  test("401 triggers one client_id refresh then retries", async () => {
    let calls = 0;
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      calls++;
      if (url.includes("client_id=stale")) return jsonResponse({}, 401);
      return jsonResponse({ collection: [] });
    }) as typeof fetch;

    const client = new SoundCloudClient("stale", async () => "fresh");
    const track = await client.searchTrack("A", "B");
    expect(track).toBeNull();
    expect(calls).toBe(2);
  });
});

describe("SoundCloud client_id scrape", () => {
  test("extracts client_id from js bundles referenced by homepage", async () => {
    const fakeFetch = (async (input: any) => {
      const url = String(input);
      if (url === "https://soundcloud.com/") {
        return new Response(
          `<html><script crossorigin src="https://a-v2.sndcdn.com/assets/0-abc.js"></script>
           <script crossorigin src="https://a-v2.sndcdn.com/assets/50-def.js"></script></html>`,
        );
      }
      if (url.includes("50-def.js")) {
        return new Response(`var x={client_id:"AbCdEf1234567890XyZ"};`);
      }
      return new Response("nothing here");
    }) as typeof fetch;
    const id = await scrapeClientId(fakeFetch);
    expect(id).toBe("AbCdEf1234567890XyZ");
  });

  test("returns null when no bundle contains client_id", async () => {
    const fakeFetch = (async () => new Response("<html></html>")) as unknown as typeof fetch;
    expect(await scrapeClientId(fakeFetch)).toBeNull();
  });
});

import { saveConfig, type Config } from "../../config";

/**
 * SoundCloud's api-v2 needs a client_id but hands them out only to its own
 * web app. Scrape one: the homepage references js bundles on sndcdn.com and
 * one of them embeds client_id:"...".
 */
export async function scrapeClientId(fetchFn: typeof fetch = fetch): Promise<string | null> {
  const page = await fetchFn("https://soundcloud.com/");
  if (!page.ok) return null;
  const html = await page.text();
  const scriptUrls = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)]
    .map((m) => m[1]!)
    .filter((u) => u.includes("sndcdn.com"));
  // client_id usually lives in one of the last bundles — search backwards.
  for (const url of scriptUrls.reverse()) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) continue;
      const js = await res.text();
      const match = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{16,})"/);
      if (match) return match[1]!;
    } catch {
      // try the next bundle
    }
  }
  return null;
}

export async function getSoundCloudClientId(config: Config): Promise<string> {
  if (config.soundcloudClientId) return config.soundcloudClientId;
  const scraped = await scrapeClientId();
  if (!scraped) {
    throw new Error(
      "could not auto-detect a SoundCloud client_id — set SOUNDCLOUD_CLIENT_ID manually",
    );
  }
  await saveConfig({ soundcloudClientId: scraped });
  return scraped;
}

/**
 * Called once on the first 401/403: drop the cached id, scrape a fresh one.
 * Failing that, the id format likely changed — tell the user to set it by hand.
 */
export async function refreshSoundCloudClientId(): Promise<string> {
  await saveConfig({ soundcloudClientId: undefined });
  const fresh = await scrapeClientId();
  if (!fresh) {
    throw new Error(
      "SoundCloud client_id expired and re-scrape failed — set SOUNDCLOUD_CLIENT_ID manually",
    );
  }
  await saveConfig({ soundcloudClientId: fresh });
  return fresh;
}

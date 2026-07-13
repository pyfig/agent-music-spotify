import { useRef, useState } from "react";
import { isValidClientId, type Config } from "../config";
import { forceFreshLogin, getAccessToken } from "../spotify/auth";

/**
 * Spotify auth state + login mechanics. Resume choreography (re-running the
 * prompt that triggered the login) stays at the composition site — this hook
 * only reports whether a token was obtained.
 */
export function useAuthFlow(deps: {
  setError: (msg: string | undefined) => void;
  show: (msg: string) => void;
  /** Invalid/placeholder client id: route the user into the ClientIdPrompt. */
  openClientIdPrompt: () => void;
}) {
  const [authed, setAuthed] = useState(false);
  // Mirror readable from async closures (state var is stale there).
  const authedRef = useRef(false);
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  /** Prompt to re-run once the connect/login flow completes. */
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  function markAuthed(v: boolean) {
    authedRef.current = v;
    setAuthed(v);
  }

  /**
   * Acquire a token. `resumePrompt === null` means an explicit /login — force
   * a fresh browser auth instead of returning the cached token, and toast on
   * success. Returns true when a token was obtained; false when blocked
   * (missing client id — prompt opened, pendingPrompt stashed) or failed
   * (error surfaced).
   */
  async function login(cfg: Config, resumePrompt: string | null): Promise<boolean> {
    if (connectingRef.current) return false;
    if (!isValidClientId(cfg.spotifyClientId)) {
      setPendingPrompt(resumePrompt);
      deps.openClientIdPrompt();
      return false;
    }
    connectingRef.current = true;
    setConnecting(true);
    deps.setError(undefined);
    try {
      resumePrompt === null ? await forceFreshLogin(cfg) : await getAccessToken(cfg);
      markAuthed(true);
      if (resumePrompt === null) deps.show("logged in ✓");
      return true;
    } catch (e) {
      deps.setError(String(e instanceof Error ? e.message : e));
      return false;
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }

  return {
    authed,
    authedRef,
    markAuthed,
    connecting,
    pendingPrompt,
    setPendingPrompt,
    login,
  };
}

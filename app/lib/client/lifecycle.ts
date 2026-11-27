"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * For loaders that can be called again (effects, Refresh buttons, after an action). Each call to the returned
 * function cancels the previous request and gives the signal for the new one, so an older, slower response can never
 * overwrite newer data. Everything is cancelled when the component unmounts. Check `signal.aborted` before using a
 * response.
 */
export function useLatestRequest() {
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  return useCallback(() => {
    current.current?.abort();
    current.current = new AbortController();
    return current.current.signal;
  }, []);
}

/** `ref.current` is false once the component is gone: check it after any await that starts a microphone or audio. */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // development mode mounts, unmounts and mounts again
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

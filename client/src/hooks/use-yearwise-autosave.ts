import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Answers } from "@shared/yearwise";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 900;
const FOLLOW_UP_MS = 600;

// Debounced autosave of a Yearwise session's answers. Only one write is ever in
// flight, so saves land in order; edits made during a write are sent after it.
export function useYearwiseAutosave(sessionId: number, initialStatus: SaveStatus) {
  const url = `/api/yearwise-sessions/${sessionId}/answers`;
  const [status, setStatus] = useState<SaveStatus>(initialStatus);
  const latest = useRef<Answers | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const saving = useRef(false);
  const pending = useRef(false);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current || !pending.current || !latest.current) return;
    saving.current = true;
    pending.current = false;
    try {
      await apiRequest("PATCH", url, { answers: latest.current });
      saving.current = false;
      if (pending.current) {
        timer.current = setTimeout(flush, FOLLOW_UP_MS);
      } else {
        setStatus("saved");
        queryClient.invalidateQueries({ queryKey: ["/api/yearwise-sessions"], exact: true });
      }
    } catch {
      saving.current = false;
      pending.current = true;
      setStatus("error");
      timer.current = setTimeout(flush, 3000 + Math.random() * 2000);
    }
  }, [url]);

  const schedule = useCallback((answers: Answers) => {
    latest.current = answers;
    pending.current = true;
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);

  useEffect(() => {
    // Closing the tab: send what's left with keepalive (skipped if a write is
    // already in flight, which would race it; that write's data is only ~1s old).
    const onHide = () => {
      if (!pending.current || saving.current || !latest.current) return;
      pending.current = false;
      fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: latest.current }),
        credentials: "include",
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      // Leaving the wizard in-app: save now rather than waiting for the debounce.
      if (pending.current) flush();
    };
  }, [url, flush]);

  return { status, schedule };
}

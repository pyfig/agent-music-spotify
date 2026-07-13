import { useCallback, useEffect, useState } from "react";

export interface Toast {
  msg: string;
  ts: number;
}

/** Transient ✓-toast with auto-dismiss. `show()` replaces any visible toast
 * and restarts the 3.5s timer (the effect re-runs on the new object). */
export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  const show = useCallback((msg: string) => {
    setToast({ msg, ts: Date.now() });
  }, []);
  return { toast, show };
}

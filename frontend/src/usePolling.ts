import { useEffect, useState } from "react";

/** Poll a function every `ms` and return its latest value. */
export function usePolling<T>(fn: () => Promise<T>, ms: number, deps: any[] = []): { data: T | null; error: any; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<any>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: any;
    const run = async () => {
      try {
        const v = await fn();
        if (!cancelled) {
          setData(v);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) timer = setTimeout(run, ms);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, tick, ...deps]);
  return { data, error, refresh: () => setTick((t) => t + 1) };
}

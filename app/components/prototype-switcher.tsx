// PROTOTYPE helper: floating bottom bar that cycles `?variant=` on the
// current route. ← / → also cycle. Never rendered in production builds.

import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STORAGE_KEY = "prototype-variant";

/**
 * The current variant: the `?variant=` param, or the last one picked (so it
 * survives in-app navigation, whose links don't carry the param), or the first.
 */
export function usePrototypeVariant<K extends string>(keys: readonly K[]): K {
  const [params] = useSearchParams();
  const fromUrl = params.get("variant") as K | null;
  if (fromUrl && keys.includes(fromUrl)) return fromUrl;
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY) as K | null;
    if (stored && keys.includes(stored)) return stored;
  }
  return keys[0];
}

export function PrototypeSwitcher<K extends string>({
  variants,
  current,
  children,
}: {
  variants: readonly { key: K; name: string }[];
  current: K;
  children?: React.ReactNode;
}) {
  const [, setParams] = useSearchParams();
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    window.localStorage.setItem(STORAGE_KEY, next.key);
    setParams(
      (p) => {
        p.set("variant", next.key);
        return p;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  const v = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-black px-2 py-1.5 font-mono text-xs text-white shadow-2xl ring-2 ring-fuchsia-500">
      <button
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/20"
        title="Previous variant (←)"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="whitespace-nowrap">
        PROTOTYPE {v.key} ({v.name})
      </span>
      <button
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/20"
        title="Next variant (→)"
      >
        <ChevronRight className="size-4" />
      </button>
      {children && (
        <div className="flex items-center gap-2 border-l border-white/30 pl-3 pr-2">
          {children}
        </div>
      )}
    </div>
  );
}

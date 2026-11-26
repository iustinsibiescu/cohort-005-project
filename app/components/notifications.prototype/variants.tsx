// PROTOTYPE (issue #7), round 2: the bell-popover direction (round 1's B)
// won. Three takes on it, mounted in the real app layout and switched with
// `?variant=B1|B2|B3` (or ← / →).
//
// Shared by all three:
//   - Bell in the sidebar header. The badge counts what you haven't *seen*;
//     opening the bell clears it. Rows stay highlighted until *clicked*
//     (seen ≠ read). "Mark all read" in the header.
//   - Infinite scroll: 10 at first, 10 more each time you near the bottom
//     (fake 400ms load so you can see it happen). No separate page.
//
//   B1  Clean list     Narrow popover. Type icon per row, unread dot on the
//                      right, All / Unread tabs.
//   B2  Grouped        Wider popover. Sticky Today / Yesterday / Earlier
//                      headers, actor avatar with a type badge, hover
//                      action to mark read / unread.
//   B3  Flyout panel   Full-height panel attached to the sidebar edge.
//                      Filter chips by area (Lessons, Comments, Purchases,
//                      Team), roomier rows with the area as a label.
//
// Nothing here persists: see ./store.tsx.

import { Link } from "react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Archive,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  Loader2,
  Mail,
  MessageCircle,
  Receipt,
  RotateCcw,
  Star,
  Ticket,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { useNotificationsPrototype } from "./store";
import { relativeTime, dayBucket, type StubNotification } from "./data";

export const NOTIFICATION_VARIANTS = [
  { key: "B1", name: "Clean list" },
  { key: "B2", name: "Grouped by day" },
  { key: "B3", name: "Flyout panel" },
] as const;
export type NotificationVariant = (typeof NOTIFICATION_VARIANTS)[number]["key"];

// ───────────────────────────── Shared bits ─────────────────────────────

const TYPE_META: Record<
  string,
  { icon: typeof Bell; tint: string; area: "Lessons" | "Comments" | "Purchases" | "Team" }
> = {
  "reply-to-your-comment": { icon: MessageCircle, tint: "bg-sky-500/15 text-sky-600 dark:text-sky-400", area: "Comments" },
  "new-comment-on-your-lesson": { icon: MessageCircle, tint: "bg-sky-500/15 text-sky-600 dark:text-sky-400", area: "Comments" },
  "new-lesson-on-your-course": { icon: BookOpen, tint: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", area: "Lessons" },
  "course-archived": { icon: Archive, tint: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400", area: "Lessons" },
  "student-enrolled": { icon: UserPlus, tint: "bg-violet-500/15 text-violet-600 dark:text-violet-400", area: "Purchases" },
  "student-rated": { icon: Star, tint: "bg-amber-500/15 text-amber-600 dark:text-amber-400", area: "Lessons" },
  "refund-approved-on-your-course": { icon: RotateCcw, tint: "bg-rose-500/15 text-rose-600 dark:text-rose-400", area: "Purchases" },
  "refund-request-decided": { icon: Receipt, tint: "bg-rose-500/15 text-rose-600 dark:text-rose-400", area: "Purchases" },
  "new-refund-request": { icon: Receipt, tint: "bg-rose-500/15 text-rose-600 dark:text-rose-400", area: "Purchases" },
  "seat-claimed": { icon: Ticket, tint: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400", area: "Team" },
  "all-seats-claimed": { icon: Users, tint: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400", area: "Team" },
};
const metaFor = (n: StubNotification) =>
  TYPE_META[n.typeKey] ?? { icon: Bell, tint: "bg-muted text-muted-foreground", area: "Lessons" as const };

function TypeIcon({ n, size = "md" }: { n: StubNotification; size?: "sm" | "md" }) {
  const { icon: Icon, tint } = metaFor(n);
  const circle = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        tint,
        size === "md" ? "size-9" : "size-[1.15rem] ring-2 ring-popover"
      )}
    >
      <Icon className={size === "md" ? "size-4" : "size-3"} />
    </div>
  );
  // Small badges sit on an avatar: give the translucent tint a solid backing.
  return size === "sm" ? <div className="rounded-full bg-popover">{circle}</div> : circle;
}

function initials(n: StubNotification) {
  return n.actorName && n.actorName !== "Cadence"
    ? n.actorName.split(" ").map((p) => p[0]).join("").slice(0, 2)
    : null;
}

/** Bold the actor's name at the start of the text, if it's there. */
function RichText({ n }: { n: StubNotification }) {
  if (n.actorName && n.text.startsWith(n.actorName)) {
    return (
      <>
        <span className="font-semibold text-foreground">{n.actorName}</span>
        {n.text.slice(n.actorName.length)}
      </>
    );
  }
  return <>{n.text}</>;
}

/** Show 10, then 10 more whenever the sentinel scrolls into view. */
function useInfinite<T>(items: T[], resetKey: unknown) {
  const [count, setCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Callback ref: the sentinel only exists while the popover is open.
  const [sentinel, sentinelRef] = useState<HTMLDivElement | null>(null);
  const hasMore = count < items.length;

  useEffect(() => setCount(10), [resetKey]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    setLoading(true);
    setTimeout(() => {
      setCount((c) => c + 10);
      setLoading(false);
    }, 400);
  }, [loading, hasMore]);

  useEffect(() => {
    const el = sentinel;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadMore(),
      { root: rootRef.current, rootMargin: "80px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, sentinel]);

  return { visible: items.slice(0, count), hasMore, loading, rootRef, sentinelRef, count };
}

function ListEnd({
  hasMore,
  loading,
  sentinelRef,
  total,
}: {
  hasMore: boolean;
  loading: boolean;
  sentinelRef: (el: HTMLDivElement | null) => void;
  total: number;
}) {
  return (
    <div ref={sentinelRef} className="flex h-12 items-center justify-center text-xs text-muted-foreground">
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : hasMore ? (
        ""
      ) : total > 0 ? (
        "That's everything"
      ) : null}
    </div>
  );
}

/** Bell button + open state + outside-click / Escape, shared by all three. */
function useBell() {
  const store = useNotificationsPrototype();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unseen = store.all.filter((n) => n.id > store.seenUpTo && store.unread.has(n.id)).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const button = (
    <button
      onClick={() => {
        setOpen((o) => !o);
        store.markSeen();
      }}
      className={cn(
        "relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        open && "bg-sidebar-accent text-sidebar-accent-foreground"
      )}
      title="Notifications"
    >
      <Bell className="size-5" />
      {unseen > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-[1.1rem] text-white ring-2 ring-sidebar">
          {unseen > 9 ? "9+" : unseen}
        </span>
      )}
    </button>
  );

  return { ...store, open, setOpen, ref, button };
}

function MarkAllButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Mark all as read"
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      <CheckCheck className="size-3.5" /> Mark all read
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-muted-foreground">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Bell className="size-5" />
      </div>
      {text}
    </div>
  );
}

// ───────────────────────────── B1: Clean list ─────────────────────────────

function BellB1() {
  const b = useBell();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const items = tab === "unread" ? b.all.filter((n) => b.unread.has(n.id)) : b.all;
  const inf = useInfinite(items, `${tab}-${b.open}`);

  return (
    <div ref={b.ref} className="relative ml-auto">
      {b.button}
      {b.open && (
        <div className="fixed left-56 top-3 z-50 ml-2 flex max-h-[min(36rem,calc(100vh-1.5rem))] w-[22rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl animate-in fade-in slide-in-from-left-1">
          <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <MarkAllButton onClick={b.markAllRead} disabled={b.unreadCount === 0} />
          </div>
          <div className="flex gap-4 border-b px-4">
            {(["all", "unread"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium capitalize transition-colors",
                  tab === t
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
                {t === "unread" && b.unreadCount > 0 && (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] leading-4">{b.unreadCount}</span>
                )}
              </button>
            ))}
          </div>
          <div ref={inf.rootRef} className="flex-1 overflow-y-auto overscroll-contain">
            {inf.visible.length === 0 && (
              <EmptyState text={tab === "unread" ? "You're all caught up." : "No Notifications yet."} />
            )}
            <ul className="py-1">
              {inf.visible.map((n) => {
                const isUnread = b.unread.has(n.id);
                return (
                  <li key={n.id}>
                    <Link
                      to={n.link}
                      onClick={() => {
                        b.markRead(n.id);
                        b.setOpen(false);
                      }}
                      className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-accent"
                    >
                      <TypeIcon n={n} />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "line-clamp-2 text-[13px] leading-snug",
                            isUnread ? "text-foreground" : "text-muted-foreground"
                          )}
                        >
                          <RichText n={n} />
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</p>
                      </div>
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          isUnread ? "bg-blue-600" : "bg-transparent"
                        )}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <ListEnd {...inf} total={items.length} />
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── B2: Grouped by day ─────────────────────────────

function BellB2() {
  const b = useBell();
  const inf = useInfinite(b.all, b.open);

  const groups: { label: string; items: StubNotification[] }[] = [];
  for (const n of inf.visible) {
    const raw = dayBucket(n.createdAt);
    const label = raw === "Today" || raw === "Yesterday" ? raw : "Earlier";
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div ref={b.ref} className="relative ml-auto">
      {b.button}
      {b.open && (
        <div className="fixed left-56 top-3 z-50 ml-2 flex max-h-[min(40rem,calc(100vh-1.5rem))] w-[26rem] flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl">
          <div className="flex items-center justify-between border-b bg-muted/40 px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold">Notifications</h2>
              <p className="text-xs text-muted-foreground">
                {b.unreadCount > 0 ? `${b.unreadCount} unread` : "You're all caught up"}
              </p>
            </div>
            <MarkAllButton onClick={b.markAllRead} disabled={b.unreadCount === 0} />
          </div>
          <div ref={inf.rootRef} className="flex-1 overflow-y-auto overscroll-contain">
            {groups.length === 0 && <EmptyState text="No Notifications yet." />}
            {groups.map((g) => (
              <section key={g.label}>
                <h3 className="sticky top-0 z-10 border-b bg-popover/95 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                  {g.label}
                </h3>
                <ul className="divide-y divide-border/60">
                  {g.items.map((n) => {
                    const isUnread = b.unread.has(n.id);
                    const init = initials(n);
                    return (
                      <li key={n.id} className={cn("group relative", isUnread && "bg-blue-500/[0.06]")}>
                        {isUnread && <span className="absolute inset-y-0 left-0 w-0.5 bg-blue-600" />}
                        <Link
                          to={n.link}
                          onClick={() => {
                            b.markRead(n.id);
                            b.setOpen(false);
                          }}
                          className="flex items-start gap-3 px-5 py-3 pr-12 transition-colors hover:bg-accent"
                        >
                          <div className="relative">
                            {init ? (
                              <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 text-xs font-semibold text-zinc-700 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-200">
                                {init}
                              </div>
                            ) : (
                              <div className="flex size-9 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                                C
                              </div>
                            )}
                            <div className="absolute -bottom-1 -right-1">
                              <TypeIcon n={n} size="sm" />
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-[13px] leading-snug", isUnread ? "text-foreground" : "text-muted-foreground")}>
                              <RichText n={n} />
                            </p>
                            <p className="mt-1 text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</p>
                          </div>
                        </Link>
                        <button
                          onClick={() => (isUnread ? b.markRead(n.id) : b.markUnread(n.id))}
                          title={isUnread ? "Mark as read" : "Mark as unread"}
                          className="absolute right-3 top-3 rounded-md border bg-popover p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          {isUnread ? <Check className="size-3.5" /> : <Mail className="size-3.5" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <ListEnd {...inf} total={b.all.length} />
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── B3: Flyout panel ─────────────────────────────

const AREAS = ["All", "Lessons", "Comments", "Purchases", "Team"] as const;

function BellB3() {
  const b = useBell();
  const [area, setArea] = useState<(typeof AREAS)[number]>("All");
  const presentAreas = AREAS.filter((a) => a === "All" || b.all.some((n) => metaFor(n).area === a));
  const items = area === "All" ? b.all : b.all.filter((n) => metaFor(n).area === area);
  const inf = useInfinite(items, `${area}-${b.open}`);

  return (
    <div ref={b.ref} className="relative ml-auto">
      {b.button}
      {b.open && (
        <div className="fixed bottom-0 left-56 top-0 z-50 flex w-[24rem] flex-col border-r bg-background shadow-[8px_0_24px_-12px_rgba(0,0,0,0.25)] animate-in slide-in-from-left-2">
          <div className="flex h-14 shrink-0 items-center justify-between border-b px-5">
            <h2 className="font-semibold">Notifications</h2>
            <div className="flex items-center gap-1">
              <MarkAllButton onClick={b.markAllRead} disabled={b.unreadCount === 0} />
              <button onClick={() => b.setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
                <X className="size-4" />
              </button>
            </div>
          </div>
          {presentAreas.length > 2 && (
            <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-5 py-2.5">
              {presentAreas.map((a) => (
                <button
                  key={a}
                  onClick={() => setArea(a)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    area === a
                      ? "border-foreground bg-foreground text-background"
                      : "text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
          <div ref={inf.rootRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-2">
            {inf.visible.length === 0 && <EmptyState text="Nothing here yet." />}
            <ul className="space-y-1">
              {inf.visible.map((n) => {
                const isUnread = b.unread.has(n.id);
                return (
                  <li key={n.id}>
                    <Link
                      to={n.link}
                      onClick={() => {
                        b.markRead(n.id);
                        b.setOpen(false);
                      }}
                      className={cn(
                        "flex gap-3 rounded-lg p-3 transition-colors hover:bg-accent",
                        isUnread && "bg-blue-500/[0.07] hover:bg-blue-500/[0.12]"
                      )}
                    >
                      <TypeIcon n={n} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {metaFor(n).area}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</span>
                        </div>
                        <p className={cn("mt-0.5 text-sm leading-snug", isUnread ? "font-medium" : "text-muted-foreground")}>
                          <RichText n={n} />
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <ListEnd {...inf} total={items.length} />
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Slots ─────────────────────────────

export function NotificationsHeaderSlot({ variant }: { variant: NotificationVariant }) {
  if (variant === "B1") return <BellB1 />;
  if (variant === "B2") return <BellB2 />;
  return <BellB3 />;
}

/** State readout + controls for the switcher bar. */
export function NotificationsPrototypeControls() {
  const { unreadCount, all, unread, seenUpTo, simulateNew, reset } = useNotificationsPrototype();
  const unseen = all.filter((n) => n.id > seenUpTo && unread.has(n.id)).length;
  return (
    <>
      <span>
        unread {unreadCount}/{all.length} · badge {unseen}
      </span>
      <button onClick={simulateNew} className="rounded-full bg-white/15 px-2 py-0.5 hover:bg-white/30">
        + new (poll)
      </button>
      <button onClick={reset} className="rounded-full bg-white/15 px-2 py-0.5 hover:bg-white/30">
        reset
      </button>
    </>
  );
}

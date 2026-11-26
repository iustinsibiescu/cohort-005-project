// PROTOTYPE (issue #7): three structurally different answers to
// "How do people see and read Notifications in the app?", mounted in the real
// app layout and switched with `?variant=A|B|C` (or ← / →).
//
//   A  Inbox page      Sidebar nav item with an unread count → /notifications,
//                      a full page. Read on click; "Mark all read"; per-row
//                      mark unread; Unread/All tabs; "Load older" (20 a page).
//   B  Bell popover    Bell in the sidebar header. Badge counts what you
//                      haven't *seen*; opening the bell clears the badge but
//                      rows stay highlighted until *clicked* (seen ≠ read).
//                      Latest 8 inline, "See all" → /notifications.
//   C  Drawer          "Notifications" in the sidebar footer with a dot, no
//                      number. Opens a right-hand drawer grouped by day with
//                      numbered pages of 15. Everything you were shown is
//                      read when the drawer closes. No per-row controls.
//
// Nothing here persists: see ./store.tsx.

import { Link, NavLink } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Bell, BellDot, Check, CheckCheck, Mail, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { useNotificationsPrototype } from "./store";
import { relativeTime, dayBucket, type StubNotification } from "./data";

export const NOTIFICATION_VARIANTS = [
  { key: "A", name: "Inbox page" },
  { key: "B", name: "Bell popover" },
  { key: "C", name: "Drawer, read on view" },
] as const;
export type NotificationVariant = (typeof NOTIFICATION_VARIANTS)[number]["key"];

function Avatar({ n }: { n: StubNotification }) {
  const initials = n.actorName
    ? n.actorName
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
    : "C";
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        n.actorName && n.actorName !== "Cadence"
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground"
      )}
    >
      {initials}
    </div>
  );
}

// ───────────────────────────── Variant A ─────────────────────────────

function SidebarA() {
  const { unreadCount } = useNotificationsPrototype();
  return (
    <NavLink
      to="/notifications"
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Bell className="size-4" />
      <span className="flex-1">Notifications</span>
      {unreadCount > 0 && (
        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </NavLink>
  );
}

export function NotificationsPageA() {
  const { all, unread, markRead, markUnread, markAllRead, unreadCount } =
    useNotificationsPrototype();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [shown, setShown] = useState(20);
  const list = tab === "unread" ? all.filter((n) => unread.has(n.id)) : all;
  const page = list.slice(0, shown);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount} unread · {all.length} total
          </p>
        </div>
        <button
          onClick={markAllRead}
          disabled={unreadCount === 0}
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-40"
        >
          <CheckCheck className="size-4" /> Mark all as read
        </button>
      </div>

      <div className="mb-4 flex gap-1 border-b">
        {(["all", "unread"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setShown(20);
            }}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t}
            {t === "unread" && unreadCount > 0 && ` (${unreadCount})`}
          </button>
        ))}
      </div>

      {page.length === 0 && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {tab === "unread" ? "You're all caught up." : "No Notifications yet."}
        </p>
      )}

      <ul className="divide-y rounded-lg border">
        {page.map((n) => {
          const isUnread = unread.has(n.id);
          return (
            <li
              key={n.id}
              className={cn("group relative flex items-start gap-3 p-4", isUnread && "bg-primary/5")}
            >
              <Avatar n={n} />
              <Link
                to={n.link}
                onClick={() => markRead(n.id)}
                className="min-w-0 flex-1 after:absolute after:inset-0"
              >
                <p className={cn("text-sm", isUnread ? "font-semibold" : "text-muted-foreground")}>
                  {n.text}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{relativeTime(n.createdAt)}</p>
              </Link>
              <button
                onClick={() => (isUnread ? markRead(n.id) : markUnread(n.id))}
                title={isUnread ? "Mark as read" : "Mark as unread"}
                className="relative z-10 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
              >
                {isUnread ? <Check className="size-4" /> : <Mail className="size-4" />}
              </button>
              {isUnread && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
            </li>
          );
        })}
      </ul>

      {shown < list.length && (
        <button
          onClick={() => setShown((s) => s + 20)}
          className="mt-4 w-full rounded-md border py-2 text-sm font-medium hover:bg-accent"
        >
          Load older ({list.length - shown} more)
        </button>
      )}
    </div>
  );
}

// ───────────────────────────── Variant B ─────────────────────────────

function HeaderBellB() {
  const { all, unread, seenUpTo, markSeen, markRead, markAllRead } =
    useNotificationsPrototype();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unseen = all.filter((n) => n.id > seenUpTo && unread.has(n.id)).length;

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

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        onClick={() => {
          setOpen((o) => !o);
          markSeen();
        }}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        title="Notifications"
      >
        <Bell className="size-5" />
        {unseen > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed left-56 top-2 z-50 ml-2 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-semibold">Notifications</span>
            <button
              onClick={markAllRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-[28rem] overflow-y-auto">
            {all.slice(0, 8).map((n) => {
              const isUnread = unread.has(n.id);
              return (
                <li key={n.id}>
                  <Link
                    to={n.link}
                    onClick={() => {
                      markRead(n.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex gap-3 border-l-2 px-4 py-3 hover:bg-accent",
                      isUnread ? "border-primary bg-primary/5" : "border-transparent"
                    )}
                  >
                    <Avatar n={n} />
                    <div className="min-w-0">
                      <p className={cn("text-sm leading-snug", !isUnread && "text-muted-foreground")}>
                        {n.text}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {relativeTime(n.createdAt)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t py-2.5 text-center text-sm font-medium hover:bg-accent"
          >
            See all {all.length} Notifications
          </Link>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Variant C ─────────────────────────────

const PAGE_C = 15;

function FooterButtonC({ onOpen }: { onOpen: () => void }) {
  const { unreadCount } = useNotificationsPrototype();
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {unreadCount > 0 ? (
        <BellDot className="size-4 text-primary" />
      ) : (
        <Bell className="size-4" />
      )}
      Notifications
    </button>
  );
}

function DrawerC({ onClose }: { onClose: () => void }) {
  const { all, unread, markRead } = useNotificationsPrototype();
  const [page, setPage] = useState(0);
  // What was unread when you opened it stays highlighted while it's open.
  const [highlight] = useState(() => new Set(unread));
  const shownIds = useRef(new Set<number>());
  const pages = Math.max(1, Math.ceil(all.length / PAGE_C));
  const slice = all.slice(page * PAGE_C, page * PAGE_C + PAGE_C);
  slice.forEach((n) => shownIds.current.add(n.id));

  function close() {
    shownIds.current.forEach((id) => markRead(id));
    onClose();
  }

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  });

  const groups: { label: string; items: StubNotification[] }[] = [];
  for (const n of slice) {
    const label = dayBucket(n.createdAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={close} />
      <aside className="relative flex h-full w-[26rem] flex-col border-l bg-background shadow-2xl">
        <div className="flex h-14 items-center justify-between border-b px-5">
          <span className="font-semibold">Notifications</span>
          <button onClick={close} className="rounded p-1 hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {groups.map((g) => (
            <section key={g.label}>
              <h3 className="sticky top-0 bg-background/95 px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                {g.label}
              </h3>
              <ul>
                {g.items.map((n) => (
                  <li key={n.id}>
                    <Link
                      to={n.link}
                      onClick={close}
                      className="flex items-baseline gap-3 px-5 py-2.5 hover:bg-accent"
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 translate-y-[-2px] rounded-full",
                          highlight.has(n.id) ? "bg-primary" : "bg-transparent"
                        )}
                      />
                      <span className={cn("flex-1 text-sm", highlight.has(n.id) && "font-medium")}>
                        {n.text}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(n.createdAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex items-center justify-center gap-1 border-t p-3">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={cn(
                "size-8 rounded text-sm",
                i === page ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function FooterC() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FooterButtonC onOpen={() => setOpen(true)} />
      {open && <DrawerC onClose={() => setOpen(false)} />}
    </>
  );
}

// ───────────────────────────── Slots ─────────────────────────────
// The sidebar renders these three slots; each variant fills the ones it uses.

export function NotificationsHeaderSlot({ variant }: { variant: NotificationVariant }) {
  return variant === "B" ? <HeaderBellB /> : null;
}

export function NotificationsNavSlot({ variant }: { variant: NotificationVariant }) {
  return variant === "A" ? <SidebarA /> : null;
}

export function NotificationsFooterSlot({ variant }: { variant: NotificationVariant }) {
  return variant === "C" ? <FooterC /> : null;
}

/** State readout + controls for the switcher bar. */
export function NotificationsPrototypeControls({ variant }: { variant: NotificationVariant }) {
  const { unreadCount, all, unread, seenUpTo, simulateNew, reset } = useNotificationsPrototype();
  const unseen = all.filter((n) => n.id > seenUpTo && unread.has(n.id)).length;
  return (
    <>
      <span>
        unread {unreadCount}/{all.length}
        {variant === "B" && ` · unseen ${unseen}`}
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

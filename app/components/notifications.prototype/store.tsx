// PROTOTYPE (issue #7): in-memory Notification store shared by the variants.
// Lives in the app layout, so it survives navigation and resets on reload
// or when you switch user in the DevUI panel.

import { createContext, useContext, useMemo, useState, useEffect } from "react";
import { UserRole } from "~/db/schema";
import {
  stubNotificationsFor,
  initialUnreadIds,
  type StubNotification,
} from "./data";

type Store = {
  all: StubNotification[];
  unread: Set<number>;
  /** Variant B only: newest id the bell was opened at. Badge counts unread newer than this. */
  seenUpTo: number;
  unreadCount: number;
  markRead: (id: number) => void;
  markUnread: (id: number) => void;
  markAllRead: () => void;
  markSeen: () => void;
  /** Simulate the ~60s poll finding a new Notification. */
  simulateNew: () => void;
  reset: () => void;
};

const Ctx = createContext<Store | null>(null);

export function NotificationsPrototypeProvider({
  role,
  isTeamAdmin,
  userId,
  children,
}: {
  role: UserRole | null;
  isTeamAdmin: boolean;
  userId: number | null;
  children: React.ReactNode;
}) {
  const seed = () => stubNotificationsFor(role, isTeamAdmin);
  const [all, setAll] = useState<StubNotification[]>(seed);
  const [unread, setUnread] = useState<Set<number>>(() => initialUnreadIds(all));
  const [seenUpTo, setSeenUpTo] = useState(0);

  const reset = () => {
    const fresh = seed();
    setAll(fresh);
    setUnread(initialUnreadIds(fresh));
    setSeenUpTo(0);
  };

  // Switching user in the DevUI resets the stub log.
  useEffect(reset, [userId, role, isTeamAdmin]);

  const store = useMemo<Store>(() => {
    return {
      all,
      unread,
      seenUpTo,
      unreadCount: unread.size,
      markRead: (id) =>
        setUnread((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        }),
      markUnread: (id) => setUnread((s) => new Set(s).add(id)),
      markAllRead: () => setUnread(new Set()),
      markSeen: () => setSeenUpTo(all[0]?.id ?? 0),
      simulateNew: () => {
        const template = all[Math.floor(Math.random() * Math.min(all.length, 6))];
        if (!template) return;
        const fresh: StubNotification = {
          ...template,
          id: (all[0]?.id ?? 1000) + 1,
          createdAt: new Date().toISOString(),
        };
        setAll((a) => [fresh, ...a]);
        setUnread((s) => new Set(s).add(fresh.id));
      },
      reset,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, unread, seenUpTo]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useNotificationsPrototype(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("NotificationsPrototypeProvider missing");
  return s;
}

// PROTOTYPE (issue #7): stub Notifications per role. In memory only, never
// touches the database. Wording follows the 11 launch Notification Types
// (issue #2). Links point at real seed routes so clicking them navigates.

import { UserRole } from "~/db/schema";

export type StubNotification = {
  id: number;
  typeKey: string;
  text: string;
  link: string;
  createdAt: string; // ISO
  actorName: string | null; // null = done by Cadence
};

type Template = Omit<StubNotification, "id" | "createdAt">;

const studentTemplates: Template[] = [
  {
    typeKey: "reply-to-your-comment",
    text: "Priya Shah replied to your comment on “Generics in practice”",
    link: "/courses/introduction-to-typescript/lessons/1",
    actorName: "Priya Shah",
  },
  {
    typeKey: "new-lesson-on-your-course",
    text: "New lesson on Building REST APIs with Node.js: “Rate limiting”",
    link: "/courses/building-rest-apis-with-nodejs/lessons/20",
    actorName: "Marcus Lee",
  },
  {
    typeKey: "course-archived",
    text: "Design Systems with Tailwind was archived. You can still watch every lesson.",
    link: "/courses/design-systems-with-tailwind",
    actorName: null,
  },
  {
    typeKey: "refund-request-decided",
    text: "Your Refund Request for Practical Data Visualisation was approved",
    link: "/courses/practical-data-visualisation",
    actorName: "Cadence",
  },
];

const instructorTemplates: Template[] = [
  {
    typeKey: "new-comment-on-your-lesson",
    text: "Ana Torres commented on “Generics in practice”",
    link: "/courses/introduction-to-typescript/lessons/1",
    actorName: "Ana Torres",
  },
  {
    typeKey: "student-enrolled",
    text: "Ben Okafor enrolled on Introduction to TypeScript",
    link: "/instructor/1/students",
    actorName: "Ben Okafor",
  },
  {
    typeKey: "student-rated",
    text: "Chloe Martin rated Introduction to TypeScript ★★★★☆",
    link: "/courses/introduction-to-typescript",
    actorName: "Chloe Martin",
  },
  {
    typeKey: "reply-to-your-comment",
    text: "Dev Patel replied to your comment on “Union types”",
    link: "/courses/introduction-to-typescript/lessons/1",
    actorName: "Dev Patel",
  },
  {
    typeKey: "refund-approved-on-your-course",
    text: "A refund was approved for Ben Okafor on Introduction to TypeScript",
    link: "/instructor/1/students",
    actorName: "Cadence",
  },
];

const teamAdminTemplates: Template[] = [
  {
    typeKey: "seat-claimed",
    text: "Elif Demir claimed a Seat on Shipping with Docker and Kubernetes (7 of 10)",
    link: "/team",
    actorName: "Elif Demir",
  },
  {
    typeKey: "all-seats-claimed",
    text: "All 10 Seats on Shipping with Docker and Kubernetes are claimed",
    link: "/team",
    actorName: null,
  },
];

const platformAdminTemplates: Template[] = [
  {
    typeKey: "new-refund-request",
    text: "New Refund Request from Ana Torres on Building REST APIs with Node.js",
    link: "/admin/refunds",
    actorName: "Ana Torres",
  },
  {
    typeKey: "new-refund-request",
    text: "New Refund Request from Felix Braun on Introduction to TypeScript",
    link: "/admin/refunds",
    actorName: "Felix Braun",
  },
];

/** 47 Notifications spread over ~5 weeks, newest first, so pagination bites. */
export function stubNotificationsFor(
  role: UserRole | null,
  isTeamAdmin: boolean
): StubNotification[] {
  if (!role) return [];
  const templates = [
    ...(role === UserRole.Student ? studentTemplates : []),
    ...(role === UserRole.Instructor ? instructorTemplates : []),
    ...(role === UserRole.Admin ? platformAdminTemplates : []),
    ...(isTeamAdmin ? teamAdminTemplates : []),
  ];
  if (templates.length === 0) return [];

  const now = Date.now();
  const out: StubNotification[] = [];
  for (let i = 0; i < 47; i++) {
    const t = templates[(i * 7) % templates.length];
    // First few minutes apart, then hours, then days.
    const ageMinutes = i < 4 ? i * 9 + 2 : i < 12 ? (i - 3) * 140 : (i - 10) * 1100;
    out.push({
      ...t,
      id: 1000 - i,
      createdAt: new Date(now - ageMinutes * 60_000).toISOString(),
    });
  }
  return out;
}

/** The first 5 are unread to start, plus a couple of older stragglers. */
export function initialUnreadIds(list: StubNotification[]): Set<number> {
  return new Set(list.filter((_, i) => i < 5 || i === 9 || i === 14).map((n) => n.id));
}

export function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function dayBucket(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

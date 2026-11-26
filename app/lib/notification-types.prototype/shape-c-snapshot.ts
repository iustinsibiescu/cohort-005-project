// PROTOTYPE, throwaway. Answers: what does defining a Notification Type look like?
// Shape C: snapshot the data, render the words at display time.
// Stored row = { type, params } where params are a typed snapshot (ids *and* the
// names as they were). Wording is a pure function of the snapshot, so copy
// changes reach old Notifications, but a renamed course keeps its old name.

import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  comments,
  courses,
  enrollments,
  lessons,
  modules,
  purchases,
  refunds,
  users,
  RefundStatus,
  UserRole,
} from "~/db/schema";
import type { Db } from "~/lib/refunds.server";

export function defineNotificationType<I, P extends z.ZodTypeAny>(def: {
  key: string;
  // Runtime-checked shape of what's stored.
  params: P;
  // At raise: turn "what happened" into a snapshot + who gets it.
  raise: (db: Db, input: I) => { params: z.infer<P>; recipients: number[] };
  // At display: pure, no db.
  text: (p: z.infer<P>) => string;
  link: (p: z.infer<P>) => string;
  email?: (p: z.infer<P>) => { subject: string; body: string };
}) {
  return def;
}

const course = z.object({ id: z.number(), title: z.string(), slug: z.string() });

function lessonContext(db: Db, lessonId: number) {
  const r = db
    .select({ lessonTitle: lessons.title, id: courses.id, title: courses.title, slug: courses.slug })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(lessons.id, lessonId))
    .get()!;
  return { lesson: { id: lessonId, title: r.lessonTitle }, course: { id: r.id, title: r.title, slug: r.slug } };
}

const enrolled = (db: Db, courseId: number) =>
  db.select({ id: enrollments.userId }).from(enrollments).where(eq(enrollments.courseId, courseId)).all().map((r) => r.id);

const replyToYourComment = defineNotificationType({
  key: "reply_to_your_comment",
  params: z.object({
    replyId: z.number(),
    replier: z.string(),
    lesson: z.object({ id: z.number(), title: z.string() }),
    course,
  }),
  raise: (db, { replyId }: { replyId: number }) => {
    const reply = db.select().from(comments).where(eq(comments.id, replyId)).get()!;
    const parent = db.select().from(comments).where(eq(comments.id, reply.parentId!)).get()!;
    const replier = db.select().from(users).where(eq(users.id, reply.userId)).get()!;
    return {
      params: { replyId, replier: replier.name, ...lessonContext(db, reply.lessonId) },
      recipients: parent.userId === reply.userId ? [] : [parent.userId],
    };
  },
  text: (p) => `${p.replier} replied to your comment on "${p.lesson.title}"`,
  link: (p) => `/courses/${p.course.slug}/lessons/${p.lesson.id}#comment-${p.replyId}`,
});

const newLessonOnYourCourse = defineNotificationType({
  key: "new_lesson_on_your_course",
  params: z.object({ lesson: z.object({ id: z.number(), title: z.string() }), course }),
  raise: (db, { lessonId }: { lessonId: number }) => {
    const ctx = lessonContext(db, lessonId);
    return { params: ctx, recipients: enrolled(db, ctx.course.id) };
  },
  text: (p) => `New lesson on ${p.course.title}: "${p.lesson.title}"`,
  link: (p) => `/courses/${p.course.slug}`,
});

const refundRequestDecided = defineNotificationType({
  key: "refund_request_decided",
  params: z.object({ refundId: z.number(), approved: z.boolean(), course }),
  raise: (db, { refundId }: { refundId: number }) => {
    const r = db
      .select({ status: refunds.status, buyer: purchases.userId, id: courses.id, title: courses.title, slug: courses.slug })
      .from(refunds)
      .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
      .innerJoin(courses, eq(courses.id, purchases.courseId))
      .where(eq(refunds.id, refundId))
      .get()!;
    return {
      params: { refundId, approved: r.status === RefundStatus.Approved, course: { id: r.id, title: r.title, slug: r.slug } },
      recipients: [r.buyer],
    };
  },
  text: (p) => `Your refund request for ${p.course.title} was ${p.approved ? "approved" : "declined"}`,
  link: (p) => `/courses/${p.course.slug}`,
  email: (p) => ({ subject: `Refund ${p.approved ? "approved" : "declined"} — ${p.course.title}`, body: "…" }),
});

const newRefundRequest = defineNotificationType({
  key: "new_refund_request",
  params: z.object({ refundId: z.number(), buyer: z.string(), course }),
  raise: (db, { refundId }: { refundId: number }) => {
    const r = db
      .select({ buyer: users.name, id: courses.id, title: courses.title, slug: courses.slug })
      .from(refunds)
      .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
      .innerJoin(users, eq(users.id, purchases.userId))
      .innerJoin(courses, eq(courses.id, purchases.courseId))
      .where(eq(refunds.id, refundId))
      .get()!;
    return {
      params: { refundId, buyer: r.buyer, course: { id: r.id, title: r.title, slug: r.slug } },
      recipients: db.select({ id: users.id }).from(users).where(eq(users.role, UserRole.Admin)).all().map((u) => u.id),
    };
  },
  text: (p) => `${p.buyer} asked for a refund on ${p.course.title}`,
  link: () => "/admin/refunds",
  email: (p) => ({ subject: `New refund request — ${p.course.title}`, body: "…" }),
});

// ─── The test: adding "Announcement posted" ───
const announcementPosted = defineNotificationType({
  key: "announcement_posted",
  params: z.object({ title: z.string(), course }),
  raise: (db, { courseId, title }: { courseId: number; title: string }) => {
    const c = db.select().from(courses).where(eq(courses.id, courseId)).get()!;
    return { params: { title, course: { id: c.id, title: c.title, slug: c.slug } }, recipients: enrolled(db, courseId) };
  },
  text: (p) => `${p.course.title}: ${p.title}`,
  link: (p) => `/courses/${p.course.slug}#announcements`,
});

export const notificationTypes = {
  reply_to_your_comment: replyToYourComment,
  new_lesson_on_your_course: newLessonOnYourCourse,
  refund_request_decided: refundRequestDecided,
  new_refund_request: newRefundRequest,
  announcement_posted: announcementPosted,
} as const;
export type NotificationTypeKey = keyof typeof notificationTypes;
type InputOf<K extends NotificationTypeKey> = Parameters<(typeof notificationTypes)[K]["raise"]>[1];

type Stored = { type: NotificationTypeKey; params: unknown; recipients: number[] };

export function raise<K extends NotificationTypeKey>(db: Db, type: K, input: InputOf<K>): Stored {
  const def = notificationTypes[type] as any;
  const out = def.raise(db, input);
  return { type, params: def.params.parse(out.params), recipients: out.recipients };
}

export function show(_db: Db, n: Stored) {
  const def = notificationTypes[n.type] as any;
  const p = def.params.parse(n.params);
  return { text: def.text(p) as string, link: def.link(p) as string };
}

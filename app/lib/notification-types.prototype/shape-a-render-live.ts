// PROTOTYPE, throwaway. Answers: what does defining a Notification Type look like?
// Shape A: store ids, render live. Stored row = { type, params: ids only }.
// Text and link are worked out every time the Notification is shown, from
// whatever the database says *now*. (Noticed-style.)

import { and, eq, isNull } from "drizzle-orm";
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

type Shown = { text: string; link: string };

export function defineNotificationType<P extends z.ZodTypeAny, D>(def: {
  key: string;
  params: P;
  // Called once, when the Notification is raised.
  recipients: (db: Db, params: z.infer<P>) => number[];
  // Called every time it is shown. Null = the thing it pointed at is gone.
  load: (db: Db, params: z.infer<P>) => D | null;
  show: (data: D) => Shown;
  email?: (data: D) => { subject: string; body: string };
}) {
  return def;
}

// ─── Launch types (a sample) ───

const replyToYourComment = defineNotificationType({
  key: "reply_to_your_comment",
  params: z.object({ replyId: z.number() }),
  recipients: (db, { replyId }) => {
    const reply = db.select().from(comments).where(eq(comments.id, replyId)).get()!;
    const parent = db.select().from(comments).where(eq(comments.id, reply.parentId!)).get()!;
    return parent.userId === reply.userId ? [] : [parent.userId];
  },
  load: (db, { replyId }) =>
    db
      .select({
        replier: users.name,
        lessonId: lessons.id,
        lessonTitle: lessons.title,
        courseSlug: courses.slug,
        deletedAt: comments.deletedAt,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .innerJoin(lessons, eq(lessons.id, comments.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .innerJoin(courses, eq(courses.id, modules.courseId))
      .where(and(eq(comments.id, replyId), isNull(comments.deletedAt)))
      .get() ?? null,
  show: (d) => ({
    text: `${d.replier} replied to your comment on "${d.lessonTitle}"`,
    link: `/courses/${d.courseSlug}/lessons/${d.lessonId}#comment`,
  }),
});

const newLessonOnYourCourse = defineNotificationType({
  key: "new_lesson_on_your_course",
  params: z.object({ lessonId: z.number() }),
  recipients: (db, { lessonId }) =>
    db
      .select({ id: enrollments.userId })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .innerJoin(enrollments, eq(enrollments.courseId, modules.courseId))
      .where(eq(lessons.id, lessonId))
      .all()
      .map((r) => r.id),
  load: (db, { lessonId }) =>
    db
      .select({ lessonTitle: lessons.title, courseTitle: courses.title, courseSlug: courses.slug })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .innerJoin(courses, eq(courses.id, modules.courseId))
      .where(eq(lessons.id, lessonId))
      .get() ?? null,
  show: (d) => ({
    text: `New lesson on ${d.courseTitle}: "${d.lessonTitle}"`,
    link: `/courses/${d.courseSlug}`,
  }),
});

const refundRequestDecided = defineNotificationType({
  key: "refund_request_decided",
  params: z.object({ refundId: z.number() }),
  recipients: (db, { refundId }) => {
    const row = db
      .select({ buyer: purchases.userId })
      .from(refunds)
      .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
      .where(eq(refunds.id, refundId))
      .get()!;
    return [row.buyer];
  },
  load: (db, { refundId }) =>
    db
      .select({ status: refunds.status, courseTitle: courses.title, courseSlug: courses.slug })
      .from(refunds)
      .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
      .innerJoin(courses, eq(courses.id, purchases.courseId))
      .where(eq(refunds.id, refundId))
      .get() ?? null,
  show: (d) => ({
    text: `Your refund request for ${d.courseTitle} was ${d.status === RefundStatus.Approved ? "approved" : "declined"}`,
    link: `/courses/${d.courseSlug}`,
  }),
  email: (d) => ({ subject: `Refund ${d.status} — ${d.courseTitle}`, body: "…" }),
});

const newRefundRequest = defineNotificationType({
  key: "new_refund_request",
  params: z.object({ refundId: z.number() }),
  recipients: (db) =>
    db.select({ id: users.id }).from(users).where(eq(users.role, UserRole.Admin)).all().map((r) => r.id),
  load: (db, { refundId }) =>
    db
      .select({ buyer: users.name, courseTitle: courses.title })
      .from(refunds)
      .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
      .innerJoin(users, eq(users.id, purchases.userId))
      .innerJoin(courses, eq(courses.id, purchases.courseId))
      .where(eq(refunds.id, refundId))
      .get() ?? null,
  show: (d) => ({ text: `${d.buyer} asked for a refund on ${d.courseTitle}`, link: "/admin/refunds" }),
  email: (d) => ({ subject: `New refund request — ${d.courseTitle}`, body: "…" }),
});

// ─── The test: adding "Announcement posted" ───
// Announcements don't exist, so this pretends there's an `announcements` table.
// Under Shape A that table *must* exist and be joinable, or there's nothing to load.
const announcementPosted = defineNotificationType({
  key: "announcement_posted",
  params: z.object({ courseId: z.number(), announcementId: z.number() }),
  recipients: (db, { courseId }) =>
    db.select({ id: enrollments.userId }).from(enrollments).where(eq(enrollments.courseId, courseId)).all().map((r) => r.id),
  load: (db, { courseId }) => {
    const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
    // + a join to announcements for its title, in real life
    return course ? { courseTitle: course.title, courseSlug: course.slug, title: "(announcement title)" } : null;
  },
  show: (d) => ({ text: `${d.courseTitle}: ${d.title}`, link: `/courses/${d.courseSlug}#announcements` }),
});

// ─── Registry: one line per type ───
export const notificationTypes = {
  reply_to_your_comment: replyToYourComment,
  new_lesson_on_your_course: newLessonOnYourCourse,
  refund_request_decided: refundRequestDecided,
  new_refund_request: newRefundRequest,
  announcement_posted: announcementPosted,
} as const;
export type NotificationTypeKey = keyof typeof notificationTypes;

// ─── Engine (what the developer never touches) ───
type Stored = { type: NotificationTypeKey; params: unknown; recipients: number[] };

export function raise<K extends NotificationTypeKey>(
  db: Db,
  type: K,
  params: z.infer<(typeof notificationTypes)[K]["params"]>
): Stored {
  const def = notificationTypes[type] as any;
  const p = def.params.parse(params);
  return { type, params: p, recipients: def.recipients(db, p) };
}

export function show(db: Db, n: Stored): Shown | null {
  const def = notificationTypes[n.type] as any;
  const data = def.load(db, def.params.parse(n.params));
  return data ? def.show(data) : null;
}

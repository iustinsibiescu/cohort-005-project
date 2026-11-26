// PROTOTYPE, throwaway. Answers: what does defining a Notification Type look like?
// Shape B: render once, store the text. Stored row = { type, text, link }.
// One function per type does everything at the moment it is raised. (Knock-style.)

import { eq } from "drizzle-orm";
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

type Raised = {
  recipients: number[];
  text: string;
  link: string;
  email?: { subject: string; body: string };
};

// A Notification Type is just a function from "what happened" to "what to store".
export function defineNotificationType<I>(def: {
  key: string;
  raise: (db: Db, input: I) => Raised;
}) {
  return def;
}

function lessonContext(db: Db, lessonId: number) {
  return db
    .select({ lessonTitle: lessons.title, courseId: courses.id, courseTitle: courses.title, courseSlug: courses.slug })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(lessons.id, lessonId))
    .get()!;
}

const replyToYourComment = defineNotificationType({
  key: "reply_to_your_comment",
  raise: (db, { replyId }: { replyId: number }) => {
    const reply = db.select().from(comments).where(eq(comments.id, replyId)).get()!;
    const parent = db.select().from(comments).where(eq(comments.id, reply.parentId!)).get()!;
    const replier = db.select().from(users).where(eq(users.id, reply.userId)).get()!;
    const ctx = lessonContext(db, reply.lessonId);
    return {
      recipients: parent.userId === reply.userId ? [] : [parent.userId],
      text: `${replier.name} replied to your comment on "${ctx.lessonTitle}"`,
      link: `/courses/${ctx.courseSlug}/lessons/${reply.lessonId}#comment-${reply.id}`,
    };
  },
});

const newLessonOnYourCourse = defineNotificationType({
  key: "new_lesson_on_your_course",
  raise: (db, { lessonId }: { lessonId: number }) => {
    const ctx = lessonContext(db, lessonId);
    return {
      recipients: db
        .select({ id: enrollments.userId })
        .from(enrollments)
        .where(eq(enrollments.courseId, ctx.courseId))
        .all()
        .map((r) => r.id),
      text: `New lesson on ${ctx.courseTitle}: "${ctx.lessonTitle}"`,
      link: `/courses/${ctx.courseSlug}`,
    };
  },
});

const refundRequestDecided = defineNotificationType({
  key: "refund_request_decided",
  raise: (db, { refundId }: { refundId: number }) => {
    const r = db
      .select({ status: refunds.status, buyer: purchases.userId, courseTitle: courses.title, courseSlug: courses.slug })
      .from(refunds)
      .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
      .innerJoin(courses, eq(courses.id, purchases.courseId))
      .where(eq(refunds.id, refundId))
      .get()!;
    const verdict = r.status === RefundStatus.Approved ? "approved" : "declined";
    return {
      recipients: [r.buyer],
      text: `Your refund request for ${r.courseTitle} was ${verdict}`,
      link: `/courses/${r.courseSlug}`,
      email: { subject: `Refund ${verdict} — ${r.courseTitle}`, body: "…" },
    };
  },
});

const newRefundRequest = defineNotificationType({
  key: "new_refund_request",
  raise: (db, { refundId }: { refundId: number }) => {
    const r = db
      .select({ buyer: users.name, courseTitle: courses.title })
      .from(refunds)
      .innerJoin(purchases, eq(purchases.id, refunds.purchaseId))
      .innerJoin(users, eq(users.id, purchases.userId))
      .innerJoin(courses, eq(courses.id, purchases.courseId))
      .where(eq(refunds.id, refundId))
      .get()!;
    return {
      recipients: db.select({ id: users.id }).from(users).where(eq(users.role, UserRole.Admin)).all().map((u) => u.id),
      text: `${r.buyer} asked for a refund on ${r.courseTitle}`,
      link: "/admin/refunds",
      email: { subject: `New refund request — ${r.courseTitle}`, body: "…" },
    };
  },
});

// ─── The test: adding "Announcement posted" ───
// Only needs what the caller hands it. No announcements table required to show it later.
const announcementPosted = defineNotificationType({
  key: "announcement_posted",
  raise: (db, { courseId, title }: { courseId: number; title: string }) => {
    const course = db.select().from(courses).where(eq(courses.id, courseId)).get()!;
    return {
      recipients: db.select({ id: enrollments.userId }).from(enrollments).where(eq(enrollments.courseId, courseId)).all().map((r) => r.id),
      text: `${course.title}: ${title}`,
      link: `/courses/${course.slug}#announcements`,
    };
  },
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

type Stored = { type: NotificationTypeKey; text: string; link: string; recipients: number[] };

export function raise<K extends NotificationTypeKey>(db: Db, type: K, input: InputOf<K>): Stored {
  const out = (notificationTypes[type].raise as (db: Db, i: InputOf<K>) => Raised)(db, input);
  return { type, text: out.text, link: out.link, recipients: out.recipients };
}

export function show(_db: Db, n: Stored) {
  return { text: n.text, link: n.link };
}

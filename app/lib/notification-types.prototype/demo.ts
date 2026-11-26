// PROTOTYPE, throwaway. Run: npx tsx app/lib/notification-types.prototype/demo.ts
// Raises the same Notifications under all three shapes, then changes the world
// (rename the course, delete the reply) and shows what each shape now displays.

import { eq } from "drizzle-orm";
import * as s from "~/db/schema";
import { createTestDb } from "~/test/setup";
import * as A from "./shape-a-render-live";
import * as B from "./shape-b-frozen-text";
import * as C from "./shape-c-snapshot";

const db = createTestDb();
const ins = <T extends Parameters<typeof db.insert>[0]>(t: T, v: any) => db.insert(t).values(v).returning().get() as any;

const ana = ins(s.users, { name: "Ana (Student)", email: "ana@x", role: s.UserRole.Student });
const ben = ins(s.users, { name: "Ben (Student)", email: "ben@x", role: s.UserRole.Student });
const ivy = ins(s.users, { name: "Ivy (Instructor)", email: "ivy@x", role: s.UserRole.Instructor });
ins(s.users, { name: "Pat (Platform Admin)", email: "pat@x", role: s.UserRole.Admin });
const cat = ins(s.categories, { name: "Code", slug: "code" });
const course = ins(s.courses, {
  title: "Intro to SQL", slug: "intro-to-sql", description: "d", salesCopy: "x",
  instructorId: ivy.id, categoryId: cat.id, status: s.CourseStatus.Published,
});
const mod = ins(s.modules, { courseId: course.id, title: "M1", position: 1 });
const lesson = ins(s.lessons, { moduleId: mod.id, title: "Joins", position: 1 });
ins(s.enrollments, { userId: ana.id, courseId: course.id });
ins(s.enrollments, { userId: ben.id, courseId: course.id });
const top = ins(s.comments, { lessonId: lesson.id, userId: ana.id, body: "How do joins work?" });
const reply = ins(s.comments, { lessonId: lesson.id, userId: ben.id, parentId: top.id, body: "Like this" });
const purchase = ins(s.purchases, { userId: ana.id, courseId: course.id, amountPaid: 5000 });
const refund = ins(s.refunds, { purchaseId: purchase.id, reason: "meh", status: s.RefundStatus.Approved });

const cases = [
  ["reply_to_your_comment", { replyId: reply.id }],
  ["new_lesson_on_your_course", { lessonId: lesson.id }],
  ["refund_request_decided", { refundId: refund.id }],
  ["new_refund_request", { refundId: refund.id }],
  ["announcement_posted", { courseId: course.id, announcementId: 1, title: "Office hours moved" }],
] as const;

const shapes = { "A live": A, "B frozen text": B, "C snapshot": C } as const;
const raised = Object.fromEntries(
  Object.entries(shapes).map(([name, m]) => [name, cases.map(([t, p]) => (m.raise as any)(db, t, p))])
);

function print(when: string) {
  console.log(`\n━━━ ${when} ━━━`);
  for (const [name, m] of Object.entries(shapes)) {
    console.log(`\n  ${name}`);
    for (const n of raised[name]) {
      const shown = m.show(db, n);
      console.log(`    ${n.type.padEnd(26)} → ${shown ? shown.text : "(hidden: source gone)"}`);
    }
  }
}

console.log("Stored rows, per shape (one example):");
for (const [name] of Object.entries(shapes)) {
  const { recipients, ...rest } = raised[name][1];
  console.log(`  ${name.padEnd(14)} ${JSON.stringify(rest)}   recipients=${JSON.stringify(recipients)}`);
}

print("When raised");

db.update(s.courses).set({ title: "SQL from Zero" }).where(eq(s.courses.id, course.id)).run();
db.update(s.comments).set({ deletedAt: new Date().toISOString() }).where(eq(s.comments.id, reply.id)).run();

print("After: course renamed to 'SQL from Zero', Ben deleted his reply");

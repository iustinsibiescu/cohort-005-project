# How notification systems define a Notification Type

## Question

How do established notification systems and libraries let a developer define a new Notification Type in one place? Specifically:

1. How a type declares its text/template, its Recipients, and its link target.
2. Whether they store rendered text or structured data that is rendered at display time, and what each choice costs (renaming a course later, changing copy, i18n, deleted entities, query cost).
3. How one Notification fans out to many Recipients with per-Recipient read state.

Researched 2026-11-26 against official docs, API references and source code only. Each claim links to the page it came from. Anything I could not confirm is marked **Unverified**.

## Summary

- **Code-first libraries (Noticed, Laravel, django-notifications) make each Notification Type a class or call site in app code.** Text, Recipients and URL sit next to each other there. Hosted services (Novu, Knock) model a type as a "workflow", defined in a dashboard or in code (Novu Framework, Knock CLI/Management API).
- **Noticed v2 keeps text and URL out of the database.** It stores `params` (JSON) and evaluates `message` and `url` methods whenever they are called, which is usually at display time. Laravel stores whatever array `toArray()` returns, so the app decides whether that is ids, copy, or both.
- **Hosted services fix the content when the message is generated.** Knock says in-app message "content and other metadata can't be changed once Knock generates it", and its feed blocks carry both `content` and `rendered` HTML. Novu's in-app step returns literal `subject`, `body` and `redirect.url` strings at execution time.
- **There are three fan-out shapes:**
  - one row per Recipient, with the payload repeated on every row (Laravel, django-notifications);
  - one event row plus a thin per-Recipient row (Noticed v2: `noticed_events` plus `noticed_notifications`);
  - one message per Recipient per channel (Novu, Knock, GitHub threads).
- **Every system tracks read state per Recipient.** Laravel has only `read_at`. django-notifications has only an `unread` boolean. Noticed adds `seen_at`. Knock and Novu track seen, read, archived and interacted. GitHub has `unread` and `last_read_at`, plus "mark as done".
- **Recipients are fixed when the Notification is raised, in every system checked.** Noticed bulk-inserts one notification row per Recipient inside the same transaction that saves the event.
- **Hosted services cap how many Recipients one trigger can take.** Novu allows 100 per `to` and Knock allows 1,000 per trigger. Noticed and Laravel have no cap, so fan-out cost is the app's problem.

---

## 1. Noticed (Rails gem, v2)

**How a type is defined.** A type is a Ruby class that inherits from `Noticed::Event`. The class declares delivery methods with `deliver_by` or `bulk_deliver_by`, and optionally `required_params`, Recipients, and a `notification_methods` block holding `message` and `url` ([README](https://github.com/excid3/noticed)):

```ruby
class NewCommentNotifier < Noticed::Event
  deliver_by :email do |config| ... end
  bulk_deliver_by :discord do |config| ... end
  # recipients ->{ params[:record].thread.all_authors }   (from README tip)
  notification_methods do
    def message = t(".message")
    def url = user_post_path(recipient, params[:post])
  end
end

NewCommentNotifier.with(record: @comment, foo: "bar").deliver(@comment.thread.all_authors)
```

- **Text.** `message` is usually `t(".message")`, which resolves to `notifiers.<notifier_name>.notification.message` in the locale file. Text is therefore an i18n lookup run when the method is called, not a stored string ([README](https://github.com/excid3/noticed)).
- **Recipients.** Recipients are passed to `.deliver(...)`, or declared in the notifier as a lambda, block or method symbol, in which case `.deliver` takes no argument ([README](https://github.com/excid3/noticed)).
- **Link target.** `url` is a method that uses Rails URL helpers, so `default_url_options` must be set ([README](https://github.com/excid3/noticed)).
- **Required data.** `required_params :branch` raises `Noticed::ValidationError` when the param is missing ([README](https://github.com/excid3/noticed)).

**Storage.** The migration creates two tables ([migration](https://raw.githubusercontent.com/excid3/noticed/main/db/migrate/20231215190233_create_noticed_tables.rb)):

| Table | Columns |
| --- | --- |
| `noticed_events` | `type` (notifier class), polymorphic `record` ("the record/object this notification is _about_"), `params` (`jsonb` when supported, else `json`), timestamps |
| `noticed_notifications` | `type`, `event_id` (required), polymorphic `recipient` (required), `read_at`, `seen_at`, timestamps |

The README notes that `params` can back generated "virtual columns", for example `url` or `organization_id`, if you need to query them ([README](https://github.com/excid3/noticed)). Rendered text is never stored. `message` and `url` are recomputed from `params` plus the current locale and current records.

**Fan-out.** "This invocation will create a single `Noticed::Event` record and a `Noticed::Notification` record for each recipient" ([README](https://github.com/excid3/noticed)). In source, `deliver` runs one transaction that saves the event, sets `notifications_count`, calls `notifications.insert_all!(recipients_attributes, record_timestamps: true)`, and then enqueues `EventJob` for the other channels once the transaction commits ([deliverable.rb](https://raw.githubusercontent.com/excid3/noticed/main/app/models/concerns/noticed/deliverable.rb)).

**Read state.** Each Recipient's row has its own `read_at` and `seen_at` ([migration](https://raw.githubusercontent.com/excid3/noticed/main/db/migrate/20231215190233_create_noticed_tables.rb)).

- Scopes: `newest_first`, `read`, `unread`.
- Methods: `mark_as_read`, `mark_as_unread` (and the `!` forms), `read?`, `unread?`.
- The README says "your app must choose when and where to call" `mark_as_read` ([README](https://github.com/excid3/noticed)).
- The README does not explain what `seen_at` means or show a `seen` scope.

**Deleted entities.** The README recommends `has_many :notifications, as: :recipient, dependent: :destroy` on the Recipient model and `has_many :noticed_events, as: :record, dependent: :destroy` on the subject record. It warns that deleted records can cause `ActiveJob::DeserializationError` when params are deserialized ([README](https://github.com/excid3/noticed)). Deleting the subject record therefore deletes its Notifications too, unless the app does something else.

## 2. Laravel Notifications

**How a type is defined.** A type is a class extending `Notification`:

- `via($notifiable)` chooses channels, for example `['mail', 'database']`.
- `toDatabase` or `toArray` returns the stored payload.
- `toMail` builds the email.

([docs](https://laravel.com/docs/12.x/notifications))

```php
public function via(object $notifiable): array
{ return $notifiable->prefers_sms ? ['vonage'] : ['mail', 'database']; }

public function toArray(object $notifiable): array
{ return ['invoice_id' => $this->invoice->id, 'amount' => $this->invoice->amount]; }
```

- **Text and link target.** Laravel defines no fields for these. Whatever array `toArray()` returns "will be encoded as JSON and stored in the `data` column", and the app's view decides how to show it ([docs](https://laravel.com/docs/12.x/notifications)). The payload can hold ids, ready-made strings, or both.
- **Recipients.** Recipients are passed by the caller: `Notification::send($users, new InvoicePaid($invoice))` or `$user->notify(...)`. They are not declared on the class ([docs](https://laravel.com/docs/12.x/notifications)). `toArray` receives each `$notifiable`, so the payload can differ per Recipient.
- **Type key.** `type` defaults to the class name and can be overridden with `databaseType()`. That matters because renaming the PHP class otherwise changes the stored key ([docs](https://laravel.com/docs/12.x/notifications)).

**Storage.** The `make:notifications-table` stub defines `uuid id` primary key, `string type`, `morphs('notifiable')`, `text data`, `timestamp read_at` (nullable), and timestamps ([stub](https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Notifications/Console/stubs/notifications.stub)).

**Fan-out.** `DatabaseChannel::send()` makes one `create()` call for each notifiable, writing `id`, `type`, `data` and `read_at` ([DatabaseChannel.php](https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Notifications/Channels/DatabaseChannel.php)). The result is one row per Recipient, with `data` copied onto every row. No separate event table exists. When queued, "a queued job will be created for each recipient and channel combination" ([docs](https://laravel.com/docs/12.x/notifications)).

**Read state.** Each row has its own `read_at`. Laravel provides:

- `$user->notifications`, newest `created_at` first;
- `unreadNotifications` and `readNotifications`;
- `markAsRead()` on one row or a collection;
- a mass update: `$user->unreadNotifications()->update(['read_at' => now()])`.

There is no seen or archived field ([docs](https://laravel.com/docs/12.x/notifications)).

## 3. Novu

**How a type is defined.** A "workflow defines the end-to-end process for delivering a notification to one or more subscribers". Workflows are built in the dashboard Workflow Editor or in code with Novu Framework ([workflows](https://docs.novu.co/platform/concepts/workflows)). In code, `workflow(workflowId, handler, options)` takes a `payloadSchema` (Zod) that validates the trigger payload ([workflow()](https://docs.novu.co/framework/typescript/workflow)):

```ts
workflow('order-shipped', async ({ step, payload }) => {
  await step.inApp('send-in-app', async () => ({
    body: `Your order ${payload.orderId} has shipped.`,
  }));
}, { payloadSchema: z.object({ orderId: z.string() }) });
```

- **Text and link target.** The in-app step returns ([inApp step](https://docs.novu.co/framework/typescript/steps/inApp)):
  - `subject` and `body` (`body` is required);
  - `avatar`;
  - `redirect: { url, target }`, where `url` must be absolute http(s), root-relative (`/...`), or built from Liquid variables;
  - `primaryAction` and `secondaryAction`, each `{ label, redirect }`;
  - free-form `data`.
- **Recipients.** The trigger's `to` takes a subscriber id, an array of ids or subscriber objects, or topics. "Maximum number of recipients can be 100." Topic triggers accept an `exclude` list. Trigger is "the main (and only) way to send notifications to subscribers" ([trigger API](https://docs.novu.co/api-reference/events/trigger-event)).

**Storage.**

- The step resolver returns finished strings, built from `payload` with template literals, when the workflow executes ([inApp step](https://docs.novu.co/framework/typescript/steps/inApp)).
- The client `Notification` object exposes `subject`, `body`, `redirect`, `primaryAction` and `data` ([JS SDK](https://docs.novu.co/platform/sdks/javascript)).
- The trigger payload "can be returned when fetching the notifications feed" ([trigger API](https://docs.novu.co/api-reference/events/trigger-event)).
- **Unverified:** whether Novu persists rendered text per message, or can re-render it after a workflow edit. No official page I read states this outright.

**Fan-out and read state.** Per-Recipient state lives on each subscriber's notification ([JS SDK](https://docs.novu.co/platform/sdks/javascript)):

- Fields: `isRead`, `isSeen`, `isArchived`, `isSnoozed`, `readAt`, `firstSeenAt`, `archivedAt`.
- Methods: `read()`, `unread()`, `seen()`, `archive()`, `unarchive()`, `delete()`, `snooze()`, and bulk `seenAll()`.
- "Seen" is "automatically tracked when visible". "Read" is "explicitly marked by user interaction". "Once a notification has been seen by a user, it remains seen".
- **Unverified:** whether storage is exactly one message row per subscriber per step. The workflows page implies per-subscriber step execution but does not state the record count ([workflows](https://docs.novu.co/platform/concepts/workflows)).

## 4. Knock

**How a type is defined.** A type is a workflow made of channel steps. Templates are written in Liquid with `{{ data.x }}`, `{{ recipient.name }}` and `{{ actor.name }}`, and can be managed "as code" through the Knock CLI or Management API, with versioned commits ([template editor](https://docs.knock.app/designing-workflows/template-editor/overview)).

- **Link target.** The in-app feed template has a "click action" URL that is "a static URL, or ... a dynamic URL using a Liquid variable". It also has single-action and multi-action button variants ([in-app channel](https://docs.knock.app/integrations/in-app/knock)).
- **Recipients and data.** A trigger takes `recipients`, `data`, and an optional `actor`. "You can trigger a workflow for up to 1000 recipients at a time". `data` is "a map of properties that are required in the templates in this workflow". A trigger returns one workflow run id, and each Recipient gets its own derived recipient run ([trigger API](https://docs.knock.app/send-notifications/triggering-workflows/api)).

**Storage: rendered at generation time.**

- "In-app feed messages in Knock are generated when a workflow runs for a recipient", and "its content and other metadata can't be changed once Knock generates it". To fix outdated content, archive the message and trigger again ([feeds overview](https://docs.knock.app/in-app-ui/feeds/overview), [in-app channel](https://docs.knock.app/integrations/in-app/knock)).
- In the OpenAPI spec, `InAppFeedItem` has `blocks`, where each `MessageInAppFeedContentBlock` has `name`, `type`, `content` and `rendered` ("The rendered HTML version of the content"), plus `data`, `actors`, `activities`, `source` and `tenant` ([openapi.json](https://docs.knock.app/openapi.json)).
- The Message object also has `data`, which holds the trigger payload ([messages API](https://docs.knock.app/api-reference/messages)).
- Each item stores both the rendered snapshot and the raw data.

**Fan-out and read state.** "A Message in Knock represents a notification delivered to a User or an Object on a particular channel" ([messages concept](https://docs.knock.app/concepts/messages)).

- Per-message fields: `seen_at`, `read_at`, `archived_at`, `interacted_at`, `link_clicked_at`, and an `engagement_statuses` list ([messages API](https://docs.knock.app/api-reference/messages)).
- Each state has a PUT/DELETE pair, for example `PUT /v1/messages/{id}/read`, and batch endpoints such as `POST /v1/messages/batch/read` ([messages API](https://docs.knock.app/api-reference/messages)).
- Archived messages are "hidden from the default message list in the feed but can still be accessed and unarchived later" ([messages API](https://docs.knock.app/api-reference/messages)).
- Feed metadata returns `total_count`, `unread_count` and `unseen_count` ([openapi.json](https://docs.knock.app/openapi.json)).

## 5. GitHub notifications REST API

GitHub has no developer-defined types. It is included because its read model is mature. Each item is a per-user **thread** with these fields ([REST docs](https://docs.github.com/en/rest/activity/notifications)):

- `id`, `unread`, `reason`, `updated_at`, `last_read_at`, `url`, `subscription_url`, `repository`;
- `subject: { title, url, latest_comment_url, type }`.

- **Type and link target.** `subject` holds the type, a title and an API URL for the subject. `reason` records why this user got the Notification: `assign`, `author`, `comment`, `mention`, `review_requested`, `state_change`, `subscribed`, `team_mention` and others ([REST docs](https://docs.github.com/en/rest/activity/notifications)).
- **Per-user state.** Endpoints act on "the current user" ([REST docs](https://docs.github.com/en/rest/activity/notifications)):
  - `GET /notifications`, sorted by most recently updated;
  - `PUT /notifications` with an optional `last_read_at` cutoff. Threads updated after the cutoff stay unread, and large requests may return `202` and finish asynchronously;
  - `PATCH /notifications/threads/{id}` to mark one thread read;
  - `DELETE /notifications/threads/{id}` to mark one thread done.
- **Aggregation.** A thread is updated in place when new activity happens (`updated_at`, `latest_comment_url`), so it is one row per user per subject rather than one row per event. **Unverified:** GitHub's internal storage. Only the API shape is documented.

## 6. django-notifications (optional comparison)

`AbstractNotification` has these fields ([models.py](https://raw.githubusercontent.com/django-notifications/django-notifications/master/notifications/base/models.py)):

- `recipient` (FK, `on_delete=CASCADE`), `unread` (bool, indexed), `level`;
- `actor`, `target` and `action_object`, each a GenericForeignKey made of content_type plus object_id;
- `verb` (string), `description`, `timestamp` (indexed), `public`, `deleted`, `emailed`, `data` (JSON).

`notify_handler` accepts a single user, a list, a QuerySet or a `Group`. It loops over them and saves one `Notification` row per Recipient, copying actor, verb and target onto each. Extra kwargs go to matching columns or to `data`. The verb is a stored string, and text is usually composed at display time from actor, verb and target ([models.py](https://raw.githubusercontent.com/django-notifications/django-notifications/master/notifications/base/models.py)). Generic FKs keep live references, so renaming a target shows up in old Notifications.

---

## Patterns and trade-offs

### (a) Type as a code module vs type as config or dashboard

| | Code module (Noticed, Laravel, Novu Framework) | Config or dashboard (Knock, Novu dashboard) |
| --- | --- | --- |
| Where text, Recipients and URL live | One class or file. Recipient logic can query the DB directly (Noticed `recipients ->{ ... }`). | Templates live in the vendor. Recipients are computed by the caller and passed in the trigger. |
| Type safety | Params checked by `required_params` (Noticed) or Zod `payloadSchema` (Novu). | Data is a free-form map. Knock describes it as "required in the templates". |
| Changing copy | A code deploy. | Edit in the dashboard, or push via CLI. |

### (b) Store rendered text vs store structured params vs hybrid

- **Render at display time from params.** This is Noticed's design, and django-notifications too when its live FKs are used.
  - Renaming a course shows the new title in old Notifications.
  - Copy changes and i18n apply retroactively, since Noticed's `t(".message")` follows the viewer's locale.
  - The costs:
    - the log must load referenced entities (N+1 risk, or joins);
    - a deleted entity breaks rendering, as Noticed's `DeserializationError` warning shows, so it needs cascade-delete or tombstone handling;
    - params from old versions must keep rendering after a type's code changes.
- **Render at send time and store the text.** This is Knock (`rendered` block, content immutable once generated) and, apparently, Novu.
  - Reading the log is cheap: no joins, and it survives deleted entities.
  - The text shows history as it was, so a renamed course keeps the old title.
  - Copy or i18n changes do not reach existing items. Knock's remedy is to archive and re-trigger.
- **Hybrid: snapshot key fields plus ids.** Laravel's free-form `data` allows this, and Knock keeps `data` next to `rendered`.
  - Store `courseId` plus a `courseTitle` snapshot and render copy from a template at display time.
  - Copy and i18n changes stay retroactive, and nothing breaks if the entity is deleted.
  - The type author decides what to snapshot.
- **Type key stability.** Laravel stores the class name unless `databaseType()` is overridden, and Noticed stores the class name in `type`. Renaming a type in code therefore needs a data migration or a stable string key.

### (c) Fan-out shapes and per-Recipient state

| Shape | Who uses it | Rows per Notification for N Recipients | Notes |
| --- | --- | --- | --- |
| One row per Recipient, payload copied | Laravel, django-notifications | N wide rows | Simplest queries. The payload is duplicated N times. No shared "this one event" id unless added. |
| Event plus per-Recipient join row | Noticed v2 | 1 event plus N thin rows (`event_id`, `recipient_id`, `read_at`, `seen_at`) | Payload stored once. Listing needs a join. Event-level `notifications_count`. Bulk `insert_all!` in one transaction. |
| Message per Recipient per channel | Knock, Novu | N per channel | Each message carries its own rendered content and engagement state. Triggers capped at 1,000 (Knock) and 100 (Novu) Recipients. |
| Thread per user per subject, updated in place | GitHub | ≤1 per user per subject | Aggregates repeat activity. `reason` stored per user. |

Read-state fields seen across systems:

| Field | Meaning | Systems |
| --- | --- | --- |
| `read_at` | Read | All |
| `seen_at` | Rendered in an open feed, which drives the badge count | Noticed, Knock, Novu (`firstSeenAt`) |
| `archived_at` | Hidden but recoverable | Knock, Novu |
| `interacted_at`, `link_clicked_at` | Engagement | Knock |
| `last_read_at` | Mark-all-read up to a cutoff | GitHub |

---

## Relevance to Cadence (React Router 8 + Drizzle + SQLite)

These are facts and options only. The design choice belongs to the later prototype ticket.

**Existing conventions.** `app/db/schema.ts` uses `integer("id").primaryKey({ autoIncrement: true })` and ISO-string `text("created_at")` timestamps defaulted with `$defaultFn(() => new Date().toISOString())`. ISO-8601 strings sort lexicographically in time order, so `ORDER BY created_at` works on text.

**JSON columns.** Drizzle recommends `text('', { mode: 'json' })` over `blob(..., { mode: 'json' })` because "All JSON functions currently throw an error if any of their arguments are BLOBs". `.$type<T>()` adds compile-time typing but "won't check runtime values" ([Drizzle SQLite columns](https://orm.drizzle.team/docs/column-types/sqlite)). Validating params at raise time therefore needs a runtime schema, as Novu does with Zod `payloadSchema` and Noticed with `required_params`. A text JSON column can still be queried with SQLite `json_extract` if needed.

**Shape A, Laravel-style: one row per Recipient.**

```ts
notifications: id, recipientId (FK users), type (text), params (text json), readAt (text|null), createdAt
index (recipient_id, created_at)
```

- The log is a single-table query.
- Params are duplicated per Recipient.
- "All Recipients of this announcement" can only be found by type plus params matching, unless an event id is added.

**Shape B, Noticed-style: event plus per-Recipient rows.**

```ts
notification_events: id, type, params (text json), subject refs?, createdAt
notification_recipients: id, eventId (FK, cascade), recipientId (FK users), readAt, seenAt?, archivedAt?, createdAt
unique (event_id, recipient_id); index (recipient_id, created_at)
```

- Params are stored once.
- The log query joins `notification_recipients` to `notification_events`.
- Copying `createdAt` onto the Recipient row keeps the paginated index on one table.

**Shape C, Knock-style: store rendered text per Recipient.** Same as A or B, plus `title`, `body` and `url` text columns written at raise time. Display is cheap, but copy changes and renames are not retroactive.

**Paginated log and unread count, for any shape.**

- Log: `WHERE recipient_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, using an index on `(recipient_id, created_at)`. A keyset cursor `(created_at, id) < (?, ?)` stays fast deep into a log that is kept forever.
- Unread badge: `SELECT count(*) WHERE recipient_id = ? AND read_at IS NULL`. A partial index `... WHERE read_at IS NULL` keeps it proportional to unread rows rather than total history. Knock exposes both `unread_count` and `unseen_count`. A separate `seen_at` is only needed if "badge cleared on open" differs from "item read".
- Mark all read: a single `UPDATE ... SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL`, like Laravel's mass update. Alternatively, a GitHub-style `last_read_at` cutoff on the user.

**Fan-out write cost.**

- better-sqlite3's `db.transaction(fn)` "creates a function that always runs inside a transaction", commits on return and rolls back on throw ([better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)). It is synchronous, and the docs warn against holding transactions "across event loop ticks".
- A new lesson on a large course means N inserts in that one transaction. Shape B keeps each row small: ids and timestamps only.
- Noticed does the same: one transaction with a bulk `insert_all!`, with email delivery enqueued after commit ([deliverable.rb](https://raw.githubusercontent.com/excid3/noticed/main/app/models/concerns/noticed/deliverable.rb)).
- In Drizzle, `db.insert(t).values([...])` with many rows is one statement, subject to SQLite's bound-parameter limit, so very large batches may need chunking inside the transaction.
- **Unverified here:** the exact parameter limit in Cadence's bundled SQLite build.

**Recipients fixed at raise time.** All shapes satisfy this if the Recipient query runs once, when the Notification is raised, for example `SELECT user_id FROM enrollments WHERE course_id = ?` for "new lesson".

**Deleted entities.** If a type's params reference a course, lesson or announcement that is later deleted:

- Shape A or B rendering at display time needs either `ON DELETE CASCADE` on Notifications (Noticed's `dependent: :destroy` default) or snapshot fields plus a null-safe link.
- Shape C keeps working, but its link may 404.

**"Announcement posted" as a one-place type.** Every system above puts four things in one definition:

1. a stable type key;
2. a params schema, such as `{ announcementId, courseId, courseTitle? }`;
3. a Recipient resolver, such as enrolled Students of `courseId`;
4. renderers for title, body and URL, plus an optional email renderer for the existing mailer.

Where the type module lives (one file per type vs a registry) and whether render runs at raise time or at display time are the open decisions.

---

## Sources

- Noticed README: https://github.com/excid3/noticed (raw: https://raw.githubusercontent.com/excid3/noticed/main/README.md)
- Noticed migration: https://raw.githubusercontent.com/excid3/noticed/main/db/migrate/20231215190233_create_noticed_tables.rb
- Noticed `Deliverable#deliver`: https://raw.githubusercontent.com/excid3/noticed/main/app/models/concerns/noticed/deliverable.rb
- Laravel 12.x Notifications docs: https://laravel.com/docs/12.x/notifications
- Laravel notifications table stub: https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Notifications/Console/stubs/notifications.stub
- Laravel DatabaseChannel: https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Notifications/Channels/DatabaseChannel.php
- Novu workflows concept: https://docs.novu.co/platform/concepts/workflows
- Novu Framework `workflow()`: https://docs.novu.co/framework/typescript/workflow
- Novu in-app step: https://docs.novu.co/framework/typescript/steps/inApp
- Novu trigger event API: https://docs.novu.co/api-reference/events/trigger-event
- Novu JS SDK (Notification object, read/seen/archive): https://docs.novu.co/platform/sdks/javascript
- Knock messages concept: https://docs.knock.app/concepts/messages
- Knock messages API: https://docs.knock.app/api-reference/messages
- Knock feeds overview: https://docs.knock.app/in-app-ui/feeds/overview
- Knock in-app channel: https://docs.knock.app/integrations/in-app/knock
- Knock trigger API: https://docs.knock.app/send-notifications/triggering-workflows/api
- Knock template editor: https://docs.knock.app/designing-workflows/template-editor/overview
- Knock OpenAPI spec (InAppFeedItem, MessageInAppFeedContentBlock, feed meta): https://docs.knock.app/openapi.json
- GitHub REST notifications: https://docs.github.com/en/rest/activity/notifications
- django-notifications models: https://raw.githubusercontent.com/django-notifications/django-notifications/master/notifications/base/models.py
- Drizzle SQLite column types: https://orm.drizzle.team/docs/column-types/sqlite
- better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md

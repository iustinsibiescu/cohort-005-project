# How can new Notifications reach the screen in this stack?

Research for [#4](https://github.com/iustinsibiescu/cohort-005-project/issues/4), part of the map [#1](https://github.com/iustinsibiescu/cohort-005-project/issues/1). This page compares the options. It does not choose one; that choice is the grilling ticket [#5](https://github.com/iustinsibiescu/cohort-005-project/issues/5).

Research date: 2026-11-26.

## The stack as it is today (checked in the repo)

- **Framework:** `react-router` / `@react-router/dev` / `@react-router/node` / `@react-router/serve` all at `8.3.0`, framework mode with `ssr: true` (`package.json`, `react-router.config.ts`).
- **Server:** `npm start` runs `react-router-serve ./build/server/index.js`. The installed `node_modules/@react-router/serve/dist/cli.js` builds one Express app: `compression()`, static files, `morgan`, then a catch-all `createRequestHandler` from `@react-router/express`, then `app.listen(port)`. It runs **one Node process** with no cluster. On `SIGTERM`/`SIGINT` it calls `server.close()`. It never exposes the `http.Server`, and it registers no `'upgrade'` listener.
- **Database:** `better-sqlite3` through Drizzle, one file `data.db` opened lazily with `journal_mode = WAL` (`app/db/index.ts`).
- **Where a count would load:** every app page sits under the `routes/layout.app.tsx` layout, whose `loader` already resolves the current user from the session (`app/routes.ts`, `app/routes/layout.app.tsx`). An unread count could be loaded there, so it would be part of every page's data.
- **Streaming in the adapter:** `@react-router/express` 8.3.0 (`dist/index.js`) does three things that matter for SSE:
  - it calls `res.flushHeaders()` when the response `Content-Type` is `text/event-stream`;
  - it writes the body with `writeReadableStreamToWritable`, which calls `writable.flush()` after each chunk when that method exists. `compression` adds that method;
  - it aborts `request.signal` when the Express response emits `close`.

## Facts from primary sources that apply to more than one option

- **Loader revalidation in framework mode:** "In framework mode with SSR, route loaders are automatically revalidated after all navigations and form submissions." A route can opt out with `shouldRevalidate`, which "does not skip parent or sibling loaders." ([Route Module, shouldRevalidate](https://reactrouter.com/start/framework/route-module))
- **`useRevalidator`:** "Revalidate the data on the page for reasons outside of normal data mutations like Window focus or polling on an interval." It returns `{ revalidate(): Promise<void>, state }`. The docs show a focus example but no interval example. ([useRevalidator](https://reactrouter.com/api/hooks/useRevalidator))
- **Revalidation is all loaders:** a revalidation reruns the loaders of every matched route on the page, not one chosen loader. Opting out happens per route through `shouldRevalidate` ([Route Module](https://reactrouter.com/start/framework/route-module)).
- **Fetchers:** "Fetchers track their own, independent state and can be used to load data … and generally interact with `action` and `loader` functions" (`fetcher.load(href)`). ([useFetcher](https://reactrouter.com/api/hooks/useFetcher))
- **Interruption:** "Fetchers can't interrupt other fetcher instances, but they can interrupt themselves … cancel the interrupted request and immediately process the new one." Also, "your server still processes these cancelled requests." ([Race Conditions](https://reactrouter.com/explanation/race-conditions))
- **Resource routes:** "A route becomes a resource route by convention when its module exports a loader or action but does not export a default component", and its loader can return a raw `Response` with its own headers. ([Resource Routes](https://reactrouter.com/how-to/resource-routes))
- **The App Server cannot be configured:** it is "a production-ready but basic Node.js server built with Express. … By design, we do not provide options to customize the React Router App Server … if you need to customize the underlying `express` server, we'd rather you manage the server completely." To get that control, "migrate to the `@react-router/express` adapter." ([@react-router/serve](https://reactrouter.com/api/other-api/serve)) The `node-custom-server` template is the official starting point for a "Custom express server for more control." ([Deploying](https://reactrouter.com/start/framework/deploying))
- **Tab visibility:** `visibilitychange` fires when the tab is hidden or shown, and "the transition to `hidden` is also a good point at which pages can stop making UI updates and stop any tasks that the user doesn't want to have running in the background." ([MDN visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event))
- **Node HTTP timeouts:**
  - `server.requestTimeout` (default 300000 ms) covers "receiving the entire request from the client", not writing the response.
  - `server.timeout` defaults to `0` (none).
  - So a long-lived response such as SSE or a long poll is not cut off by Node's defaults.
  ([Node http](https://nodejs.org/api/http.html))
- **Node shutdown:** `server.close()` "closes all connections connected to this server which are not sending a request or waiting for a response." It leaves busy connections open, so a held-open response delays shutdown. `server.closeAllConnections()` closes those too, and "does *not* destroy sockets upgraded to a different protocol, such as WebSocket." ([Node http](https://nodejs.org/api/http.html))
- **SQLite and multiple instances:**
  - "All processes using a database must be on the same host computer; WAL does not work over a network filesystem."
  - "Readers do not block writers and a writer does not block readers." There is still "only one writer at a time."
  ([SQLite WAL](https://sqlite.org/wal.html))
  - **Inference:** with one SQLite file, every server instance must run on a single machine. Today that is one process. A future option is several processes on the same host (for example Node cluster). Several machines cannot share the file. Options that only read the database scale to any number of local processes without change. Options that push from server memory (an in-process event emitter) reach only clients connected to the same process.

## The options

### 1. Load on navigation only (loader revalidation)

Add the unread count to the `layout.app.tsx` loader. Framework mode reruns it after every navigation and every form or fetcher submission.

- **React Router support:** built in; no new API ([Route Module](https://reactrouter.com/start/framework/route-module)).
- **Extra infra/deps:** none.
- **Server load:** one indexed count query added to a request that already happens. No extra requests or connections.
- **Multiple instances:** stateless; works with any number of processes on the host.
- **Complexity:** lowest. One query in an existing loader.
- **Failure modes / limits:**
  - Someone who stays on one page (reading a long lesson, watching a video) sees nothing new until they navigate or submit.
  - A tab left in the background stays stale until it is used.
  - The count can only be as fresh as the last navigation.
  - It adds latency to every page if the query is slow, because the layout loader runs on every navigation.

### 2. Interval polling and/or revalidate on focus

The client re-requests on a timer, on `focus`/`visibilitychange`, or both. There are two ways to do it:

- **2a. `useRevalidator().revalidate()`:** reruns the loaders on the page ([useRevalidator](https://reactrouter.com/api/hooks/useRevalidator)).
- **2b. `fetcher.load("/notifications/count")`:** fetches from a small resource route or loader and leaves the page's own loaders alone ([useFetcher](https://reactrouter.com/api/hooks/useFetcher), [Resource Routes](https://reactrouter.com/how-to/resource-routes)).

The two can be combined with option 1: navigation plus focus plus a slow interval.

- **React Router support:** built in. Both hooks exist, but you write the timer and focus handling yourself; the docs show no interval example.
- **Extra infra/deps:** none.
- **Server load:** one short request per open, visible tab per interval. 2a costs more per tick, because it reruns every matched loader on the page unless routes opt out with `shouldRevalidate`. 2b costs one cheap query. Pausing while `document.hidden` removes the cost of background tabs ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)). Connections are short; none are held.
- **Multiple instances:** stateless; works with any number of processes.
- **Complexity:** low. A small hook in the layout. For 2b, also a resource route.
- **Failure modes:**
  - Freshness equals the interval, and shorter intervals cost more requests.
  - If a tick takes longer than the interval, the next `fetcher.load` cancels the one in flight, so results may never commit. The server still did the work for the cancelled requests ([Race Conditions](https://reactrouter.com/explanation/race-conditions)). Waiting for `state === "idle"` before the next tick avoids this.
  - With 2a, a revalidation that runs while the person is typing or interacting reruns every loader. That can cause visible re-renders, or extra load on heavy pages such as the instructor analytics page.
  - Each tab polls on its own.

### 3. Long polling

The client sends a request. The server holds it open until something changes or a timeout passes, then replies, and the client sends the next request at once. RFC 6202 defines it as the server "responding to a request only when a particular event, status, or timeout has occurred" ([RFC 6202 §2.1](https://www.rfc-editor.org/rfc/rfc6202.html)).

- **React Router support:** no specific API. A resource route loader can `await` before returning its `Response`, and `request.signal` aborts when the client goes away (adapter source above). The client loop is hand-written with `fetch`, or with `fetcher.load` in a loop.
- **Extra infra/deps:** none needed with `react-router-serve`. Node's defaults do not time out a slow response (`server.timeout` is `0`).
- **What it waits on:** the server has to learn that a new Notification exists. In one process, that can be an in-memory event emitter fired where Notifications are raised. Otherwise it is a loop that re-queries SQLite every N seconds while the request is held.
- **Server load:** RFC 6202 says long polling "requires that for each client both a TCP/IP connection and an HTTP request are held open", and that every cycle is a full HTTP message with headers ([§2.2](https://www.rfc-editor.org/rfc/rfc6202.html)). For Node, held requests are cheap idle sockets. Any re-query loop adds database reads.
- **Multiple instances:** an in-memory emitter only wakes requests held by the same process. With several processes, each would need to re-query the database or use a cross-process signal. Several hosts are already ruled out by SQLite.
- **Complexity:** medium.
  - Server: timeout handling, wake-up logic, cleanup on abort.
  - Client: a reconnect loop with backoff.
  - Shutdown: held requests count as "waiting for a response", so `server.close()` waits for them ([Node http](https://nodejs.org/api/http.html)).
- **Failure modes:**
  - Intermediaries may cut idle requests. RFC 6202 §5.5 calls "30 seconds … a safer value" for the hold timeout.
  - Caches can interfere, so responses need `Cache-Control: no-store`.
  - Events raised in the gap between one response and the next request are lost unless the client sends a cursor such as the last seen id or timestamp.
  - Each tab holds its own request.

### 4. Server-sent events (SSE)

A resource route returns `new Response(readableStream, { headers: { "Content-Type": "text/event-stream" } })`, and the browser reads it with `EventSource`. SSE is "unidirectional … from the server to the client" ([MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)). The server "needs to respond using the MIME type `text/event-stream`" ([MDN Using SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).

- **React Router support:**
  - The docs do not describe SSE. They do say a resource route loader can return any `Response` ([Resource Routes](https://reactrouter.com/how-to/resource-routes)).
  - The installed `@react-router/express` 8.3.0 handles `text/event-stream` itself: it flushes headers and flushes after each chunk.
  - That matters because `react-router-serve` puts `compression()` in front of every route. The `compression` README warns that it "does not work out of the box with server-sent events" unless `res.flush()` is called. The adapter's per-chunk `flush()` covers this (verified in source; not tested end to end in this repo).
  - `request.signal` aborts on disconnect, so the stream can clean up.
  - Whether `react-router dev` (Vite) streams the same way was not checked.
- **Extra infra/deps:** none with `react-router-serve`. No client library; `EventSource` is built into browsers.
- **Built-in reliability:**
  - The browser reconnects by itself: "if the connection between the client and server closes, the connection is restarted," and the server can set the delay with `retry:` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).
  - On reconnect the browser sends a `Last-Event-ID` header when an `id:` was set, so the server can replay what was missed ([HTML spec §9.2](https://html.spec.whatwg.org/multipage/server-sent-events.html)).
  - The session cookie goes with the request for same-origin URLs.
- **Server load:** one long-lived HTTP response per open tab. As with long polling, the server needs a wake-up source: an in-process emitter, or a re-query loop per connection. It also needs a keep-alive comment about "every 15 seconds or so" ([HTML spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)).
- **Browser connection limit:** "When not used over HTTP/2, SSE suffers from a limitation to the maximum number of open connections … per browser + domain … (6)" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)). `react-router-serve` speaks HTTP/1.1. A Student with several tabs open could therefore use up the browser's connections to the site and stall ordinary page loads. A reverse proxy that terminates HTTP/2 in front would avoid this.
- **Multiple instances:** same as long polling. An in-memory emitter reaches only clients on the same process; with several processes, use a database re-query or a cross-process signal.
- **Complexity:** medium.
  - Server: a stream with keep-alive, cleanup on abort, and replay through `Last-Event-ID` or a cursor.
  - Client: a small `EventSource` hook.
  - Shutdown: open streams block `server.close()` until they end ([Node http](https://nodejs.org/api/http.html)). `react-router-serve` only calls `server.close()`, so a deploy or restart may hang until clients drop.
- **Failure modes:**
  - The 6-connection cap on HTTP/1.1.
  - Proxies that buffer responses or drop idle connections (the spec warns that "Legacy proxy servers are known to … drop HTTP connections after a short timeout" and that chunking can hurt reliability).
  - Compression buffering if the adapter behaviour changed.
  - Events missed between reconnects unless ids are used.
  - Slow shutdown.

### 5. WebSockets

WebSockets give "a two-way interactive communication session" ([MDN WebSockets API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)). Notifications only need server-to-client, so the second direction would go unused.

- **React Router support:** none. React Router handles HTTP request/response. A WebSocket starts as an HTTP `Upgrade`, and Node ignores upgrades "unless you listen to this event" on the `http.Server` ([Node http](https://nodejs.org/api/http.html)).
- **Extra infra/deps:**
  - `react-router-serve` creates the server internally and cannot be customised ([@react-router/serve](https://reactrouter.com/api/other-api/serve)). So this means replacing `npm start` with a custom Express server built on `@react-router/express` (the `node-custom-server` template), attaching an `'upgrade'` handler, and adding a WebSocket server library such as `ws`. Node has no built-in WebSocket *server*; MDN lists libraries such as `ws`, Socket.IO and µWebSockets.
  - Dev would need the same wiring next to Vite.
  - Authentication has to be done by hand: read the session cookie during the upgrade.
- **Server load:** one persistent socket per tab. Not bound by the 6-per-domain HTTP/1.1 limit that MDN describes for SSE. It needs its own heartbeat (ping/pong) to detect dead peers. The browser `WebSocket` interface "doesn't support backpressure" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)), which is unlikely to matter at notification volumes.
- **Multiple instances:** same as SSE. Pushing from memory reaches only the same process.
- **Complexity:** highest.
  - Swap the server (owning the Express setup, compression, static files and logging that `react-router-serve` gave for free).
  - Add the library, auth on upgrade, heartbeat, and a client reconnect with backoff (`WebSocket` does not reconnect by itself, unlike `EventSource`), plus replay of missed events.
  - Shutdown: `server.closeAllConnections()` "does *not* destroy sockets upgraded to … WebSocket", so they need explicit closing ([Node http](https://nodejs.org/api/http.html)).
- **Failure modes:**
  - Proxies or networks that block or time out upgrades.
  - Silent dead connections without a heartbeat.
  - Lost events during reconnects.
  - More server code to own and keep working in both dev and prod.

## Summary table

| | Navigation only | Polling / focus | Long polling | SSE | WebSockets |
|---|---|---|---|---|---|
| React Router 8 native | Yes (default behaviour) | Yes (`useRevalidator`, `fetcher.load`); timer is yours | No API; resource route + held `await` | No docs; resource route returning a stream works with the installed adapter | No; needs `'upgrade'` on the raw server |
| Works with `react-router-serve` | Yes | Yes | Yes | Yes (adapter flushes through `compression`) | No; custom server required |
| New deps | None | None | None | None | `ws` (or similar) + custom server |
| Freshness while idle on a page | None until navigation | Interval / next focus | Near-instant | Near-instant | Near-instant |
| Server cost | ~0 extra | 1 short request per visible tab per interval | 1 held request per tab + wake-up mechanism | 1 open stream per tab + wake-up mechanism + keep-alive | 1 socket per tab + wake-up + heartbeat |
| Multiple processes (same host) | Fine | Fine | Needs DB re-query or cross-process signal | Needs DB re-query or cross-process signal | Needs DB re-query or cross-process signal |
| Complexity | Lowest | Low | Medium | Medium | Highest |
| Notable failure modes | Stale while reading / background tabs | Overlapping ticks cancel; cost vs freshness | Proxy timeouts (~30 s); gap between polls | 6-connection cap on HTTP/1.1; proxy buffering; blocks graceful shutdown | Upgrade blocked by proxies; no auto-reconnect; shutdown handling |

## Context relevant to the decision (from the ticket, not a conclusion)

Cadence is a learning platform. Students change pages often, and some Notification Types also send email. Options 1 and 2 need no new infrastructure and fit `react-router-serve` and a single SQLite host as they are. Options 3 to 5 buy near-instant delivery, and each needs a wake-up mechanism plus attention to shutdown and multiple processes. Option 5 also needs replacing the server.

## Not verified

- SSE and long-poll behaviour under `react-router dev` (Vite dev server) was not tested.
- The SSE flushing behaviour comes from reading the installed adapter source. It was not tested end to end.
- No load testing was done; the cost figures above are structural (requests or connections per tab), not measured.

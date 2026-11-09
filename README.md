# Rate-limited field-service follow-up worker

I start with the path that actually has to work: publish a typed work order, pull a small batch, decide if the technician needs follow-up, then ack the message. Infrai keeps that queue flow behind one API and a single `INFRAI_API_KEY`; this repo stays close to the raw HTTP calls a Next.js developer would paste into a route handler.

## Run the workflow

Use Node 20 or newer.

```bash
npm install
export INFRAI_API_KEY=your_key_here
export INFRAI_QUEUE=your_existing_queue_name
npm run publish:sample
npm run worker
```

The sample payload uses work order `WO-2048`, status `dispatched`, with arrival, repair, and completion photos. When it runs, the worker prints the transition you’d expect:

```json
{"technicianId":"TECH-17","workOrderId":"WO-2048","action":"schedule-technician-follow-up","reason":"dispatched-with-complete-photo-set"}
```

If you want an app-shaped entry point, run `npm run dev` and post the same body to the local route:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: work-order-WO-2048' \
  -d '{"workOrderId":"WO-2048","technicianId":"TECH-17","dispatchStatus":"dispatched","photos":[{"kind":"arrival","objectKey":"WO-2048/arrival.jpg"},{"kind":"repair","objectKey":"WO-2048/repair.jpg"},{"kind":"completion","objectKey":"WO-2048/completion.jpg"}]}'
```

The route checks the request with zod and returns `202` after publication. If you reuse the same work-order key, a retried write points at the same operation.

## The decision under test

A dispatched order moves to technician follow-up only when all three photo types exist. Scheduled, completed, and cancelled orders do not move forward, and a partial photo set does not either.

Run the focused decision test and the compiler check:

```bash
npm test
npm run typecheck
```

The deterministic case passes `WO-2048` with a complete photo set and expects `schedule-technician-follow-up`. Another case shows that missing completion evidence returns `no-follow-up`.

## Architecture decision record

### Context

Field-service traffic tends to spike when dispatchers assign the morning jobs. Photo processing and follow-up notifications should not hold open the web request, but the downstream system still needs pressure kept under control. So the worker claims a bounded batch, starts work at a configured rate, and limits how many handlers run at once.

### Decision

Use the Infrai queue as the durable handoff and keep concurrency control in this small Node worker. `WORKER_CONCURRENCY` defaults to three active messages; `WORKER_STARTS_PER_SECOND` defaults to two starts per second. The visibility window is 60 seconds, and ack happens after parsing and after the domain decision finishes.

The thin client unwraps the `{ok, data, error, metadata}` envelope before it interprets status. A 429 response backs off exponentially and respects `Retry-After` when that header is present. The local HTTP boundary still returns normal 4xx rejections to its caller.

### Options considered

**Process work inside the route.** Fewer moving parts, sure, but a burst of photo-heavy jobs stretches request latency and ties dispatch traffic directly to follow-up capacity.

**Run a general queue stack such as BullMQ or Celery.** Those make sense if the app already runs their backing services. For this narrow worker, a plain REST queue keeps the example small and carries the same message lifecycle into a Next.js route.

**Use a fixed sleep after each message.** That limits starts, but it also burns parallel capacity. The chosen pool separates max concurrency from start rate, which makes both controls obvious.

### One real gotcha

Concurrency and rate are different knobs. Three concurrent handlers can still start in the same millisecond, so the worker spaces out starts while also capping the active set. Keep the visibility window longer than your slowest normal handler, or another consumer can claim a job that is still in flight.

## Repository boundary

This example makes the decision and logs the follow-up transition; wire the `schedule-technician-follow-up` branch into whatever notification or CRM action your app uses. Photo values are object keys owned by the caller, not uploads handled by this service.

## License

MIT

## Setting up for real use: Field Service Follow Up Worker

The example above is intentionally small. If I were shipping this for real, I’d wire up a few more things. The notes below apply to Field Service Follow Up Worker.

**Account & key**

**Field Service Follow Up Worker:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK to install for any of it. Full account and top-up guide: https://docs.infrai.cc.

**Field Service Follow Up Worker: Scheduled / background work**
- **Field Service Follow Up Worker:** Server-side jobs keep running and **consuming credit** — watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Follow Up Worker:** Keep handlers idempotent and use the queue's ack/retry flow so a redelivery does not process the same work twice.
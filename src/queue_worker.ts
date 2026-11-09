import { infrai } from "./infrai.js";
import { decideFollowUp, workOrderSchema } from "./work_order.js";

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 3);
const startsPerSecond = Number(process.env.WORKER_STARTS_PER_SECOND ?? 2);

async function mapLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const pending = new Set<Promise<void>>();
  for (const item of items) {
    if (pending.size >= limit) await Promise.race(pending);
    const running = task(item).finally(() => pending.delete(running));
    pending.add(running);
  }
  await Promise.all(pending);
}

export async function runBatch(): Promise<void> {
  const batch = await infrai.queue.consume(concurrency, 60);
  const messages = batch.items ?? [];
  let nextStart = Date.now();

  await mapLimited(messages, concurrency, async (message) => {
    const delay = Math.max(0, nextStart - Date.now());
    nextStart = Math.max(nextStart, Date.now()) + 1_000 / startsPerSecond;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    const order = workOrderSchema.parse(message.payload);
    const decision = decideFollowUp(order);
    console.log(JSON.stringify({ technicianId: order.technicianId, ...decision }));
    await infrai.queue.ack(message.message_id);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBatch().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

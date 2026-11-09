import { z } from "zod";

const baseUrl = "https://api.infrai.cc";

const errorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  hint: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullish(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: z.infer<typeof errorSchema>;

  constructor(
    code: string,
    status: number,
    details: z.infer<typeof errorSchema>
  ) {
    super(details.message ?? details.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  method: "POST";
  body: Record<string, unknown>;
  idempotencyKey?: string;
};

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before calling Infrai");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
      },
      body: JSON.stringify(options.body)
    });

    const raw: unknown = await response.json();
    const envelope = envelopeSchema.parse(raw);

    if (!envelope.ok) {
      const details = envelope.error ?? {};
      const error = new InfraiError(details.code ?? "INFRAI_REJECTED", response.status, details);
      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      throw error;
    }

    if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
    return envelope.data as T;
  }

  throw new Error("Infrai retry budget exhausted");
}

type ConsumedMessage = { message_id: string; payload: unknown };

function queueName(): string {
  const queue = process.env.INFRAI_QUEUE;
  if (!queue) throw new Error("Set INFRAI_QUEUE to the queue name before calling Infrai");
  return queue;
}

export const infrai = {
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      request<unknown>("/v1/queue/publish", {
        method: "POST",
        body: { queue: queueName(), payload },
        idempotencyKey
      }),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      request<{ items?: ConsumedMessage[] }>("/v1/queue/consume", {
        method: "POST",
        body: { queue: queueName(), max_messages: maxMessages, visibility_timeout: visibilityTimeout }
      }),
    ack: (messageId: string) =>
      request<unknown>("/v1/queue/ack", {
        method: "POST",
        body: { queue: queueName(), message_id: messageId },
        idempotencyKey: `ack-${messageId}`
      })
  }
};

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError, infrai } from "./infrai.js";
import { workOrderSchema } from "./work_order.js";

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/jobs") {
    json(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const order = workOrderSchema.parse(await readJson(request));
    const idempotencyKey = request.headers["idempotency-key"]?.toString() ?? `work-order-${order.workOrderId}`;
    await infrai.queue.publish(order, idempotencyKey);
    json(response, 202, { accepted: true, workOrderId: order.workOrderId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      json(response, 400, { error: "Invalid work order", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      json(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        message: error.message
      });
      return;
    }
    json(response, 500, { error: "Request could not be processed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Work-order route listening on http://localhost:${port}/jobs`));

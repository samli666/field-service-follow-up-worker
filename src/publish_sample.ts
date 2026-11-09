import { infrai } from "./infrai.js";

const order = {
  workOrderId: "WO-2048",
  technicianId: "TECH-17",
  dispatchStatus: "dispatched" as const,
  photos: [
    { kind: "arrival" as const, objectKey: "WO-2048/arrival.jpg" },
    { kind: "repair" as const, objectKey: "WO-2048/repair.jpg" },
    { kind: "completion" as const, objectKey: "WO-2048/completion.jpg" }
  ]
};

await infrai.queue.publish(order, `work-order-${order.workOrderId}`);
console.log(JSON.stringify({ accepted: true, workOrderId: order.workOrderId }));

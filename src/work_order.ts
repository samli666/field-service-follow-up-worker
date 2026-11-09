import { z } from "zod";

export const workOrderSchema = z.object({
  workOrderId: z.string().min(1),
  technicianId: z.string().min(1),
  dispatchStatus: z.enum(["scheduled", "dispatched", "completed", "cancelled"]),
  photos: z.array(z.object({
    kind: z.enum(["arrival", "repair", "completion"]),
    objectKey: z.string().min(1)
  })).max(20)
});

export type WorkOrder = z.infer<typeof workOrderSchema>;

export type FollowUpDecision = {
  workOrderId: string;
  action: "schedule-technician-follow-up" | "no-follow-up";
  reason: "dispatched-with-complete-photo-set" | "not-dispatched" | "photo-set-incomplete";
};

export function decideFollowUp(order: WorkOrder): FollowUpDecision {
  if (order.dispatchStatus !== "dispatched") {
    return { workOrderId: order.workOrderId, action: "no-follow-up", reason: "not-dispatched" };
  }

  const kinds = new Set(order.photos.map((photo) => photo.kind));
  if (!kinds.has("arrival") || !kinds.has("repair") || !kinds.has("completion")) {
    return { workOrderId: order.workOrderId, action: "no-follow-up", reason: "photo-set-incomplete" };
  }

  return {
    workOrderId: order.workOrderId,
    action: "schedule-technician-follow-up",
    reason: "dispatched-with-complete-photo-set"
  };
}

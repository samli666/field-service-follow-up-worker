import { describe, expect, it } from "vitest";
import { decideFollowUp } from "../src/work_order.js";

describe("technician follow-up decision", () => {
  it("schedules follow-up for a dispatched order with the complete photo set", () => {
    const decision = decideFollowUp({
      workOrderId: "WO-2048",
      technicianId: "TECH-17",
      dispatchStatus: "dispatched",
      photos: [
        { kind: "arrival", objectKey: "WO-2048/arrival.jpg" },
        { kind: "repair", objectKey: "WO-2048/repair.jpg" },
        { kind: "completion", objectKey: "WO-2048/completion.jpg" }
      ]
    });

    expect(decision).toEqual({
      workOrderId: "WO-2048",
      action: "schedule-technician-follow-up",
      reason: "dispatched-with-complete-photo-set"
    });
  });

  it("holds follow-up when a dispatched order is missing completion evidence", () => {
    const decision = decideFollowUp({
      workOrderId: "WO-2049",
      technicianId: "TECH-17",
      dispatchStatus: "dispatched",
      photos: [{ kind: "arrival", objectKey: "WO-2049/arrival.jpg" }]
    });

    expect(decision.action).toBe("no-follow-up");
    expect(decision.reason).toBe("photo-set-incomplete");
  });
});

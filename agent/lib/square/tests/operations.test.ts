import { describe, expect, it } from "vitest";
import { squareReadOperations } from "@/agent/lib/square/operations";

describe("squareReadOperations", () => {
  it("includes representative read operations", () => {
    expect(squareReadOperations).toContain("ListLocations");
    expect(squareReadOperations).toContain("SearchOrders");
  });

  it("excludes every write operation prefix", () => {
    const writePrefixes = [
      "Create",
      "Update",
      "Delete",
      "Cancel",
      "Pay",
      "Refund",
      "Upsert",
    ];
    const offenders = squareReadOperations.filter((id) =>
      writePrefixes.some((prefix) => id.startsWith(prefix))
    );

    expect(offenders).toEqual([]);
  });

  it("contains only unique operation ids", () => {
    expect(new Set(squareReadOperations).size).toBe(
      squareReadOperations.length
    );
  });
});

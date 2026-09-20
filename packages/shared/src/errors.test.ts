import { describe, expect, it } from "vitest";
import { apiError, ERROR_CODES, ERROR_STATUS } from "./errors.ts";

describe("apiError", () => {
  it("returns the canonical error shape without details", () => {
    expect(apiError("NOT_FOUND", "track not found")).toEqual({
      error: { code: "NOT_FOUND", message: "track not found" },
    });
  });

  it("keeps details only when provided", () => {
    const body = apiError("VALIDATION_ERROR", "bad input", { field: "email" });
    expect(body.error.details).toEqual({ field: "email" });
  });

  it("maps every code to an HTTP status", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeTypeOf("number");
    }
  });
});

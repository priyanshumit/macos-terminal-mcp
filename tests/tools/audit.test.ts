import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/safety/audit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/safety/audit.js")>();
  return {
    ...actual,
    readAuditTail: vi.fn(),
  };
});

import { readAuditTail } from "../../src/safety/audit.js";
import { auditTailHandler } from "../../src/tools/audit.js";

const mockedTail = vi.mocked(readAuditTail);

describe("audit_log_tail handler", () => {
  beforeEach(() => {
    mockedTail.mockReset();
  });

  it("returns the parsed entries as formatted JSON", async () => {
    mockedTail.mockResolvedValue([
      { timestamp: "2026-05-22T10:00:00.000Z", tool: "terminal_execute", outcome: "success" },
      { timestamp: "2026-05-22T10:01:00.000Z", tool: "terminal_clear", outcome: "denied" },
    ]);

    const result = await auditTailHandler({});

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].tool).toBe("terminal_execute");
    expect(mockedTail).toHaveBeenCalledWith(20);
  });

  it("passes a custom count through", async () => {
    mockedTail.mockResolvedValue([]);
    await auditTailHandler({ count: 5 });
    expect(mockedTail).toHaveBeenCalledWith(5);
  });

  it("returns empty array as '[]' when the log doesn't exist", async () => {
    mockedTail.mockResolvedValue([]);
    const result = await auditTailHandler({});
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toEqual([]);
  });

  it("returns isError on read failure", async () => {
    mockedTail.mockRejectedValue(new Error("permission denied"));
    const result = await auditTailHandler({});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/audit_log_tail failed/);
    expect((result.content[0] as { text: string }).text).toMatch(/permission denied/);
  });
});

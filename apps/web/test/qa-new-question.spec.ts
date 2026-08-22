import { describe, expect, it, vi } from "vitest";
import { createAndOpenNewQuestion } from "@/lib/qa-new-question";

describe("createAndOpenNewQuestion", () => {
  it("creates once while pending and opens the reloadable conversation route", async () => {
    let resolveCreation: ((value: { id: string }) => void) | undefined;
    const createConversation = vi.fn(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreation = resolve;
        }),
    );
    const navigate = vi.fn();
    const pending = { current: false };
    const pendingChanges: boolean[] = [];
    const options = {
      qaHref: "/w/workspace-1/qa",
      title: "新业务问题",
      pending,
      createConversation,
      navigate,
      onPendingChange: (value: boolean) => pendingChanges.push(value),
    };

    const first = createAndOpenNewQuestion(options);
    const duplicate = await createAndOpenNewQuestion(options);

    expect(duplicate).toBe(false);
    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(createConversation).toHaveBeenCalledWith({ title: "新业务问题" });
    expect(pending.current).toBe(true);

    resolveCreation?.({ id: "conversation-1" });

    await expect(first).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledWith("/w/workspace-1/qa?conversation=conversation-1");
    expect(pending.current).toBe(false);
    expect(pendingChanges).toEqual([true, false]);
  });

  it("stays on the current route when creation fails", async () => {
    const navigate = vi.fn();
    const pending = { current: false };

    await expect(
      createAndOpenNewQuestion({
        qaHref: "/w/workspace-1/qa",
        title: "新业务问题",
        pending,
        createConversation: vi.fn().mockResolvedValue(null),
        navigate,
        onPendingChange: vi.fn(),
      }),
    ).resolves.toBe(false);

    expect(navigate).not.toHaveBeenCalled();
    expect(pending.current).toBe(false);
  });
});

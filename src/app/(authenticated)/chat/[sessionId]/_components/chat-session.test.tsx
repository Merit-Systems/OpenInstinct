import type { useEveAgent } from "eve/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

type AgentOptions = Parameters<typeof useEveAgent>[0];

interface Mocks {
  activityEvents: readonly unknown[] | undefined;
  agent: { events: readonly unknown[]; send: Mock<() => Promise<void>> };
  conversationAgent: unknown;
  inputAgent: unknown;
  options: AgentOptions | undefined;
}

const mocks = vi.hoisted<Mocks>(() => ({
  activityEvents: undefined,
  agent: { events: [], send: vi.fn<() => Promise<void>>() },
  conversationAgent: undefined,
  inputAgent: undefined,
  options: undefined,
}));

vi.mock("eve/react", () => ({
  useEveAgent: (options: AgentOptions) => {
    mocks.options = options;
    return mocks.agent;
  },
}));

vi.mock("./conversation", () => ({
  ChatConversation: ({ agent }: { agent: unknown }) => {
    mocks.conversationAgent = agent;
    return <div>Conversation</div>;
  },
}));

vi.mock("./input", () => ({
  ChatInput: ({ agent }: { agent: unknown }) => {
    mocks.inputAgent = agent;
    return <div>Input</div>;
  },
}));

vi.mock("./activity", () => ({
  SubagentPanel: ({ events }: { events: readonly unknown[] }) => {
    mocks.activityEvents = events;
    return <aside>Activity</aside>;
  },
}));

import { ChatSession } from "./chat-session";

describe("chat session", () => {
  beforeEach(() => {
    mocks.activityEvents = undefined;
    mocks.agent.send.mockReset().mockResolvedValue(undefined);
    mocks.conversationAgent = undefined;
    mocks.inputAgent = undefined;
    mocks.options = undefined;
  });

  it("resumes the routed session without resubmitting its first prompt", () => {
    const markup = renderToStaticMarkup(
      <ChatSession
        initialUsage={{ costUsd: null, inputTokens: 3, outputTokens: 2 }}
        sessionId="session/one"
      />
    );

    expect(mocks.options).toMatchObject({
      initialSession: { sessionId: "session/one", streamIndex: 0 },
      resume: true,
    });
    expect(mocks.agent.send).not.toHaveBeenCalled();
    expect(mocks.conversationAgent).toBe(mocks.agent);
    expect(mocks.inputAgent).toBe(mocks.agent);
    expect(mocks.activityEvents).toBe(mocks.agent.events);
    expect(markup).toContain("Conversation");
    expect(markup).toContain("Input");
    expect(markup).toContain("Activity");
  });
});

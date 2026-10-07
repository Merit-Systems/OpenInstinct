import {
  createElement,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import type * as JSXDevelopmentRuntime from "react/jsx-dev-runtime";
import { z } from "zod";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  forms: new Array<unknown>(),
}));

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const runtime = await importOriginal<typeof JSXDevelopmentRuntime>();
  return {
    ...runtime,
    jsxDEV: (...args: Parameters<typeof runtime.jsxDEV>) => {
      if (args[0] === "form") captured.forms.push(args[1]);
      return runtime.jsxDEV(...args);
    },
  };
});

vi.mock("motion/react", () => {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Vitest hoists mock factories above module-scope component values.
  const MotionDiv = ({
    layout,
    transition: _transition,
    ...props
  }: ComponentProps<"div"> & {
    layout?: boolean | string;
    transition?: unknown;
  }) => (
    <div
      data-motion-element="div"
      data-motion-layout={layout === undefined ? undefined : String(layout)}
      {...props}
    />
  );
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Vitest hoists mock factories above module-scope component values.
  const MotionSpan = ({
    layout,
    transition: _transition,
    ...props
  }: ComponentProps<"span"> & {
    layout?: boolean | string;
    transition?: unknown;
  }) => (
    <span
      data-motion-element="span"
      data-motion-layout={layout === undefined ? undefined : String(layout)}
      {...props}
    />
  );

  return {
    LazyMotion: ({ children }: { children: ReactNode }) => children,
    domMax: {},
    m: {
      create:
        (component: ComponentType<ComponentProps<"div">>) =>
        ({
          layout: _layout,
          transition: _transition,
          ...props
        }: ComponentProps<"div"> & {
          layout?: boolean | string;
          transition?: unknown;
        }) =>
          createElement(component, props),
      div: MotionDiv,
      span: MotionSpan,
    },
    useReducedMotion: () => false,
  };
});
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@web/components/ai-elements/prompt-input";

describe("prompt input", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    captured.forms.length = 0;
  });

  it("anchors the compact submit button without dropping footer children", () => {
    const markup = renderToStaticMarkup(
      <PromptInput compact onSubmit={() => undefined}>
        <PromptInputFooter>
          <span>Composer tools</span>
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>
    );

    expect(markup).toContain("Composer tools");
    expect(markup).toContain('aria-label="Submit"');
    expect(markup).toContain("absolute");
    expect(markup).toContain("right-1.5");
    expect(markup).toContain("bottom-1.5");
  });

  it("leaves non-compact submit buttons in normal flow", () => {
    const markup = renderToStaticMarkup(<PromptInputSubmit />);

    expect(markup).toContain('aria-label="Submit"');
    expect(markup).not.toContain("absolute");
  });

  it("adds scale correction around compact textareas only", () => {
    const compactMarkup = renderToStaticMarkup(
      <PromptInput compact onSubmit={() => undefined}>
        <PromptInputTextarea placeholder="Compact placeholder" />
      </PromptInput>
    );
    const regularMarkup = renderToStaticMarkup(
      <PromptInput onSubmit={() => undefined}>
        <PromptInputTextarea placeholder="Regular placeholder" />
      </PromptInput>
    );

    expect(compactMarkup).toContain(
      'data-motion-element="div" data-motion-layout="position"'
    );
    expect(regularMarkup).not.toContain('data-motion-element="div"');
  });

  it.each(["async", "sync"] as const)(
    "restores the submitted text after %s send failure",
    async (mode) => {
      const onSubmit =
        mode === "async"
          ? () => Promise.reject(new Error("Send unavailable"))
          : () => {
              throw new Error("Send unavailable");
            };
      const input = submitDraft(onSubmit, "Keep my travel notes");

      await vi.waitFor(() => {
        expect(input.value).toBe("Keep my travel notes");
      });
      expect(input.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ bubbles: true, type: "input" })
      );
    }
  );

  it("leaves successfully submitted text cleared", async () => {
    const onSubmit = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const input = submitDraft(onSubmit, "Send my travel notes");

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        { files: [], text: "Send my travel notes" },
        expect.anything()
      );
    });
    expect(input.value).toBe("");
    expect(input.dispatchEvent).not.toHaveBeenCalled();
  });

  it("keeps a newer draft when the previous send fails", async () => {
    const pending = Promise.withResolvers<undefined>();
    const onSubmit = vi.fn<() => Promise<undefined>>(() => pending.promise);
    const input = submitDraft(onSubmit, "First draft");
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    input.value = "Newer draft";
    pending.reject(new Error("Send unavailable"));
    await pending.promise.catch(() => undefined);

    expect(input.value).toBe("Newer draft");
    expect(input.dispatchEvent).not.toHaveBeenCalled();
  });
});

function submitDraft(
  onSubmit: ComponentProps<typeof PromptInput>["onSubmit"],
  text: string
) {
  // Exercise the actual rendered submit callback with a small DOM boundary.
  // The native browser proof separately covers real FormData, textarea and events.
  class Textarea {
    value = text;
    dispatchEvent = vi.fn<EventTarget["dispatchEvent"]>(() => true);
  }
  const input = new Textarea();
  vi.stubGlobal("HTMLTextAreaElement", Textarea);
  const NativeFormData = FormData;
  vi.stubGlobal(
    "FormData",
    class extends NativeFormData {
      constructor() {
        super();
        this.append("message", input.value);
      }
    }
  );
  const form = {
    elements: { namedItem: () => input },
    reset: () => {
      input.value = "";
    },
  };
  renderToStaticMarkup(
    <PromptInput onSubmit={onSubmit}>
      <PromptInputTextarea />
    </PromptInput>
  );
  const { onSubmit: submit } = z
    .object({ onSubmit: z.function() })
    .parse(captured.forms.at(-1));
  submit({
    currentTarget: form,
    preventDefault: vi.fn<() => void>(),
  });
  return input;
}

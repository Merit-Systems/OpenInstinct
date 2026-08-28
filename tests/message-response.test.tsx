// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArtifactMessageImage,
  MessageResponse,
} from "../components/ai-elements/message";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("message response rendering", () => {
  it("uses the synchronous renderer for settled text", () => {
    const response = MessageResponse({ children: "Current response" });

    expect(response.props).toMatchObject({
      children: "Current response",
      isAnimating: false,
      mode: "static",
    });
  });

  it("keeps incremental rendering while text is streaming", () => {
    const response = MessageResponse({
      children: "Partial response",
      isAnimating: true,
    });

    expect(response.props).toMatchObject({
      children: "Partial response",
      isAnimating: true,
      mode: "streaming",
    });
  });

  it("renders only authenticated artifact images inline", () => {
    const artifactMarkup = renderToStaticMarkup(
      createElement(ArtifactMessageImage, {
        alt: "Product",
        src: "/artifacts/0d01e667-d128-4bb7-a248-1ae21db72f4f",
      })
    );
    const externalMarkup = renderToStaticMarkup(
      createElement(ArtifactMessageImage, {
        alt: "External product",
        src: "https://example.com/product.png",
      })
    );

    expect(artifactMarkup).toContain("<img");
    expect(artifactMarkup).toContain('loading="lazy"');
    expect(artifactMarkup).toContain("/artifacts/0d01e667");
    expect(externalMarkup).toContain("Image not displayed: External product");
    expect(externalMarkup).not.toContain("https://example.com/product.png");
  });

  it("routes artifact Markdown through the authenticated image renderer", () => {
    const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
    const markup = renderToStaticMarkup(
      MessageResponse({
        children: `![Product](/artifacts/${artifactId})`,
      })
    );

    expect(markup).toContain(`<img alt="Product"`);
    expect(markup).toContain(`src="/artifacts/${artifactId}"`);
    expect(markup).toContain(`loading="lazy"`);
    expect(markup).not.toContain("Image not available");
    expect(markup).not.toContain('data-streamdown="image-wrapper"');
  });

  it("retries a failed artifact request once before showing a fallback", async () => {
    vi.useFakeTimers();
    const artifactUrl = "/artifacts/0d01e667-d128-4bb7-a248-1ae21db72f4f";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      act(() => {
        root.render(
          createElement(ArtifactMessageImage, {
            alt: "Product",
            src: artifactUrl,
          })
        );
      });

      act(() => {
        container
          .querySelector("img")
          ?.dispatchEvent(new Event("error", { bubbles: true }));
      });
      expect(container.textContent).toBe("Retrying image…");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      const retryImage = container.querySelector("img");
      expect(retryImage?.getAttribute("src")).toBe(`${artifactUrl}?attempt=1`);

      act(() => {
        retryImage?.dispatchEvent(new Event("error", { bubbles: true }));
      });
      expect(container.textContent).toBe("Image unavailable: Product");
      expect(container.querySelector("img")).toBeNull();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
      vi.useRealTimers();
    }
  });

  it("starts a fresh retry when the artifact source changes", async () => {
    vi.useFakeTimers();
    const firstUrl = "/artifacts/0d01e667-d128-4bb7-a248-1ae21db72f4f";
    const secondUrl = "/artifacts/206c3a7e-c0b8-4317-9e34-552cff646673";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      act(() => {
        root.render(
          createElement(ArtifactMessageImage, {
            alt: "First product",
            src: firstUrl,
          })
        );
      });
      act(() => {
        container
          .querySelector("img")
          ?.dispatchEvent(new Event("error", { bubbles: true }));
      });

      act(() => {
        root.render(
          createElement(ArtifactMessageImage, {
            alt: "Second product",
            src: secondUrl,
          })
        );
      });
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        secondUrl
      );

      act(() => {
        container
          .querySelector("img")
          ?.dispatchEvent(new Event("error", { bubbles: true }));
      });
      expect(container.textContent).toBe("Retrying image…");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        `${secondUrl}?attempt=1`
      );
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
      vi.useRealTimers();
    }
  });
});

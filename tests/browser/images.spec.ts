import { test, expect } from "@playwright/test";

test("large image histories keep thumbnails bounded while scrolling and previewing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const images = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 768;
    const context = canvas.getContext("2d")!;
    return Array.from({ length: 40 }, (_, index) => {
      context.fillStyle = `hsl(${index * 9} 60% 50%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "black";
      context.font = "80px sans-serif";
      context.fillText(`Image ${index}`, 100, 100);
      return canvas.toDataURL();
    });
  });
  const snapshot = {
    session_id: "image-history", sequence: 1, status: "waiting_for_input", input_requested: true,
    conversations: [{
      id: "primary", kind: "primary", label: "Primary", status: "idle", terminated: false,
      messages: images.map((image, index) => ({
        id: `image-${index}`, role: "assistant", content: `Measurement ${index}`, images: [image],
      })),
    }],
    logs: [], tool_execution_queue: [], message_queue: [],
  };
  await page.route("**/api/state", route => route.fulfill({ json: snapshot }));
  await page.addInitScript(() => {
    // Keep the real demo session's SSE updates out of this isolated history.
    window.EventSource = class extends EventTarget { close() {} } as unknown as typeof EventSource;
  });
  await page.reload();
  await expect(page.getByText("Images (40)", { exact: true })).toBeVisible();
  const messages = page.locator(".eaa-messages");
  const strip = page.locator(".eaa-images");
  const first = page.locator("#message-primary-image-0");
  const last = page.locator("#message-primary-image-39");
  await expect.poll(() => page.locator(".eaa-messages img, .eaa-images img").count()).toBeLessThan(16);
  await expect(last).toBeInViewport();
  await expect(last.locator("img")).toHaveJSProperty("naturalWidth", 1024);

  await messages.evaluate(element => { element.scrollTop = 0; });
  await expect(first.locator("img")).toHaveJSProperty("naturalWidth", 1024);
  await expect(last.locator("img")).toHaveCount(0);
  const height = await messages.evaluate(element => element.scrollHeight);
  await messages.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(last.locator("img")).toHaveJSProperty("naturalWidth", 1024);
  await expect(first.locator("img")).toHaveCount(0);
  expect(await messages.evaluate(element => element.scrollHeight)).toBe(height);

  await page.locator(".eaa-input-panel textarea").pressSequentially("Inspect these measurements");
  await expect(page.locator(".eaa-input-panel textarea")).toHaveValue("Inspect these measurements");
  await strip.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(strip.locator(".eaa-sidebar-image-card").last().locator("img")).toHaveJSProperty("naturalWidth", 1024);
  await expect(strip.locator(".eaa-sidebar-image-card").first().locator("img")).toHaveCount(0);
  await strip.locator(".eaa-image-button").last().click();
  const preview = page.locator(".eaa-browser-image-preview-image");
  await expect(preview).toHaveAttribute("src", images[39]);
  await page.getByRole("button", { name: "Close image preview", exact: true }).click();

  await page.getByRole("button", { name: "Open image gallery", exact: true }).click();
  const gallery = page.getByRole("dialog", { name: "Image gallery", exact: true });
  await expect(gallery.locator("img").first()).toHaveJSProperty("naturalWidth", 1024);
  await expect.poll(() => gallery.locator("img").count()).toBeLessThan(40);
  await gallery.locator(".eaa-gallery-grid").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(gallery.locator(".eaa-gallery-card").last().locator("img")).toHaveJSProperty("naturalWidth", 1024);
  await gallery.locator(".eaa-gallery-title").last().click();
  await expect(gallery).toBeHidden();
  await expect(last).toBeInViewport();
  await strip.evaluate(element => { element.scrollLeft = 0; });
  await strip.locator(".eaa-image-title").first().click();
  await expect(first).toBeInViewport();
  await expect(first.locator("img")).toHaveJSProperty("naturalWidth", 1024);
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';

test('chat round-trip: send a message and stream a fake response', async ({ page }) => {
  await page.goto('/');

  // Composer is the entry point — wait for it to mount.
  const textarea = page.locator('.composer textarea');
  await expect(textarea).toBeVisible();

  // Sidebar auto-creates a session on first load.
  await expect(page.locator('.session-row')).toBeVisible();

  await textarea.fill('hello fake gemini');
  await textarea.press('Enter');

  // User bubble appears immediately.
  await expect(page.locator('.msg.user .bubble')).toContainText('hello fake gemini');

  // Assistant bubble streams the fake response; wait for the canned tail.
  await expect(page.locator('.msg.assistant .bubble')).toContainText(
    'fake streaming response',
    { timeout: 5_000 },
  );

  // Composer returns to non-streaming state (send button, not stop button).
  await expect(page.locator('.send-btn.stop')).toHaveCount(0);
});

test('stream error: typed system bubble appears with a Retry button', async ({ page }) => {
  await page.goto('/');

  const textarea = page.locator('.composer textarea');
  await expect(textarea).toBeVisible();

  // fake-session.ts maps "simulate-error:model" to a stream-level error.
  await textarea.fill('simulate-error:model quota exhausted');
  await textarea.press('Enter');

  const errBubble = page.locator('.msg.system[data-error-kind="model"]');
  await expect(errBubble).toBeVisible({ timeout: 5_000 });
  await expect(errBubble.locator('.err-kind')).toHaveText('Model error');
  await expect(errBubble.locator('.err-body')).toContainText('quota exhausted');

  const retry = errBubble.locator('.retry-btn');
  await expect(retry).toBeVisible();

  // Retry re-sends the same prompt; since the fake session still yields an
  // error, a fresh system bubble should replace the prior one (same prompt,
  // no duplicate user bubble).
  await retry.click();
  await expect(page.locator('.msg.user')).toHaveCount(1);
  await expect(page.locator('.msg.system[data-error-kind="model"]')).toHaveCount(1);
});

test('tool call: request + result render in a collapsed card', async ({ page }) => {
  await page.goto('/');

  const textarea = page.locator('.composer textarea');
  await expect(textarea).toBeVisible();
  await textarea.fill('list the files');
  await textarea.press('Enter');

  const toolCard = page.locator('.tool-call').first();
  await expect(toolCard).toBeVisible({ timeout: 5_000 });

  // Folded by default.
  await expect(toolCard).toHaveAttribute('data-open', 'false');

  // Expand and verify the result row is present (single-column layout).
  await toolCard.locator('.tc-head').click();
  await expect(toolCard).toHaveAttribute('data-open', 'true');
  await expect(toolCard.locator('.tc-body')).toContainText('README.md');
});

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

test('debug drawer: merged-chunk mode collapses chunk runs', async ({ page }) => {
  await page.goto('/');

  const textarea = page.locator('.composer textarea');
  await expect(textarea).toBeVisible();

  // Open the drawer before sending so it's up when events arrive.
  await page.locator('button[aria-label="Toggle debug drawer"]').click();
  const drawer = page.locator('.debug-drawer');
  await expect(drawer).toBeVisible();

  // Fake session emits two consecutive 'content' events for this prompt.
  await textarea.fill('hello fake gemini');
  await textarea.press('Enter');

  // Wait for streaming to finish so the debug event list is complete.
  await expect(page.locator('.msg.assistant .bubble')).toContainText(
    'fake streaming response',
    { timeout: 5_000 },
  );
  await expect(page.locator('.send-btn.stop')).toHaveCount(0);

  const mergedBtn = drawer.locator('.dd-mode-btn', { hasText: 'Merged' });
  const rawBtn = drawer.locator('.dd-mode-btn', { hasText: 'Raw' });

  // Default: merged mode with a single chunk_group row and no raw chunk rows.
  await expect(mergedBtn).toHaveClass(/\bactive\b/);
  await expect(drawer.locator('.dd-event[data-kind="chunk_group"]')).toHaveCount(1);
  await expect(drawer.locator('.dd-event[data-kind="chunk"]')).toHaveCount(0);

  // Toggle to raw → multiple chunk rows, no chunk_group.
  await rawBtn.click();
  await expect(rawBtn).toHaveClass(/\bactive\b/);
  const rawChunks = drawer.locator('.dd-event[data-kind="chunk"]');
  await expect(rawChunks).toHaveCount(2);
  await expect(drawer.locator('.dd-event[data-kind="chunk_group"]')).toHaveCount(0);

  // Toggle back to merged and expand the group — body shows the full reply.
  await mergedBtn.click();
  const group = drawer.locator('.dd-event[data-kind="chunk_group"]');
  await expect(group).toHaveCount(1);
  await group.locator('.dd-evt-head').click();
  await expect(group).toHaveAttribute('data-open', 'true');
  const body = group.locator('.dd-evt-body');
  await expect(body).toContainText('You said: hello fake gemini.');
  await expect(body).toContainText('This is a fake streaming response for tests.');
  await expect(body.locator('.dd-chunk-meta')).toContainText('2 chunks');
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

test('approval modal: allow lets the tool call complete', async ({ page }) => {
  await page.goto('/');

  const textarea = page.locator('.composer textarea');
  await expect(textarea).toBeVisible();
  await textarea.fill('write a new file for me');
  await textarea.press('Enter');

  // The modal should pop up before any tool result renders.
  const modal = page.locator('.approval-card');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await expect(modal).toContainText('write_file');

  // The tool card should be in the "awaiting approval" state.
  const toolCard = page.locator('.tool-call').first();
  await expect(toolCard.locator('.awaiting')).toBeVisible();

  await modal.locator('.approval-btn.primary').click();

  // Modal closes and the tool call now has a result.
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.msg.assistant .bubble')).toContainText('Done writing.', {
    timeout: 5_000,
  });
});

test('approval modal: cancel returns an error to the stream', async ({ page }) => {
  await page.goto('/');

  const textarea = page.locator('.composer textarea');
  await expect(textarea).toBeVisible();
  await textarea.fill('please edit notes.txt');
  await textarea.press('Enter');

  const modal = page.locator('.approval-card');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  await modal.getByRole('button', { name: 'Cancel' }).click();

  await expect(modal).toHaveCount(0);
  await expect(page.locator('.msg.assistant .bubble')).toContainText('Cancelled by user.', {
    timeout: 5_000,
  });
});

test('command palette: ⌘/ opens, shows Switch model, Escape closes', async ({ page }) => {
  await page.goto('/');

  // Wait for boot (sidebar creates a session, composer mounts).
  await expect(page.locator('.composer textarea')).toBeVisible();
  await expect(page.locator('.session-row')).toBeVisible();

  // ⌘/ — open palette. Playwright uses ControlOrMeta to pick the platform key.
  await page.keyboard.press('ControlOrMeta+/');

  const palette = page.locator('.cmdk-card');
  await expect(palette).toBeVisible();

  const switchModel = palette.locator('.cmdk-item', { hasText: 'Switch model' });
  await expect(switchModel).toBeVisible();
  await expect(switchModel).not.toHaveClass(/disabled/);

  // Escape closes.
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
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

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Checkbox from '$lib/components/ui/checkbox.svelte';
import SheetHarness from './fixtures/SheetHarness.svelte';
import PopoverHarness from './fixtures/PopoverHarness.svelte';
import CommandHarness from './fixtures/CommandHarness.svelte';

describe('Checkbox', () => {
  it("renders with aria-checked='false' by default; click toggles to 'true'", async () => {
    const { container } = render(Checkbox, { label: 'opt' });
    const visual = container.querySelector('[role="checkbox"]');
    expect(visual?.getAttribute('aria-checked')).toBe('false');

    const nativeInput = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await fireEvent.click(nativeInput);
    const visualAfter = container.querySelector('[role="checkbox"]');
    expect(visualAfter?.getAttribute('aria-checked')).toBe('true');
  });

  it('has min-h-11 wrapper for 44px touch target', () => {
    const { container } = render(Checkbox);
    const label = container.querySelector('[data-slot="checkbox"]');
    expect(label?.className).toMatch(/min-h-11/);
  });
});

describe('Sheet', () => {
  it("renders role='dialog' and aria-modal='true' when open", () => {
    const { container } = render(SheetHarness, { open: true, title: 'Filters' });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  it('is not in the document when open=false', () => {
    const { container } = render(SheetHarness, { open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('Command', () => {
  it("renders role='listbox' container with aria-multiselectable", () => {
    const { container } = render(CommandHarness);
    const list = container.querySelector('[role="listbox"]');
    expect(list).not.toBeNull();
    expect(list?.getAttribute('aria-multiselectable')).toBe('true');
  });
});

describe('Popover', () => {
  it('renders children content when open=true', () => {
    const { container, baseElement } = render(PopoverHarness, { open: true });
    // Content gets portaled to document body; search baseElement
    const text = baseElement.textContent || container.textContent || '';
    expect(text).toContain('popover-body-content');
  });
});

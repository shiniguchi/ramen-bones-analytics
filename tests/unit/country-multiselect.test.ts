// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/svelte';
import CountryMultiSelect from '../../src/lib/components/CountryMultiSelect.svelte';

// Phase 7 FLT-05 UI: CountryMultiSelect enforces meta-option mutual
// exclusion (D-05):
//   - Selecting __de_only__ or __non_de_only__ clears specific countries.
//   - Selecting a specific country clears meta-options.
//   - Meta-options are mutually exclusive with each other.
//
// State is observed via onSelectionChange because Svelte 5 `$bindable`
// props are not reflected as instance fields on the returned component.

afterEach(() => cleanup());

const OPTIONS = ['__de_only__', '__non_de_only__', 'DE', 'AT', '__unknown__'];

describe('CountryMultiSelect mutual exclusion (FLT-05 / D-05)', () => {
  it('toggling __de_only__ from empty selects only the meta-option', async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(CountryMultiSelect, {
      options: OPTIONS,
      selected: [],
      onSelectionChange,
    });
    await fireEvent.click(container.querySelector('[data-option="__de_only__"]')!);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['__de_only__']);
  });

  it('toggling specific country while meta-option active clears the meta', async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(CountryMultiSelect, {
      options: OPTIONS,
      selected: ['__de_only__'],
      onSelectionChange,
    });
    await fireEvent.click(container.querySelector('[data-option="AT"]')!);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['AT']);
  });

  it('toggling a meta-option clears the specific-country selection', async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(CountryMultiSelect, {
      options: OPTIONS,
      selected: ['AT'],
      onSelectionChange,
    });
    await fireEvent.click(container.querySelector('[data-option="__non_de_only__"]')!);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['__non_de_only__']);
  });

  it('meta-options are mutually exclusive with each other', async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(CountryMultiSelect, {
      options: OPTIONS,
      selected: ['__non_de_only__'],
      onSelectionChange,
    });
    await fireEvent.click(container.querySelector('[data-option="__de_only__"]')!);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['__de_only__']);
  });

  it('toggling an already-selected specific country removes it', async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(CountryMultiSelect, {
      options: OPTIONS,
      selected: ['DE', 'AT'],
      onSelectionChange,
    });
    await fireEvent.click(container.querySelector('[data-option="AT"]')!);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['DE']);
  });
});

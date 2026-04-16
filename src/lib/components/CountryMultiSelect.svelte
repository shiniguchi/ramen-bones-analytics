<script lang="ts">
  // Phase 7 FLT-05 — country multi-select with pinned meta-options.
  //
  // Wraps the same draft-and-apply pattern as MultiSelectDropdown but
  // enforces D-05 mutual exclusion:
  //   - Selecting __de_only__ or __non_de_only__ clears all other picks.
  //   - Selecting a specific country strips all meta-sentinels.
  //   - Meta-sentinels are mutually exclusive with each other.
  //
  // Caller wires via bind:selected OR onSelectionChange. The sentinels
  // all start with `__` so they can never collide with ISO-2 codes.
  import Checkbox from '$lib/components/ui/checkbox.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    options: string[];
    selected?: string[] | undefined;
    label?: string;
    class?: string;
    onSelectionChange?: (next: string[] | undefined) => void;
  }

  let {
    options,
    selected = $bindable(undefined),
    label = 'Country',
    class: className,
    onSelectionChange
  }: Props = $props();

  // ISO-2 + meta-sentinel → human label map. Covers every country observed
  // on DEV in 07-02 ground-truth (DE dominant, plus tourist tail) plus
  // common aliases so the dropdown reads cleanly. Unknown codes fall back
  // to the raw value.
  const LABELS: Record<string, string> = {
    __de_only__: 'DE only',
    __non_de_only__: 'Non-DE only',
    __unknown__: 'Unknown',
    DE: 'DE (Germany)',
    AT: 'AT (Austria)',
    CH: 'CH (Switzerland)',
    FR: 'FR (France)',
    NL: 'NL (Netherlands)',
    IT: 'IT (Italy)',
    GB: 'GB (United Kingdom)',
    US: 'US (United States)',
    JP: 'JP (Japan)',
    CN: 'CN (China)',
    TW: 'TW (Taiwan)',
    KR: 'KR (South Korea)',
    HK: 'HK (Hong Kong)',
    ES: 'ES (Spain)',
    BE: 'BE (Belgium)',
    IE: 'IE (Ireland)',
    FI: 'FI (Finland)',
    SE: 'SE (Sweden)',
    DK: 'DK (Denmark)',
    PL: 'PL (Poland)',
    PT: 'PT (Portugal)',
    CZ: 'CZ (Czechia)',
    HU: 'HU (Hungary)',
    BG: 'BG (Bulgaria)',
    TR: 'TR (Türkiye)',
    IL: 'IL (Israel)',
    AU: 'AU (Australia)',
    CA: 'CA (Canada)',
    BR: 'BR (Brazil)',
    PH: 'PH (Philippines)',
    UA: 'UA (Ukraine)',
    KG: 'KG (Kyrgyzstan)',
    GE: 'GE (Georgia)'
  };

  function labelOf(opt: string): string {
    return LABELS[opt] ?? opt;
  }

  function isMeta(opt: string): boolean {
    return opt.startsWith('__') && opt !== '__unknown__';
  }

  // Split options into pinned meta-sentinels and the regular list.
  // __unknown__ is a specific selectable value (NULL bucket), not a meta.
  const metaOptions = $derived(options.filter((o) => isMeta(o)));
  const specificOptions = $derived(options.filter((o) => !isMeta(o)));

  const current = $derived(selected ?? []);

  function commit(next: string[]) {
    const committed = next.length === 0 ? undefined : next;
    selected = committed;
    onSelectionChange?.(committed);
  }

  function toggle(opt: string) {
    if (isMeta(opt)) {
      // Meta click: if already the only selection, deselect; else replace
      // everything with just this meta. Mutually exclusive with other
      // metas AND with specific countries.
      if (current.length === 1 && current[0] === opt) {
        commit([]);
      } else {
        commit([opt]);
      }
      return;
    }
    // Specific click: strip all meta sentinels, toggle this option.
    const withoutMeta = current.filter((c) => !isMeta(c));
    const idx = withoutMeta.indexOf(opt);
    if (idx >= 0) {
      commit(withoutMeta.filter((c) => c !== opt));
    } else {
      commit([...withoutMeta, opt]);
    }
  }

  function isChecked(opt: string): boolean {
    return current.includes(opt);
  }

  const active = $derived(current.length > 0);

  const placeholder = $derived.by(() => {
    if (current.length === 0) return 'All';
    if (current.length === 1) return labelOf(current[0]);
    return `${current.length} selected`;
  });
</script>

<div
  data-slot="country-multiselect"
  class={cn(
    'rounded-md border p-3 transition-colors',
    active ? 'border-primary/60 bg-primary/5' : 'border-input',
    className
  )}
>
  <div class="mb-2 text-xs font-medium">{label}</div>
  <div class="mb-2 text-xs text-muted-foreground">{placeholder}</div>

  {#if metaOptions.length > 0}
    <div class="flex flex-col">
      {#each metaOptions as opt (opt)}
        <div data-option={opt}>
          <Checkbox
            label={labelOf(opt)}
            checked={isChecked(opt)}
            onCheckedChange={() => toggle(opt)}
          />
        </div>
      {/each}
    </div>
    <hr class="my-2 border-input" />
  {/if}

  <div class="flex flex-col">
    {#each specificOptions as opt (opt)}
      <div data-option={opt}>
        <Checkbox
          label={labelOf(opt)}
          checked={isChecked(opt)}
          onCheckedChange={() => toggle(opt)}
        />
      </div>
    {/each}
  </div>
</div>

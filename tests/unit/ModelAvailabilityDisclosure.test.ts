// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// Pin locale to 'en' so EN assertions match rendered output.
// Must be hoisted before any component import (Svelte 5 $app/state mock).
vi.mock("$app/state", () => ({
  page: { data: { locale: "en" } },
}));

import { render } from "@testing-library/svelte";
import ModelAvailabilityDisclosure from "$lib/components/ModelAvailabilityDisclosure.svelte";

// Flush Svelte 5 microtask queue after DOM mutations (e.g. {#if detailsOpen}).
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Open the disclosure panel and return the opened container. */
async function openDisclosure(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-testid="model-avail-trigger"]'
  );
  expect(trigger).not.toBeNull();
  trigger!.click();
  await flush();
}

describe("ModelAvailabilityDisclosure — Phase 17 backtest pills", () => {
  it("renders 4 horizon pills per available model when backtestStatus provided", async () => {
    const { container } = render(ModelAvailabilityDisclosure, {
      props: {
        availableModels: ["sarimax"],
        grain: "day",
        backtestStatus: {
          sarimax: { h7: "PASS", h35: "FAIL", h120: "PENDING", h365: "PENDING" },
        },
      },
    });
    await openDisclosure(container);

    // sarimax row should have 4 pills (h=7, 35, 120, 365)
    for (const h of [7, 35, 120, 365]) {
      expect(
        container.querySelector(`[data-testid="backtest-pill-sarimax-h${h}"]`)
      ).toBeTruthy();
    }
  });

  it("PASS pill has emerald color class", async () => {
    const { container } = render(ModelAvailabilityDisclosure, {
      props: {
        availableModels: ["sarimax"],
        grain: "day",
        backtestStatus: { sarimax: { h7: "PASS" } },
      },
    });
    await openDisclosure(container);

    const pill = container.querySelector(
      '[data-testid="backtest-pill-sarimax-h7"]'
    );
    expect(pill?.className).toMatch(/emerald/);
  });

  it("FAIL pill has rose color class", async () => {
    const { container } = render(ModelAvailabilityDisclosure, {
      props: {
        availableModels: ["sarimax"],
        grain: "day",
        backtestStatus: { sarimax: { h35: "FAIL" } },
      },
    });
    await openDisclosure(container);

    const pill = container.querySelector(
      '[data-testid="backtest-pill-sarimax-h35"]'
    );
    expect(pill?.className).toMatch(/rose/);
  });

  it("UNCALIBRATED pill has amber color class", async () => {
    const { container } = render(ModelAvailabilityDisclosure, {
      props: {
        availableModels: ["sarimax"],
        grain: "day",
        backtestStatus: { sarimax: { h365: "UNCALIBRATED" } },
      },
    });
    await openDisclosure(container);

    const pill = container.querySelector(
      '[data-testid="backtest-pill-sarimax-h365"]'
    );
    expect(pill?.className).toMatch(/amber/);
  });

  it("cold-start: backtestStatus=null still renders 4 pills (gray fallback)", async () => {
    const { container } = render(ModelAvailabilityDisclosure, {
      props: {
        availableModels: ["sarimax"],
        grain: "day",
        backtestStatus: null,
      },
    });
    await openDisclosure(container);

    const pills = container.querySelectorAll(
      '[data-testid^="backtest-pill-sarimax-"]'
    );
    expect(pills.length).toBe(4);
    // Each pill has the gray (zinc) fallback class
    for (const p of pills) expect(p.className).toMatch(/zinc/);
  });

  it("missing model in backtestStatus -> all pills gray fallback", async () => {
    const { container } = render(ModelAvailabilityDisclosure, {
      props: {
        availableModels: ["sarimax"],
        grain: "day",
        backtestStatus: { prophet: { h7: "PASS" } }, // sarimax missing
      },
    });
    await openDisclosure(container);

    const sarimaxPills = container.querySelectorAll(
      '[data-testid^="backtest-pill-sarimax-"]'
    );
    expect(sarimaxPills.length).toBe(4);
    for (const p of sarimaxPills) expect(p.className).toMatch(/zinc/);
  });
});

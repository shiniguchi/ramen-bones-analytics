// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import InsightCard from "$lib/components/InsightCard.svelte";

describe("InsightCard", () => {
  const baseInsight = {
    headline: "Weekend traffic slipped 18%",
    body: "Saturday and Sunday transactions were the lowest in 4 weeks. Weekday revenue held steady at €2840.",
    action_points: [
      "Weekend revenue 18% below 4-week average",
      "Weekday €2840 steady",
    ],
    business_date: "2026-04-14",
    fallback_used: false,
    is_yesterday: false,
  };

  it("renders headline and body in normal mode", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.querySelector("h2")?.textContent).toContain("Weekend traffic slipped 18%");
    expect(container.querySelector("p")?.textContent).toContain("Saturday and Sunday");
  });

  it("renders 'From yesterday' label when is_yesterday is true", () => {
    const { container } = render(InsightCard, { insight: { ...baseInsight, is_yesterday: true } });
    expect(container.textContent).toContain("From yesterday");
  });

  it("renders 'auto-generated' chip when fallback_used is true", () => {
    const { container } = render(InsightCard, { insight: { ...baseInsight, fallback_used: true } });
    expect(container.textContent).toContain("auto-generated");
  });

  it("does NOT render 'auto-generated' chip when fallback_used is false", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.textContent).not.toContain("auto-generated");
  });

  it("does NOT render 'From yesterday' label when is_yesterday is false", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.textContent).not.toContain("From yesterday");
  });

  it("uses text-zinc-900 for headline (UI-SPEC contrast rule)", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    const h2 = container.querySelector("h2");
    expect(h2?.className).toMatch(/text-zinc-900/);
  });

  it("uses text-zinc-700 for body prose (UI-SPEC contrast rule)", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    const p = container.querySelector("p");
    expect(p?.className).toMatch(/text-zinc-700/);
  });

  it("has role='article' on outer section (UI-SPEC accessibility)", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.querySelector("[role='article']")).not.toBeNull();
  });

  it("renders action_points bullets in a list", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    const items = container.querySelectorAll("ul li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("Weekend revenue 18%");
    expect(items[1].textContent).toContain("Weekday €2840 steady");
  });

  it("omits the bullet list when action_points is empty", () => {
    const { container } = render(InsightCard, {
      insight: { ...baseInsight, action_points: [] },
    });
    expect(container.querySelector("ul")).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import InsightCard from "$lib/components/InsightCard.svelte";

describe("InsightCard", () => {
  const baseInsight = {
    id: "11111111-1111-1111-1111-111111111111",
    headline: "Past 7 days €1842 ▼ 12% vs prior week",
    body: "Past 7 days logged €1842 in revenue. Four-week rolling total €8120. Returning customers drove 38% of spend.",
    action_points: [
      "Past 7 days €1842 ▼ 12%",
      "Last 4 weeks €8120 ▲ 4%",
      "Returning share 38%",
    ],
    business_date: "2026-04-15",
    fallback_used: false,
  };

  it("renders headline and body in normal mode", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.querySelector("h2")?.textContent).toContain("Past 7 days €1842 ▼ 12%");
    expect(container.querySelector("p")?.textContent).toContain("Four-week rolling total");
  });

  it("renders 'Week ending' label derived from business_date", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.textContent).toMatch(/Week ending Apr 15, 2026/);
  });

  it("renders 'auto-generated' chip when fallback_used is true", () => {
    const { container } = render(InsightCard, { insight: { ...baseInsight, fallback_used: true } });
    expect(container.textContent).toContain("auto-generated");
  });

  it("does NOT render 'auto-generated' chip when fallback_used is false", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.textContent).not.toContain("auto-generated");
  });

  it("never renders day-scope labels (weekly cadence contract)", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.textContent).not.toContain("From yesterday");
    expect(container.textContent?.toLowerCase()).not.toContain("today");
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
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain("Past 7 days €1842");
    expect(items[1].textContent).toContain("Last 4 weeks €8120");
    expect(items[2].textContent).toContain("Returning share 38%");
  });

  it("omits the bullet list when action_points is empty", () => {
    const { container } = render(InsightCard, {
      insight: { ...baseInsight, action_points: [] },
    });
    expect(container.querySelector("ul")).toBeNull();
  });

  it("shows edit button when isAdmin=true", () => {
    const { container } = render(InsightCard, { insight: baseInsight, isAdmin: true });
    expect(container.querySelector("button[aria-label='Edit insight']")).not.toBeNull();
  });

  it("hides edit button when isAdmin=false (default)", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.querySelector("button[aria-label='Edit insight']")).toBeNull();
  });

  it("always renders 'Refreshed weekly' cadence label in the footer", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.textContent).toContain("Refreshed weekly");
  });

  it("appends last-run date from generated_at when provided", () => {
    const { container } = render(InsightCard, {
      insight: { ...baseInsight, generated_at: "2026-04-22T09:35:00Z" },
    });
    expect(container.textContent).toMatch(/Refreshed weekly · last run Apr 22, 2026/);
  });

  it("combines cadence + fallback label on one line when fallback_used is true", () => {
    const { container } = render(InsightCard, {
      insight: { ...baseInsight, fallback_used: true, generated_at: "2026-04-22T09:35:00Z" },
    });
    expect(container.textContent).toMatch(/Refreshed weekly · last run Apr 22, 2026.*auto-generated/s);
  });
});

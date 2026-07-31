/** Smooth-scroll a report filter/table section into view after the user picks a report type. */
export function scrollToReportSection(el: HTMLElement | null): void {
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

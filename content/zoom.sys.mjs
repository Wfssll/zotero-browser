/** Shared keyboard recognition for chrome, remote pages and the legacy bridge. */
export const zbZoom = {
  command(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey ||
        !(event.metaKey || event.ctrlKey)) return null;
    if (["+", "=", "Add"].includes(event.key)) return "in";
    if (["-", "Subtract"].includes(event.key)) return "out";
    if (event.key === "0" && !event.shiftKey) return "reset";
    return null;
  },
  next(value, command) {
    const current = Number.isFinite(value) ? value : 1;
    if (command === "reset") return 1;
    return Math.max(.5, Math.min(3, Math.round((current + (command === "in" ? .1 : -.1)) * 100) / 100));
  },
  apply(tab, homeContent, command) {
    if (!tab || !["in", "out", "reset"].includes(command)) return null;
    const value = this.next(tab.pageZoom, command);
    tab.browser.fullZoom = value;
    tab.pageZoom = value;
    // The home page is chrome DOM outside the content browser.
    if (homeContent) homeContent.style.zoom = String(value);
    return value;
  }
};

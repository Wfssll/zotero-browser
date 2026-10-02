export class ZoteroBrowserEmbedParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (!message.data) {
      return;
    }
    let eventType = null;
    if (message.name === "Navigate") {
      eventType = "zb-embed-navigate";
    } else if (message.name === "Selection") {
      eventType = "zb-embed-selection";
    } else if (message.name === "Captcha") {
      eventType = "zb-embed-captcha";
    }
    if (message.name === "Zoom") eventType = "zb-embed-zoom";
    if (!eventType) {
      return;
    }
    try {
      let browsingContext = this.browsingContext;
      let top = browsingContext && browsingContext.top;
      let browser = top && top.embedderElement;
      if (!browser || !browser.ownerGlobal) {
        return;
      }
      let EventCtor = browser.ownerGlobal.CustomEvent;
      browser.dispatchEvent(new EventCtor(eventType, {
        detail: message.data,
        bubbles: true
      }));
    } catch (e) {}
  }
}

/**
 * AIWH Chat Scroll — Smart auto-scroll for streaming chat.
 * Ported from OpenClaw's app-scroll.ts, adapted for standalone Lit component.
 */

/** Distance (px) from the bottom within which we consider the user "near bottom". */
const NEAR_BOTTOM_THRESHOLD = 450;

export type ScrollState = {
  chatScrollFrame: number | null;
  chatScrollTimeout: number | null;
  chatHasAutoScrolled: boolean;
  chatUserNearBottom: boolean;
  chatNewMessagesBelow: boolean;
};

export function createScrollState(): ScrollState {
  return {
    chatScrollFrame: null,
    chatScrollTimeout: null,
    chatHasAutoScrolled: false,
    chatUserNearBottom: true,
    chatNewMessagesBelow: false,
  };
}

export function resetScrollState(s: ScrollState) {
  s.chatHasAutoScrolled = false;
  s.chatUserNearBottom = true;
  s.chatNewMessagesBelow = false;
}

/**
 * Schedule a scroll-to-bottom after the next Lit render cycle.
 * Two-tier: first rAF for immediate content, then 120ms retry for lazy-loaded content.
 */
export function scheduleChatScroll(
  s: ScrollState,
  updateComplete: Promise<unknown>,
  querySelector: (sel: string) => Element | null,
  force = false,
  smooth = false,
) {
  if (s.chatScrollFrame) {
    cancelAnimationFrame(s.chatScrollFrame);
  }
  if (s.chatScrollTimeout != null) {
    clearTimeout(s.chatScrollTimeout);
    s.chatScrollTimeout = null;
  }

  const pickTarget = (): HTMLElement | null => {
    const container = querySelector(".chat-thread") as HTMLElement | null;
    if (container) {
      const overflowY = getComputedStyle(container).overflowY;
      const canScroll =
        overflowY === "auto" ||
        overflowY === "scroll" ||
        container.scrollHeight - container.clientHeight > 1;
      if (canScroll) {
        return container;
      }
    }
    return (document.scrollingElement ?? document.documentElement) as HTMLElement | null;
  };

  void updateComplete.then(() => {
    s.chatScrollFrame = requestAnimationFrame(() => {
      s.chatScrollFrame = null;
      const target = pickTarget();
      if (!target) {
        return;
      }

      const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      const effectiveForce = force && !s.chatHasAutoScrolled;
      const shouldStick =
        effectiveForce || s.chatUserNearBottom || distanceFromBottom < NEAR_BOTTOM_THRESHOLD;

      if (!shouldStick) {
        s.chatNewMessagesBelow = true;
        return;
      }

      if (effectiveForce) {
        s.chatHasAutoScrolled = true;
      }

      const smoothEnabled =
        smooth &&
        (typeof window === "undefined" ||
          typeof window.matchMedia !== "function" ||
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

      const scrollTop = target.scrollHeight;
      if (typeof target.scrollTo === "function") {
        target.scrollTo({ top: scrollTop, behavior: smoothEnabled ? "smooth" : "auto" });
      } else {
        target.scrollTop = scrollTop;
      }
      s.chatUserNearBottom = true;
      s.chatNewMessagesBelow = false;

      // Retry after delay to catch lazy-loaded content
      const retryDelay = effectiveForce ? 150 : 120;
      s.chatScrollTimeout = window.setTimeout(() => {
        s.chatScrollTimeout = null;
        const latest = pickTarget();
        if (!latest) {
          return;
        }
        const latestDist = latest.scrollHeight - latest.scrollTop - latest.clientHeight;
        const shouldStickRetry =
          effectiveForce || s.chatUserNearBottom || latestDist < NEAR_BOTTOM_THRESHOLD;
        if (!shouldStickRetry) {
          return;
        }
        latest.scrollTop = latest.scrollHeight;
        s.chatUserNearBottom = true;
      }, retryDelay);
    });
  });
}

/** Handle user scroll events — update near-bottom tracking. */
export function handleChatScroll(s: ScrollState, event: Event) {
  const container = event.currentTarget as HTMLElement | null;
  if (!container) {
    return;
  }
  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  s.chatUserNearBottom = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
  if (s.chatUserNearBottom) {
    s.chatNewMessagesBelow = false;
  }
}

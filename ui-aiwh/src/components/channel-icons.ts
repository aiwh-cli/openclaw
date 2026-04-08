// Channel SVG icon map — shared between channel-panel, channels-config, channels-setup

export const CH_ICONS: Record<string, string> = {
  discord:  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 3.5a13 13 0 00-3.2-1l-.15.3a12 12 0 00-4.3 0l-.14-.3a13 13 0 00-3.2 1A14 14 0 00.5 12.5a13 13 0 004 2l.5-.7c-.5-.2-.9-.4-1.4-.7l.3-.25a9.2 9.2 0 008.2 0l.3.25c-.4.3-.9.5-1.4.7l.5.7a13 13 0 004-2A14 14 0 002.5 3.5zM5.8 10.8c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5 1.3.7 1.3 1.5-.6 1.5-1.3 1.5zm4.4 0c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5 1.3.7 1.3 1.5-.6 1.5-1.3 1.5z"/></svg>',
  telegram: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.8 1.5L1.3 6.5c-.9.4-.9 1 0 1.2l3.5 1.1 1.3 4.2c.2.4.5.5.8.3l1.9-1.6 3.6 2.7c.7.4 1.2.2 1.4-.6l2.4-11.2c.2-1-.4-1.4-1.4-1.1z"/></svg>',
  slack:    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 9.5a1.5 1.5 0 110-3h3v3a1.5 1.5 0 01-3 0zm1.5-5a1.5 1.5 0 113 0v3h-3a1.5 1.5 0 010-3zm5 1.5a1.5 1.5 0 110 3h-3v-3a1.5 1.5 0 013 0zm-1.5 5a1.5 1.5 0 11-3 0v-3h3a1.5 1.5 0 010 3z"/></svg>',
  whatsapp: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 00-6 10.5L1 15l3.6-1A7 7 0 108 1zm3.5 9.7c-.15.4-1 .8-1.4.9s-.6.1-1.1-.1c-.4-.2-1.7-.7-3.3-2.1-1.2-1.1-2-2.5-2.3-2.9s0-.7.2-.9l.5-.5c.1-.2.2-.3.3-.5s0-.3 0-.5l-.8-2c-.2-.5-.4-.4-.6-.4h-.5s-.4 0-.6.3c-.2.3-.9.9-.9 2.1s.9 2.5 1 2.6c.1.2 1.8 3 4.5 4.1.6.3 1.1.4 1.5.6s1 .2 1.4.1c.4-.1 1.3-.5 1.5-1s.2-1 .1-1l-.5-.3z"/></svg>',
  signal:   '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 8.5l2 2 3-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  imessage: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2C4.13 2 1 4.69 1 8c0 1.7.87 3.22 2.24 4.27L2.5 14.5l2.72-1.36C6.06 13.7 7 14 8 14c3.87 0 7-2.69 7-6S11.87 2 8 2z"/></svg>',
  googlechat: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v8H6l-4 3V3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  nostr:    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
};

export function chIcon(ch: string): string {
  return CH_ICONS[ch] || '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
}

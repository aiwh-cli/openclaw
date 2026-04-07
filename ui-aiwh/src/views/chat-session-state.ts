import { DeletedMessages } from "../chat/deleted-messages.ts";
import { InputHistory } from "../chat/input-history.ts";
import { PinnedMessages } from "../chat/pinned-messages.ts";
import { getOrCreateSessionCacheValue } from "../chat/session-cache.ts";

// Persistent instances keyed by session
const inputHistories = new Map<string, InputHistory>();
const pinnedMessagesMap = new Map<string, PinnedMessages>();
const deletedMessagesMap = new Map<string, DeletedMessages>();

export function getInputHistory(sessionKey: string): InputHistory {
  return getOrCreateSessionCacheValue(inputHistories, sessionKey, () => new InputHistory());
}

export function getPinnedMessages(sessionKey: string): PinnedMessages {
  return getOrCreateSessionCacheValue(
    pinnedMessagesMap,
    sessionKey,
    () => new PinnedMessages(sessionKey),
  );
}

export function getDeletedMessages(sessionKey: string): DeletedMessages {
  return getOrCreateSessionCacheValue(
    deletedMessagesMap,
    sessionKey,
    () => new DeletedMessages(sessionKey),
  );
}

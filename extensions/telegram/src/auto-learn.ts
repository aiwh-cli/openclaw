// V.1.5: record discovered group IDs so the AIWH dashboard can surface
// unconfigured groups without requiring the upstream `directory groups list`
// CLI to enumerate Telegram chats. Writes to a side file, never openclaw.json.

import { promises as fs } from "node:fs";
import * as path from "node:path";

type Entry = {
  channel: string;
  accountId: string;
  groupId: string;
  groupName?: string;
  firstSeen: number;
  lastSeen: number;
};

const FILE = path.join(
  process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw"),
  "discovered-groups.json",
);

let cache: Record<string, Entry> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

async function load(): Promise<Record<string, Entry>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache!;
}

function scheduleFlush(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(async () => {
    writeTimer = null;
    if (!dirty || !cache) return;
    dirty = false;
    try {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      const tmp = FILE + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(cache, null, 2));
      await fs.rename(tmp, FILE);
    } catch {
      /* best-effort */
    }
  }, 1500);
}

export function recordDiscoveredGroup(
  channel: string,
  accountId: string | undefined,
  groupId: string,
  groupName?: string,
): void {
  if (!groupId) return;
  const acct = accountId || "default";
  const key = `${channel}:${acct}:${groupId}`;
  void load().then((c) => {
    const now = Date.now();
    const existing = c[key];
    if (existing) {
      existing.lastSeen = now;
      if (groupName && existing.groupName !== groupName) existing.groupName = groupName;
      dirty = true;
    } else {
      c[key] = {
        channel,
        accountId: acct,
        groupId,
        groupName,
        firstSeen: now,
        lastSeen: now,
      };
      dirty = true;
    }
    scheduleFlush();
  });
}

/** Slash-command handler implementations. Imported by ./slash-command-executor.ts. */
import {
  createChatModelOverride,
  resolvePreferredServerChatModel,
} from "../ui-deps/chat-model-ref.ts";
import type { GatewayBrowserClient } from "../ui-deps/gateway.ts";
import { formatThinkingLevels, normalizeThinkLevel } from "../ui-deps/thinking.ts";
import type {
  AgentsListResult,
  ModelCatalogEntry,
  SessionsListResult,
  SessionsPatchResult,
} from "../ui-deps/types.ts";
import { generateUUID } from "../ui-deps/uuid.ts";
import {
  fmtTokens,
  formatDirectiveOptions,
  isActiveSteerSession,
  loadCurrentSession,
  loadModelCatalog,
  loadThinkingCommandState,
  normalizeVerboseLevel,
  resolveCurrentFastMode,
  resolveCurrentSession,
  resolveCurrentThinkingLevel,
  resolveKillTargets,
  resolveSteerTarget,
} from "./slash-command-executor.ts";
import type { SlashCommandContext, SlashCommandResult } from "./slash-command-executor.ts";
import { SLASH_COMMANDS } from "./slash-commands.ts";

export function executeHelp(): SlashCommandResult {
  const lines = ["**Available Commands**\n"];
  let currentCategory = "";
  for (const cmd of SLASH_COMMANDS) {
    const cat = cmd.category ?? "session";
    if (cat !== currentCategory) {
      currentCategory = cat;
      lines.push(`**${cat.charAt(0).toUpperCase() + cat.slice(1)}**`);
    }
    const argStr = cmd.args ? ` ${cmd.args}` : "";
    const local = cmd.executeLocal ? "" : " *(agent)*";
    lines.push(`\`/${cmd.name}${argStr}\` — ${cmd.description}${local}`);
  }
  lines.push("\nType `/` to open the command menu.");
  return { content: lines.join("\n") };
}
export async function executeCompact(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<SlashCommandResult> {
  try {
    await client.request("sessions.compact", { key: sessionKey });
    return { content: "Context compacted successfully.", action: "refresh" };
  } catch (err) {
    return { content: `Compaction failed: ${String(err)}` };
  }
}
export async function executeModel(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  const modelCatalog = context.chatModelCatalog ?? context.modelCatalog;
  if (!args) {
    try {
      const [sessions, models] = await Promise.all([
        client.request<SessionsListResult>("sessions.list", {}),
        modelCatalog ? Promise.resolve(modelCatalog) : loadModelCatalog(client),
      ]);
      const session = resolveCurrentSession(sessions, sessionKey);
      const model = session?.model || sessions?.defaults?.model || "default";
      const available = models.map((m: ModelCatalogEntry) => m.id);
      const lines = [`**Current model:** \`${model}\``];
      if (available.length > 0) {
        lines.push(
          `**Available:** ${available
            .slice(0, 10)
            .map((m: string) => `\`${m}\``)
            .join(", ")}${available.length > 10 ? ` +${available.length - 10} more` : ""}`,
        );
      }
      return { content: lines.join("\n") };
    } catch (err) {
      return { content: `Failed to get model info: ${String(err)}` };
    }
  }
  try {
    const [patched, resolvedModelCatalog] = await Promise.all([
      client.request<SessionsPatchResult>("sessions.patch", {
        key: sessionKey,
        model: args.trim(),
      }),
      modelCatalog
        ? Promise.resolve(modelCatalog)
        : loadModelCatalog(client, { allowFailure: true }),
    ]);
    const resolvedValue = resolvePreferredServerChatModel(
      patched.resolved?.model ?? args.trim(),
      patched.resolved?.modelProvider,
      resolvedModelCatalog,
    ).value;
    return {
      content: `Model set to \`${args.trim()}\`.`,
      action: "refresh",
      sessionPatch: { modelOverride: createChatModelOverride(resolvedValue) },
    };
  } catch (err) {
    return { content: `Failed to set model: ${String(err)}` };
  }
}
export async function executeThink(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
): Promise<SlashCommandResult> {
  const rawLevel = args.trim();
  if (!rawLevel) {
    try {
      const { session, models } = await loadThinkingCommandState(client, sessionKey);
      return {
        content: formatDirectiveOptions(
          `Current thinking level: ${resolveCurrentThinkingLevel(session, models)}.`,
          formatThinkingLevels(session?.modelProvider),
        ),
      };
    } catch (err) {
      return { content: `Failed to get thinking level: ${String(err)}` };
    }
  }
  const level = normalizeThinkLevel(rawLevel);
  if (!level) {
    try {
      const session = await loadCurrentSession(client, sessionKey);
      return {
        content: `Unrecognized thinking level "${rawLevel}". Valid levels: ${formatThinkingLevels(session?.modelProvider)}.`,
      };
    } catch (err) {
      return { content: `Failed to validate thinking level: ${String(err)}` };
    }
  }
  try {
    await client.request("sessions.patch", { key: sessionKey, thinkingLevel: level });
    return {
      content: `Thinking level set to **${level}**.`,
      action: "refresh",
    };
  } catch (err) {
    return { content: `Failed to set thinking level: ${String(err)}` };
  }
}
export async function executeVerbose(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
): Promise<SlashCommandResult> {
  const rawLevel = args.trim();
  if (!rawLevel) {
    try {
      const session = await loadCurrentSession(client, sessionKey);
      return {
        content: formatDirectiveOptions(
          `Current verbose level: ${normalizeVerboseLevel(session?.verboseLevel) ?? "off"}.`,
          "on, full, off",
        ),
      };
    } catch (err) {
      return { content: `Failed to get verbose level: ${String(err)}` };
    }
  }
  const level = normalizeVerboseLevel(rawLevel);
  if (!level) {
    return { content: `Unrecognized verbose level "${rawLevel}". Valid levels: off, on, full.` };
  }
  try {
    await client.request("sessions.patch", { key: sessionKey, verboseLevel: level });
    return {
      content: `Verbose mode set to **${level}**.`,
      action: "refresh",
    };
  } catch (err) {
    return { content: `Failed to set verbose mode: ${String(err)}` };
  }
}
export async function executeFast(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
): Promise<SlashCommandResult> {
  const rawMode = args.trim().toLowerCase();
  if (!rawMode || rawMode === "status") {
    try {
      const session = await loadCurrentSession(client, sessionKey);
      return {
        content: formatDirectiveOptions(
          `Current fast mode: ${resolveCurrentFastMode(session)}.`,
          "status, on, off",
        ),
      };
    } catch (err) {
      return { content: `Failed to get fast mode: ${String(err)}` };
    }
  }
  if (rawMode !== "on" && rawMode !== "off") {
    return { content: `Unrecognized fast mode "${args.trim()}". Valid levels: status, on, off.` };
  }
  try {
    await client.request("sessions.patch", { key: sessionKey, fastMode: rawMode === "on" });
    return {
      content: `Fast mode ${rawMode === "on" ? "enabled" : "disabled"}.`,
      action: "refresh",
    };
  } catch (err) {
    return { content: `Failed to set fast mode: ${String(err)}` };
  }
}
export async function executeUsage(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<SlashCommandResult> {
  try {
    const sessions = await client.request<SessionsListResult>("sessions.list", {});
    const session = resolveCurrentSession(sessions, sessionKey);
    if (!session) {
      return { content: "No active session." };
    }
    const input = session.inputTokens ?? 0;
    const output = session.outputTokens ?? 0;
    const total = session.totalTokens ?? input + output;
    const ctx = session.contextTokens ?? 0;
    const pct = ctx > 0 ? Math.round((input / ctx) * 100) : null;
    const lines = [
      "**Session Usage**",
      `Input: **${fmtTokens(input)}** tokens`,
      `Output: **${fmtTokens(output)}** tokens`,
      `Total: **${fmtTokens(total)}** tokens`,
    ];
    if (pct !== null) {
      lines.push(`Context: **${pct}%** of ${fmtTokens(ctx)}`);
    }
    if (session.model) {
      lines.push(`Model: \`${session.model}\``);
    }
    return { content: lines.join("\n") };
  } catch (err) {
    return { content: `Failed to get usage: ${String(err)}` };
  }
}
export async function executeAgents(client: GatewayBrowserClient): Promise<SlashCommandResult> {
  try {
    const result = await client.request<AgentsListResult>("agents.list", {});
    const agents = result?.agents ?? [];
    if (agents.length === 0) {
      return { content: "No agents configured." };
    }
    const lines = [`**Agents** (${agents.length})\n`];
    for (const agent of agents) {
      const isDefault = agent.id === result?.defaultId;
      const name = agent.identity?.name || agent.name || agent.id;
      const marker = isDefault ? " *(default)*" : "";
      lines.push(`- \`${agent.id}\` — ${name}${marker}`);
    }
    return { content: lines.join("\n") };
  } catch (err) {
    return { content: `Failed to list agents: ${String(err)}` };
  }
}
export async function executeKill(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
): Promise<SlashCommandResult> {
  const target = args.trim();
  if (!target) {
    return { content: "Usage: `/kill <id|all>`" };
  }
  try {
    const sessions = await client.request<SessionsListResult>("sessions.list", {});
    const matched = resolveKillTargets(sessions?.sessions ?? [], sessionKey, target);
    if (matched.length === 0) {
      return {
        content:
          target.toLowerCase() === "all"
            ? "No active sub-agent sessions found."
            : `No matching sub-agent sessions found for \`${target}\`.`,
      };
    }
    const results = await Promise.allSettled(
      matched.map((key) =>
        client.request<{ aborted?: boolean }>("chat.abort", { sessionKey: key }),
      ),
    );
    const rejected = results.filter((entry) => entry.status === "rejected");
    const successCount = results.filter(
      (entry) =>
        entry.status === "fulfilled" && (entry.value as { aborted?: boolean })?.aborted !== false,
    ).length;
    if (successCount === 0) {
      if (rejected.length === 0) {
        return {
          content:
            target.toLowerCase() === "all"
              ? "No active sub-agent runs to abort."
              : `No active runs matched \`${target}\`.`,
        };
      }
      throw rejected[0]?.reason ?? new Error("abort failed");
    }
    if (target.toLowerCase() === "all") {
      return {
        content:
          successCount === matched.length
            ? `Aborted ${successCount} sub-agent session${successCount === 1 ? "" : "s"}.`
            : `Aborted ${successCount} of ${matched.length} sub-agent sessions.`,
      };
    }
    return {
      content:
        successCount === matched.length
          ? `Aborted ${successCount} matching sub-agent session${successCount === 1 ? "" : "s"} for \`${target}\`.`
          : `Aborted ${successCount} of ${matched.length} matching sub-agent sessions for \`${target}\`.`,
    };
  } catch (err) {
    return { content: `Failed to abort: ${String(err)}` };
  }
}
/** Soft inject — queues a message into the active run via chat.send (deliver: false). */
export async function executeSteer(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  try {
    const resolved = await resolveSteerTarget(client, sessionKey, args, context);
    if ("error" in resolved) {
      return {
        content: resolved.error === "empty" ? "Usage: `/steer [id] <message>`" : resolved.error,
      };
    }
    const sessions =
      resolved.sessions ?? (await client.request<SessionsListResult>("sessions.list", {}));
    const targetSession = resolveCurrentSession(sessions, resolved.key);
    if (!isActiveSteerSession(targetSession)) {
      return {
        content: resolved.label
          ? `No active run matched \`${resolved.label}\`. Use \`/redirect\` instead.`
          : "No active run. Use the chat input or `/redirect` instead.",
      };
    }
    await client.request("chat.send", {
      sessionKey: resolved.key,
      message: resolved.message,
      deliver: false,
      idempotencyKey: generateUUID(),
    });
    return {
      content: resolved.label ? `Steered \`${resolved.label}\`.` : "Steered.",
      pendingCurrentRun: resolved.key === sessionKey,
    };
  } catch (err) {
    return { content: `Failed to steer: ${String(err)}` };
  }
}
/** Hard redirect — aborts the active run and restarts with a new message. */
export async function executeRedirect(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  try {
    const resolved = await resolveSteerTarget(client, sessionKey, args, context);
    if ("error" in resolved) {
      return {
        content: resolved.error === "empty" ? "Usage: `/redirect [id] <message>`" : resolved.error,
      };
    }
    const resp = await client.request<{ runId?: string }>("sessions.steer", {
      key: resolved.key,
      message: resolved.message,
    });
    // Only track the run when redirecting the current session. Subagent
    // redirects target a different sessionKey, so chat events for that run
    // would never clear chatRunId on the current view.
    const runId = typeof resp?.runId === "string" ? resp.runId : undefined;
    const trackRunId = resolved.key === sessionKey ? runId : undefined;
    return {
      content: resolved.label ? `Redirected \`${resolved.label}\`.` : "Redirected.",
      trackRunId,
    };
  } catch (err) {
    return { content: `Failed to redirect: ${String(err)}` };
  }
}

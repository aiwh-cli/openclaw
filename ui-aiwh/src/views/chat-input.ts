import { html, nothing, type TemplateResult } from "lit";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentMimeType,
} from "../chat/attachment-support.ts";
import {
  CATEGORY_LABELS,
  SLASH_COMMANDS,
  getSlashCommandCompletions,
  type SlashCommandCategory,
  type SlashCommandDef,
} from "../chat/slash-commands.ts";
import { icons } from "../ui-deps/icons.ts";
import type { ChatAttachment } from "../ui-deps/ui-types.ts";
import type { ChatProps, ChatEphemeralState } from "./chat.ts";

export function adjustTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
}

export function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function handlePaste(e: ClipboardEvent, props: ChatProps) {
  const items = e.clipboardData?.items;
  if (!items || !props.onAttachmentsChange) {
    return;
  }
  const imageItems: DataTransferItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      imageItems.push(item);
    }
  }
  if (imageItems.length === 0) {
    return;
  }
  e.preventDefault();
  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = reader.result as string;
      const newAttachment: ChatAttachment = {
        id: generateAttachmentId(),
        dataUrl,
        mimeType: file.type,
      };
      const current = props.attachments ?? [];
      props.onAttachmentsChange?.([...current, newAttachment]);
    });
    reader.readAsDataURL(file);
  }
}

export function handleFileSelect(e: Event, props: ChatProps) {
  const input = e.target as HTMLInputElement;
  if (!input.files || !props.onAttachmentsChange) {
    return;
  }
  const current = props.attachments ?? [];
  const additions: ChatAttachment[] = [];
  let pending = 0;
  for (const file of input.files) {
    if (!isSupportedChatAttachmentMimeType(file.type)) {
      continue;
    }
    pending++;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      additions.push({
        id: generateAttachmentId(),
        dataUrl: reader.result as string,
        mimeType: file.type,
      });
      pending--;
      if (pending === 0) {
        props.onAttachmentsChange?.([...current, ...additions]);
      }
    });
    reader.readAsDataURL(file);
  }
  input.value = "";
}

export function handleDrop(e: DragEvent, props: ChatProps) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || !props.onAttachmentsChange) {
    return;
  }
  const current = props.attachments ?? [];
  const additions: ChatAttachment[] = [];
  let pending = 0;
  for (const file of files) {
    if (!isSupportedChatAttachmentMimeType(file.type)) {
      continue;
    }
    pending++;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      additions.push({
        id: generateAttachmentId(),
        dataUrl: reader.result as string,
        mimeType: file.type,
      });
      pending--;
      if (pending === 0) {
        props.onAttachmentsChange?.([...current, ...additions]);
      }
    });
    reader.readAsDataURL(file);
  }
}

export function renderAttachmentPreview(props: ChatProps): TemplateResult | typeof nothing {
  const attachments = props.attachments ?? [];
  if (attachments.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-attachments-preview">
      ${attachments.map(
        (att) => html`
          <div class="chat-attachment-thumb">
            <img src=${att.dataUrl} alt="Attachment preview" />
            <button
              class="chat-attachment-remove"
              type="button"
              aria-label="Remove attachment"
              @click=${() => {
                const next = (props.attachments ?? []).filter((a) => a.id !== att.id);
                props.onAttachmentsChange?.(next);
              }}
            >
              &times;
            </button>
          </div>
        `,
      )}
    </div>
  `;
}

export function resetSlashMenuState(vs: ChatEphemeralState): void {
  vs.slashMenuMode = "command";
  vs.slashMenuCommand = null;
  vs.slashMenuArgItems = [];
  vs.slashMenuItems = [];
}

export function updateSlashMenu(
  value: string,
  requestUpdate: () => void,
  vs: ChatEphemeralState,
): void {
  // Arg mode: /command <partial-arg>
  const argMatch = value.match(/^\/(\S+)\s(.*)$/);
  if (argMatch) {
    const cmdName = argMatch[1].toLowerCase();
    const argFilter = argMatch[2].toLowerCase();
    const cmd = SLASH_COMMANDS.find((c) => c.name === cmdName);
    if (cmd?.argOptions?.length) {
      const filtered = argFilter
        ? cmd.argOptions.filter((opt) => opt.toLowerCase().startsWith(argFilter))
        : cmd.argOptions;
      if (filtered.length > 0) {
        vs.slashMenuMode = "args";
        vs.slashMenuCommand = cmd;
        vs.slashMenuArgItems = filtered;
        vs.slashMenuOpen = true;
        vs.slashMenuIndex = 0;
        vs.slashMenuItems = [];
        requestUpdate();
        return;
      }
    }
    vs.slashMenuOpen = false;
    resetSlashMenuState(vs);
    requestUpdate();
    return;
  }

  // Command mode: /partial-command
  const match = value.match(/^\/(\S*)$/);
  if (match) {
    const items = getSlashCommandCompletions(match[1]);
    vs.slashMenuItems = items;
    vs.slashMenuOpen = items.length > 0;
    vs.slashMenuIndex = 0;
    vs.slashMenuMode = "command";
    vs.slashMenuCommand = null;
    vs.slashMenuArgItems = [];
  } else {
    vs.slashMenuOpen = false;
    resetSlashMenuState(vs);
  }
  requestUpdate();
}

export function selectSlashCommand(
  cmd: SlashCommandDef,
  props: ChatProps,
  requestUpdate: () => void,
  vs: ChatEphemeralState,
): void {
  // Transition to arg picker when the command has fixed options
  if (cmd.argOptions?.length) {
    props.onDraftChange(`/${cmd.name} `);
    vs.slashMenuMode = "args";
    vs.slashMenuCommand = cmd;
    vs.slashMenuArgItems = cmd.argOptions;
    vs.slashMenuOpen = true;
    vs.slashMenuIndex = 0;
    vs.slashMenuItems = [];
    requestUpdate();
    return;
  }

  vs.slashMenuOpen = false;
  resetSlashMenuState(vs);

  if (cmd.executeLocal && !cmd.args) {
    props.onDraftChange(`/${cmd.name}`);
    requestUpdate();
    props.onSend();
  } else {
    props.onDraftChange(`/${cmd.name} `);
    requestUpdate();
  }
}

export function tabCompleteSlashCommand(
  cmd: SlashCommandDef,
  props: ChatProps,
  requestUpdate: () => void,
  vs: ChatEphemeralState,
): void {
  // Tab: fill in the command text without executing
  if (cmd.argOptions?.length) {
    props.onDraftChange(`/${cmd.name} `);
    vs.slashMenuMode = "args";
    vs.slashMenuCommand = cmd;
    vs.slashMenuArgItems = cmd.argOptions;
    vs.slashMenuOpen = true;
    vs.slashMenuIndex = 0;
    vs.slashMenuItems = [];
    requestUpdate();
    return;
  }

  vs.slashMenuOpen = false;
  resetSlashMenuState(vs);
  props.onDraftChange(cmd.args ? `/${cmd.name} ` : `/${cmd.name}`);
  requestUpdate();
}

export function selectSlashArg(
  arg: string,
  props: ChatProps,
  requestUpdate: () => void,
  execute: boolean,
  vs: ChatEphemeralState,
): void {
  const cmdName = vs.slashMenuCommand?.name ?? "";
  vs.slashMenuOpen = false;
  resetSlashMenuState(vs);
  props.onDraftChange(`/${cmdName} ${arg}`);
  requestUpdate();
  if (execute) {
    props.onSend();
  }
}

export function tokenEstimate(draft: string): string | null {
  if (draft.length < 100) {
    return null;
  }
  return `~${Math.ceil(draft.length / 4)} tokens`;
}

export function renderSlashMenu(
  requestUpdate: () => void,
  props: ChatProps,
  vs: ChatEphemeralState,
): TemplateResult | typeof nothing {
  if (!vs.slashMenuOpen) {
    return nothing;
  }

  // Arg-picker mode: show options for the selected command
  if (vs.slashMenuMode === "args" && vs.slashMenuCommand && vs.slashMenuArgItems.length > 0) {
    return html`
      <div class="slash-menu" role="listbox" aria-label="Command arguments">
        <div class="slash-menu-group">
          <div class="slash-menu-group__label">
            /${vs.slashMenuCommand.name} ${vs.slashMenuCommand.description}
          </div>
          ${vs.slashMenuArgItems.map(
            (arg, i) => html`
              <div
                class="slash-menu-item ${i === vs.slashMenuIndex ? "slash-menu-item--active" : ""}"
                role="option"
                aria-selected=${i === vs.slashMenuIndex}
                @click=${() => selectSlashArg(arg, props, requestUpdate, true, vs)}
                @mouseenter=${() => {
                  vs.slashMenuIndex = i;
                  requestUpdate();
                }}
              >
                ${vs.slashMenuCommand?.icon
                  ? html`<span class="slash-menu-icon">${icons[vs.slashMenuCommand.icon]}</span>`
                  : nothing}
                <span class="slash-menu-name">${arg}</span>
                <span class="slash-menu-desc">/${vs.slashMenuCommand?.name} ${arg}</span>
              </div>
            `,
          )}
        </div>
        <div class="slash-menu-footer">
          <kbd>↑↓</kbd> navigate <kbd>Tab</kbd> fill <kbd>Enter</kbd> run <kbd>Esc</kbd> close
        </div>
      </div>
    `;
  }

  // Command mode: show grouped commands
  if (vs.slashMenuItems.length === 0) {
    return nothing;
  }

  const grouped = new Map<
    SlashCommandCategory,
    Array<{ cmd: SlashCommandDef; globalIdx: number }>
  >();
  for (let i = 0; i < vs.slashMenuItems.length; i++) {
    const cmd = vs.slashMenuItems[i];
    const cat = cmd.category ?? "session";
    let list = grouped.get(cat);
    if (!list) {
      list = [];
      grouped.set(cat, list);
    }
    list.push({ cmd, globalIdx: i });
  }

  const sections: TemplateResult[] = [];
  for (const [cat, entries] of grouped) {
    sections.push(html`
      <div class="slash-menu-group">
        <div class="slash-menu-group__label">${CATEGORY_LABELS[cat]}</div>
        ${entries.map(
          ({ cmd, globalIdx }) => html`
            <div
              class="slash-menu-item ${globalIdx === vs.slashMenuIndex
                ? "slash-menu-item--active"
                : ""}"
              role="option"
              aria-selected=${globalIdx === vs.slashMenuIndex}
              @click=${() => selectSlashCommand(cmd, props, requestUpdate, vs)}
              @mouseenter=${() => {
                vs.slashMenuIndex = globalIdx;
                requestUpdate();
              }}
            >
              ${cmd.icon ? html`<span class="slash-menu-icon">${icons[cmd.icon]}</span>` : nothing}
              <span class="slash-menu-name">/${cmd.name}</span>
              ${cmd.args ? html`<span class="slash-menu-args">${cmd.args}</span>` : nothing}
              <span class="slash-menu-desc">${cmd.description}</span>
              ${cmd.argOptions?.length
                ? html`<span class="slash-menu-badge">${cmd.argOptions.length} options</span>`
                : cmd.executeLocal && !cmd.args
                  ? html` <span class="slash-menu-badge">instant</span> `
                  : nothing}
            </div>
          `,
        )}
      </div>
    `);
  }

  return html`
    <div class="slash-menu" role="listbox" aria-label="Slash commands">
      ${sections}
      <div class="slash-menu-footer">
        <kbd>↑↓</kbd> navigate <kbd>Tab</kbd> fill <kbd>Enter</kbd> select <kbd>Esc</kbd> close
      </div>
    </div>
  `;
}

export { CHAT_ATTACHMENT_ACCEPT };

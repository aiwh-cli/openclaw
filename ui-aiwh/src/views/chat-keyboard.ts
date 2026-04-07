import type { InputHistory } from "../chat/input-history.ts";
import {
  resetSlashMenuState,
  selectSlashCommand,
  tabCompleteSlashCommand,
  selectSlashArg,
  adjustTextareaHeight,
  updateSlashMenu,
} from "./chat-input.ts";
import type { ChatProps, ChatEphemeralState } from "./chat.ts";

export function createHandleKeyDown(
  props: ChatProps,
  vs: ChatEphemeralState,
  requestUpdate: () => void,
  inputHistory: InputHistory,
  canCompose: boolean,
) {
  return (e: KeyboardEvent) => {
    // Slash menu navigation — arg mode
    if (vs.slashMenuOpen && vs.slashMenuMode === "args" && vs.slashMenuArgItems.length > 0) {
      const len = vs.slashMenuArgItems.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex + 1) % len;
          requestUpdate();
          return;
        case "ArrowUp":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex - 1 + len) % len;
          requestUpdate();
          return;
        case "Tab":
          e.preventDefault();
          selectSlashArg(vs.slashMenuArgItems[vs.slashMenuIndex], props, requestUpdate, false, vs);
          return;
        case "Enter":
          e.preventDefault();
          selectSlashArg(vs.slashMenuArgItems[vs.slashMenuIndex], props, requestUpdate, true, vs);
          return;
        case "Escape":
          e.preventDefault();
          vs.slashMenuOpen = false;
          resetSlashMenuState(vs);
          requestUpdate();
          return;
      }
    }

    // Slash menu navigation — command mode
    if (vs.slashMenuOpen && vs.slashMenuItems.length > 0) {
      const len = vs.slashMenuItems.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex + 1) % len;
          requestUpdate();
          return;
        case "ArrowUp":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex - 1 + len) % len;
          requestUpdate();
          return;
        case "Tab":
          e.preventDefault();
          tabCompleteSlashCommand(vs.slashMenuItems[vs.slashMenuIndex], props, requestUpdate, vs);
          return;
        case "Enter":
          e.preventDefault();
          selectSlashCommand(vs.slashMenuItems[vs.slashMenuIndex], props, requestUpdate, vs);
          return;
        case "Escape":
          e.preventDefault();
          vs.slashMenuOpen = false;
          resetSlashMenuState(vs);
          requestUpdate();
          return;
      }
    }

    // Input history (only when input is empty)
    if (!props.draft.trim()) {
      if (e.key === "ArrowUp") {
        const prev = inputHistory.up();
        if (prev !== null) {
          e.preventDefault();
          props.onDraftChange(prev);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        const next = inputHistory.down();
        e.preventDefault();
        props.onDraftChange(next ?? "");
        return;
      }
    }

    // Cmd+F for search
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
      e.preventDefault();
      vs.searchOpen = !vs.searchOpen;
      if (!vs.searchOpen) {
        vs.searchQuery = "";
      }
      requestUpdate();
      return;
    }

    // Send on Enter (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      if (!props.connected) {
        return;
      }
      e.preventDefault();
      if (canCompose) {
        if (props.draft.trim()) {
          inputHistory.push(props.draft);
        }
        props.onSend();
      }
    }
  };
}

export function createHandleInput(
  props: ChatProps,
  vs: ChatEphemeralState,
  requestUpdate: () => void,
  inputHistory: InputHistory,
) {
  return (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    adjustTextareaHeight(target);
    updateSlashMenu(target.value, requestUpdate, vs);
    inputHistory.reset();
    props.onDraftChange(target.value);
  };
}

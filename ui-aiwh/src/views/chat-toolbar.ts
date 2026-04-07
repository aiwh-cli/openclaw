import { html, nothing } from "lit";
import { isSttSupported, startStt, stopStt } from "../chat/speech.ts";
import { icons } from "../ui-deps/icons.ts";
import { exportMarkdown } from "./chat-panels.ts";
import type { ChatProps, ChatEphemeralState } from "./chat.ts";

export function renderToolbar(
  props: ChatProps,
  vs: ChatEphemeralState,
  requestUpdate: () => void,
  getDraft: () => string,
  inputHistory: { push: (s: string) => void },
  isBusy: boolean,
  canAbort: boolean,
  tokens: string | null,
) {
  return html`
    <div class="agent-chat__toolbar">
      <div class="agent-chat__toolbar-left">
        <button
          class="agent-chat__input-btn"
          @click=${() => {
            document.querySelector<HTMLInputElement>(".agent-chat__file-input")?.click();
          }}
          title="Attach file"
          aria-label="Attach file"
          ?disabled=${!props.connected}
        >
          ${icons.paperclip}
        </button>
        ${isSttSupported()
          ? html`
              <button
                class="agent-chat__input-btn ${vs.sttRecording
                  ? "agent-chat__input-btn--recording"
                  : ""}"
                @click=${() => {
                  if (vs.sttRecording) {
                    stopStt();
                    vs.sttRecording = false;
                    vs.sttInterimText = "";
                    requestUpdate();
                  } else {
                    const started = startStt({
                      onTranscript: (text, isFinal) => {
                        if (isFinal) {
                          const current = getDraft();
                          const sep = current && !current.endsWith(" ") ? " " : "";
                          props.onDraftChange(current + sep + text);
                          vs.sttInterimText = "";
                        } else {
                          vs.sttInterimText = text;
                        }
                        requestUpdate();
                      },
                      onStart: () => {
                        vs.sttRecording = true;
                        requestUpdate();
                      },
                      onEnd: () => {
                        vs.sttRecording = false;
                        vs.sttInterimText = "";
                        requestUpdate();
                      },
                      onError: () => {
                        vs.sttRecording = false;
                        vs.sttInterimText = "";
                        requestUpdate();
                      },
                    });
                    if (started) {
                      vs.sttRecording = true;
                      requestUpdate();
                    }
                  }
                }}
                title=${vs.sttRecording ? "Stop recording" : "Voice input"}
                ?disabled=${!props.connected}
              >
                ${vs.sttRecording ? icons.micOff : icons.mic}
              </button>
            `
          : nothing}
        ${tokens ? html`<span class="agent-chat__token-count">${tokens}</span>` : nothing}
      </div>
      <div class="agent-chat__toolbar-right">
        ${nothing /* search hidden for now */}
        ${canAbort
          ? nothing
          : html`
              <button
                class="btn btn--ghost"
                @click=${props.onNewSession}
                title="New session"
                aria-label="New session"
              >
                ${icons.plus}
              </button>
            `}
        <button
          class="btn btn--ghost"
          @click=${() => exportMarkdown(props)}
          title="Export"
          aria-label="Export chat"
          ?disabled=${props.messages.length === 0}
        >
          ${icons.download}
        </button>
        ${canAbort && (isBusy || props.sending)
          ? html`
              <button
                class="chat-send-btn chat-send-btn--stop"
                @click=${props.onAbort}
                title="Stop"
                aria-label="Stop generating"
              >
                ${icons.stop}
              </button>
            `
          : html`
              <button
                class="chat-send-btn"
                @click=${() => {
                  if (props.draft.trim()) {
                    inputHistory.push(props.draft);
                  }
                  props.onSend();
                }}
                ?disabled=${!props.connected || props.sending}
                title=${isBusy ? "Queue" : "Send"}
                aria-label=${isBusy ? "Queue message" : "Send message"}
              >
                ${icons.send}
              </button>
            `}
      </div>
    </div>
  `;
}

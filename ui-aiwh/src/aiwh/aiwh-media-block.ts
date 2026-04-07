/**
 * AIWH Media Block — renders inline video/audio/image from file paths.
 *
 * Used in chat tool results when agents generate media via
 * video_generate, image_generate, or music_generate tools.
 * Auto-detects type from file extension.
 *
 * Files are served via /api/media/file?path=... (media-serve.js route).
 */

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

const MEDIA_EXTENSIONS: Record<string, string> = {
  // Video
  mp4: "video", webm: "video", mov: "video", avi: "video", mkv: "video",
  // Audio
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio", aac: "audio",
  // Image
  png: "image", jpg: "image", jpeg: "image", gif: "image",
  webp: "image", svg: "image", avif: "image", heic: "image",
};

function detectMediaType(src: string): string {
  const ext = src.split(".").pop()?.toLowerCase() || "";
  return MEDIA_EXTENSIONS[ext] || "file";
}

function toServeUrl(filePath: string): string {
  // Convert absolute paths to the media serving endpoint
  if (filePath.startsWith("/opt/AIWH/") || filePath.startsWith("/")) {
    return `/api/media/file?path=${encodeURIComponent(filePath)}`;
  }
  // Already a URL
  if (filePath.startsWith("http://") || filePath.startsWith("https://") || filePath.startsWith("data:")) {
    return filePath;
  }
  return `/api/media/file?path=${encodeURIComponent(filePath)}`;
}

@customElement("aiwh-media-block")
export class AiwhMediaBlock extends LitElement {
  @property() src = "";
  @property() type = "";  // auto-detected if empty
  @property() alt = "";

  @state() private _lightboxOpen = false;
  @state() private _error = false;

  static override styles = css`
    :host {
      display: block;
      margin: 8px 0;
      max-width: 480px;
    }

    .media-container {
      border-radius: 8px;
      overflow: hidden;
      background: var(--surface-secondary, #f5f5f5);
      border: 1px solid var(--border-color, #e0e0e0);
    }

    video {
      display: block;
      width: 100%;
      max-height: 360px;
      border-radius: 8px;
    }

    audio {
      display: block;
      width: 100%;
      padding: 8px;
    }

    img {
      display: block;
      width: 100%;
      max-height: 480px;
      object-fit: contain;
      cursor: pointer;
    }

    .media-error {
      padding: 12px;
      color: var(--text-muted, #888);
      font-size: 13px;
    }

    .media-download {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 12px;
      color: var(--accent, #2563eb);
      text-decoration: none;
      font-size: 13px;
    }

    .media-download:hover {
      text-decoration: underline;
    }

    .media-label {
      padding: 4px 8px;
      font-size: 11px;
      color: var(--text-muted, #888);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Lightbox overlay */
    .lightbox {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .lightbox img {
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
      cursor: default;
      border-radius: 0;
    }

    .lightbox-close {
      position: absolute;
      top: 16px;
      right: 16px;
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: #fff;
      font-size: 24px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .lightbox-close:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  `;

  private get _mediaType(): string {
    return this.type || detectMediaType(this.src);
  }

  private get _serveUrl(): string {
    return toServeUrl(this.src);
  }

  private get _filename(): string {
    return this.src.split("/").pop() || "file";
  }

  private _openLightbox() {
    this._lightboxOpen = true;
    // Close on Escape
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this._lightboxOpen = false;
        document.removeEventListener("keydown", handler);
      }
    };
    document.addEventListener("keydown", handler);
  }

  private _closeLightbox() {
    this._lightboxOpen = false;
  }

  private _onError() {
    this._error = true;
  }

  override render() {
    if (!this.src) {return nothing;}

    const type = this._mediaType;
    const url = this._serveUrl;

    if (this._error) {
      return html`
        <div class="media-container">
          <div class="media-error">Failed to load media</div>
          <a class="media-download" href="${url}" target="_blank" download>
            ⬇ Download ${this._filename}
          </a>
        </div>
      `;
    }

    if (type === "video") {
      return html`
        <div class="media-container">
          <video controls preload="metadata" @error=${this._onError}>
            <source src="${url}" />
          </video>
          <div class="media-label">${this._filename}</div>
        </div>
      `;
    }

    if (type === "audio") {
      return html`
        <div class="media-container">
          <audio controls preload="metadata" @error=${this._onError}>
            <source src="${url}" />
          </audio>
          <div class="media-label">${this._filename}</div>
        </div>
      `;
    }

    if (type === "image") {
      return html`
        <div class="media-container">
          <img
            src="${url}"
            alt="${this.alt || this._filename}"
            loading="lazy"
            @click=${this._openLightbox}
            @error=${this._onError}
          />
        </div>
        ${this._lightboxOpen
          ? html`
              <div class="lightbox" @click=${this._closeLightbox}>
                <button class="lightbox-close" @click=${this._closeLightbox}>✕</button>
                <img
                  src="${url}"
                  alt="${this.alt || this._filename}"
                  @click=${(e: Event) => e.stopPropagation()}
                />
              </div>
            `
          : nothing}
      `;
    }

    // Unknown type — download link
    return html`
      <div class="media-container">
        <a class="media-download" href="${url}" target="_blank" download>
          ⬇ Download ${this._filename}
        </a>
      </div>
    `;
  }
}

// Utility: detect media file paths in text (for use in grouped-render.ts)
const MEDIA_PATH_RE = /(?:\/opt\/AIWH\/|\/tmp\/)[^\s"'<>]+\.(?:mp4|webm|mov|mp3|wav|ogg|m4a|png|jpg|jpeg|gif|webp|svg|avif)/gi;

export function extractMediaPaths(text: string): Array<{ path: string; type: string }> {
  const matches = text.match(MEDIA_PATH_RE) || [];
  return matches.map((path) => ({
    path,
    type: detectMediaType(path),
  }));
}

declare global {
  interface HTMLElementTagNameMap {
    "aiwh-media-block": AiwhMediaBlock;
  }
}

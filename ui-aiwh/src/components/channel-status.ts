import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Placeholder for future per-channel config form rendering
// Will be expanded to include dynamic config forms from gateway schema

@customElement('channel-status')
export class ChannelStatus extends LitElement {
  @property() channel = '';

  static styles = css`
    :host { display: block; }
  `;

  render() {
    return nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'channel-status': ChannelStatus;
  }
}

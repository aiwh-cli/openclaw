// ─── Chat View: Media Rendering (Images + Audio) ────────────────────
// Inline image display, lightbox, and audio player for chat messages.
// Globals provided: _renderChatImages, _chatOpenImageLightbox, _chatCloseLightbox

function _renderChatImages(contentBlocks) {
  if (!Array.isArray(contentBlocks)) {return '';}
  const images = contentBlocks.filter(b => b && b.type === 'image');
  if (images.length === 0) {return '';}

  return `<div class="chat-images-inline">${images.map(img => {
    const src = img.source?.type === 'base64'
      ? `data:${img.source.media_type || 'image/png'};base64,${img.source.data}`
      : (img.data ? `data:${img.mimeType || 'image/png'};base64,${img.data}` : '');
    if (!src) {return '';}
    return `<img class="chat-image-inline" src="${src}" alt="Image" onclick="_chatOpenImageLightbox(this.src)" loading="lazy">`;
  }).join('')}</div>`;
}

function _renderUserAttachmentImages(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {return '';}
  return `<div class="chat-images-inline">${attachments.map(att => {
    const src = `data:${att.mimeType || 'image/png'};base64,${att.content}`;
    return `<img class="chat-image-inline" src="${src}" alt="Attached image" onclick="_chatOpenImageLightbox(this.src)" loading="lazy">`;
  }).join('')}</div>`;
}

function _chatOpenImageLightbox(src) {
  let lb = document.getElementById('chat-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'chat-lightbox';
    lb.className = 'chat-lightbox hidden';
    lb.innerHTML = `<div class="chat-lightbox-backdrop" onclick="_chatCloseLightbox()"></div>
      <img class="chat-lightbox-img" src="" alt="Full size">
      <button class="chat-lightbox-close" onclick="_chatCloseLightbox()">&times;</button>`;
    document.body.appendChild(lb);
  }
  lb.querySelector('.chat-lightbox-img').src = src;
  lb.classList.remove('hidden');
}

function _chatCloseLightbox() {
  const lb = document.getElementById('chat-lightbox');
  if (lb) {lb.classList.add('hidden');}
}

// Close lightbox on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {_chatCloseLightbox();}
});

// ─── Chat View: Image Paste / Drop / Upload ────────────────────────
// Handles clipboard paste, drag-and-drop, and file picker for image attachments.
// Globals provided: _chatInitImageHandlers, _chatAddImageFromPicker,
//   _chatGetAttachmentsForSend, _chatClearAttachments

const _chatAttachments = []; // [{id, dataUrl, mimeType, fileName}]
const _CHAT_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB decoded
const _CHAT_ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
let _chatImagePickerInput = null;

function _chatInitImageHandlers() {
  const inputArea = document.querySelector('.chat-input-area');
  const textarea = document.getElementById('chat-input');
  if (!inputArea) return;

  // Paste handler
  textarea?.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (_CHAT_ALLOWED_IMAGE_TYPES.has(item.type)) {
        e.preventDefault();
        _chatProcessFile(item.getAsFile());
      }
    }
  });

  // Drag-and-drop
  inputArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    inputArea.classList.add('chat-drag-active');
  });
  inputArea.addEventListener('dragleave', () => {
    inputArea.classList.remove('chat-drag-active');
  });
  inputArea.addEventListener('drop', (e) => {
    e.preventDefault();
    inputArea.classList.remove('chat-drag-active');
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (_CHAT_ALLOWED_IMAGE_TYPES.has(file.type)) _chatProcessFile(file);
    }
  });
}

function _chatProcessFile(file) {
  if (!file) return;
  if (!_CHAT_ALLOWED_IMAGE_TYPES.has(file.type)) {
    showToast(`Unsupported format: ${file.type || 'unknown'}. Use JPEG, PNG, GIF, or WebP.`, 'error');
    return;
  }
  if (file.size > _CHAT_MAX_IMAGE_BYTES) {
    showToast(`Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 5MB.`, 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    _chatAttachments.push({
      id: 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      dataUrl: reader.result,
      mimeType: file.type,
      fileName: file.name,
    });
    _chatRenderPreviewStrip();
  };
  reader.readAsDataURL(file);
}

function _chatAddImageFromPicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/gif,image/webp';
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    // Read all files BEFORE removing input (FileReader is async, needs valid File refs)
    const files = Array.from(input.files);
    let pending = files.filter(f => f.type.startsWith('image/')).length;
    if (pending === 0) { input.remove(); return; }
    for (const file of files) {
      if (!file.type.startsWith('image/')) {continue;}
      const reader = new FileReader();
      reader.onload = () => {
        _chatAttachments.push({
          id: 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          dataUrl: reader.result,
          mimeType: file.type,
          fileName: file.name,
        });
        pending--;
        if (pending === 0) {
          _chatRenderPreviewStrip();
          input.remove();
        }
      };
      reader.onerror = () => { pending--; if (pending === 0) { _chatRenderPreviewStrip(); input.remove(); } };
      reader.readAsDataURL(file);
    }
  });
  input.click();
}

function _chatRenderPreviewStrip() {
  const strip = document.getElementById('chat-image-preview');
  if (!strip) {return;}

  if (_chatAttachments.length === 0) {
    strip.classList.add('hidden');
    strip.innerHTML = '';
    return;
  }

  strip.classList.remove('hidden');
  strip.innerHTML = _chatAttachments.map(att => `
    <div class="chat-preview-thumb" data-id="${att.id}">
      <img src="${att.dataUrl}" alt="${escHtml(att.fileName || 'image')}">
      <button class="chat-preview-remove" onclick="_chatRemoveAttachment('${att.id}')" title="Remove">&times;</button>
    </div>
  `).join('');
}

function _chatRemoveAttachment(id) {
  const idx = _chatAttachments.findIndex(a => a.id === id);
  if (idx >= 0) {_chatAttachments.splice(idx, 1);}
  _chatRenderPreviewStrip();
}

function _chatGetAttachmentsForSend() {
  const attachments = _chatAttachments.map(att => {
    const base64 = att.dataUrl.replace(/^data:[^;]+;base64,/, '');
    return { type: 'image', mimeType: att.mimeType, content: base64 };
  });
  // Validate total size (base64 strings + JSON overhead must fit in server limit)
  const totalBytes = attachments.reduce((sum, a) => sum + a.content.length, 0);
  if (totalBytes > 20 * 1024 * 1024) { // 20MB base64 ≈ ~15MB decoded
    showToast(`Total image size too large (${(totalBytes / 1024 / 1024).toFixed(1)}MB). Try fewer or smaller images.`, 'error');
    return [];
  }
  return attachments;
}

function _chatClearAttachments() {
  _chatAttachments.length = 0;
  _chatRenderPreviewStrip();
}

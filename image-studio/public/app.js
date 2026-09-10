/**
 * Image Studio Client Application
 * Generative diffusion workflows, drag & drop image handling, and gallery management.
 */

// Workflow Configurations
const WORKFLOWS = {
  quality: {
    id: 'quality',
    title: 'Photoreal Quality — Krea 2 RAW',
    desc: 'Ultra-crisp photorealistic generation using Krea 2 RAW with LoRA 0.75 weight delta.',
    model: 'krea2-raw-fp8',
    steps: 25,
    cfg: 5.5,
    dropzones: 'none',
  },
  fast: {
    id: 'fast',
    title: 'Fast Generation — Krea Turbo',
    desc: 'High-speed 4-step generation for rapid concept visualization and brainstorming.',
    model: 'krea2-turbo',
    steps: 4,
    cfg: 1.5,
    dropzones: 'none',
  },
  draft: {
    id: 'draft',
    title: 'Draft Preview — Z-Image Turbo',
    desc: 'Fast, flexible layout sketches and conceptual layouts.',
    model: 'z-image-turbo',
    steps: 8,
    cfg: 2.5,
    dropzones: 'none',
  },
  instruction: {
    id: 'instruction',
    title: 'Text-to-Image — Qwen-Image',
    desc: 'Instruction-following image synthesis guided by complex natural language prompts.',
    model: 'qwen-image',
    steps: 20,
    cfg: 5.0,
    dropzones: 'none',
  },
  edit: {
    id: 'edit',
    title: 'Photo Edit & Inpainting — Qwen-Edit',
    desc: 'Modifies an existing photo based on your instructions. Requires a source reference image.',
    model: 'qwen-edit-2511-fp8',
    steps: 20,
    cfg: 5.0,
    dropzones: 'source',
  },
  faceswap: {
    id: 'faceswap',
    title: 'Face Swap — Identity Transfer',
    desc: 'Transfers an identity face onto a target scene. Requires both reference images.',
    model: 'qwen-edit-2511-fp8',
    steps: 24,
    cfg: 5.0,
    dropzones: 'faceswap',
  },
  id: {
    id: 'id',
    title: 'ID Document Pipeline — Qwen-Edit',
    desc: 'Cleans up scans, corrects shadows, and refines portrait lighting for documentation.',
    model: 'qwen-edit-2511-fp8',
    steps: 20,
    cfg: 5.0,
    dropzones: 'source',
  },
  klein: {
    id: 'klein',
    title: 'High Adherence — FLUX.2 Klein 9B',
    desc: 'Advanced prompt adherence and detailed multi-subject composition.',
    model: 'flux-2-klein-9b',
    steps: 28,
    cfg: 4.5,
    dropzones: 'none',
  },
  anime: {
    id: 'anime',
    title: 'Anime Illustration — Illustrious / Pony',
    desc: 'Stylized anime, manga, and digital 2D illustration pipelines.',
    model: 'illustrious-pony-fp8',
    steps: 22,
    cfg: 6.0,
    dropzones: 'none',
  },
  xai: {
    id: 'xai',
    title: 'Cloud Mode — xAI Grok Imagine 2.0',
    desc: 'Direct cloud generation using the xAI Grok Imagine API.',
    model: 'grok-imagine-2.0',
    steps: 20,
    cfg: 5.0,
    dropzones: 'none',
  },
};

const RANDOM_PROMPTS = [
  'A cinematic street portrait in Tokyo at dusk, neon rain reflections on wet asphalt, 35mm lens, natural film grain, shallow depth of field.',
  'Futuristic architectural pavilion in the desert, brutalist concrete curves, sharp golden hour shadows, minimal aesthetic, 8k resolution.',
  'An ethereal macro shot of morning dew drops on a delicate green monstera leaf, refraction of sunlight, sharp focus, vibrant emerald tones.',
  'High-fashion studio portrait of a woman wearing an iridescent metallic trench coat, bold dramatic split lighting, high contrast, clean backdrop.',
  'A cozy artisan coffee roastery in a Scandinavian loft, warm morning ambient light through industrial steel-framed windows, steam rising.',
  'Cyberpunk nighttime alleyway with holographic signs, volumetric smoke, puddles reflecting magenta and cyan neon, ultra-detailed.',
];

// App State
const state = {
  activeWorkflow: 'quality',
  aspectRatio: '1:1',
  size: '1024x1024',
  sourceImageB64: null,
  faceImageB64: null,
  targetImageB64: null,
  currentImageB64: null,
  currentImageUrl: null,
  isGenerating: false,
  timerInterval: null,
  timerStart: 0,
};

// DOM Elements
const el = {
  bridgeStatusPill: document.getElementById('bridgeStatusPill'),
  bridgeStatusLabel: document.getElementById('bridgeStatusLabel'),
  btnRestartBridge: document.getElementById('btnRestartBridge'),
  workflowChips: document.querySelectorAll('.workflow-chip'),
  workflowBanner: document.getElementById('workflowBanner'),
  workflowTitle: document.getElementById('workflowTitle'),
  workflowDesc: document.getElementById('workflowDesc'),
  promptInput: document.getElementById('promptInput'),
  negativePromptInput: document.getElementById('negativePromptInput'),
  btnRandomPrompt: document.getElementById('btnRandomPrompt'),
  btnClearPrompt: document.getElementById('btnClearPrompt'),
  tagChips: document.querySelectorAll('.tag-chip'),

  // Dropzones
  dropzonesContainer: document.getElementById('dropzonesContainer'),
  dzSourceBox: document.getElementById('dzSourceBox'),
  dzFaceBox: document.getElementById('dzFaceBox'),
  dzTargetBox: document.getElementById('dzTargetBox'),
  dzSource: document.getElementById('dzSource'),
  dzFace: document.getElementById('dzFace'),
  dzTarget: document.getElementById('dzTarget'),
  fileSource: document.getElementById('fileSource'),
  fileFace: document.getElementById('fileFace'),
  fileTarget: document.getElementById('fileTarget'),
  previewSource: document.getElementById('previewSource'),
  previewFace: document.getElementById('previewFace'),
  previewTarget: document.getElementById('previewTarget'),
  dzSourcePlaceholder: document.getElementById('dzSourcePlaceholder'),
  dzFacePlaceholder: document.getElementById('dzFacePlaceholder'),
  dzTargetPlaceholder: document.getElementById('dzTargetPlaceholder'),
  btnRemoveSource: document.getElementById('btnRemoveSource'),
  btnRemoveFace: document.getElementById('btnRemoveFace'),
  btnRemoveTarget: document.getElementById('btnRemoveTarget'),

  // Parameters
  aspectBtns: document.querySelectorAll('.aspect-btn'),
  inputSteps: document.getElementById('inputSteps'),
  stepsVal: document.getElementById('stepsVal'),
  inputCfg: document.getElementById('inputCfg'),
  cfgVal: document.getElementById('cfgVal'),
  inputSeed: document.getElementById('inputSeed'),
  btnRandomSeed: document.getElementById('btnRandomSeed'),
  xaiKeyContainer: document.getElementById('xaiKeyContainer'),
  inputXaiKey: document.getElementById('inputXaiKey'),

  // Generation
  btnGenerate: document.getElementById('btnGenerate'),
  btnGenerateText: document.getElementById('btnGenerateText'),

  // Viewport
  viewportCanvas: document.getElementById('viewportCanvas'),
  canvasPlaceholder: document.getElementById('canvasPlaceholder'),
  canvasImage: document.getElementById('canvasImage'),
  generationLoader: document.getElementById('generationLoader'),
  loaderTimer: document.getElementById('loaderTimer'),
  viewportMeta: document.getElementById('viewportMeta'),
  canvasActionsBar: document.getElementById('canvasActionsBar'),
  btnDownloadImage: document.getElementById('btnDownloadImage'),
  btnCopyImage: document.getElementById('btnCopyImage'),
  btnSendToEdit: document.getElementById('btnSendToEdit'),
  btnZoomImage: document.getElementById('btnZoomImage'),

  // Gallery
  galleryGrid: document.getElementById('galleryGrid'),
  galleryCount: document.getElementById('galleryCount'),
  btnRefreshGallery: document.getElementById('btnRefreshGallery'),

  // Modal
  imageModal: document.getElementById('imageModal'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalImage: document.getElementById('modalImage'),
  modalCaption: document.getElementById('modalCaption'),
  modalClose: document.getElementById('modalClose'),

  // Toast
  toast: document.getElementById('toastNotification'),
  toastIcon: document.getElementById('toastIcon'),
  toastMessage: document.getElementById('toastMessage'),
  toastClose: document.getElementById('toastClose'),
};

// Utilities
function showToast(message, type = 'info') {
  el.toastMessage.textContent = message;
  el.toast.className = `toast ${type}`;
  el.toastIcon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ️';
  el.toast.classList.remove('hidden');
  setTimeout(() => el.toast.classList.add('hidden'), 5000);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Check Bridge Status
async function checkBridgeStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.healthy) {
      el.bridgeStatusPill.className = 'bridge-status-pill online';
      el.bridgeStatusLabel.textContent = `Bridge Online (:7860) · ${data.models?.length || 0} Models`;
    } else {
      el.bridgeStatusPill.className = 'bridge-status-pill offline';
      el.bridgeStatusLabel.textContent = 'Bridge Offline (:7860)';
    }
  } catch {
    el.bridgeStatusPill.className = 'bridge-status-pill offline';
    el.bridgeStatusLabel.textContent = 'Bridge Unreachable';
  }
}

// Select Workflow
function setWorkflow(id) {
  state.activeWorkflow = id;
  const wf = WORKFLOWS[id] || WORKFLOWS.quality;

  el.workflowChips.forEach((chip) => chip.classList.toggle('active', chip.dataset.workflow === id));
  el.workflowTitle.textContent = wf.title;
  el.workflowDesc.textContent = wf.desc;

  el.inputSteps.value = wf.steps;
  el.stepsVal.textContent = wf.steps;
  el.inputCfg.value = wf.cfg;
  el.cfgVal.textContent = wf.cfg.toFixed(1);

  // Dropzone visibility
  if (wf.dropzones === 'source') {
    el.dropzonesContainer.classList.remove('hidden');
    el.dzSourceBox.classList.remove('hidden');
    el.dzFaceBox.classList.add('hidden');
    el.dzTargetBox.classList.add('hidden');
  } else if (wf.dropzones === 'faceswap') {
    el.dropzonesContainer.classList.remove('hidden');
    el.dzSourceBox.classList.add('hidden');
    el.dzFaceBox.classList.remove('hidden');
    el.dzTargetBox.classList.remove('hidden');
  } else {
    el.dropzonesContainer.classList.add('hidden');
  }

  // xAI container
  el.xaiKeyContainer.style.display = id === 'xai' ? 'flex' : 'none';
}

// Load Gallery
async function loadGallery() {
  try {
    const res = await fetch('/api/gallery');
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      el.galleryCount.textContent = `${data.items.length} saved`;
      el.galleryGrid.innerHTML = data.items
        .map(
          (item) => `
        <div class="gallery-thumb" title="${escapeHtml(item.prompt || 'Generated Image')}" data-url="${item.imageUrl}" data-prompt="${escapeHtml(item.prompt || '')}" data-meta="${escapeHtml(item.model || '')}">
          <img src="${item.imageUrl}" alt="Thumbnail" loading="lazy">
        </div>
      `,
        )
        .join('');

      el.galleryGrid.querySelectorAll('.gallery-thumb').forEach((thumb) => {
        thumb.addEventListener('click', () => {
          const url = thumb.dataset.url;
          const prompt = thumb.dataset.prompt;
          const meta = thumb.dataset.meta;
          showInCanvas(url, `${meta} · ${prompt}`);
        });
      });
    } else {
      el.galleryCount.textContent = '0 saved';
      el.galleryGrid.innerHTML = '<div class="gallery-empty">No generated images recorded yet.</div>';
    }
  } catch (err) {
    el.galleryGrid.innerHTML = `<div class="gallery-empty">Error loading gallery: ${err.message}</div>`;
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showInCanvas(url, metaText = '') {
  state.currentImageUrl = url;
  el.canvasPlaceholder.classList.add('hidden');
  el.generationLoader.classList.add('hidden');
  el.canvasImage.src = url;
  el.canvasImage.classList.remove('hidden');
  el.canvasActionsBar.classList.remove('hidden');
  if (metaText) el.viewportMeta.textContent = metaText;
}

// Generate Action
async function generate() {
  if (state.isGenerating) return;

  const prompt = el.promptInput.value.trim();
  if (!prompt) {
    showToast('Please enter a prompt first', 'error');
    el.promptInput.focus();
    return;
  }

  const wf = WORKFLOWS[state.activeWorkflow] || WORKFLOWS.quality;

  // Validation for image edit modes
  if (wf.dropzones === 'source' && !state.sourceImageB64) {
    showToast('Please attach a source reference image for this mode', 'error');
    return;
  }
  if (wf.dropzones === 'faceswap' && (!state.faceImageB64 || !state.targetImageB64)) {
    showToast('Face Swap requires both an Identity Face and a Target Scene image', 'error');
    return;
  }

  state.isGenerating = true;
  el.btnGenerate.disabled = true;
  el.btnGenerate.classList.add('generating');
  el.btnGenerateText.textContent = 'Synthesizing…';

  el.canvasPlaceholder.classList.add('hidden');
  el.canvasImage.classList.add('hidden');
  el.canvasActionsBar.classList.add('hidden');
  el.generationLoader.classList.remove('hidden');

  // Start timer
  state.timerStart = Date.now();
  el.loaderTimer.textContent = '0.0s';
  state.timerInterval = setInterval(() => {
    const elapsed = ((Date.now() - state.timerStart) / 1000).toFixed(1);
    el.loaderTimer.textContent = `${elapsed}s`;
  }, 100);

  const payload = {
    prompt,
    negativePrompt: el.negativePromptInput.value.trim(),
    model: wf.model,
    size: state.size,
    aspectRatio: state.aspectRatio,
    steps: Number(el.inputSteps.value) || wf.steps,
    guidanceScale: Number(el.inputCfg.value) || wf.cfg,
    seed: el.inputSeed.value.trim() ? Number(el.inputSeed.value) : undefined,
    xaiApiKey: el.inputXaiKey.value.trim() || undefined,
  };

  if (wf.dropzones === 'source') {
    payload.image = state.sourceImageB64;
  } else if (wf.dropzones === 'faceswap') {
    payload.images = [
      { url: state.faceImageB64, role: 'face' },
      { url: state.targetImageB64, role: 'scene' },
    ];
  }

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }

    const b64 = json.data?.[0]?.b64_json;
    const url = json.data?.[0]?.url;
    const finalUrl = b64 ? `data:image/png;base64,${b64}` : url;

    state.currentImageB64 = b64 ? `data:image/png;base64,${b64}` : null;
    state.currentImageUrl = finalUrl;

    const elapsed = ((Date.now() - state.timerStart) / 1000).toFixed(1);
    showInCanvas(finalUrl, `${wf.title} · ${state.size} · ${elapsed}s`);
    showToast(`Image generated in ${elapsed}s`, 'success');

    // Reload gallery to pick up persisted file
    setTimeout(loadGallery, 500);
  } catch (err) {
    el.canvasPlaceholder.classList.remove('hidden');
    showToast(err.message, 'error');
  } finally {
    clearInterval(state.timerInterval);
    state.isGenerating = false;
    el.btnGenerate.disabled = false;
    el.btnGenerate.classList.remove('generating');
    el.btnGenerateText.textContent = 'Generate Still';
  }
}

// Event Listeners
function initEvents() {
  // Workflow Chips
  el.workflowChips.forEach((chip) => {
    chip.addEventListener('click', () => setWorkflow(chip.dataset.workflow));
  });

  // Aspect Ratio Buttons
  el.aspectBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      el.aspectBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.aspectRatio = btn.dataset.ratio;
      state.size = btn.dataset.size;
    });
  });

  // Sliders
  el.inputSteps.addEventListener('input', (e) => (el.stepsVal.textContent = e.target.value));
  el.inputCfg.addEventListener('input', (e) => (el.cfgVal.textContent = Number(e.target.value).toFixed(1)));

  // Prompt Helpers
  el.btnRandomPrompt.addEventListener('click', () => {
    const p = RANDOM_PROMPTS[Math.floor(Math.random() * RANDOM_PROMPTS.length)];
    el.promptInput.value = p;
  });

  el.btnClearPrompt.addEventListener('click', () => {
    el.promptInput.value = '';
    el.promptInput.focus();
  });

  el.tagChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const tag = chip.dataset.tag;
      if (el.promptInput.value.trim()) {
        el.promptInput.value += `, ${tag}`;
      } else {
        el.promptInput.value = tag;
      }
    });
  });

  el.btnRandomSeed.addEventListener('click', () => {
    el.inputSeed.value = Math.floor(Math.random() * 2147483647);
  });

  // Dropzone Handlers
  function setupDropzone(dz, fileInput, preview, placeholder, removeBtn, stateKey) {
    dz.addEventListener('click', (e) => {
      if (e.target !== removeBtn) fileInput.click();
    });

    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    });

    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));

    dz.addEventListener('drop', async (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files?.[0]) {
        const file = e.dataTransfer.files[0];
        const b64 = await fileToBase64(file);
        state[stateKey] = b64;
        preview.src = b64;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
        removeBtn.classList.remove('hidden');
      }
    });

    fileInput.addEventListener('change', async () => {
      if (fileInput.files?.[0]) {
        const file = fileInput.files[0];
        const b64 = await fileToBase64(file);
        state[stateKey] = b64;
        preview.src = b64;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
        removeBtn.classList.remove('hidden');
      }
    });

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state[stateKey] = null;
      fileInput.value = '';
      preview.src = '';
      preview.classList.add('hidden');
      placeholder.classList.remove('hidden');
      removeBtn.classList.add('hidden');
    });
  }

  setupDropzone(el.dzSource, el.fileSource, el.previewSource, el.dzSourcePlaceholder, el.btnRemoveSource, 'sourceImageB64');
  setupDropzone(el.dzFace, el.fileFace, el.previewFace, el.dzFacePlaceholder, el.btnRemoveFace, 'faceImageB64');
  setupDropzone(el.dzTarget, el.fileTarget, el.previewTarget, el.dzTargetPlaceholder, el.btnRemoveTarget, 'targetImageB64');

  // Generate Button & Shortcut
  el.btnGenerate.addEventListener('click', generate);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      generate();
    }
  });

  // Canvas Actions
  el.btnDownloadImage.addEventListener('click', () => {
    if (!state.currentImageUrl) return;
    const a = document.createElement('a');
    a.href = state.currentImageUrl;
    a.download = `spark_image_${Date.now()}.png`;
    a.click();
    showToast('Image downloaded', 'info');
  });

  el.btnCopyImage.addEventListener('click', async () => {
    if (!state.currentImageUrl) return;
    try {
      const res = await fetch(state.currentImageUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      showToast('Image copied to clipboard', 'info');
    } catch {
      showToast('Clipboard write failed — use download', 'error');
    }
  });

  el.btnSendToEdit.addEventListener('click', () => {
    if (!state.currentImageUrl) return;
    setWorkflow('edit');
    state.sourceImageB64 = state.currentImageUrl;
    el.previewSource.src = state.currentImageUrl;
    el.previewSource.classList.remove('hidden');
    el.dzSourcePlaceholder.classList.add('hidden');
    el.btnRemoveSource.classList.remove('hidden');
    showToast('Loaded current output as reference photo for Photo Edit', 'success');
  });

  el.btnZoomImage.addEventListener('click', () => {
    if (!state.currentImageUrl) return;
    el.modalImage.src = state.currentImageUrl;
    el.modalCaption.textContent = el.viewportMeta.textContent;
    el.imageModal.classList.remove('hidden');
  });

  el.canvasImage.addEventListener('click', () => {
    el.btnZoomImage.click();
  });

  el.modalClose.addEventListener('click', () => el.imageModal.classList.add('hidden'));
  el.modalBackdrop.addEventListener('click', () => el.imageModal.classList.add('hidden'));

  // Restart Bridge
  el.btnRestartBridge.addEventListener('click', async () => {
    el.btnRestartBridge.disabled = true;
    try {
      showToast('Restarting bridge via spark_ctl.sh start…', 'info');
      await fetch('/api/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      setTimeout(checkBridgeStatus, 3000);
    } finally {
      el.btnRestartBridge.disabled = false;
    }
  });

  // Gallery Refresh
  el.btnRefreshGallery.addEventListener('click', loadGallery);
  el.toastClose.addEventListener('click', () => el.toast.classList.add('hidden'));
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  setWorkflow('quality');
  initEvents();
  checkBridgeStatus();
  loadGallery();
  setInterval(checkBridgeStatus, 5000);
});

/**
 * Spark Controller Client-Side Application
 * Live updates, telemetry rendering, and REST API dispatch.
 */

// State
const state = {
  alias: 'flak3dd',
  port: 8000,
  activeTab: 'overview',
  activeRecipe: 'qwen',
  activeLogTarget: 'vllm',
  autoPoll: true,
  pollTimer: null,
  isBusy: false,
  statusData: null,
};

// Elements Cache
const el = {
  hostAlias: document.getElementById('hostAlias'),
  connectionBadge: document.getElementById('connectionBadge'),
  autoPollToggle: document.getElementById('autoPollToggle'),
  refreshBtn: document.getElementById('refreshBtn'),
  footerTimestamp: document.getElementById('footerTimestamp'),

  // Tabs
  navTabs: document.querySelectorAll('.nav-tab'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Hardware Telemetry
  gpuDeviceName: document.getElementById('gpuDeviceName'),
  gpuDriverVersion: document.getElementById('gpuDriverVersion'),
  vramUsageText: document.getElementById('vramUsageText'),
  vramBar: document.getElementById('vramBar'),
  gpuUtilVal: document.getElementById('gpuUtilVal'),
  gpuUtilBar: document.getElementById('gpuUtilBar'),
  memUtilVal: document.getElementById('memUtilVal'),
  memUtilBar: document.getElementById('memUtilBar'),
  tempVal: document.getElementById('tempVal'),
  tempSub: document.getElementById('tempSub'),
  powerVal: document.getElementById('powerVal'),
  powerLimitSub: document.getElementById('powerLimitSub'),

  // Service Pills
  vllmStatusBadge: document.getElementById('vllmStatusBadge'),
  vllmActiveModel: document.getElementById('vllmActiveModel'),
  vllmVersion: document.getElementById('vllmVersion'),
  imageStatusBadge: document.getElementById('imageStatusBadge'),
  imagePid: document.getElementById('imagePid'),
  imageModelsCount: document.getElementById('imageModelsCount'),
  imageHeaderBadge: document.getElementById('imageHeaderBadge'),

  // Stack Controls
  stackActionOutput: document.getElementById('stackActionOutput'),
  btnStartStack: document.getElementById('btnStartStack'),
  btnStopStack: document.getElementById('btnStopStack'),
  btnFreePorts: document.getElementById('btnFreePorts'),
  btnProbeStack: document.getElementById('btnProbeStack'),

  // vLLM Form & Recipes
  recipeQwen: document.getElementById('recipeQwen'),
  recipeGptOss: document.getElementById('recipeGptOss'),
  vllmServedName: document.getElementById('vllmServedName'),
  vllmGpuMem: document.getElementById('vllmGpuMem'),
  vllmMaxLen: document.getElementById('vllmMaxLen'),
  vllmKvCache: document.getElementById('vllmKvCache'),
  vllmQuant: document.getElementById('vllmQuant'),
  vllmReasoning: document.getElementById('vllmReasoning'),
  btnServeVllm: document.getElementById('btnServeVllm'),
  btnStopVllm: document.getElementById('btnStopVllm'),
  btnPullWeights: document.getElementById('btnPullWeights'),
  btnSaveVllm: document.getElementById('btnSaveVllm'),

  // Image Bridge
  btnStartImage: document.getElementById('btnStartImage'),
  btnKillImage: document.getElementById('btnKillImage'),
  btnSmokeImage: document.getElementById('btnSmokeImage'),
  btnStatusImage: document.getElementById('btnStatusImage'),
  imageActionOutput: document.getElementById('imageActionOutput'),

  // Weights
  pullActiveCard: document.getElementById('pullActiveCard'),
  pullBytesCounter: document.getElementById('pullBytesCounter'),
  pullLogSnippet: document.getElementById('pullLogSnippet'),
  weightsListContainer: document.getElementById('weightsListContainer'),

  // Logs
  targetBtns: document.querySelectorAll('.target-btn'),
  terminalOutput: document.getElementById('terminalOutput'),
  btnCopyLogs: document.getElementById('btnCopyLogs'),
  btnRefreshLogs: document.getElementById('btnRefreshLogs'),

  // Toast
  toast: document.getElementById('toastNotification'),
  toastIcon: document.getElementById('toastIcon'),
  toastMessage: document.getElementById('toastMessage'),
  toastClose: document.getElementById('toastClose'),
};

// Recipe Presets
const RECIPES = {
  qwen: {
    id: 'qwen',
    servedName: 'qwen-abliterated',
    gpuMemoryUtilization: 0.6,
    maxModelLen: 65536,
    kvCacheDtype: 'fp8',
    quantization: 'nvfp4',
    reasoningParser: 'qwen3',
    toolCallParser: 'qwen3_coder',
  },
  'gpt-oss': {
    id: 'gpt-oss',
    servedName: 'gpt-oss-120b-abliterated',
    gpuMemoryUtilization: 0.7,
    maxModelLen: 131072,
    kvCacheDtype: 'fp8',
    quantization: 'mxfp4',
    reasoningParser: 'none',
    toolCallParser: 'none',
  },
};

// Utilities
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function showToast(message, type = 'info') {
  el.toastMessage.textContent = message;
  el.toast.className = `toast ${type}`;
  el.toastIcon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ️';
  el.toast.classList.remove('hidden');
  setTimeout(() => el.toast.classList.add('hidden'), 5000);
}

// API Calls
async function fetchStatus() {
  try {
    const alias = el.hostAlias.value.trim() || 'flak3dd';
    const res = await fetch(`/api/status?alias=${encodeURIComponent(alias)}&port=${state.port}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.statusData = data;
    renderStatus(data);
    updateConnectionBadge(true);
  } catch (err) {
    updateConnectionBadge(false, err.message);
  }
}

async function apiPost(endpoint, body) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// Renderers
function updateConnectionBadge(online, error = '') {
  if (online) {
    el.connectionBadge.className = 'connection-status online';
    el.connectionBadge.querySelector('.status-text').textContent = 'Connected (SSH)';
  } else {
    el.connectionBadge.className = 'connection-status offline';
    el.connectionBadge.querySelector('.status-text').textContent = error ? `Error: ${error.slice(0, 16)}` : 'Disconnected';
  }
  el.footerTimestamp.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
}

function renderStatus(data) {
  // 1. Hardware Telemetry
  if (data.gpu) {
    const g = data.gpu;
    el.gpuDeviceName.textContent = `${g.name || 'NVIDIA GPU'} (${g.driver || 'Driver'})`;
    el.gpuDriverVersion.textContent = `Driver ${g.driver || '—'}`;

    const usedGb = (g.vramUsedMb / 1024).toFixed(1);
    const totalGb = (g.vramTotalMb / 1024).toFixed(1);
    const pct = g.vramTotalMb > 0 ? Math.min(100, Math.round((g.vramUsedMb / g.vramTotalMb) * 100)) : 0;

    el.vramUsageText.textContent = `${usedGb} GB / ${totalGb} GB (${pct}%)`;
    el.vramBar.style.width = `${pct}%`;
    if (pct > 80) el.vramBar.classList.add('warn');
    else el.vramBar.classList.remove('warn');

    el.gpuUtilVal.textContent = `${g.gpuUtilPct}%`;
    el.gpuUtilBar.style.width = `${g.gpuUtilPct}%`;

    el.memUtilVal.textContent = `${g.memUtilPct}%`;
    el.memUtilBar.style.width = `${g.memUtilPct}%`;

    el.tempVal.textContent = `${g.tempC} °C`;
    el.tempSub.textContent = g.tempC > 78 ? 'Running Hot' : 'Nominal';

    el.powerVal.textContent = `${Math.round(g.powerDrawW)} W`;
    el.powerLimitSub.textContent = `Limit: ${Math.round(g.powerLimitW)} W`;
  }

  // 2. Text vLLM Pill
  const live = data.live;
  if (live && live.health) {
    el.vllmStatusBadge.className = 'badge online';
    el.vllmStatusBadge.textContent = 'ONLINE :8000';
    el.vllmActiveModel.textContent = live.models?.[0]?.id || data.saved?.servedName || 'Active';
    el.vllmVersion.textContent = live.version ? `vLLM ${live.version}` : 'Healthy';
  } else {
    el.vllmStatusBadge.className = 'badge offline';
    el.vllmStatusBadge.textContent = 'OFFLINE';
    el.vllmActiveModel.textContent = 'No model responding';
    el.vllmVersion.textContent = live?.healthError || 'Port 8000 idle';
  }

  // 3. Image Bridge Pill
  const img = data.image;
  if (img && img.running) {
    el.imageStatusBadge.className = 'badge online';
    el.imageStatusBadge.textContent = 'ONLINE :7860';
    el.imageHeaderBadge.className = 'badge online';
    el.imageHeaderBadge.textContent = `ONLINE (PID ${img.pid || '—'})`;
    el.imagePid.textContent = img.pid ? `${img.pid}` : 'Running';
    el.imageModelsCount.textContent = `${img.models?.length || 0} models ready`;
  } else {
    el.imageStatusBadge.className = 'badge offline';
    el.imageStatusBadge.textContent = 'OFFLINE';
    el.imageHeaderBadge.className = 'badge offline';
    el.imageHeaderBadge.textContent = 'OFFLINE';
    el.imagePid.textContent = 'None';
    el.imageModelsCount.textContent = '0 models';
  }

  // 4. Model Storage & Weights
  if (data.pull && data.pull.running) {
    el.pullActiveCard.classList.remove('hidden');
    el.pullBytesCounter.textContent = formatBytes(data.pull.bytes);
    el.pullLogSnippet.textContent = data.pull.log || 'Downloading Safetensors shards…';
  } else {
    el.pullActiveCard.classList.add('hidden');
  }

  if (Array.isArray(data.models) && data.models.length > 0) {
    el.weightsListContainer.innerHTML = data.models
      .map(
        (m) => `
      <div class="weight-row">
        <div>
          <div class="weight-name font-mono">${m.name}</div>
          <div class="weight-sub">
            ${m.shards ? `${m.shards} Safetensors shards` : 'Single file'}
            ${m.config ? ' · config.json validated' : ' · config.json missing'}
          </div>
        </div>
        <div class="weight-size font-mono">${formatBytes(m.bytes)}</div>
      </div>
    `,
      )
      .join('');
  } else {
    el.weightsListContainer.innerHTML = '<div class="empty-msg">No model directories located in models/</div>';
  }
}

// Recipe Switcher
function selectRecipe(id) {
  state.activeRecipe = id;
  const r = RECIPES[id] || RECIPES.qwen;

  el.recipeQwen.classList.toggle('active', id === 'qwen');
  el.recipeGptOss.classList.toggle('active', id === 'gpt-oss');

  el.vllmServedName.value = r.servedName;
  el.vllmGpuMem.value = r.gpuMemoryUtilization;
  el.vllmMaxLen.value = r.maxModelLen;
  el.vllmKvCache.value = r.kvCacheDtype;
  el.vllmQuant.value = r.quantization;
  el.vllmReasoning.value = r.reasoningParser;
}

// Logs Viewer
async function fetchLogs(target) {
  try {
    const alias = el.hostAlias.value.trim() || 'flak3dd';
    const res = await fetch(`/api/logs?alias=${encodeURIComponent(alias)}&target=${encodeURIComponent(target)}&lines=120`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    el.terminalOutput.textContent = json.logs || 'No output recorded for this target.';
    el.terminalOutput.scrollTop = el.terminalOutput.scrollHeight;
  } catch (err) {
    el.terminalOutput.textContent = `Failed to fetch logs: ${err.message}`;
  }
}

// Event Listeners Initialization
function initEvents() {
  // Tabs Navigation
  el.navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      state.activeTab = targetTab;

      el.navTabs.forEach((t) => t.classList.remove('active'));
      el.tabContents.forEach((c) => c.classList.remove('active'));

      tab.classList.add('active');
      const targetContent = document.getElementById(`view${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)}`);
      if (targetContent) targetContent.classList.add('active');

      if (targetTab === 'logs') {
        fetchLogs(state.activeLogTarget);
      }
    });
  });

  // Host Alias Change
  el.hostAlias.addEventListener('change', () => {
    fetchStatus();
  });

  // Manual Refresh
  el.refreshBtn.addEventListener('click', () => {
    fetchStatus();
    if (state.activeTab === 'logs') fetchLogs(state.activeLogTarget);
    showToast('State refreshed', 'info');
  });

  // Auto Poll Switch
  el.autoPollToggle.addEventListener('change', (e) => {
    state.autoPoll = e.target.checked;
    if (state.autoPoll) startPolling();
    else stopPolling();
  });

  // Recipes Click
  el.recipeQwen.addEventListener('click', () => selectRecipe('qwen'));
  el.recipeGptOss.addEventListener('click', () => selectRecipe('gpt-oss'));

  // Master Stack Actions
  [el.btnStartStack, el.btnStopStack, el.btnFreePorts, el.btnProbeStack].forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const alias = el.hostAlias.value.trim() || 'flak3dd';
      btn.disabled = true;
      el.stackActionOutput.classList.remove('hidden');
      el.stackActionOutput.textContent = `Executing stack action: ${action}…`;

      try {
        const res = await apiPost('/api/stack', { alias, action });
        el.stackActionOutput.textContent = res.stdout || res.stderr || 'Action completed.';
        showToast(`Stack action '${action}' completed`, 'success');
        fetchStatus();
      } catch (err) {
        el.stackActionOutput.textContent = `Error: ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  });

  // vLLM Actions
  el.btnServeVllm.addEventListener('click', async () => {
    const alias = el.hostAlias.value.trim() || 'flak3dd';
    const config = {
      recipe: state.activeRecipe,
      servedName: el.vllmServedName.value.trim(),
      gpuMemoryUtilization: Number(el.vllmGpuMem.value) || 0.6,
      maxModelLen: Number(el.vllmMaxLen.value) || 65536,
      kvCacheDtype: el.vllmKvCache.value,
      quantization: el.vllmQuant.value.trim(),
      reasoningParser: el.vllmReasoning.value.trim(),
      port: state.port,
    };
    el.btnServeVllm.disabled = true;
    try {
      await apiPost('/api/vllm', { op: 'serve', alias, config });
      showToast('vLLM serve initiated', 'success');
      setTimeout(fetchStatus, 3000);
    } finally {
      el.btnServeVllm.disabled = false;
    }
  });

  el.btnStopVllm.addEventListener('click', async () => {
    const alias = el.hostAlias.value.trim() || 'flak3dd';
    el.btnStopVllm.disabled = true;
    try {
      await apiPost('/api/vllm', { op: 'stop', alias, recipe: state.activeRecipe });
      showToast('vLLM container stopped', 'info');
      setTimeout(fetchStatus, 2000);
    } finally {
      el.btnStopVllm.disabled = false;
    }
  });

  el.btnPullWeights.addEventListener('click', async () => {
    const alias = el.hostAlias.value.trim() || 'flak3dd';
    el.btnPullWeights.disabled = true;
    try {
      await apiPost('/api/vllm', { op: 'pull', alias, recipe: state.activeRecipe });
      showToast('Hugging Face pull initiated on Spark', 'info');
      setTimeout(fetchStatus, 2000);
    } finally {
      el.btnPullWeights.disabled = false;
    }
  });

  el.btnSaveVllm.addEventListener('click', async () => {
    const alias = el.hostAlias.value.trim() || 'flak3dd';
    const config = {
      recipe: state.activeRecipe,
      servedName: el.vllmServedName.value.trim(),
      gpuMemoryUtilization: Number(el.vllmGpuMem.value) || 0.6,
      maxModelLen: Number(el.vllmMaxLen.value) || 65536,
      kvCacheDtype: el.vllmKvCache.value,
      quantization: el.vllmQuant.value.trim(),
      reasoningParser: el.vllmReasoning.value.trim(),
      port: state.port,
    };
    await apiPost('/api/vllm', { op: 'save', alias, config });
    showToast('Config saved to spark/vllm-ui.json', 'success');
  });

  // Image Bridge Actions
  [el.btnStartImage, el.btnKillImage, el.btnSmokeImage, el.btnStatusImage].forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const alias = el.hostAlias.value.trim() || 'flak3dd';
      btn.disabled = true;
      el.imageActionOutput.classList.remove('hidden');
      el.imageActionOutput.textContent = `Executing spark_ctl.sh ${action}…`;

      try {
        const res = await apiPost('/api/image', { alias, action });
        el.imageActionOutput.textContent = res.stdout || res.stderr || 'Action executed.';
        showToast(`Image bridge '${action}' executed`, 'success');
        fetchStatus();
      } catch (err) {
        el.imageActionOutput.textContent = `Error: ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Log Target Filters
  el.targetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      state.activeLogTarget = target;
      el.targetBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      fetchLogs(target);
    });
  });

  el.btnRefreshLogs.addEventListener('click', () => fetchLogs(state.activeLogTarget));
  el.btnCopyLogs.addEventListener('click', () => {
    navigator.clipboard.writeText(el.terminalOutput.textContent);
    showToast('Logs copied to clipboard', 'info');
  });

  el.toastClose.addEventListener('click', () => el.toast.classList.add('hidden'));
}

// Poller
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    fetchStatus();
    if (state.activeTab === 'logs') {
      fetchLogs(state.activeLogTarget);
    }
  }, 3000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

// Initial Boot
document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  fetchStatus();
  startPolling();
});

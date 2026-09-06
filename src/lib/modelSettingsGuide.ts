/** Keep in sync with sseParse.ts thinking-family detection. */
const THINKING_MODEL_RE =
  /qwen3|qwq[-_]?|deepseek-r1|deepseek-reasoner|hunyuan-t1|glm-4\.5|glm-5|magistral/i;

export type ModelFamily = 'thinking' | 'instruct' | 'code' | 'vision' | 'base';
export type GuideStatus = 'ok' | 'warn' | 'block';
export type GuideReasoning = 'off' | 'low' | 'high' | 'max';
export type GuideProvider = 'abliteration' | 'dgx-spark' | 'featherless' | 'custom';
export type GuideTab = 'api' | 'settings';

/** Subset of ClientSettings used to recommend API settings for a model. */
export type GuideSettings = {
  inferenceProvider?: GuideProvider;
  reasoning?: GuideReasoning;
  coalesceReasoningToContent?: boolean;
  featherlessEnabled?: boolean;
  featherlessToken?: string;
  featherlessModel?: string;
  sparkEnabled?: boolean;
  sparkModel?: string;
  sparkToken?: string;
  defaultModel?: string;
  token?: string;
};

export type GuideFix =
  | { kind: 'patch'; patch: Partial<GuideSettings> }
  | { kind: 'open'; tab: GuideTab };

export type SettingRequirement = {
  id: string;
  where: string;
  need: string;
  current: string;
  status: GuideStatus;
  fixLabel?: string;
  fix?: GuideFix;
};

export type ModelClass = {
  family: ModelFamily;
  chip: string;
  label: string;
  vision: boolean;
  toolsLikely: boolean;
};

export type ModelSettingsGuide = {
  model: string;
  provider: GuideProvider;
  klass: ModelClass;
  summary: string;
  items: SettingRequirement[];
  /** One-click patch for API (and required companion) settings. Empty if already applied. */
  applyPatch: Partial<GuideSettings> | null;
  applyLabel: string;
  applyDetail: string;
};

function norm(id: string): string {
  return (id || '').trim();
}

export function classifyModel(model: string): ModelClass {
  const id = norm(model);
  const s = id.toLowerCase();
  const vision = /(?:^|[/\-_.])(vl|vision|llava|pixtral|qwen2-vl|qwen2\.5-vl|qwen3-vl)\b/.test(s);
  const thinking = THINKING_MODEL_RE.test(id);
  const code = /coder|codestral|starcoder|deepseek-coder|code[-_]/i.test(s);
  const instruct = /instruct|chat|\b-it\b|hermes|functionary/i.test(s);
  const toolsLikely =
    thinking ||
    /instruct|chat|\b-it\b|hermes|functionary|tool|firefunction|command-r|mistral|llama-3|qwen2\.5|qwen3|gpt-oss|kimi|deepseek-v3|deepseek-chat/i.test(
      s,
    );

  if (thinking) {
    return {
      family: 'thinking',
      chip: vision ? 'think+vl' : 'think',
      label: vision ? 'Thinking + vision' : 'Thinking',
      vision,
      toolsLikely: true,
    };
  }
  if (vision) {
    return {
      family: 'vision',
      chip: 'vision',
      label: 'Vision',
      vision: true,
      toolsLikely,
    };
  }
  if (code) {
    return {
      family: 'code',
      chip: 'code',
      label: instruct ? 'Code instruct' : 'Code',
      vision: false,
      toolsLikely: instruct || toolsLikely,
    };
  }
  if (instruct) {
    return {
      family: 'instruct',
      chip: 'instruct',
      label: 'Instruct / chat',
      vision: false,
      toolsLikely: true,
    };
  }
  return {
    family: 'base',
    chip: 'base',
    label: 'Base (not chat-tuned)',
    vision: false,
    toolsLikely: false,
  };
}

function providerOf(settings: GuideSettings): GuideProvider {
  return settings.inferenceProvider ?? 'abliteration';
}

function currentModel(settings: GuideSettings): string {
  const p = providerOf(settings);
  if (p === 'featherless') return settings.featherlessModel?.trim() || 'Qwen/Qwen2.5-7B-Instruct';
  if (p === 'dgx-spark') return settings.sparkModel?.trim() || 'qwen-abliterated';
  return settings.defaultModel?.trim() || '';
}

function reasoningNow(settings: GuideSettings): GuideReasoning {
  return settings.reasoning || 'off';
}

function recommendedReasoning(klass: ModelClass): GuideReasoning {
  return klass.family === 'thinking' ? 'max' : 'off';
}

function fmtReasoning(level: GuideReasoning): string {
  return `API → Reasoning = ${level}`;
}

function tokenPresent(settings: GuideSettings): boolean {
  const p = providerOf(settings);
  if (p === 'featherless') return !!(settings.featherlessToken || '').trim();
  if (p === 'dgx-spark') return true;
  return !!(settings.token || '').trim();
}

function patchDiffers(settings: GuideSettings, patch: Partial<GuideSettings>): boolean {
  for (const key of Object.keys(patch) as (keyof GuideSettings)[]) {
    if (settings[key] !== patch[key]) return true;
  }
  return false;
}

function describePatch(patch: Partial<GuideSettings>): string {
  const bits: string[] = [];
  if (patch.reasoning != null) bits.push(`API → Reasoning ${patch.reasoning}`);
  if (patch.coalesceReasoningToContent === true) bits.push('Settings → coalesce reasoning on');
  if (patch.coalesceReasoningToContent === false) bits.push('Settings → coalesce reasoning off');
  return bits.join(' · ') || 'No changes';
}

export function recommendedApiPatch(model: string, _settings?: GuideSettings): Partial<GuideSettings> {
  const klass = classifyModel(model);
  const patch: Partial<GuideSettings> = {
    reasoning: recommendedReasoning(klass),
  };
  if (klass.family === 'thinking') {
    patch.coalesceReasoningToContent = true;
  }
  return patch;
}

export function applyRecommendedApiSettings<T extends GuideSettings>(settings: T, model?: string): T {
  const id = (model && norm(model)) || currentModel(settings);
  const patch = recommendedApiPatch(id, settings);
  return { ...settings, ...patch };
}

export function buildModelSettingsGuide(model: string, settings: GuideSettings): ModelSettingsGuide {
  const id = norm(model) || currentModel(settings) || '(no model)';
  const klass = classifyModel(id);
  const provider = providerOf(settings);
  const reasoning = reasoningNow(settings);
  const wantReasoning = recommendedReasoning(klass);
  const coalesceOn = settings.coalesceReasoningToContent !== false;
  const items: SettingRequirement[] = [];

  if (klass.family === 'thinking') {
    items.push({
      id: 'reasoning',
      where: 'API → Reasoning',
      need:
        provider === 'featherless'
          ? 'low / high / max turns Qwen3-class thinking on (`chat_template_kwargs.enable_thinking`). off = content only.'
          : 'low / high / max sends X-Reasoning. max is the usual setting for Thought traces.',
      current: reasoning,
      status: reasoning === 'off' ? 'warn' : 'ok',
      fixLabel: reasoning === 'off' ? 'Set max' : undefined,
      fix: reasoning === 'off' ? { kind: 'patch', patch: { reasoning: 'max' } } : undefined,
    });
    items.push({
      id: 'coalesce',
      where: 'Settings → Use reasoning as answer',
      need: 'On, so Thought-only replies fill the main bubble (no extra API call).',
      current: coalesceOn ? 'on' : 'off',
      status: reasoning !== 'off' && !coalesceOn ? 'warn' : 'ok',
      fixLabel: !coalesceOn ? 'Turn on' : undefined,
      fix: !coalesceOn
        ? { kind: 'patch', patch: { coalesceReasoningToContent: true } }
        : undefined,
    });
  } else {
    items.push({
      id: 'reasoning',
      where: 'API → Reasoning',
      need:
        provider === 'featherless'
          ? 'off — this family has no thinking channel; Featherless ignores X-Reasoning.'
          : 'off unless you know the endpoint maps X-Reasoning for this model.',
      current: reasoning,
      status: reasoning !== 'off' ? 'warn' : 'ok',
      fixLabel: reasoning !== 'off' ? 'Set off' : undefined,
      fix: reasoning !== 'off' ? { kind: 'patch', patch: { reasoning: 'off' } } : undefined,
    });
  }

  if (!klass.toolsLikely) {
    items.push({
      id: 'tools',
      where: 'Chat tools',
      need: 'Prefer an Instruct / Qwen3 model. Base weights often return empty 200s when tools are sent (client retries without tools).',
      current: 'tools still sent by the agent',
      status: 'warn',
    });
  } else {
    items.push({
      id: 'tools',
      where: 'Chat tools',
      need:
        provider === 'featherless'
          ? 'Featherless honours tools only on models that advertise tool-calling. Empty replies retry once without tools.'
          : 'Agent tool list is sent with tool_choice auto.',
      current: 'enabled',
      status: 'ok',
    });
  }

  if (provider === 'featherless') {
    const enabled = settings.featherlessEnabled !== false;
    items.push({
      id: 'endpoint',
      where: 'API → Featherless endpoint available',
      need: 'On, plus a cloud API key (or local :3000 session). Settings admin login is not a Featherless key.',
      current: enabled ? (tokenPresent(settings) ? 'on · key set' : 'on · key missing') : 'off',
      status: !enabled ? 'block' : tokenPresent(settings) ? 'ok' : 'block',
      fixLabel: !enabled ? 'Enable' : 'Open API',
      fix: !enabled
        ? { kind: 'patch', patch: { featherlessEnabled: true } }
        : { kind: 'open', tab: 'api' },
    });
  } else if (provider === 'dgx-spark') {
    items.push({
      id: 'endpoint',
      where: 'API → Spark endpoint available',
      need: 'On, with the NIM base URL reachable.',
      current: settings.sparkEnabled ? 'on' : 'off',
      status: settings.sparkEnabled ? 'ok' : 'block',
      fixLabel: settings.sparkEnabled ? undefined : 'Enable',
      fix: settings.sparkEnabled ? undefined : { kind: 'patch', patch: { sparkEnabled: true } },
    });
  } else if (provider === 'abliteration' || provider === 'custom') {
    const hostOk = provider === 'custom' || tokenPresent(settings);
    items.push({
      id: 'endpoint',
      where: 'API → Token',
      need: 'Inference API key on the API tab (not the Settings admin login).',
      current: tokenPresent(settings) ? 'key set' : 'missing',
      status: hostOk ? 'ok' : 'block',
      fixLabel: tokenPresent(settings) ? undefined : 'Open API',
      fix: tokenPresent(settings) ? undefined : { kind: 'open', tab: 'api' },
    });
  }

  const applyPatch = recommendedApiPatch(id, settings);
  const needsApply = patchDiffers(settings, applyPatch);

  let summary: string;
  if (klass.family === 'thinking') {
    summary =
      provider === 'featherless'
        ? `${klass.label} model. Featherless maps API → Reasoning to enable_thinking. Use max for Thought traces; off for content-only.`
        : `${klass.label} model. API → Reasoning is sent as X-Reasoning. max is the usual Thought setting.`;
  } else if (klass.family === 'base') {
    summary = `${klass.label}. Chat/agent quality is poor; pick an Instruct or thinking variant. Keep Reasoning off.`;
  } else {
    summary = `${klass.label} model. Keep API → Reasoning off. Tools work on most Instruct checkpoints.`;
  }

  return {
    model: id,
    provider,
    klass,
    summary,
    items,
    applyPatch: needsApply ? applyPatch : null,
    applyLabel: 'Apply API settings',
    applyDetail: needsApply
      ? describePatch(applyPatch)
      : `${fmtReasoning(wantReasoning)} already applied`,
  };
}

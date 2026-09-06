/** Pull a human error string out of OpenAI-compatible / Featherless JSON bodies. */
export function extractHttpErrorMessage(status: number, text: string): string {
  const raw = String(text || '').trim();
  if (raw) {
    try {
      const json = JSON.parse(raw) as {
        error?: unknown;
        message?: unknown;
        detail?: unknown;
        msg?: unknown;
      };
      const err = json.error;
      if (typeof err === 'string' && err.trim()) return err.trim();
      if (err && typeof err === 'object') {
        const e = err as { message?: unknown; code?: unknown; type?: unknown };
        if (typeof e.message === 'string' && e.message.trim()) return e.message.trim();
        if (typeof e.code === 'string' && e.code.trim()) return e.code.trim();
      }
      for (const v of [json.message, json.detail, json.msg]) {
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    } catch {
      /* plain text */
    }
  }
  let msg = raw.slice(0, 400) || `HTTP ${status}`;
  if (/model_gated_needs_oauth/i.test(raw)) {
    msg += ' Connect HuggingFace on featherless.ai for this gated model, or pick an ungated one.';
  } else if (/model_switching_limit_exceeded/i.test(raw)) {
    msg += ' Plan limits model switches (~4/min). Wait a minute or stay on one model.';
  } else if (/completion_error|model is busy/i.test(raw)) {
    msg += ' Model busy — retry or switch model.';
  }
  return msg;
}

export function describeChatBody(body: Record<string, unknown>): string {
  const kwargs = body.chat_template_kwargs;
  return [
    `model=${String(body.model || '')}`,
    `stream=${body.stream === true ? '1' : '0'}`,
    `tools=${Array.isArray(body.tools) ? String((body.tools as unknown[]).length) : '0'}`,
    `tool_choice=${body.tool_choice != null ? String(body.tool_choice) : '-'}`,
    `kwargs=${kwargs && typeof kwargs === 'object' ? Object.keys(kwargs as object).join(',') || '1' : '0'}`,
    `min_tokens=${body.min_tokens != null ? String(body.min_tokens) : '-'}`,
  ].join(' ');
}

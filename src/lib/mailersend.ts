/**
 * MailerSend API Client for sending transactional emails and checking delivery.
 * Native fetch-based, fully typed, compatible with Node.js 18+ and browser environments.
 */

export interface MailerSendRecipient {
  email: string;
  name?: string;
}

export interface MailerSendAttachment {
  content: string; // Base64 encoded string
  filename: string;
  disposition?: 'inline' | 'attachment';
  id?: string;
}

export interface MailerSendEmailParams {
  from: MailerSendRecipient;
  to: MailerSendRecipient[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: MailerSendRecipient;
  cc?: MailerSendRecipient[];
  bcc?: MailerSendRecipient[];
  tags?: string[];
  attachments?: MailerSendAttachment[];
  templateId?: string;
  variables?: Array<{ email: string; substitutions: Array<{ var: string; value: string }> }>;
}

export interface MailerSendConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface MailerSendSendResult {
  ok: boolean;
  statusCode: number;
  messageId?: string;
  rawResponse?: Record<string, unknown>;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export interface MailerSendDomain {
  id: string;
  name: string;
  dkim: boolean;
  spf: boolean;
  mx: boolean;
  tracking: boolean;
  is_verified: boolean;
  created_at: string;
}

const DEFAULT_BASE_URL = 'https://api.mailersend.com/v1';

/** Validate email format using standard regex */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Pre-flight check for email parameters before hitting MailerSend */
export function validateEmailParams(params: MailerSendEmailParams): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!params.from || !params.from.email) {
    errors.push('Sender email ("from.email") is required.');
  } else if (!isValidEmail(params.from.email)) {
    errors.push(`Sender email "${params.from.email}" is invalid.`);
  }

  if (!params.to || !Array.isArray(params.to) || params.to.length === 0) {
    errors.push('At least one recipient ("to") is required.');
  } else {
    for (let i = 0; i < params.to.length; i++) {
      const recipient = params.to[i];
      if (!recipient || !recipient.email) {
        errors.push(`Recipient #${i + 1} is missing an email address.`);
      } else if (!isValidEmail(recipient.email)) {
        errors.push(`Recipient email "${recipient.email}" is invalid.`);
      }
    }
  }

  if (!params.subject || !params.subject.trim()) {
    errors.push('Email subject is required.');
  }

  if (!params.text && !params.html && !params.templateId) {
    errors.push('At least one of "text", "html", or "templateId" must be provided.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format email parameters into MailerSend REST API payload
 */
export function buildMailerSendPayload(params: MailerSendEmailParams): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    from: {
      email: params.from.email.trim(),
      ...(params.from.name ? { name: params.from.name.trim() } : {}),
    },
    to: params.to.map((t) => ({
      email: t.email.trim(),
      ...(t.name ? { name: t.name.trim() } : {}),
    })),
    subject: params.subject.trim(),
  };

  if (params.text) payload.text = params.text;
  if (params.html) payload.html = params.html;
  if (params.templateId) payload.template_id = params.templateId;

  if (params.replyTo && params.replyTo.email) {
    payload.reply_to = {
      email: params.replyTo.email.trim(),
      ...(params.replyTo.name ? { name: params.replyTo.name.trim() } : {}),
    };
  }

  if (params.cc && params.cc.length > 0) {
    payload.cc = params.cc.map((c) => ({
      email: c.email.trim(),
      ...(c.name ? { name: c.name.trim() } : {}),
    }));
  }

  if (params.bcc && params.bcc.length > 0) {
    payload.bcc = params.bcc.map((b) => ({
      email: b.email.trim(),
      ...(b.name ? { name: b.name.trim() } : {}),
    }));
  }

  if (params.tags && params.tags.length > 0) {
    payload.tags = params.tags.map((tag) => tag.trim());
  }

  if (params.attachments && params.attachments.length > 0) {
    payload.attachments = params.attachments.map((att) => ({
      content: att.content,
      filename: att.filename,
      disposition: att.disposition || 'attachment',
      ...(att.id ? { id: att.id } : {}),
    }));
  }

  if (params.variables && params.variables.length > 0) {
    payload.variables = params.variables;
  }

  return payload;
}

/**
 * Send an email via MailerSend REST API
 */
export async function sendMailerSendEmail(
  params: MailerSendEmailParams,
  config: MailerSendConfig,
): Promise<MailerSendSendResult> {
  const apiKey = (config.apiKey || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      statusCode: 400,
      error: 'MailerSend API key is required. Set MAILERSEND_API_KEY in environment or provide apiKey.',
    };
  }

  const validation = validateEmailParams(params);
  if (!validation.valid) {
    return {
      ok: false,
      statusCode: 400,
      error: `Validation failed: ${validation.errors.join('; ')}`,
      fieldErrors: { validation: validation.errors },
    };
  }

  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${baseUrl}/email`;
  const payload = buildMailerSendPayload(params);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const statusCode = response.status;
    const messageId = response.headers.get('x-message-id') || undefined;

    let responseData: Record<string, unknown> = {};
    const textBody = await response.text();
    if (textBody.trim()) {
      try {
        responseData = JSON.parse(textBody);
      } catch {
        responseData = { text: textBody };
      }
    }

    // MailerSend returns 202 Accepted on success
    if (statusCode === 200 || statusCode === 201 || statusCode === 202) {
      return {
        ok: true,
        statusCode,
        messageId,
        rawResponse: responseData,
      };
    }

    // Extract error message
    let errorMsg = `MailerSend API returned status ${statusCode}`;
    let fieldErrors: Record<string, string[]> | undefined;

    if (responseData.message && typeof responseData.message === 'string') {
      errorMsg = responseData.message;
    }

    if (responseData.errors && typeof responseData.errors === 'object') {
      fieldErrors = responseData.errors as Record<string, string[]>;
      const detailedList = Object.entries(fieldErrors)
        .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : String(msgs)}`)
        .join('; ');
      if (detailedList) {
        errorMsg += ` (${detailedList})`;
      }
    }

    return {
      ok: false,
      statusCode,
      messageId,
      error: errorMsg,
      fieldErrors,
      rawResponse: responseData,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      statusCode: 0,
      error: `Network error connecting to MailerSend: ${message}`,
    };
  }
}

/**
 * Fetch verified domains for this MailerSend account
 */
export async function getMailerSendDomains(
  config: MailerSendConfig,
): Promise<{ ok: boolean; domains?: MailerSendDomain[]; error?: string }> {
  const apiKey = (config.apiKey || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'MailerSend API key is required.' };
  }

  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${baseUrl}/domains`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      return { ok: false, error: `Failed to fetch domains (status ${response.status}): ${errText}` };
    }

    const data = await response.json();
    return { ok: true, domains: data.data || [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Error fetching domains: ${message}` };
  }
}

/** Official MailerSend SDK compatibility layer */

export class Sender {
  email: string;
  name?: string;
  constructor(email: string, name?: string) {
    this.email = email;
    this.name = name;
  }
}

export class Recipient {
  email: string;
  name?: string;
  constructor(email: string, name?: string) {
    this.email = email;
    this.name = name;
  }
}

export class Attachment {
  content: string;
  filename: string;
  disposition?: 'inline' | 'attachment';
  id?: string;
  constructor(content: string, filename: string, disposition: 'inline' | 'attachment' = 'attachment', id?: string) {
    this.content = content;
    this.filename = filename;
    this.disposition = disposition;
    this.id = id;
  }
}

export class EmailParams {
  from?: MailerSendRecipient;
  to?: MailerSendRecipient[];
  replyTo?: MailerSendRecipient;
  cc?: MailerSendRecipient[];
  bcc?: MailerSendRecipient[];
  subject?: string;
  text?: string;
  html?: string;
  tags?: string[];
  attachments?: MailerSendAttachment[];
  templateId?: string;
  variables?: Array<{ email: string; substitutions: Array<{ var: string; value: string }> }>;

  setFrom(from: Sender | MailerSendRecipient): this {
    this.from = from;
    return this;
  }

  setTo(to: (Recipient | MailerSendRecipient)[]): this {
    this.to = to;
    return this;
  }

  setReplyTo(replyTo: Sender | MailerSendRecipient): this {
    this.replyTo = replyTo;
    return this;
  }

  setCc(cc: (Recipient | MailerSendRecipient)[]): this {
    this.cc = cc;
    return this;
  }

  setBcc(bcc: (Recipient | MailerSendRecipient)[]): this {
    this.bcc = bcc;
    return this;
  }

  setSubject(subject: string): this {
    this.subject = subject;
    return this;
  }

  setHtml(html: string): this {
    this.html = html;
    return this;
  }

  setText(text: string): this {
    this.text = text;
    return this;
  }

  setTags(tags: string[]): this {
    this.tags = tags;
    return this;
  }

  setAttachments(attachments: Attachment[]): this {
    this.attachments = attachments;
    return this;
  }

  setTemplateId(templateId: string): this {
    this.templateId = templateId;
    return this;
  }

  setVariables(variables: Array<{ email: string; substitutions: Array<{ var: string; value: string }> }>): this {
    this.variables = variables;
    return this;
  }

  toParams(): MailerSendEmailParams {
    return {
      from: this.from || { email: '' },
      to: this.to || [],
      subject: this.subject || '',
      text: this.text,
      html: this.html,
      replyTo: this.replyTo,
      cc: this.cc,
      bcc: this.bcc,
      tags: this.tags,
      attachments: this.attachments,
      templateId: this.templateId,
      variables: this.variables,
    };
  }
}

export class MailerSend {
  config: MailerSendConfig;

  constructor(options?: { apiKey?: string; baseUrl?: string }) {
    const key =
      options?.apiKey ||
      (typeof process !== 'undefined' && (process.env?.MAILERSEND_API_KEY || process.env?.API_KEY)) ||
      '';
    this.config = {
      apiKey: key,
      baseUrl: options?.baseUrl,
    };
  }

  email = {
    send: async (params: EmailParams | MailerSendEmailParams): Promise<MailerSendSendResult> => {
      const p = params instanceof EmailParams ? params.toParams() : params;
      return sendMailerSendEmail(p, this.config);
    },
  };

  domains = {
    list: async () => getMailerSendDomains(this.config),
  };
}

export default MailerSend;


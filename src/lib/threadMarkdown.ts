import type { Message, Thread } from '../types';

function roleLabel(role: Message['role']): string {
  if (role === 'assistant') return 'Assistant';
  if (role === 'user') return 'User';
  if (role === 'tool') return 'Tool';
  return role;
}

export function threadToMarkdown(thread: Thread, messages: Message[]): string {
  const lines = [
    `# ${thread.title || 'Chat'}`,
    '',
    `- model: \`${thread.model || '—'}\``,
    `- workspace: \`${thread.workspaceRoot || '—'}\``,
    `- updated: ${new Date(thread.updatedAt).toISOString()}`,
    '',
  ];
  for (const m of messages) {
    const body = (m.content || '').trim();
    if (!body && !(m.toolCalls && m.toolCalls.length)) continue;
    lines.push(`## ${roleLabel(m.role)}`);
    if (m.toolCalls && m.toolCalls.length) {
      for (const tc of m.toolCalls) {
        lines.push(`- tool \`${tc.name}\``);
      }
      lines.push('');
    }
    if (body) lines.push(body, '');
  }
  return lines.join('\n').trim() + '\n';
}

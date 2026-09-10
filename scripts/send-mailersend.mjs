#!/usr/bin/env node
/**
 * Standalone MailerSend Email Sender CLI
 * Usage:
 *   node scripts/send-mailersend.mjs --to recipient@example.com [options]
 *
 * Environment variables:
 *   MAILERSEND_API_KEY       MailerSend API token (starts with mlsn.)
 *   MAILERSEND_FROM          Verified sender address (e.g. sender@yourdomain.com)
 *   MAILERSEND_FROM_NAME     Sender name (default: "Abliterated")
 *   MAILERSEND_TO            Recipient email address
 *   MAILERSEND_TO_NAME       Recipient name
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Lightweight .env / .env.local loader
function loadEnv() {
  const envFiles = ['.env.local', '.env'];
  for (const f of envFiles) {
    const fullPath = path.join(rootDir, f);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    } catch {
      // Ignore reading errors
    }
  }
}

loadEnv();

function parseArgs(argv) {
  const args = {
    apiKey: process.env.MAILERSEND_API_KEY || '',
    from: process.env.MAILERSEND_FROM || '',
    fromName: process.env.MAILERSEND_FROM_NAME || 'Abliterated IDE',
    to: process.env.MAILERSEND_TO || '',
    toName: process.env.MAILERSEND_TO_NAME || 'Test Recipient',
    subject: 'MailerSend Test Email from Abliterated',
    text: '',
    html: '',
    dryRun: false,
    checkDomains: false,
    template: '',
    allTemplates: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--check-domains') args.checkDomains = true;
    else if (arg === '--all-templates') args.allTemplates = true;
    else if (arg === '--template' && i + 1 < argv.length) args.template = argv[++i];
    else if (arg === '--api-key' && i + 1 < argv.length) args.apiKey = argv[++i];
    else if (arg === '--from' && i + 1 < argv.length) args.from = argv[++i];
    else if (arg === '--from-name' && i + 1 < argv.length) args.fromName = argv[++i];
    else if (arg === '--to' && i + 1 < argv.length) args.to = argv[++i];
    else if (arg === '--to-name' && i + 1 < argv.length) args.toName = argv[++i];
    else if (arg === '--subject' && i + 1 < argv.length) args.subject = argv[++i];
    else if (arg === '--text' && i + 1 < argv.length) args.text = argv[++i];
    else if (arg === '--html' && i + 1 < argv.length) args.html = argv[++i];
  }

  return args;
}

function printUsage() {
  console.log(`
MailerSend Test Email CLI
=========================

Usage:
  node scripts/send-mailersend.mjs [options]

Options:
  --api-key <key>      MailerSend API key (or set MAILERSEND_API_KEY)
  --from <email>       Sender email address (or set MAILERSEND_FROM)
  --from-name <name>   Sender display name (default: "Abliterated IDE")
  --to <email>         Recipient email address (or set MAILERSEND_TO)
  --to-name <name>     Recipient display name (default: "Test Recipient")
  --subject <text>     Email subject line
  --text <content>     Plain text body
  --html <content>     HTML body
  --check-domains      Fetch and display verified domains for this account
  --template <name>    Use official template: signup_welcome, payment_receipt, code_redeemed
  --all-templates      Send 1 email of each official template sequentially
  --dry-run            Validate email payload without sending
  --help, -h           Show this help message

Examples:
  1. Check verified domains:
     node scripts/send-mailersend.mjs --api-key mlsn.xxx --check-domains

  2. Send 1 email of each official template:
     node scripts/send-mailersend.mjs --to "user@example.com" --all-templates

  3. Send a single template email:
     node scripts/send-mailersend.mjs --to "user@example.com" --template signup_welcome
`);
}

async function listDomains(apiKey) {
  console.log('Fetching verified domains from MailerSend...');
  try {
    const res = await fetch('https://api.mailersend.com/v1/domains', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Failed to fetch domains (HTTP ${res.status}): ${body}`);
      return false;
    }

    const data = await res.json();
    const domains = data.data || [];
    console.log(`\nFound ${domains.length} domain(s):`);
    for (const d of domains) {
      const status = d.is_verified ? '\x1b[32m[VERIFIED]\x1b[0m' : '\x1b[33m[UNVERIFIED]\x1b[0m';
      console.log(` - ${d.name} (${status}) ID: ${d.id}`);
      console.log(`   DKIM: ${d.dkim ? 'OK' : 'Pending'} | SPF: ${d.spf ? 'OK' : 'Pending'} | MX: ${d.mx ? 'OK' : 'Pending'}`);
    }
    return true;
  } catch (err) {
    console.error(`Error connecting to MailerSend: ${err.message}`);
    return false;
  }
}

const TEMPLATES = [
  {
    type: 'signup_welcome',
    name: 'Signup Welcome',
    subject: 'Welcome to Abliterated',
    build: () => ({
      subject: 'Welcome to Abliterated',
      text: [
        'Welcome to Abliterated.',
        '',
        'Login ID: ABLIT-LOGIN-TEST0001',
        'Create a paid plan or redeem a code to unlock a license.',
        '',
        'Download the app: https://abliterated.app/download',
        'See plans: https://abliterated.app/pricing',
        'Redeem a code: https://abliterated.app/redeem',
        '',
        'Links:',
        'Download: https://abliterated.app/download',
        'Docs: https://abliterated.app/docs',
        'Support: info@abliterated.app',
      ].join('\n'),
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#0f172a;color:#f8fafc;border-radius:8px;border:1px solid #334155;">
<h2 style="color:#38bdf8;margin-top:0;">Welcome to Abliterated</h2>
<p style="font-size:15px;line-height:1.6;color:#cbd5e1;">Welcome to Abliterated — the uncensored local agent IDE with built-in model inference, local bridge, and persistent memory.</p>
<div style="background:#1e293b;padding:12px 16px;border-radius:6px;border:1px solid #475569;margin:16px 0;"><span style="color:#94a3b8;font-size:12px;text-transform:uppercase;">Login ID:</span><br/><strong style="font-family:monospace;font-size:16px;color:#38bdf8;">ABLIT-LOGIN-TEST0001</strong></div>
<p style="font-size:14px;color:#cbd5e1;">Download the desktop app, then sign in under <strong>Settings → Account</strong>.</p>
<div style="margin:20px 0;">
  <a href="https://abliterated.app/download" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;">Download Desktop App</a>
</div>
</div>`,
    }),
  },
  {
    type: 'payment_receipt',
    name: 'Payment Receipt',
    subject: 'Your Abliterated payment receipt',
    build: () => ({
      subject: 'Your Abliterated payment receipt',
      text: [
        'Abliterated payment receipt',
        '',
        'Plan: pro_monthly',
        'Seats: 1',
        'License key: ABLIT-PRO-TEST-0001',
        'Monthly tokens: 3,000,000',
        'Stripe session: cs_test_email_template',
        '',
        'Activate in the desktop app: Settings → License.',
        'Download: https://abliterated.app/download',
        '',
        'Links:',
        'Download: https://abliterated.app/download',
        'Manage billing: https://abliterated.app/account/billing',
        'Support: info@abliterated.app',
      ].join('\n'),
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#0f172a;color:#f8fafc;border-radius:8px;border:1px solid #334155;">
<h2 style="color:#4ade80;margin-top:0;">Payment Confirmed</h2>
<p style="font-size:15px;line-height:1.6;color:#cbd5e1;">Thanks for your Abliterated purchase. Your subscription is active.</p>
<div style="background:#1e293b;padding:16px;border-radius:6px;border:1px solid #475569;margin:16px 0;font-size:14px;line-height:1.8;">
  <div><span style="color:#94a3b8;">Plan:</span> <strong style="color:#f8fafc;text-transform:uppercase;">PRO_MONTHLY</strong></div>
  <div><span style="color:#94a3b8;">Token Allowance:</span> <strong style="color:#38bdf8;">3,000,000 tokens / month</strong></div>
  <div style="margin-top:8px;"><span style="color:#94a3b8;">License Key:</span><br/><code style="display:inline-block;background:#0f172a;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:15px;color:#4ade80;border:1px solid #334155;margin-top:4px;">ABLIT-PRO-TEST-0001</code></div>
</div>
<p style="font-size:14px;color:#cbd5e1;">To activate your features, paste your license key in the desktop app under <strong>Settings → License</strong>.</p>
</div>`,
    }),
  },
  {
    type: 'code_redeemed',
    name: 'Code Redeemed',
    subject: 'Your Abliterated license & login',
    build: () => ({
      subject: 'Your Abliterated license & login',
      text: [
        'Your Abliterated access code is redeemed.',
        '',
        'Plan: pro_monthly',
        'Tier: pro',
        'License key: ABLIT-PRO-TEST-0001',
        'Login ID: ABLIT-LOGIN-TEST0001',
        'Platform / LiteLLM API key: sk-test-litellm-not-a-real-key',
        'Gateway URL: https://abliterated.app/api/v1',
        '',
        'Paste the license key in the desktop app: Settings → License.',
        'Download: https://abliterated.app/download',
        '',
        'Links:',
        'Docs: https://abliterated.app/docs',
        'Support: info@abliterated.app',
      ].join('\n'),
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#0f172a;color:#f8fafc;border-radius:8px;border:1px solid #334155;">
<h2 style="color:#a855f7;margin-top:0;">Access Code Redeemed</h2>
<p style="font-size:15px;line-height:1.6;color:#cbd5e1;">Your Abliterated access code was successfully redeemed and bound to your device.</p>
<div style="background:#1e293b;padding:16px;border-radius:6px;border:1px solid #475569;margin:16px 0;font-size:14px;line-height:1.8;">
  <div><span style="color:#94a3b8;">Plan:</span> <strong style="color:#f8fafc;text-transform:uppercase;">PRO_MONTHLY</strong></div>
  <div style="margin-top:8px;"><span style="color:#94a3b8;">License Key:</span><br/><code style="display:inline-block;background:#0f172a;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:15px;color:#4ade80;border:1px solid #334155;margin-top:4px;">ABLIT-PRO-TEST-0001</code></div>
  <div style="margin-top:8px;"><span style="color:#94a3b8;">Login ID:</span><br/><code style="display:inline-block;background:#0f172a;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:14px;color:#38bdf8;border:1px solid #334155;margin-top:4px;">ABLIT-LOGIN-TEST0001</code></div>
</div>
<p style="font-size:13px;color:#94a3b8;">Paste the license key in Settings → License.</p>
</div>`,
    }),
  },
];

async function sendEmail(args) {
  if (!args.apiKey) {
    console.error('\x1b[31mError:\x1b[0m MailerSend API key is missing.');
    console.error('Provide it via --api-key <key> or set MAILERSEND_API_KEY in .env.local');
    process.exit(1);
  }

  if (args.checkDomains) {
    const ok = await listDomains(args.apiKey);
    process.exit(ok ? 0 : 1);
  }

  if (!args.from) {
    console.error('\x1b[31mError:\x1b[0m Sender email address is missing.');
    console.error('Provide it via --from <email> (must be on a verified domain in MailerSend).');
    process.exit(1);
  }

  if (!args.to) {
    console.error('\x1b[31mError:\x1b[0m Recipient email address is missing.');
    console.error('Provide it via --to <email>');
    process.exit(1);
  }

  if (args.allTemplates) {
    console.log('\n======================================================');
    console.log(` Dispatching 1 email for each of the ${TEMPLATES.length} templates`);
    console.log(` Recipient: ${args.to} | Sender: ${args.from}`);
    console.log('======================================================');

    const results = [];
    for (const t of TEMPLATES) {
      const built = t.build();
      const subArgs = {
        ...args,
        allTemplates: false,
        template: '',
        subject: built.subject,
        text: built.text,
        html: built.html,
      };
      console.log(`\n--> Sending template: [${t.name}] "${built.subject}"`);
      try {
        await sendSingleEmail(subArgs);
        results.push({ name: t.name, subject: built.subject, ok: true });
      } catch (err) {
        results.push({ name: t.name, subject: built.subject, ok: false, error: String(err) });
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    console.log('\n======================================================');
    console.log(' Batch Summary:');
    for (const r of results) {
      console.log(` - ${r.name}: ${r.ok ? '\x1b[32mSENT\x1b[0m' : '\x1b[31mFAILED\x1b[0m'} ("${r.subject}")`);
    }
    console.log('======================================================');
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  }

  if (args.template) {
    const found = TEMPLATES.find((t) => t.type === args.template || t.name.toLowerCase() === args.template.toLowerCase());
    if (!found) {
      console.error(`\x1b[31mError:\x1b[0m Unknown template "${args.template}". Available: ${TEMPLATES.map((t) => t.type).join(', ')}`);
      process.exit(1);
    }
    const built = found.build();
    args.subject = built.subject;
    args.text = built.text;
    args.html = built.html;
  }

  await sendSingleEmail(args);
}

async function sendSingleEmail(args) {

  const defaultText = `Hello,\n\nThis is a test email sent from Abliterated IDE via MailerSend.\n\nTimestamp: ${new Date().toISOString()}\nSender: ${args.from}\nRecipient: ${args.to}\n\nMailerSend integration verified successfully.`;
  const defaultHtml = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #0f172a; color: #f8fafc; border-radius: 8px; border: 1px solid #334155;">
  <h2 style="color: #38bdf8; margin-top: 0;">MailerSend Test Email</h2>
  <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1;">This is a test email sent from <strong>Abliterated IDE</strong> via MailerSend REST API.</p>
  <div style="background: #1e293b; padding: 16px; border-radius: 6px; border: 1px solid #475569; margin: 20px 0; font-family: monospace; font-size: 13px;">
    <div><strong>Timestamp:</strong> ${new Date().toISOString()}</div>
    <div><strong>From:</strong> ${args.from} (${args.fromName})</div>
    <div><strong>To:</strong> ${args.to} (${args.toName})</div>
    <div><strong>Status:</strong> <span style="color: #4ade80;">Active</span></div>
  </div>
  <p style="font-size: 13px; color: #94a3b8; border-top: 1px solid #334155; padding-top: 16px; margin-bottom: 0;">
    Sent via Abliterated Workbench MailerSend Client
  </p>
</div>`;

  const payload = {
    from: {
      email: args.from.trim(),
      name: args.fromName.trim(),
    },
    to: [
      {
        email: args.to.trim(),
        name: args.toName.trim(),
      },
    ],
    subject: args.subject.trim(),
    text: args.text || defaultText,
    html: args.html || defaultHtml,
  };

  console.log('\n========================================');
  console.log(' MailerSend Email Dispatch');
  console.log('========================================');
  console.log(`From:    ${payload.from.name} <${payload.from.email}>`);
  console.log(`To:      ${payload.to[0].name} <${payload.to[0].email}>`);
  console.log(`Subject: ${payload.subject}`);

  if (args.dryRun) {
    console.log('\n\x1b[33m[DRY-RUN]\x1b[0m Pre-flight validation passed. Email was not sent.');
    console.log('Payload preview:');
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  console.log('\nSending request to https://api.mailersend.com/v1/email ...');

  try {
    const startTime = Date.now();
    const response = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Authorization: `Bearer ${args.apiKey.trim()}`,
      },
      body: JSON.stringify(payload),
    });

    const elapsed = Date.now() - startTime;
    const statusCode = response.status;
    const messageId = response.headers.get('x-message-id') || 'none';
    const textBody = await response.text();

    let jsonBody = null;
    try {
      if (textBody.trim()) jsonBody = JSON.parse(textBody);
    } catch {
      // not JSON
    }

    if (statusCode === 200 || statusCode === 201 || statusCode === 202) {
      console.log('\n\x1b[32m[SUCCESS]\x1b[0m Email accepted by MailerSend!');
      console.log(`Status code: ${statusCode} (Accepted)`);
      console.log(`Message ID:  ${messageId}`);
      console.log(`Latency:     ${elapsed}ms`);
      console.log('\nThe email is queued for delivery. Check your inbox (or spam folder).');
    } else {
      console.error(`\n\x1b[31m[FAILED]\x1b[0m MailerSend responded with HTTP ${statusCode}`);
      if (messageId && messageId !== 'none') {
        console.error(`Message ID:  ${messageId}`);
      }
      if (jsonBody) {
        if (jsonBody.message) console.error(`Error Message: ${jsonBody.message}`);
        if (jsonBody.errors) {
          console.error('Field Errors:');
          for (const [k, v] of Object.entries(jsonBody.errors)) {
            console.error(`  - ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
          }
        }
      } else if (textBody) {
        console.error(`Response: ${textBody}`);
      }

      if (statusCode === 401) {
        console.error('\nHint: Your MailerSend API key appears invalid or expired.');
      } else if (statusCode === 422) {
        console.error('\nHint: In MailerSend, the sender address domain must be verified on your account.');
        console.error('Run: node scripts/send-mailersend.mjs --check-domains to list verified domains.');
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n\x1b[31m[NETWORK ERROR]\x1b[0m Failed to reach MailerSend: ${err.message}`);
    process.exit(1);
  }
}

const args = parseArgs(process.argv);
if (args.help) {
  printUsage();
  process.exit(0);
}

sendEmail(args);

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-mailersend');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Compile TypeScript files for mailersend
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/mailersend.ts',
    'src/lib/mailersendTemplates.ts',
    '--outDir',
    outDir,
    '--rootDir',
    'src',
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);

const mailerMod = await import(pathToFileURL(path.join(outDir, 'lib/mailersend.js')).href);
const {
  isValidEmail,
  validateEmailParams,
  buildMailerSendPayload,
  sendMailerSendEmail,
} = mailerMod;

console.log('--- 1. Testing email validation ---');
assert.equal(isValidEmail('test@example.com'), true);
assert.equal(isValidEmail('user.name+tag@sub.domain.org'), true);
assert.equal(isValidEmail('invalid-email'), false);
assert.equal(isValidEmail('@example.com'), false);
assert.equal(isValidEmail('user@'), false);
assert.equal(isValidEmail(''), false);

console.log('--- 2. Testing parameter validation ---');
const invalidCheck1 = validateEmailParams({
  from: { email: '' },
  to: [{ email: 'recipient@example.com' }],
  subject: 'Test',
  text: 'Hello',
});
assert.equal(invalidCheck1.valid, false);
assert.ok(invalidCheck1.errors.some((e) => e.includes('Sender email')));

const invalidCheck2 = validateEmailParams({
  from: { email: 'sender@example.com' },
  to: [],
  subject: 'Test',
  text: 'Hello',
});
assert.equal(invalidCheck2.valid, false);
assert.ok(invalidCheck2.errors.some((e) => e.includes('At least one recipient')));

const invalidCheck3 = validateEmailParams({
  from: { email: 'sender@example.com' },
  to: [{ email: 'recipient@example.com' }],
  subject: '',
  text: 'Hello',
});
assert.equal(invalidCheck3.valid, false);
assert.ok(invalidCheck3.errors.some((e) => e.includes('subject is required')));

const validCheck = validateEmailParams({
  from: { email: 'sender@example.com', name: 'Sender Name' },
  to: [{ email: 'recipient@example.com', name: 'Recipient Name' }],
  subject: 'Test Subject',
  text: 'Plain text',
  html: '<p>HTML text</p>',
});
assert.equal(validCheck.valid, true);
assert.equal(validCheck.errors.length, 0);

console.log('--- 3. Testing payload construction ---');
const payload = buildMailerSendPayload({
  from: { email: 'sender@example.com', name: 'Sender' },
  to: [{ email: 'recipient@example.com', name: 'Recipient' }],
  subject: 'Hello World',
  text: 'Text body',
  html: '<p>HTML body</p>',
  cc: [{ email: 'cc@example.com' }],
  bcc: [{ email: 'bcc@example.com' }],
  tags: ['test', 'verification'],
});

assert.deepEqual(payload.from, { email: 'sender@example.com', name: 'Sender' });
assert.deepEqual(payload.to, [{ email: 'recipient@example.com', name: 'Recipient' }]);
assert.equal(payload.subject, 'Hello World');
assert.equal(payload.text, 'Text body');
assert.equal(payload.html, '<p>HTML body</p>');
assert.deepEqual(payload.cc, [{ email: 'cc@example.com' }]);
assert.deepEqual(payload.bcc, [{ email: 'bcc@example.com' }]);
assert.deepEqual(payload.tags, ['test', 'verification']);

console.log('--- 4. Testing missing API key error ---');
const noKeyResult = await sendMailerSendEmail(
  {
    from: { email: 'sender@example.com' },
    to: [{ email: 'recipient@example.com' }],
    subject: 'Test',
    text: 'Test body',
  },
  { apiKey: '' },
);
assert.equal(noKeyResult.ok, false);
assert.equal(noKeyResult.statusCode, 400);
assert.ok(noKeyResult.error?.includes('API key is required'));

console.log('--- 5. Testing CLI dry-run execution ---');
const dryRunOutput = execFileSync(
  'node',
  [
    'scripts/send-mailersend.mjs',
    '--api-key',
    'mlsn.test_token_123',
    '--from',
    'sender@test.com',
    '--to',
    'recipient@test.com',
    '--subject',
    'Dry Run Subject',
    '--dry-run',
  ],
  { cwd: root, encoding: 'utf8' },
);

assert.ok(dryRunOutput.includes('[DRY-RUN]'));
assert.ok(dryRunOutput.includes('Dry Run Subject'));
assert.ok(dryRunOutput.includes('recipient@test.com'));

console.log('--- 6. Testing SDK compatibility classes ---');
const { Sender, Recipient, EmailParams, MailerSend } = mailerMod;

const sentFrom = new Sender('test@abliterated.app', 'Abliterated');
assert.equal(sentFrom.email, 'test@abliterated.app');
assert.equal(sentFrom.name, 'Abliterated');

const recipients = [new Recipient('jdjduncan@outlook.com', 'JD Duncan')];
assert.equal(recipients[0].email, 'jdjduncan@outlook.com');
assert.equal(recipients[0].name, 'JD Duncan');

const emailParams = new EmailParams()
  .setFrom(sentFrom)
  .setTo(recipients)
  .setReplyTo(sentFrom)
  .setSubject('SDK Test Subject')
  .setHtml('<p>Greetings from the team</p>')
  .setText('Greetings from the team');

const asParams = emailParams.toParams();
assert.equal(asParams.from.email, 'test@abliterated.app');
assert.equal(asParams.to[0].email, 'jdjduncan@outlook.com');
assert.equal(asParams.subject, 'SDK Test Subject');
assert.equal(asParams.html, '<p>Greetings from the team</p>');
assert.equal(asParams.text, 'Greetings from the team');

const client = new MailerSend({ apiKey: 'mlsn.test_token_123' });
assert.ok(client.email);
assert.ok(client.domains);
assert.equal(typeof client.email.send, 'function');
assert.equal(typeof client.domains.list, 'function');

console.log('--- 7. Testing transactional templates ---');
const templatesMod = await import(pathToFileURL(path.join(outDir, 'lib/mailersendTemplates.js')).href);
const { ABLITERATED_TEMPLATES, SIGNUP_WELCOME_SUBJECT, PAYMENT_RECEIPT_SUBJECT, CODE_REDEEMED_SUBJECT } = templatesMod;
assert.equal(ABLITERATED_TEMPLATES.length, 3);

const welcome = ABLITERATED_TEMPLATES.find((t) => t.type === 'signup_welcome');
assert.ok(welcome);
assert.equal(welcome.subject, SIGNUP_WELCOME_SUBJECT);
assert.ok(welcome.getHtml(welcome.defaultPayload).includes('Welcome to Abliterated'));
assert.ok(welcome.getText(welcome.defaultPayload).includes('Welcome to Abliterated'));

const receipt = ABLITERATED_TEMPLATES.find((t) => t.type === 'payment_receipt');
assert.ok(receipt);
assert.equal(receipt.subject, PAYMENT_RECEIPT_SUBJECT);
assert.ok(receipt.getHtml(receipt.defaultPayload).includes('Payment Confirmed'));
assert.ok(receipt.getText(receipt.defaultPayload).includes('Abliterated payment receipt'));

const redeemed = ABLITERATED_TEMPLATES.find((t) => t.type === 'code_redeemed');
assert.ok(redeemed);
assert.equal(redeemed.subject, CODE_REDEEMED_SUBJECT);
assert.ok(redeemed.getHtml(redeemed.defaultPayload).includes('Access Code Redeemed'));
assert.ok(redeemed.getText(redeemed.defaultPayload).includes('access code is redeemed'));

// Cleanup
fs.rmSync(outDir, { recursive: true, force: true });
console.log('All MailerSend client, templates & CLI tests PASSED!');

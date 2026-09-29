import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { initializeStore, getState, persist, encryptedSnapshot, restoreSnapshot, launchFile } from './storage.js';
import { parseAttendance, parseParents, parentChanges, mergeParents, publicState, students, warnings, validateReady, requireVerifiedTest, validEmail, mailFor, applyStudentName } from './model.js';

const PORT = 43871;
const HOST = '127.0.0.1';
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const token = randomBytes(32).toString('hex');
let running = false;

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};
const fail = (res, error) => json(res, 400, { error: error.message || 'Request failed.' });
const refresh = state => { state.test = null; state.deliveries = {}; state.batch = null; };
const fingerprint = state => createHash('sha256').update(JSON.stringify({
  senderEmail: state.senderEmail, attendance: state.attendance, parents: state.parents, template: state.template
})).digest('hex');
const editable = () => {
  if (running || getState().batch?.status === 'paused' || getState().batch?.status === 'complete') {
    throw new Error('This mailing has started. Upload a new attendance file to begin a new mailing.');
  }
};
const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

async function body(req, limit = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('The uploaded file or request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function payload(req) {
  try { return JSON.parse((await body(req, 2 * 1024 * 1024)).toString('utf8')); }
  catch { throw new Error('Invalid request data.'); }
}
function transport(state) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: state.senderEmail, pass: state.appPassword },
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000
  });
}
async function sendOne(state, message) {
  const mailer = transport(state);
  try {
    const result = await mailer.sendMail({
      from: state.senderEmail, to: message.to,
      subject: message.subject, text: message.text
    });
    if (!result.accepted?.some(address => address.toLowerCase() === message.to.toLowerCase())) {
      throw new Error('The SMTP server did not accept the recipient.');
    }
    return result.messageId || '';
  } finally { mailer.close(); }
}
function archive(state) {
  if (state.batch || Object.keys(state.deliveries).length) {
    state.history ||= [];
    state.history.unshift({ batch: state.batch, deliveries: state.deliveries, archivedAt: new Date().toISOString() });
    state.history = state.history.slice(0, 12);
  }
}
async function runBatch() {
  if (running) return;
  running = true;
  const state = getState();
  try {
    for (const student of students(state).filter(s => s.rows.some(r => r.included))) {
      const current = state.deliveries[student.registration];
      if (current?.status === 'sent' || current?.status === 'skipped' || current?.status === 'uncertain') continue;
      state.deliveries[student.registration] = { status: 'sending', email: student.parent.email, updatedAt: new Date().toISOString() };
      state.batch.status = 'running';
      await persist();
      try {
        const messageId = await sendOne(state, mailFor(state, student.registration));
        state.deliveries[student.registration] = { status: 'sent', email: student.parent.email, messageId, updatedAt: new Date().toISOString() };
        await persist();
      } catch (error) {
        state.deliveries[student.registration] = { status: 'uncertain', email: student.parent.email, error: error.message, updatedAt: new Date().toISOString() };
        state.batch.status = 'paused';
        state.batch.error = 'Sending paused. Check the uncertain delivery before retrying.';
        await persist();
        return;
      }
    }
    state.batch.status = 'complete';
    state.batch.error = null;
    await persist();
  } finally { running = false; }
}

async function api(req, res, url) {
  const state = getState();
  if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, publicState(state));
  if (url.pathname === '/api/backup' && req.method === 'GET') return json(res, 200, { encrypted: encryptedSnapshot() });
  if (url.pathname === '/api/restore' && req.method === 'POST') {
    const input = await payload(req);
    await restoreSnapshot(String(input.encrypted || ''));
    return json(res, 200, publicState(getState()));
  }
  if (url.pathname === '/api/sender' && req.method === 'POST') {
    editable();
    const input = await payload(req);
    const email = text(input.email).toLowerCase();
    if (!validEmail(email)) throw new Error('Enter a valid sender email address.');
    if (input.password && String(input.password).trim().length < 8) throw new Error('The app password looks too short.');
    if (!input.password && !state.appPassword) throw new Error('Enter the Gmail app password.');
    state.senderEmail = email;
    if (input.password) state.appPassword = String(input.password).replace(/\s/g, '');
    refresh(state);
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/attendance' && req.method === 'POST') {
    if (running) throw new Error('Wait for the current send to finish.');
    if (state.recoveryPending) throw new Error('Review every restored delivery outcome before importing a new attendance report.');
    const rows = await parseAttendance(await body(req));
    archive(state);
    state.attendance = rows;
    state.acknowledgements = [];
    refresh(state);
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/parents' && req.method === 'POST') {
    editable();
    const incoming = await parseParents(await body(req));
    const changes = parentChanges(state.parents, incoming);
    const merged = mergeParents(state.parents, incoming, changes);
    if (state.parents.length && changes.length) {
      state.pendingParents = { rows: merged, changes };
    } else {
      state.parents = merged;
      state.pendingParents = null;
      state.acknowledgements = [];
      refresh(state);
    }
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/parents/accept' && req.method === 'POST') {
    editable();
    if (!state.pendingParents) throw new Error('There are no pending parent changes.');
    state.parents = mergeParents(state.parents, state.pendingParents.changes.map(change => change.after));
    state.pendingParents = null;
    state.acknowledgements = [];
    refresh(state);
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/parents/cancel' && req.method === 'POST') {
    state.pendingParents = null;
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/parent' && req.method === 'POST') {
    editable();
    if (state.pendingParents) throw new Error('Accept or cancel the pending contact changes before editing a saved contact.');
    const input = await payload(req);
    const parent = state.parents.find(p => p.registration === text(input.registration));
    if (!parent) throw new Error('Parent record not found.');
    parent.email = text(input.email).toLowerCase();
    parent.studentName = text(input.studentName);
    state.acknowledgements = state.acknowledgements.filter(id => !id.includes(parent.registration));
    refresh(state);
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/attendance-row' && req.method === 'POST') {
    editable();
    const input = await payload(req);
    const row = state.attendance.find(r => r.id === input.id);
    if (!row) throw new Error('Attendance row not found.');
    row.subject = text(input.subject);
    row.included = Boolean(input.included);
    state.acknowledgements = state.acknowledgements.filter(id => id !== `subject:${row.id}`);
    refresh(state);
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/student-name' && req.method === 'POST') {
    editable();
    const input = await payload(req);
    applyStudentName(state, text(input.registration), text(input.name));
    refresh(state);
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/acknowledge' && req.method === 'POST') {
    editable();
    const input = await payload(req);
    const issue = warnings(state).find(w => w.id === input.id && w.kind === 'review');
    if (!issue) throw new Error('Review item not found.');
    state.acknowledgements = state.acknowledgements.filter(id => id !== issue.id);
    if (input.accepted) state.acknowledgements.push(issue.id);
    refresh(state);
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/template' && req.method === 'POST') {
    editable();
    const input = await payload(req);
    const subject = text(input.subject, 250);
    const message = text(input.body, 20000);
    if (!subject || !message || !message.includes('{{attendance_details}}')) {
      throw new Error('Add a subject and body, and keep {{attendance_details}} in the body.');
    }
    state.template = { subject, body: message };
    refresh(state);
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname.startsWith('/api/preview/') && req.method === 'GET') {
    const reg = decodeURIComponent(url.pathname.slice('/api/preview/'.length));
    return json(res, 200, mailFor(state, reg));
  }
  if (url.pathname === '/api/test' && req.method === 'POST') {
    if (running) throw new Error('A batch is currently sending.');
    validateReady(state);
    const input = await payload(req);
    const to = text(input.email).toLowerCase();
    if (!validEmail(to)) throw new Error('Enter a valid alternate email address.');
    if (state.parents.some(parent => parent.email.toLowerCase() === to)) {
      throw new Error('Use an alternate address that is not in the parent directory.');
    }
    const draft = mailFor(state, text(input.registration));
    const testId = randomBytes(4).toString('hex').toUpperCase();
    const messageId = await sendOne(state, { ...draft, to, subject: `[TEST] ${draft.subject} (test ${testId})` });
    state.test = { to, registration: draft.registration, messageId, fingerprint: fingerprint(state), sentAt: new Date().toISOString() };
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/test/verify' && req.method === 'POST') {
    if (running) throw new Error('A batch is currently sending.');
    validateReady(state);
    if (!state.test || state.test.fingerprint !== fingerprint(state)) {
      throw new Error('Send a successful test email for the current data and draft first.');
    }
    state.test.verifiedAt = new Date().toISOString();
    await persist();
    return json(res, 200, publicState(state));
  }
  if (url.pathname === '/api/send' && req.method === 'POST') {
    validateReady(state);
    if (state.recoveryPending) throw new Error('Review every restored delivery outcome before sending.');
    requireVerifiedTest(state, fingerprint(state));
    if (running) throw new Error('A batch is already running.');
    if (state.batch?.fingerprint && state.batch.fingerprint !== fingerprint(state)) throw new Error('This mailing has changed since the batch began.');
    if (!state.batch) state.batch = { fingerprint: fingerprint(state), startedAt: new Date().toISOString(), status: 'running' };
    if (!state.batch.fingerprint) state.batch.fingerprint = fingerprint(state);
    if (state.batch.status === 'complete') throw new Error('All eligible emails have already been sent.');
    if (Object.values(state.deliveries).some(d => d.status === 'uncertain' || d.status === 'sending')) {
      throw new Error('Resolve uncertain deliveries before resuming.');
    }
    state.batch.status = 'running';
    await persist();
    void runBatch().catch(async error => {
      state.batch.status = 'paused';
      state.batch.error = error.message;
      await persist();
    });
    return json(res, 202, publicState(state));
  }
  if (url.pathname === '/api/delivery/resolve' && req.method === 'POST') {
    if (running) throw new Error('Wait for the current send to finish.');
    const input = await payload(req);
    const delivery = state.deliveries[text(input.registration)];
    if (!delivery || delivery.status !== 'uncertain') throw new Error('No uncertain delivery found.');
    if (!['sent', 'skipped', 'retry'].includes(input.action)) throw new Error('Choose sent, skipped, or retry.');
    delivery.status = input.action === 'retry' ? 'pending' : input.action;
    delivery.updatedAt = new Date().toISOString();
    if (state.recoveryPending && !Object.values(state.deliveries).some(item => item.status === 'uncertain')) {
      state.recoveryPending = false;
      state.batch.error = 'Delivery outcomes reviewed. Send a fresh test before resuming.';
    }
    await persist();
    return json(res, 200, publicState(state));
  }
  return json(res, 404, { error: 'Not found.' });
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
async function staticFile(res, pathname) {
  const requested = path.resolve(dist, '.' + pathname);
  const file = requested.startsWith(dist + path.sep) && path.extname(requested) ? requested : path.join(dist, 'index.html');
  try {
    const content = await readFile(file);
    res.writeHead(200, {
      'Content-Type': (mime[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(content);
  } catch { json(res, 404, { error: 'Build the website first with npm run build.' }); }
}

await initializeStore();
const state = getState();
for (const delivery of Object.values(state.deliveries)) if (delivery.status === 'sending') delivery.status = 'uncertain';
if (state.batch?.status === 'running') state.batch.status = 'paused';
await persist();
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `${HOST}:${PORT}` && req.headers.host !== `localhost:${PORT}`) return json(res, 403, { error: 'Invalid host.' });
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-emailsender-request'] !== token) return json(res, 403, { error: 'Open EmailSender with the emailsender start command.' });
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${HOST}:${PORT}` && req.headers.origin !== `http://localhost:${PORT}`) return json(res, 403, { error: 'Invalid origin.' });
      return await api(req, res, url);
    }
    return await staticFile(res, url.pathname);
  } catch (error) { fail(res, error); }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Close the other EmailSender instance and try again.`);
  else console.error('The local service could not start listening:', error);
  process.exitCode = 1;
});
server.listen(PORT, HOST, async () => {
  const url = `http://${HOST}:${PORT}/#session=${token}`;
  try {
    await writeFile(launchFile, JSON.stringify({ url, pid: process.pid }), { mode: 0o600 });
    console.log('EmailSender local service is ready.');
  } catch (error) {
    console.error('Could not write the private launch link:', error);
    process.exitCode = 1;
    server.close();
  }
});

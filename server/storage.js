import { Entry } from '@napi-rs/keyring';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { emptyState, mergeParents, parentChanges, students } from './model.js';

const dataDir = process.env.EMAILSENDER_DATA_DIR || (
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'EmailSender', 'data')
    : path.join(os.homedir(), 'Library', 'Application Support', 'EmailSender', 'data')
);
const stateFile = path.join(dataDir, 'state.enc');
const previousFile = path.join(dataDir, 'state.previous.enc');
export const launchFile = path.join(dataDir, 'launch.json');
const keyEntry = new Entry('EmailSender', 'local-encryption-key-v1');
let encryptionKey;
let state;
let writeQueue = Promise.resolve();

function reconcilePendingParents(savedState) {
  if (!savedState.pendingParents) return false;
  const staged = savedState.pendingParents.changes.map(change => change.after);
  const changes = parentChanges(savedState.parents, staged);
  savedState.pendingParents = changes.length
    ? { rows: mergeParents(savedState.parents, staged, changes), changes }
    : null;
  return true;
}

function encrypt(data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
}

function decrypt(serialized) {
  const payload = JSON.parse(serialized);
  if (payload.version !== 1) throw new Error('Unsupported saved data version.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

export async function initializeStore() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let saved;
  try { saved = await readFile(stateFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let key;
  const testMode = process.env.NODE_ENV === 'test'
    && process.env.EMAILSENDER_TEST_KEY
    && path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep);
  if (testMode) key = process.env.EMAILSENDER_TEST_KEY;
  else {
    try { key = keyEntry.getPassword(); }
    catch (error) {
      if (saved) throw new Error('Saved data exists, but the operating-system credential store cannot be opened.', { cause: error });
    }
  }
  if (!key) {
    if (saved) throw new Error('Saved data exists, but its encryption key is missing from the operating-system credential store.');
    key = randomBytes(32).toString('base64');
    if (!testMode) keyEntry.setPassword(key);
  }
  encryptionKey = Buffer.from(key, 'base64');
  if (encryptionKey.length !== 32) throw new Error('The saved encryption key is invalid.');
  state = saved ? decrypt(saved) : emptyState();
  if (reconcilePendingParents(state) || !saved) await persist();
  return state;
}

export function getState() {
  if (!state) throw new Error('Store is not initialized.');
  return state;
}

export function encryptedSnapshot() {
  return encrypt(state);
}

export async function restoreSnapshot(serialized) {
  if (await exists(stateFile) && (getState().attendance.length || getState().parents.length || getState().senderEmail)) {
    throw new Error('Existing local data cannot be overwritten by a browser backup.');
  }
  const restored = decrypt(serialized);
  if (restored.version !== 1 || !Array.isArray(restored.parents) || !Array.isArray(restored.attendance)) throw new Error('The browser backup has an invalid format.');
  reconcilePendingParents(restored);
  restored.test = null;
  const recipients = students(restored).filter(student => student.rows.some(row => row.included));
  if (recipients.length) {
    const previous = restored.deliveries || {};
    restored.deliveries = Object.fromEntries(recipients.map(student => [student.registration, {
      status: 'uncertain',
      email: student.parent?.email || '',
      previousStatus: previous[student.registration]?.status || 'not recorded',
      updatedAt: new Date().toISOString()
    }]));
    restored.recoveryPending = true;
    restored.batch = {
      status: 'paused', recovery: true, fingerprint: null,
      startedAt: restored.batch?.startedAt || new Date().toISOString(),
      error: 'Browser backup restored. Check every recipient and send a new test before resuming.'
    };
  } else {
    restored.recoveryPending = false;
    restored.batch = null;
    restored.deliveries = {};
  }
  state = restored;
  await persist();
  return state;
}

async function exists(file) {
  try { await stat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function persist() {
  state.updatedAt = new Date().toISOString();
  const content = encrypt(state);
  writeQueue = writeQueue.then(async () => {
    const temp = path.join(dataDir, `state.${process.pid}.${randomBytes(5).toString('hex')}.tmp`);
    await writeFile(temp, content, { mode: 0o600 });
    if (await exists(stateFile)) await copyFile(stateFile, previousFile);
    await rename(temp, stateFile);
  });
  return writeQueue;
}

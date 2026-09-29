import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleAlert, CloudUpload, FileSpreadsheet, LockKeyhole, Mail, Pencil, Play, RefreshCw, Save, Send, ShieldCheck, Users, X } from 'lucide-react';
import './styles.css';

const STEPS = [
  { title: 'Sender account', caption: 'Connect Gmail', icon: Mail },
  { title: 'Attendance', caption: 'Upload report', icon: FileSpreadsheet },
  { title: 'Parent directory', caption: 'Match recipients', icon: Users },
  { title: 'Review & draft', caption: 'Check every detail', icon: Pencil },
  { title: 'Test & send', caption: 'Deliver messages', icon: Send }
];
let sessionToken = '';
function localToken() {
  if (sessionToken) return sessionToken;
  const fromLaunch = new URLSearchParams(window.location.hash.slice(1)).get('session');
  if (fromLaunch && /^[a-f0-9]{64}$/.test(fromLaunch)) {
    sessionStorage.setItem('emailsender-session', fromLaunch);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  sessionToken = fromLaunch || sessionStorage.getItem('emailsender-session') || '';
  if (!/^[a-f0-9]{64}$/.test(sessionToken)) {
    throw new Error('Open the site with “emailsender start” so the private local session can be loaded.');
  }
  return sessionToken;
}
async function api(path, options = {}) {
  const token = localToken();
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options.body && !(options.body instanceof ArrayBuffer) && !BufferLike(options.body) ? { 'Content-Type': 'application/json' } : {}),
      'X-EmailSender-Request': token,
      ...options.headers
    }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function BufferLike(value) { return value instanceof Blob || value instanceof Uint8Array; }
async function saveBrowserBackup() {
  try {
    const { encrypted } = await api('/api/backup');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('emailsender-encrypted-backup', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      transaction.objectStore('snapshots').put(encrypted, 'latest');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch { /* Local encrypted file remains the primary copy. */ }
}
async function readBrowserBackup() {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('emailsender-encrypted-backup', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get('latest');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  } catch { return null; }
}
function splitStudents(data) {
  const map = new Map();
  for (const row of data?.attendance || []) {
    if (!map.has(row.registration)) map.set(row.registration, { registration: row.registration, name: row.studentName, rows: [] });
    map.get(row.registration).rows.push(row);
  }
  return [...map.values()];
}
const money = n => Number(n).toFixed(2) + '%';
let chimeCtx;
function armChime() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  if (!chimeCtx) chimeCtx = new Context();
  if (chimeCtx.state === 'suspended') chimeCtx.resume();
}
async function playChime(tone) {
  armChime();
  if (!chimeCtx) return;
  if (chimeCtx.state === 'suspended') {
    try { await chimeCtx.resume(); } catch { return; }
  }
  if (chimeCtx.state !== 'running') return;
  const now = chimeCtx.currentTime;
  const notes = tone === 'error' ? [349.23, 277.18] : [523.25, 659.25];
  notes.forEach((freq, index) => {
    const start = now + index * 0.09;
    const body = chimeCtx.createOscillator();
    const air = chimeCtx.createOscillator();
    const mix = chimeCtx.createGain();
    const airMix = chimeCtx.createGain();
    body.type = 'triangle';
    air.type = 'sine';
    body.frequency.setValueAtTime(freq, start);
    air.frequency.setValueAtTime(freq * 2.01, start);
    airMix.gain.value = 0.16;
    mix.gain.setValueAtTime(0.0001, start);
    mix.gain.exponentialRampToValueAtTime(tone === 'error' ? 0.045 : 0.07, start + 0.02);
    mix.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
    body.connect(mix);
    air.connect(airMix);
    airMix.connect(mix);
    mix.connect(chimeCtx.destination);
    body.start(start);
    air.start(start);
    body.stop(start + 0.4);
    air.stop(start + 0.4);
  });
}

function App() {
  const [data, setData] = useState(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef(new Map());
  const [busy, setBusy] = useState(false);
  const [sender, setSender] = useState({ email: '', password: '' });
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(false);
  const [template, setTemplate] = useState({ subject: '', body: '' });
  const [alternate, setAlternate] = useState('');
  const [showTesting, setShowTesting] = useState(false);
  const [backup, setBackup] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [replacing, setReplacing] = useState({ attendance: false, parents: false });
  const students = useMemo(() => splitStudents(data), [data]);
  const included = data?.attendance.filter(r => r.included).length || 0;
  const pendingWarnings = data?.warnings.filter(w => !w.resolved) || [];
  const parentMap = useMemo(() => new Map((data?.parents || []).map(p => [p.registration, p])), [data]);
  const sendableStudents = students.filter(s => s.rows.some(r => r.included));
  const sampleReg = selected || sendableStudents[0]?.registration || students[0]?.registration;
  const showDelivery = !showTesting && Boolean(data?.test?.verifiedAt || data?.batch);

  useEffect(() => {
    const arm = () => armChime();
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
      toastTimers.current.forEach(timer => clearTimeout(timer));
    };
  }, []);
  function dismissToast(id) {
    const timer = toastTimers.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.current.delete(id);
    setToasts(current => current.map(item => item.id === id ? { ...item, leaving: true } : item));
    setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 200);
  }
  function pushToast(message, tone = 'success') {
    const id = crypto.randomUUID();
    const life = tone === 'error' ? 5200 : 3400;
    setToasts(current => {
      const next = [...current.filter(item => !item.leaving), { id, message, tone, life }].slice(-4);
      const keep = new Set(next.map(item => item.id));
      for (const [oldId, timer] of toastTimers.current) {
        if (!keep.has(oldId)) { clearTimeout(timer); toastTimers.current.delete(oldId); }
      }
      return next;
    });
    playChime(tone);
    toastTimers.current.set(id, setTimeout(() => dismissToast(id), life));
  }
  useEffect(() => {
    api('/api/state').then(async state => {
      setData(state);
      setSender({ email: state.senderEmail || '', password: '' });
      setTemplate(state.template);
      if (!state.attendance.length && !state.parents.length && !state.senderEmail) setBackup(await readBrowserBackup());
      else await saveBrowserBackup();
    }).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (!data || !sampleReg || !data.attendance.some(r => r.registration === sampleReg && r.included)) { setPreview(null); return; }
    api('/api/preview/' + encodeURIComponent(sampleReg)).then(setPreview).catch(() => setPreview(null));
  }, [data, sampleReg]);
  useEffect(() => {
    if (!data?.batch || !['running', 'paused'].includes(data.batch.status)) return;
    const timer = setInterval(() => api('/api/state').then(async state => { setData(state); await saveBrowserBackup(); }).catch(() => {}), 1400);
    return () => clearInterval(timer);
  }, [data?.batch?.status]);

  async function action(work, message) {
    setBusy(true);
    try {
      const result = await work();
      if (result?.version) { setData(result); await saveBrowserBackup(); }
      if (message) pushToast(message, 'success');
      return result;
    } catch (e) { pushToast(e.message, 'error'); return null; }
    finally { setBusy(false); }
  }
  async function upload(file, kind) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { pushToast('Choose an .xlsx workbook.', 'error'); return; }
    const result = await action(async () => api('/api/' + kind, { method: 'POST', body: await file.arrayBuffer(), headers: { 'Content-Type': 'application/octet-stream' } }),
      kind === 'attendance' ? 'Attendance report imported.' : 'Parent directory imported.');
    if (result) setReplacing(current => ({ ...current, [kind]: false }));
  }
  async function updateRow(row, changes) {
    await action(() => api('/api/attendance-row', { method: 'POST', body: JSON.stringify({ id: row.id, subject: changes.subject ?? row.subject, included: changes.included ?? row.included }) }));
  }
  async function updateParent(parent, changes) {
    await action(() => api('/api/parent', { method: 'POST', body: JSON.stringify({ registration: parent.registration, email: changes.email ?? parent.email, studentName: changes.studentName ?? parent.studentName }) }));
  }
  async function acknowledge(issue) {
    await action(() => api('/api/acknowledge', { method: 'POST', body: JSON.stringify({ id: issue.id, accepted: !issue.resolved }) }));
  }
  async function chooseName(issue, name) {
    await action(() => api('/api/student-name', { method: 'POST', body: JSON.stringify({ registration: issue.registration, name }) }), 'Student name updated for the email and the saved contact.');
  }
  async function saveTemplate() {
    const result = await action(() => api('/api/template', { method: 'POST', body: JSON.stringify(template) }), 'Draft saved. A fresh test will be required.');
    if (result) setEditing(false);
  }
  async function sendTest() {
    const result = await action(() => api('/api/test', { method: 'POST', body: JSON.stringify({ email: alternate, registration: sampleReg }) }), 'Test email accepted by Gmail. Check your alternate inbox.');
    if (result) setShowTesting(true);
  }
  async function verifyTest() {
    const result = await action(() => api('/api/test/verify', { method: 'POST', body: '{}' }), 'Test verified. Parent delivery is ready.');
    if (result) setShowTesting(false);
  }
  async function startSend() {
    await action(() => api('/api/send', { method: 'POST', body: '{}' }), 'Sending started. Keep this window open to monitor progress.');
  }
  async function resolve(registration, choice) {
    await action(() => api('/api/delivery/resolve', { method: 'POST', body: JSON.stringify({ registration, action: choice }) }), 'Delivery status updated.');
  }

  if (!data) return <div className="startup"><div className="startup-mark"><Mail size={27}/></div><h2>Opening EmailSender</h2><p>{error || 'Connecting to your private local workspace…'}</p></div>;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Mail size={22} strokeWidth={2.4}/></div><div><strong>EmailSender</strong><span>FACULTY WORKSPACE</span></div></div>
      <div className="sidebar-kicker">YOUR WORKFLOW</div>
      <nav className="step-nav">{STEPS.map((item, i) => {
        const Icon = item.icon;
        const done = i < step;
        return <button key={item.title} className={'nav-step ' + (step === i ? 'active' : '')} onClick={() => setStep(i)}>
          <span className={'step-icon ' + (done ? 'done' : '')}>{done ? <Check size={17}/> : <Icon size={18}/>}</span>
          <span className="nav-copy"><strong>{item.title}</strong><small>{item.caption}</small></span>
          {step === i && <span className="active-dot"/>}
        </button>;
      })}</nav>
      <div className="sidebar-bottom">
        <div className="privacy"><ShieldCheck size={20}/><div><strong>Private by design</strong><span>Your data stays on this computer.</span></div></div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">EMAILSENDER <span>/</span> {STEPS[step].title.toUpperCase()}</div><div className="topbar-right"><span className="local-pill"><span/> LOCAL WORKSPACE</span><span className="avatar">FA</span></div></header>
      <div className="content">
        {data.recoveryPending && <div className="alert error"><CircleAlert size={18}/><span>A browser backup was restored. Review every delivery outcome below and send a fresh test before resuming.</span><button onClick={() => setStep(4)}>Review deliveries</button></div>}
        {step === 0 && <div className="account-page">
          <div className="eyebrow"><span className="eyebrow-line"/> STEP 01 / 05</div>
          <h1>Connect your sender account<span className="title-period">.</span></h1>
          <p className="lead">Use the Gmail address that will send attendance updates to parents. Your credentials are encrypted and saved on this device.</p>
          <div className="two-col account-grid">
            <section className="panel account-card"><div className="account-title-row"><h2>Sender credentials</h2><div className="section-icon"><LockKeyhole size={21}/></div></div><p className="subtext">Enter your Gmail address and its 16-character app password.</p>
              <form onSubmit={e => { e.preventDefault(); action(() => api('/api/sender', { method: 'POST', body: JSON.stringify(sender) }), 'Sender account saved.').then(result => { if (result) { setSender(v => ({ ...v, password: '' })); setStep(1); } }); }}>
                <label>Email address<input type="email" value={sender.email} onChange={e => setSender({ ...sender, email: e.target.value })} placeholder="faculty@gmail.com" required/></label>
                <label>Gmail app password<div className="password-wrap"><input type={showPassword ? 'text' : 'password'} value={sender.password} onChange={e => setSender({ ...sender, password: e.target.value })} placeholder={data.hasPassword ? 'Saved — enter only to change' : 'Enter your app password'} required={!data.hasPassword}/><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
                <button className="primary full" disabled={busy}>{busy ? 'Saving…' : 'Save & continue'} <ArrowRight size={18}/></button>
              </form>
              {data.hasPassword && <div className="saved-line"><CheckCircle2 size={16}/> Credentials saved on this device</div>}
            </section>
            {backup && <button className="text-button" onClick={() => action(() => api('/api/restore', { method: 'POST', body: JSON.stringify({ encrypted: backup }) }), 'Encrypted browser backup restored.')}>Restore saved browser backup <ArrowRight size={15}/></button>}
          </div>
        </div>}
        {step === 1 && <>
          <div className="eyebrow"><span className="eyebrow-line"/> STEP 02 / 05</div><h1>Import attendance<span className="title-period">.</span></h1><p className="lead">{data.attendance.length && !replacing.attendance ? 'Open a student to check every low-attendance subject before you continue.' : 'Upload the latest attendance report. We’ll find every student below 75% and organize their subjects automatically.'}</p>
          {(!data.attendance.length || replacing.attendance) ? <UploadStage icon={<FileSpreadsheet size={22}/>} title="Attendance report" caption="Excel workbook · .xlsx" dropTitle="Drop attendance sheet here" help="Expected columns: Register Number, Student Name, Subject Code, Subject Name, Attendance Percentage" busy={busy} onFile={file => upload(file, 'attendance')} onCancel={data.attendance.length ? () => setReplacing(current => ({ ...current, attendance: false })) : null}/> : <><div className="review-stats"><div><Users size={20}/><strong>{students.length}</strong><span>students</span></div><div><FileSpreadsheet size={20}/><strong>{data.attendance.length}</strong><span>shortage rows</span></div><div><CheckCircle2 size={20}/><strong>{included}</strong><span>included</span></div></div><div className="soft-callout import-callout"><CircleAlert size={19}/><p><strong>Community Connect is excluded by default.</strong><br/>{students.length - sendableStudents.length} students currently have no included subjects and will receive no email. Open a card to include a subject, or change it during review.</p></div><section className="panel roster-panel import-results"><div className="panel-title-row"><div><h2>Imported students</h2><p>Each card opens to the same subject details you review in the draft.</p></div><button className="outline" onClick={() => setReplacing(current => ({ ...current, attendance: true }))}><RefreshCw size={15}/> Replace sheet</button></div><div className="roster-list">{students.map(student => <StudentCard key={student.registration} student={student} parent={parentMap.get(student.registration)} subjectsOnly selected={sampleReg === student.registration} onSelect={() => setSelected(student.registration)} onRow={updateRow} onParent={updateParent} disabled={!!data.batch}/>)}</div></section></>}
          <div className="bottom-actions"><button className="ghost" onClick={() => setStep(0)}><ArrowLeft size={17}/> Back</button><button className="primary" disabled={!data.attendance.length || replacing.attendance} onClick={() => setStep(2)}>Continue to parents <ArrowRight size={17}/></button></div>
        </>}
        {step === 2 && <>
          <div className="eyebrow"><span className="eyebrow-line"/> STEP 03 / 05</div><h1>Match parent contacts<span className="title-period">.</span></h1><p className="lead">{data.parents.length && !replacing.parents ? 'Open a contact to check the student name, registration number, and parent email.' : 'Use your saved parent directory or upload a refreshed sheet. We match records using registration numbers.'}</p>
          {(!data.parents.length || replacing.parents) ? <UploadStage icon={<Users size={22}/>} title="Parent directory" caption="Excel workbook · .xlsx" dropTitle="Drop parent email sheet here" help="Expected columns: Reg. No, Name, Parent Email" busy={busy} onFile={file => upload(file, 'parents')} onCancel={data.parents.length ? () => setReplacing(current => ({ ...current, parents: false })) : null}/> : <><div className="review-stats"><div><Users size={20}/><strong>{data.parents.length}</strong><span>parent records</span></div><div><CheckCircle2 size={20}/><strong>{students.filter(s => parentMap.has(s.registration)).length}</strong><span>matched students</span></div><div><CircleAlert size={20}/><strong>{students.filter(s => !parentMap.has(s.registration)).length}</strong><span>unmatched</span></div></div><div className="soft-callout good import-callout"><CheckCircle2 size={19}/><p><strong>Ready for next month</strong><br/>These records stay on this computer. Open a card to correct a name or email. Reupload only when contacts change.</p></div><section className="panel roster-panel import-results"><div className="panel-title-row"><div><h2>Saved contacts</h2><p>Each card opens to the student name, registration number, and parent email.</p></div><button className="outline" onClick={() => setReplacing(current => ({ ...current, parents: true }))}><RefreshCw size={15}/> Replace sheet</button></div><div className="roster-list">{data.parents.map(parent => { const student = students.find(s => s.registration === parent.registration); return <ParentCard key={parent.registration} parent={parent} student={student} attendanceReady={!!data.attendance.length} onParent={updateParent} disabled={!!data.batch || !!data.pendingParents}/>; })}</div></section></>}
          {data.pendingParents && !replacing.parents && <section className="panel changes-panel"><h2>Review updated contacts</h2><p className="subtext">{data.pendingParents.changes.length} contact{data.pendingParents.changes.length === 1 ? '' : 's'} are new or have changes. Accepting will save these updates and retain contacts absent from the new sheet.</p><div className="changes-list">{data.pendingParents.changes.map(c => <div key={c.registration}><strong>{c.after.studentName || c.registration}</strong><span><small>{c.registration}</small>{!c.before ? <>New contact: {c.after.studentName || 'No name'} · {c.after.email || 'No email'}</> : <>{c.fields.studentName && <span className="change-field">Name: {c.before.studentName || 'Blank'} → {c.after.studentName || 'Blank'}</span>}{c.fields.email && <span className="change-field">Email: {c.before.email || 'Blank'} → {c.after.email || 'Blank'}</span>}</>}</span></div>)}</div><div className="inline-actions"><button className="primary" onClick={() => action(() => api('/api/parents/accept', { method: 'POST', body: '{}' }), 'Updated parent directory saved.')}>Accept changes</button><button className="ghost" onClick={() => action(() => api('/api/parents/cancel', { method: 'POST', body: '{}' }))}>Keep saved contacts</button></div></section>}
          <div className="bottom-actions"><button className="ghost" onClick={() => setStep(1)}><ArrowLeft size={17}/> Back</button><button className="primary" disabled={!data.parents.length || !!data.pendingParents || replacing.parents} onClick={() => setStep(3)}>Review matching <ArrowRight size={17}/></button></div>
        </>}
        {step === 3 && <>
          <div className="eyebrow"><span className="eyebrow-line"/> STEP 04 / 05</div><h1>Review every detail<span className="title-period">.</span></h1><p className="lead">Confirm subject percentages, recipients, and the message parents will receive.</p>
          <div className="review-stats"><div><Users size={20}/><strong>{students.length}</strong><span>students</span></div><div><FileSpreadsheet size={20}/><strong>{included}</strong><span>subject rows</span></div><div className={pendingWarnings.length ? 'attention' : ''}><CircleAlert size={20}/><strong>{pendingWarnings.length}</strong><span>items to resolve</span></div></div>
          {pendingWarnings.length > 0 && <section className="panel warning-panel"><div className="panel-title-row"><div><h2>Data review</h2><p>Pick a name when the lists disagree, or accept the other items as shown.</p></div><span className={'badge ' + (pendingWarnings.length ? 'amber' : 'green')}>{pendingWarnings.length ? pendingWarnings.length + ' pending' : 'All resolved'}</span></div><div className="warning-list">{pendingWarnings.map(issue => <div className={'warning-item ' + (issue.resolved ? 'resolved' : '') + (issue.kind === 'name' ? ' name-item' : '')} key={issue.id}><CircleAlert size={17}/><div><strong>{issue.registration}</strong><span>{issue.kind === 'name' ? 'These names do not match.' : issue.text}</span></div>{issue.kind === 'name' ? <span className="name-choices"><button className="name-choice" onClick={() => chooseName(issue, issue.attendanceName)}><small>Attendance</small><strong>{issue.attendanceName}</strong></button><button className="name-choice" onClick={() => chooseName(issue, issue.parentName)}><small>Parent list</small><strong>{issue.parentName}</strong></button></span> : issue.kind === 'review' ? <button className="small-button" onClick={() => acknowledge(issue)}>{issue.resolved ? 'Accepted ✓' : 'Accept as shown'}</button> : <span className="badge red">Fix required</span>}</div>)}</div></section>}
          <section className="panel roster-panel"><div className="panel-title-row"><div><h2>Student & parent mapping</h2><p>Each student receives one email with all included low-attendance subjects.</p></div><span className="badge pale">{students.length} students</span></div><div className="roster-list">{students.map(student => {
            const parent = parentMap.get(student.registration);
            return <StudentCard key={student.registration} student={student} parent={parent} selected={sampleReg === student.registration} onSelect={() => setSelected(student.registration)} onRow={updateRow} onParent={updateParent} disabled={!!data.batch}/>
          })}</div></section>
          <section className="panel draft-panel"><div className="panel-title-row"><div><h2>Email draft</h2><p>One shared template, personalized for each student.</p></div><button className="outline" onClick={() => { setTemplate(data.template); setEditing(true); }} disabled={!!data.batch}><Pencil size={16}/> Edit draft</button></div><div className="draft-layout"><div className="draft-meta"><span>PREVIEWING</span><select value={sampleReg || ''} onChange={e => setSelected(e.target.value)}>{sendableStudents.map(s => <option key={s.registration} value={s.registration}>{s.name}</option>)}</select><div className="preview-field"><small>TO</small><strong>{preview?.to || '—'}</strong></div><div className="preview-field"><small>SUBJECT</small><strong>{preview?.subject || '—'}</strong></div></div><div className="mail-paper">{preview ? preview.text : 'Include at least one subject for a student to preview the email.'}</div></div></section>
          <div className="bottom-actions"><button className="ghost" onClick={() => setStep(2)}><ArrowLeft size={17}/> Back</button><button className="primary" disabled={pendingWarnings.length > 0 || !sendableStudents.length || !data.parents.length} onClick={() => setStep(4)}>Continue to test <ArrowRight size={17}/></button></div>
        </>}
        {step === 4 && <>
          <div className="send-stage">
          <div className="eyebrow"><span className="eyebrow-line"/> STEP 05 / 05</div>
          <div className="send-stage-heading"><h1>{showDelivery ? 'Deliver to parents' : 'Test your email'}<span className="title-period">.</span></h1>{showDelivery && <button className="outline" onClick={() => setShowTesting(true)}><ArrowLeft size={16}/> Back to testing</button>}</div>
          <p className="lead">{showDelivery ? 'Send each parent a separate message with their ward’s attendance details.' : 'Send a real test to your alternate inbox, check it, then verify it before delivering to parents.'}</p>
          {!showDelivery ? <section className="panel test-card send-stage-card"><div className="account-title-row"><h2>Send a test email</h2><div className="section-icon"><Mail size={21}/></div></div><p className="subtext">We’ll send the selected student's message with [TEST] in its subject.</p><label>Alternate email address<input type="email" value={alternate} onChange={e => setAlternate(e.target.value)} placeholder="your.alternate@email.com"/></label><div className="test-sample">Preview student <strong>{students.find(s => s.registration === sampleReg)?.name || '—'}</strong></div><button className="primary full" disabled={busy || pendingWarnings.length > 0 || !sampleReg || data.batch?.status === 'running' || data.batch?.status === 'complete'} onClick={sendTest}>{busy ? 'Sending…' : 'Send test email'} <ArrowRight size={17}/></button>{data.test && <div className="test-verification"><div className="saved-line"><CheckCircle2 size={16}/> Test accepted for {data.test.to}</div>{!data.test.verifiedAt && <><p>Check that the test arrived and its content looks right. Verification confirms your review of the inbox.</p><button className="primary" disabled={busy} onClick={verifyTest}><Check size={17}/> Verify test email</button></>}{data.test.verifiedAt && <button className="outline" onClick={() => setShowTesting(false)}>Continue to parent delivery <ArrowRight size={16}/></button>}</div>}</section> : <>
            <section className="panel launch-card send-stage-card"><div className="account-title-row"><h2>Deliver to parents</h2><div className="section-icon dark"><Send size={21}/></div></div><p className="subtext">Each parent receives a separate message with their ward’s attendance details.</p><div className="delivery-summary"><div><span>RECIPIENTS</span><strong>{sendableStudents.length}</strong></div><div><span>FROM</span><strong className="sender-small">{data.senderEmail || 'Not connected'}</strong></div></div><button className="primary dark-button full" disabled={busy || !data.test?.verifiedAt || data.recoveryPending || pendingWarnings.length > 0 || data.batch?.status === 'running' || data.batch?.status === 'complete'} onClick={startSend}><Send size={17}/>{data.batch?.status === 'paused' ? 'Resume remaining emails' : 'Send all parent emails'}</button><p className="muted-caption">Sending begins immediately after you press this button.</p></section>
            {data.batch && <section className="panel delivery-panel"><div className="panel-title-row"><div><h2>Delivery progress</h2><p>{data.batch.status === 'complete' ? 'This mailing is complete.' : data.batch.status === 'paused' ? (data.batch.error || 'Sending paused.') : 'Sending individual messages…'}</p></div><span className={'badge ' + (data.batch.status === 'complete' ? 'green' : 'amber')}>{data.batch.status}</span></div><div className="delivery-list">{sendableStudents.map(s => { const d = data.deliveries[s.registration]; return <div key={s.registration}><span>{s.name}<small>{parentMap.get(s.registration)?.email}</small></span><span className={'status-tag ' + (d?.status || 'pending')}>{d?.status || 'pending'}</span>{d?.status === 'uncertain' && <span className="resolve-actions"><button onClick={() => resolve(s.registration, 'sent')}>Mark sent</button><button onClick={() => resolve(s.registration, 'retry')}>Retry</button><button onClick={() => resolve(s.registration, 'skipped')}>Skip</button></span>}</div>; })}</div></section>}
          </>}
          <div className="bottom-actions"><button className="ghost" onClick={() => setStep(3)}><ArrowLeft size={17}/> Back to review</button></div>
          </div>
        </>}
      </div>
    </main>
    {editing && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit email draft"><div className="editor-modal"><div className="modal-header"><div><span>MESSAGE EDITOR</span><h2>Edit your email draft</h2></div><button className="icon-button" onClick={() => setEditing(false)} aria-label="Close"><X size={21}/></button></div><div className="editor-body"><label>Subject line<input value={template.subject} onChange={e => setTemplate({ ...template, subject: e.target.value })}/></label><label>Email body<textarea value={template.body} onChange={e => setTemplate({ ...template, body: e.target.value })}/></label><div className="token-hint">Use <code>[Student Name]</code>, <code>[Registration Number]</code>, and <code>{'{{attendance_details}}'}</code>. The attendance token is required.</div></div><div className="modal-footer"><button className="ghost" onClick={() => setEditing(false)}>Cancel</button><button className="primary" disabled={busy} onClick={saveTemplate}><Save size={17}/> Save draft</button></div></div></div>}
    <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div className={'toast ' + toast.tone + (toast.leaving ? ' leaving' : '')} key={toast.id} role="status">{toast.tone === 'error' ? <CircleAlert size={18}/> : <CheckCircle2 size={18}/>}<span>{toast.message}</span><button onClick={() => dismissToast(toast.id)} aria-label="Dismiss"><X size={16}/></button><i className={'toast-life ' + (toast.life > 4000 ? 'long' : 'short')}/></div>)}</div>
  </div>;
}

function UploadStage({ icon, title, caption, dropTitle, help, onFile, busy, onCancel }) {
  return <section className="panel upload-stage"><div className="panel-heading"><div><h2>{title}</h2><p>{caption}</p></div>{icon}</div><FileDrop title={dropTitle} subtitle="or browse files on your computer" onFile={onFile} busy={busy}/><div className="file-help">{help}</div>{onCancel && <button className="ghost upload-cancel" onClick={onCancel}>Cancel and keep current records</button>}</section>;
}
function FileDrop({ title, subtitle, onFile, busy }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  return <div className={'dropzone ' + (drag ? 'dragging' : '')} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }} onClick={() => ref.current?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') ref.current?.click(); }}>
    <input ref={ref} type="file" accept=".xlsx" hidden onChange={e => { onFile(e.target.files[0]); e.target.value = ''; }}/><span className="upload-icon"><CloudUpload size={27}/></span><strong>{busy ? 'Importing…' : title}</strong><span>{subtitle}</span><button type="button" className="browse-button" onClick={e => { e.stopPropagation(); ref.current?.click(); }}>Browse files <ArrowRight size={15}/></button>
  </div>;
}
function StudentCard({ student, parent, selected, onSelect, onRow, onParent, disabled, subjectsOnly }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(parent?.email || '');
  const [name, setName] = useState(parent?.studentName || '');
  useEffect(() => { setEmail(parent?.email || ''); setName(parent?.studentName || ''); }, [parent?.email, parent?.studentName]);
  return <div className={'student-card ' + (selected ? 'selected' : '')}><button className="student-summary" onClick={() => { setOpen(!open); onSelect(); }}><span className="student-avatar">{student.name.charAt(0)}</span><span className="student-main"><strong>{student.name}</strong><small>{student.registration}</small></span>{!subjectsOnly && <span className="student-recipient">{parent?.email || 'No parent match'}</span>}<span className="subject-count">{student.rows.filter(r => r.included).length} subjects</span><ChevronDown size={18} className={open ? 'rotate' : ''}/></button>{open && <div className="student-detail">{!subjectsOnly && <><div className="detail-heading">PARENT CONTACT</div><div className="parent-edit"><input aria-label="Parent name" value={name} onChange={e => setName(e.target.value)} placeholder="Parent list student name" disabled={!parent || disabled}/><input aria-label="Parent email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Parent email" disabled={!parent || disabled}/><button className="small-button" disabled={!parent || disabled || (email === parent.email && name === parent.studentName)} onClick={() => onParent(parent, { email, studentName: name })}>Save contact</button></div></>}<div className={'detail-heading' + (subjectsOnly ? '' : ' subjects-heading')}>LOW ATTENDANCE SUBJECTS</div>{student.rows.map(row => <SubjectRow key={row.id} row={row} onSave={onRow} disabled={disabled}/>)}</div>}</div>;
}
function ParentCard({ parent, student, attendanceReady, onParent, disabled }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(parent.email || '');
  const [name, setName] = useState(parent.studentName || '');
  useEffect(() => { setEmail(parent.email || ''); setName(parent.studentName || ''); }, [parent.email, parent.studentName]);
  const dirty = email !== parent.email || name !== parent.studentName;
  const matched = Boolean(student);
  const nameDiffers = matched && student.name.trim().toUpperCase() !== name.trim().toUpperCase();
  return <div className="student-card"><button className="student-summary" onClick={() => setOpen(!open)}><span className="student-avatar">{(parent.studentName || '?').charAt(0)}</span><span className="student-main"><strong>{parent.studentName || 'Unnamed student'}</strong><small>{parent.registration}</small></span><span className="student-recipient">{parent.email || 'No email'}</span><span className={'subject-count' + (matched || !attendanceReady ? '' : ' muted-count')}>{!attendanceReady ? 'Saved' : matched ? 'Matched' : 'Unmatched'}</span><ChevronDown size={18} className={open ? 'rotate' : ''}/></button>{open && <div className="student-detail contact-detail"><div className="contact-fields"><label>Student name<input value={name} onChange={e => setName(e.target.value)} disabled={disabled}/></label><label>Registration number<input value={parent.registration} readOnly/></label><label>Parent email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="parent@email.com" disabled={disabled}/></label></div>{attendanceReady && <p className="detail-note">{matched ? (nameDiffers ? `Attendance lists this registration as “${student.name}”.` : `Matched to ${student.name} in the attendance report.`) : 'No attendance row uses this registration number.'}</p>}<button className="small-button contact-save" disabled={disabled || !dirty} onClick={() => onParent(parent, { email, studentName: name })}>Save contact</button></div>}</div>;
}
function SubjectRow({ row, onSave, disabled }) {
  const [subject, setSubject] = useState(row.subject);
  useEffect(() => setSubject(row.subject), [row.subject]);
  return <div className="subject-row"><input type="checkbox" checked={row.included} onChange={e => onSave(row, { included: e.target.checked })} disabled={disabled}/><span className="subject-code">{row.code}</span><input className="subject-name" aria-label={'Subject name for ' + row.code} value={subject} placeholder="Add subject name" onChange={e => setSubject(e.target.value)} disabled={disabled}/><strong className={row.percentage === 0 ? 'zero' : ''}>{money(row.percentage)}</strong><button className="small-button" disabled={disabled || subject === row.subject} onClick={() => onSave(row, { subject })}>Save</button></div>;
}

createRoot(document.getElementById('root')).render(<App/>);

import ExcelJS from 'exceljs';

export const DEFAULT_SUBJECT = 'Attendance shortage notice — [Student Name] ([Registration Number])';
export const DEFAULT_BODY = `Dear Parent/Guardian,

Greetings from SRM Institute of Science and Technology.

I am writing to inform you that the attendance percentage of your ward, [Student Name] (Reg. No: [Registration Number]), is currently below the minimum required attendance of 75% in one or more subjects.

{{attendance_details}}

As per the academic regulations of the University, students are expected to maintain the prescribed attendance percentage in all courses. Continuous shortage of attendance may result in the student being detained/debarred from appearing for assessments or examinations in the concerned subject(s).

As the Faculty Advisor for the class, it is my responsibility to periodically communicate the attendance status of students to their parents/guardians. I kindly request you to counsel your ward regarding the importance of regular class attendance and ensure that they attend all forthcoming classes without fail.

We seek your cooperation in helping your ward improve their attendance and avoid any academic complications.

For any clarification regarding the attendance details, please feel free to contact me.

Thank you for your understanding and support.

Warm regards,

Dr. G. Balamurugan
Associate Professor
Faculty Advisor
Department of Computing Technologies (CTECH)
SRM Institute of Science and Technology
Kattankulathur Campus`;

export const emptyState = () => ({
  version: 1,
  senderEmail: '',
  appPassword: '',
  attendance: [],
  parents: [],
  pendingParents: null,
  template: { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY },
  acknowledgements: [],
  test: null,
  deliveries: {},
  batch: null,
  updatedAt: new Date().toISOString()
});

export function publicState(state) {
  const { appPassword, ...safe } = state;
  return { ...safe, hasPassword: Boolean(appPassword), warnings: warnings(state) };
}

const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const regKey = value => clean(value).toUpperCase();
export const validEmail = value => /^[^\s@,<>;"()]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(clean(value));
const display = cell => {
  const value = cell?.value;
  if (value && typeof value === 'object') {
    if ('result' in value) return clean(value.result);
    if ('text' in value) return clean(value.text);
  }
  return clean(value);
};

async function rowsFromWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.length > 10 * 1024 * 1024) {
    throw new Error('Choose an .xlsx file smaller than 10 MB.');
  }
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch { throw new Error('This file could not be read as an .xlsx workbook.'); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The workbook has no worksheet.');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, row => rows.push(row));
  return rows;
}

function findColumns(rows, required) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const columns = new Map();
    rows[i].eachCell((cell, col) => columns.set(key(display(cell)), col));
    if (required.every(group => group.some(label => columns.has(key(label))))) {
      return { headerIndex: i, columns: required.map(group => columns.get(key(group.find(label => columns.has(key(label))))) ) };
    }
  }
  throw new Error('The expected column headers were not found. Check that you selected the correct workbook.');
}

export async function parseAttendance(buffer) {
  const rows = await rowsFromWorkbook(buffer);
  const { headerIndex, columns: [regCol, nameCol, codeCol, subjectCol, pctCol] } = findColumns(rows, [
    ['Register Number', 'Reg. No', 'Registration Number'],
    ['Student Name', 'Name'],
    ['Subject Code', 'Course Code'],
    ['Subject Name', 'Course Name'],
    ['Attendance Percentage', 'Attendance %', 'Percentage']
  ]);
  const result = [];
  const seen = new Set();
  for (const row of rows.slice(headerIndex + 1)) {
    const reg = regKey(display(row.getCell(regCol)));
    if (!reg) continue;
    const code = display(row.getCell(codeCol));
    const subject = display(row.getCell(subjectCol));
    const pctCell = row.getCell(pctCol);
    const raw = display(pctCell).replace(/%$/, '');
    let percentage = Number(raw);
    if (pctCell.numFmt?.includes('%') && percentage >= 0 && percentage <= 1) percentage *= 100;
    if (!code || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error(`Invalid subject code or attendance percentage on row ${row.number}.`);
    }
    if (percentage >= 75) continue;
    const id = `${reg}|${code}`;
    if (seen.has(id)) throw new Error(`Duplicate registration and subject code on row ${row.number}: ${reg}, ${code}.`);
    seen.add(id);
    result.push({
      id, registration: reg, studentName: display(row.getCell(nameCol)), code, subject,
      percentage: Math.round(percentage * 100) / 100,
      included: !(/^21GNP301L\b/i.test(code) && percentage === 0)
    });
  }
  if (!result.length) throw new Error('No below-75% attendance rows were found.');
  return result;
}

export async function parseParents(buffer) {
  const rows = await rowsFromWorkbook(buffer);
  const { headerIndex, columns: [regCol, nameCol, emailCol] } = findColumns(rows, [
    ['Reg. No', 'Register Number', 'Registration Number'],
    ['Name', 'Student Name'],
    ['Parent Email', 'Parents Email', 'Email']
  ]);
  const result = [];
  const seen = new Set();
  for (const row of rows.slice(headerIndex + 1)) {
    const registration = regKey(display(row.getCell(regCol)));
    if (!registration) continue;
    if (seen.has(registration)) throw new Error(`Duplicate registration number on row ${row.number}: ${registration}.`);
    seen.add(registration);
    result.push({ registration, studentName: display(row.getCell(nameCol)), email: display(row.getCell(emailCol)) });
  }
  if (!result.length) throw new Error('No parent records were found.');
  return result;
}

export function parentChanges(current, incoming) {
  const old = new Map(current.map(p => [p.registration, p]));
  return incoming.flatMap(p => {
    const before = old.get(p.registration);
    const fields = before ? {
      studentName: clean(before.studentName).replace(/\s+/gu, ' ') !== clean(p.studentName).replace(/\s+/gu, ' '),
      email: clean(before.email) !== clean(p.email)
    } : { studentName: true, email: true };
    return fields.studentName || fields.email
      ? [{ registration: p.registration, before: before ?? null, after: p, fields }]
      : [];
  });
}

export function mergeParents(current, incoming, changes = parentChanges(current, incoming)) {
  const merged = new Map(current.map(parent => [parent.registration, parent]));
  for (const { after, fields } of changes) {
    const before = merged.get(after.registration);
    merged.set(after.registration, before ? {
      ...before,
      studentName: fields.studentName ? after.studentName : before.studentName,
      email: fields.email ? after.email : before.email
    } : after);
  }
  return [...merged.values()];
}

export function students(state) {
  const byReg = new Map();
  for (const row of state.attendance) {
    if (!byReg.has(row.registration)) byReg.set(row.registration, { registration: row.registration, name: row.studentName, rows: [], parent: null });
    byReg.get(row.registration).rows.push(row);
  }
  const parents = new Map(state.parents.map(p => [p.registration, p]));
  return [...byReg.values()].map(student => ({ ...student, parent: parents.get(student.registration) ?? null }));
}

export function warnings(state) {
  const acknowledged = new Set(state.acknowledgements);
  const issues = [];
  for (const student of students(state)) {
    const parent = student.parent;
    if (!parent) issues.push({ id: `parent:${student.registration}`, registration: student.registration, kind: 'block', text: 'No parent record found', resolved: false });
    else {
      if (!validEmail(parent.email)) issues.push({ id: `email:${student.registration}`, registration: student.registration, kind: 'block', text: 'Parent email is missing or invalid', resolved: false });
      else if (/gmaill\.com$/i.test(parent.email)) {
        const id = `email:${student.registration}`;
        issues.push({ id, registration: student.registration, kind: 'review', text: `Check unusual address: ${parent.email}`, resolved: acknowledged.has(id) });
      }
      if (clean(parent.studentName).toUpperCase() !== clean(student.name).toUpperCase()) {
        issues.push({
          id: `name:${student.registration}`, registration: student.registration, kind: 'name',
          text: 'Names differ. Choose which name the email should use.',
          attendanceName: student.name, parentName: parent.studentName, resolved: false
        });
      }
    }
    for (const row of student.rows.filter(r => r.included)) {
      if (!row.subject) {
        const id = `subject:${row.id}`;
        issues.push({ id, registration: student.registration, kind: 'review', text: `Subject name is blank for ${row.code}; code will be shown`, resolved: acknowledged.has(id) });
      }
    }
  }
  return issues;
}

export function applyStudentName(state, registration, name) {
  const student = students(state).find(item => item.registration === registration);
  if (!student?.parent) throw new Error('Parent record not found.');
  const picked = clean(name);
  const choices = [clean(student.name), clean(student.parent.studentName)];
  if (!picked || !choices.includes(picked)) throw new Error('Choose one of the two listed names.');
  student.parent.studentName = picked;
  for (const row of student.rows) row.studentName = picked;
  state.acknowledgements = state.acknowledgements.filter(id => id !== `name:${student.registration}`);
}

export function validateReady(state) {
  if (!validEmail(state.senderEmail) || !state.appPassword) throw new Error('Enter a valid sender email and app password.');
  if (!state.attendance.length) throw new Error('Upload the attendance workbook.');
  if (!state.parents.length) throw new Error('Upload the parent workbook.');
  if (state.pendingParents) throw new Error('Review and accept the pending parent changes.');
  if (warnings(state).some(w => !w.resolved)) throw new Error('Resolve or accept every data warning before sending.');
  if (!state.template.subject.trim() || !state.template.body.trim()) throw new Error('The email subject and body are required.');
  if (!state.template.body.includes('{{attendance_details}}')) throw new Error('Keep {{attendance_details}} in the email body so parents receive the percentages.');
  if (!students(state).some(s => s.rows.some(r => r.included))) throw new Error('Include at least one subject.');
}

export function requireVerifiedTest(state, currentFingerprint) {
  if (!state.test || state.test.fingerprint !== currentFingerprint) {
    throw new Error('Send a successful test email for the current data and draft first.');
  }
  if (!state.test.verifiedAt) {
    throw new Error('Check the test email in your alternate inbox and verify it before sending to parents.');
  }
}

export function mailFor(state, registration) {
  const student = students(state).find(s => s.registration === registration);
  if (!student) throw new Error('Student not found.');
  const included = student.rows.filter(row => row.included);
  if (!included.length) throw new Error('This student has no included subjects.');
  const details = 'Attendance details:\n' + included.map(row => `• ${row.subject || row.code} (${row.code}): ${row.percentage.toFixed(2)}%`).join('\n');
  const replace = text => text
    .replaceAll('[Student Name]', student.name)
    .replaceAll('[Registration Number]', student.registration)
    .replaceAll('{{attendance_details}}', details);
  return { to: student.parent?.email ?? '', subject: replace(state.template.subject), text: replace(state.template.body), registration };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { emptyState, parseAttendance, parseParents, parentChanges, mergeParents, warnings, mailFor, validateReady, requireVerifiedTest, applyStudentName } from '../server/model.js';

async function workbook(rows) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet1');
  rows.forEach(row => sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer());
}

test('imports the supplied column layouts and keeps Community Connect excluded', async () => {
  const attendance = await parseAttendance(await workbook([
    ['Institution'],
    ['S.No', 'Register Number', 'Student Name', 'Subject Code', 'Subject Name', 'Attendance Percentage'],
    [1, 'RA001', 'Student One', 'CODE1', 'Networks', 73.08],
    [2, 'RA001', 'Student One', '21GNP301L', 'Community Connect', 0],
    [3, 'RA002', 'Student Two', 'CODE2', 'Mathematics', 74.9],
    [4, 'RA002', 'Student Two', 'CODE3', 'Above minimum', 75]
  ]));
  const parents = await parseParents(await workbook([
    ['Sl.no', 'Reg. No', 'Name', 'Parent Email'],
    [1, 'RA001', 'Student One', 'one@example.com'],
    [2, 'RA002', 'Student Two', 'two@example.com']
  ]));
  assert.equal(attendance.length, 3);
  assert.equal(attendance.find(row => row.code === '21GNP301L').included, false);
  assert.equal(parents.length, 2);
  const state = { ...emptyState(), senderEmail: 'faculty@gmail.com', appPassword: 'app-password', attendance, parents };
  validateReady(state);
  const message = mailFor(state, 'RA001');
  assert.equal(message.to, 'one@example.com');
  assert.match(message.subject, /Student One \(RA001\)/);
  assert.match(message.text, /Networks \(CODE1\): 73\.08%/);
  assert.doesNotMatch(message.text, /Community Connect/);
});

test('requires resolution of mismatched names, blank subjects, and suspicious addresses', async () => {
  const state = { ...emptyState(), senderEmail: 'faculty@gmail.com', appPassword: 'app-password',
    attendance: [{ id: 'RA001|CODE1', registration: 'RA001', studentName: 'Student One', code: 'CODE1', subject: '', percentage: 60, included: true }],
    parents: [{ registration: 'RA001', studentName: 'Different Name', email: 'one@gmaill.com' }] };
  const issues = warnings(state);
  assert.deepEqual(issues.map(issue => issue.id).sort(), ['email:RA001', 'name:RA001', 'subject:RA001|CODE1']);
  assert.equal(issues.find(issue => issue.id === 'name:RA001').attendanceName, 'Student One');
  assert.equal(issues.find(issue => issue.id === 'name:RA001').parentName, 'Different Name');
  assert.throws(() => validateReady(state), /Resolve or accept/);
  state.acknowledgements = issues.map(issue => issue.id);
  assert.throws(() => validateReady(state), /Resolve or accept/);
  applyStudentName(state, 'RA001', 'Different Name');
  assert.equal(state.attendance[0].studentName, 'Different Name');
  assert.equal(state.parents[0].studentName, 'Different Name');
  assert.equal(warnings(state).some(issue => issue.id === 'name:RA001'), false);
  state.acknowledgements = warnings(state).map(issue => issue.id);
  validateReady(state);
  assert.match(mailFor(state, 'RA001').text, /Different Name/);
  assert.match(mailFor(state, 'RA001').text, /CODE1 \(CODE1\): 60\.00%/);
});

test('rejects duplicate student-subject rows rather than silently sending conflicting percentages', async () => {
  const file = await workbook([
    ['Register Number', 'Student Name', 'Subject Code', 'Subject Name', 'Attendance Percentage'],
    ['RA001', 'Student One', 'CODE1', 'Networks', 73],
    ['RA001', 'Student One', 'CODE1', 'Networks', 65]
  ]);
  await assert.rejects(parseAttendance(file), /Duplicate registration and subject code/);
});

test('imports formatted percentages and cached formula results', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Attendance');
  sheet.addRow(['Register Number', 'Student Name', 'Subject Code', 'Subject Name', 'Attendance Percentage']);
  sheet.addRow(['RA001', 'Student One', 'CODE1', 'Networks']);
  sheet.getCell('E2').value = { formula: '70/100', result: 0.7 };
  sheet.getCell('E2').numFmt = '0%';
  const rows = await parseAttendance(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(rows[0].percentage, 70);
});

test('contact review reports the fields that actually changed', () => {
  const current = [{ registration: 'RA001', studentName: 'R M SUBASH', email: 'parent@example.com' }];
  const nameOnly = [{ registration: 'RA001', studentName: 'R. M. SUBASH', email: 'parent@example.com' }];
  assert.deepEqual(parentChanges(current, nameOnly).map(change => change.fields), [{ studentName: true, email: false }]);
  const emailOnly = [{ registration: 'RA001', studentName: 'R M SUBASH', email: 'new@example.com' }];
  assert.deepEqual(parentChanges(current, emailOnly).map(change => change.fields), [{ studentName: false, email: true }]);
  assert.deepEqual(parentChanges(current, [{ registration: 'RA002', studentName: 'New Student', email: 'new@example.com' }]).map(change => change.before), [null]);
});

test('contact import ignores spacing-only changes and keeps saved records absent from the sheet', () => {
  const current = [
    { registration: 'RA001', studentName: 'R M SUBASH', email: 'parent@example.com' },
    { registration: 'RA002', studentName: 'Another Student', email: 'other@example.com' }
  ];
  const spacingOnly = [{ registration: 'RA001', studentName: 'R  M   SUBASH', email: 'parent@example.com' }];
  assert.deepEqual(parentChanges(current, spacingOnly), []);
  assert.deepEqual(mergeParents(current, spacingOnly), current);

  const updatedEmail = [{ ...spacingOnly[0], email: 'updated@example.com' }];
  assert.deepEqual(mergeParents(current, updatedEmail), [
    { ...current[0], email: 'updated@example.com' },
    current[1]
  ]);

  const staged = parentChanges(current, updatedEmail);
  const laterCurrent = [current[0], { ...current[1], email: 'corrected@example.com' }];
  assert.deepEqual(mergeParents(laterCurrent, staged.map(change => change.after)), [
    { ...current[0], email: 'updated@example.com' },
    laterCurrent[1]
  ]);
});

test('parent delivery requires confirmation of the current test email', () => {
  const state = emptyState();
  assert.throws(() => requireVerifiedTest(state, 'current'), /successful test email/);
  state.test = { fingerprint: 'old', sentAt: '2026-09-29T00:00:00.000Z' };
  assert.throws(() => requireVerifiedTest(state, 'current'), /successful test email/);
  state.test.fingerprint = 'current';
  assert.throws(() => requireVerifiedTest(state, 'current'), /verify it/);
  state.test.verifiedAt = '2026-09-29T00:01:00.000Z';
  assert.doesNotThrow(() => requireVerifiedTest(state, 'current'));
});

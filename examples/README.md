# Workbook layout examples

Use these sample layouts when preparing `.xlsx` files. The names, registration numbers, and addresses below are fictitious. Save each table as the first worksheet in its own Excel workbook.

## Attendance report

The app looks for these headers within the first 30 populated rows, so the institutional title rows in an exported report may remain above them.

| S.No | Register Number | Student Name | Subject Code | Subject Name | Attendance Percentage |
| --- | --- | --- | --- | --- | --- |
| 1 | EXAMPLE001 | Sample Student | CSE101 | Computer Networks | 73.08 |
| 2 | EXAMPLE001 | Sample Student | MAT101 | Discrete Mathematics | 71.43 |

Only rows below 75% are used. The `21GNP301L` Community Connect 0% rows are imported but excluded from messages until enabled during review.

## Parent directory

| Sl.no | Reg. No | Name | Parent Email |
| --- | --- | --- | --- |
| 1 | EXAMPLE001 | Sample Student | parent@example.com |

The registration number is the matching key. Real workbooks belong outside the public Git repository.

/**
 * API cho web LMS_Ques. Dán file này vào Apps Script của file Google Sheet question bank
 * (Tiện ích mở rộng > Apps Script), rồi Deploy > New deployment > Web app.
 *
 * Nhiều môn: mỗi môn là 1 trang tính (tab) trong file này, tên tab = tên môn hiện trên web.
 * Tab nào có đủ các cột "STT", "Câu hỏi", "Phương án A..D", "Đáp án đúng" thì được tính là 1 môn.
 */

const EXAM_SIZE = 40;
const LOG_EXAM = 'Log_Exam';
const LOG_PRACTICE = 'Log_Practice';
const SUBJECT_HEADER = 'Môn học'; // cột thứ 3 trong 2 trang log

const LOG_EXAM_HEADERS = [
  'Thời gian nộp', 'Họ và tên', SUBJECT_HEADER, 'Điểm số (Thang 10)', 'Số câu đúng',
  'Số câu sai', 'Tổng số câu', 'Thời gian làm bài'
];
const LOG_PRACTICE_HEADERS = [
  'Thời gian nộp', 'Họ và tên', SUBJECT_HEADER, 'Chuỗi đúng', 'Chuỗi thua',
  'Số câu đúng', 'Số câu sai', 'Tổng số câu'
];

const BANK_HEADERS = {
  id: 'stt',
  q: 'câu hỏi',
  a: 'phương án a',
  b: 'phương án b',
  c: 'phương án c',
  d: 'phương án d',
  ans: 'đáp án đúng'
};

// ---------- Entry points ----------

function doGet(e) {
  try {
    const action = (e.parameter.action || '').toString();

    if (action === 'subjects') {
      return json({ status: 'ok', subjects: listSubjects() });
    }

    const bank = loadBank(e.parameter.subject);

    if (action === 'practice') {
      return json({ status: 'ok', questions: bank });
    }

    if (action === 'exam') {
      const picked = shuffle(bank).slice(0, EXAM_SIZE).map(function (q) {
        return { id: q.id, q: q.q, a: q.a, b: q.b, c: q.c, d: q.d }; // không gửi đáp án
      });
      return json({ status: 'ok', questions: picked });
    }

    return json({ status: 'error', message: 'Action không hợp lệ' });
  } catch (err) {
    return json({ status: 'error', message: err.message });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    // Dữ liệu từ web HUB (nhập câu hỏi): xử lý bởi importQuestions trong file HUB.gs cùng dự án
    if (!data.action && Array.isArray(data.questions)) {
      if (typeof importQuestions === 'function') return importQuestions(e);
      return json({ status: 'error', message: 'Chưa thêm file HUB.gs (hàm importQuestions) vào dự án Apps Script' });
    }
    if (data.action === 'submitExam') return json(submitExam(data));
    if (data.action === 'savePractice') return json(savePractice(data));
    return json({ status: 'error', message: 'Action không hợp lệ' });
  } catch (err) {
    return json({ status: 'error', message: err.message });
  }
}

// ---------- Actions ----------

// Danh sách môn: [{ name, count }]
function listSubjects() {
  const result = [];
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sheet) {
    if (isLogSheet(sheet)) return;
    const questions = parseBank(sheet);
    if (questions && questions.length) result.push({ name: sheet.getName(), count: questions.length });
  });
  return result;
}

function submitExam(data) {
  const ids = (data.ids || []).slice(0, EXAM_SIZE).map(String);
  if (!ids.length) throw new Error('Bài làm rỗng');
  const answers = data.answers || {};

  const byId = {};
  loadBank(data.subject).forEach(function (q) { byId[q.id] = q; });

  const key = {};
  let correct = 0;
  ids.forEach(function (id) {
    const q = byId[id];
    if (!q) return;
    key[id] = q.ans;
    if (answers[id] === q.ans) correct++;
  });

  const total = ids.length;
  const wrong = total - correct;
  const score = Math.round((correct / total) * 10 * 100) / 100;
  const durationSec = toInt(data.durationSec);

  appendLog(LOG_EXAM, LOG_EXAM_HEADERS, [
    new Date(), cleanText(data.name), cleanText(data.subject), score, correct, wrong, total,
    formatDuration(durationSec)
  ]);

  return { status: 'ok', score: score, correct: correct, wrong: wrong, total: total, key: key };
}

function savePractice(data) {
  const correct = toInt(data.correct);
  const wrong = toInt(data.wrong);
  if (correct + wrong === 0) return { status: 'ok' };

  appendLog(LOG_PRACTICE, LOG_PRACTICE_HEADERS, [
    new Date(), cleanText(data.name), cleanText(data.subject),
    toInt(data.maxCorrectStreak), toInt(data.maxWrongStreak), correct, wrong, correct + wrong
  ]);
  return { status: 'ok' };
}

// ---------- Helpers ----------

function isLogSheet(sheet) {
  const name = sheet.getName();
  return name === LOG_EXAM || name === LOG_PRACTICE;
}

// Câu hỏi của 1 môn (tên tab). Không tìm thấy thì báo lỗi.
function loadBank(subject) {
  const name = String(subject || '').trim();
  if (!name) throw new Error('Chưa chọn môn học');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  const questions = sheet && !isLogSheet(sheet) ? parseBank(sheet) : null;
  if (!questions) throw new Error('Không tìm thấy môn "' + name + '"');
  return questions;
}

// Đọc 1 tab thành danh sách câu hỏi. Tab không có đủ cột thì trả về null.
function parseBank(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  for (let r = 0; r < Math.min(5, values.length); r++) {
    const head = values[r].map(norm);
    const col = {};
    Object.keys(BANK_HEADERS).forEach(function (k) { col[k] = head.indexOf(BANK_HEADERS[k]); });
    if (Object.keys(col).some(function (k) { return col[k] < 0; })) continue;

    const questions = [];
    const seen = {};
    for (let i = r + 1; i < values.length; i++) {
      const row = values[i];
      const id = row[col.id].trim();
      const text = row[col.q].trim();
      const ans = row[col.ans].trim().toUpperCase().charAt(0);
      if (!id || !text || !ans || 'ABCD'.indexOf(ans) < 0) continue;
      if (seen[id]) continue; // STT trùng: chỉ lấy câu đầu tiên
      seen[id] = true;
      questions.push({
        id: id, // STT
        q: text,
        a: row[col.a].trim(),
        b: row[col.b].trim(),
        c: row[col.c].trim(),
        d: row[col.d].trim(),
        ans: ans
      });
    }
    return questions;
  }
  return null;
}

function appendLog(name, headers, row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    } else if (sheet.getRange(1, 3).getDisplayValue() !== SUBJECT_HEADER) {
      // Trang log cũ (trước khi có nhiều môn): chèn cột "Môn học" vào vị trí thứ 3
      sheet.insertColumnAfter(2);
      sheet.getRange(1, 3).setValue(SUBJECT_HEADER).setFontWeight('bold');
    }
    sheet.appendRow(row);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  } finally {
    lock.releaseLock();
  }
}

function norm(s) {
  return String(s).normalize('NFC').trim().toLowerCase();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

// Chặn chữ bắt đầu bằng = + - @ bị Sheet hiểu thành công thức.
function cleanText(text) {
  const s = String(text || '').trim().slice(0, 100) || '(không rõ)';
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ' phút ' + s + ' giây';
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

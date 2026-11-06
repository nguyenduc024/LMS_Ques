// Trang chủ + gắn sự kiện chung.

function loadPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* bỏ qua */ }
}

$('name').value = loadPref('lms_name', '');
$('time').value = loadPref('lms_time', '60');

// Phát nhạc khi làm bài: Có / Không
Music.init();
const musicPref = loadPref('lms_music', '0');
for (const r of document.querySelectorAll('input[name="music"]')) {
  r.checked = r.value === musicPref;
  r.addEventListener('change', () => {
    savePref('lms_music', r.value);
    Music.setEnabled(r.value === '1');
  });
}
Music.setEnabled(musicPref === '1');

function setHomeStatus(text, isError) {
  $('home-status').className = 'status' + (isError ? ' error' : '');
  $('home-status').textContent = text;
}

// Danh sách môn học = các tab câu hỏi trong Google Sheet
async function loadSubjects() {
  const select = $('subject');
  select.replaceChildren(el('option', { value: '', text: 'Đang tải danh sách môn...' }));
  select.disabled = true;
  try {
    const { subjects } = await apiGet('subjects');
    if (!subjects.length) {
      select.replaceChildren(el('option', { value: '', text: 'Chưa có môn nào' }));
      return;
    }
    const saved = loadPref('lms_subject', '');
    select.replaceChildren(
      ...subjects.map((s) =>
        el('option', { value: s.name, text: s.name + ' (' + s.count + ' câu)', selected: s.name === saved })
      )
    );
    select.disabled = false;
  } catch (err) {
    select.replaceChildren(el('option', { value: '', text: 'Không tải được danh sách môn' }));
    setHomeStatus('Lỗi: ' + err.message, true);
  }
}
loadSubjects();

async function startMode(mode) {
  const name = $('name').value.trim();
  if (!name) {
    setHomeStatus('Vui lòng nhập họ và tên.', true);
    $('name').focus();
    return;
  }
  const subject = $('subject').value;
  if (!subject) {
    setHomeStatus('Vui lòng chọn môn học.', true);
    return;
  }
  savePref('lms_name', name);
  savePref('lms_subject', subject);
  savePref('lms_time', $('time').value);

  $('btn-practice').disabled = true;
  $('btn-exam').disabled = true;
  setHomeStatus('Đang tải câu hỏi...');
  try {
    if (mode === 'practice') await Practice.start(name, subject);
    else await Exam.start(name, parseInt($('time').value, 10) || 0, subject);
    setHomeStatus('');
  } catch (err) {
    setHomeStatus('Lỗi: ' + err.message, true);
  } finally {
    $('btn-practice').disabled = false;
    $('btn-exam').disabled = false;
  }
}

$('btn-practice').addEventListener('click', () => startMode('practice'));
$('btn-exam').addEventListener('click', () => startMode('exam'));

$('p-next').addEventListener('click', () => Practice.next());
$('p-finish').addEventListener('click', () => Practice.finish());

$('e-prev').addEventListener('click', () => Exam.prev());
$('e-next').addEventListener('click', () => Exam.next());
$('e-finish').addEventListener('click', () => Exam.submit(false));

$('btn-home').addEventListener('click', () => showScreen('home'));

// Thoát web giữa lúc luyện tập: gửi kết quả phiên.
window.addEventListener('pagehide', () => Practice.flushOnLeave());

// Đang làm đề mà đóng tab: hỏi lại để tránh mất bài.
window.addEventListener('beforeunload', (e) => {
  if (Exam.active) {
    e.preventDefault();
    e.returnValue = '';
  }
});

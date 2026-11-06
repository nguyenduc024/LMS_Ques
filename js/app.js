// Trang chủ + gắn sự kiện chung.

function loadPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* bỏ qua */ }
}

$('name').value = loadPref('lms_name', '');
$('time').value = loadPref('lms_time', '60');

function setHomeStatus(text, isError) {
  $('home-status').className = 'status' + (isError ? ' error' : '');
  $('home-status').textContent = text;
}

async function startMode(mode) {
  const name = $('name').value.trim();
  if (!name) {
    setHomeStatus('Vui lòng nhập họ và tên.', true);
    $('name').focus();
    return;
  }
  savePref('lms_name', name);
  savePref('lms_time', $('time').value);

  $('btn-practice').disabled = true;
  $('btn-exam').disabled = true;
  setHomeStatus('Đang tải câu hỏi...');
  try {
    if (mode === 'practice') await Practice.start(name);
    else await Exam.start(name, parseInt($('time').value, 10) || 0);
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

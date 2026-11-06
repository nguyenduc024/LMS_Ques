const LETTERS = ['A', 'B', 'C', 'D'];

function $(id) {
  return document.getElementById(id);
}

// Tạo phần tử DOM. Dùng textContent nên nội dung câu hỏi không bị chèn HTML.
function el(tag, props, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children || [])) {
    if (c != null) node.append(c);
  }
  return node;
}

function showScreen(name) {
  for (const s of document.querySelectorAll('.screen')) {
    s.hidden = s.id !== 'screen-' + name;
  }
  window.scrollTo(0, 0);
  if (typeof Music !== 'undefined') Music.onScreen(name);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 2338 -> "0:38:58"
function formatClock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function formatDuration(sec) {
  return Math.floor(sec / 60) + ' phút ' + (sec % 60) + ' giây';
}

function formatScore(n) {
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

// ---------- API ----------

async function apiGet(action) {
  if (!API_URL) throw new Error('Chưa cấu hình API_URL trong js/config.js');
  const res = await fetch(API_URL + '?action=' + encodeURIComponent(action));
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(data.message || 'Lỗi máy chủ');
  return data;
}

// Gửi text/plain để Apps Script không bị chặn CORS.
async function apiPost(payload) {
  if (!API_URL) throw new Error('Chưa cấu hình API_URL trong js/config.js');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(data.message || 'Lỗi máy chủ');
  return data;
}

// Gửi khi trang đang đóng (không chờ phản hồi).
function apiBeacon(payload) {
  if (!API_URL) return;
  const blob = new Blob([JSON.stringify(payload)], { type: 'text/plain;charset=utf-8' });
  navigator.sendBeacon(API_URL, blob);
}

// ---------- Hiển thị 1 câu hỏi theo kiểu LMS ----------
// o: { number, info[], q, selected, locked, answer, onSelect, onClear, flagged, onFlag, feedback, feedbackClass }
function renderQuestion(container, o) {
  const q = o.q;

  const info = el('div', { class: 'qinfo' }, [
    el('div', { class: 'qno' }, ['Câu hỏi ', el('b', { text: String(o.number) })]),
    ...(o.info || []).map((t) => el('div', { text: t })),
    o.onFlag
      ? el('button', {
          type: 'button',
          class: 'flag' + (o.flagged ? ' on' : ''),
          onclick: o.onFlag,
          text: o.flagged ? 'Bỏ cờ' : 'Đặt cờ'
        })
      : null
  ]);

  const options = LETTERS.map((L) => {
    let cls = 'option';
    if (o.answer) {
      if (L === o.answer) cls += ' correct';
      else if (L === o.selected) cls += ' wrong';
    }
    return el('label', { class: cls }, [
      el('input', {
        type: 'radio',
        name: 'q-' + q.id,
        value: L,
        checked: o.selected === L,
        disabled: !!o.locked,
        onchange: () => o.onSelect && o.onSelect(L)
      }),
      el('span', { class: 'letter', text: L.toLowerCase() + '.' }),
      el('span', { text: q[L.toLowerCase()] })
    ]);
  });

  const content = el('div', { class: 'qcontent' }, [
    el('p', { class: 'qtext', text: q.q }),
    el('p', { class: 'select-one', text: 'Select one:' }),
    el('div', {}, options),
    o.onClear && o.selected && !o.locked
      ? el('button', { type: 'button', class: 'clear', onclick: o.onClear, text: 'Clear my choice' })
      : null,
    o.feedback ? el('div', { class: 'feedback ' + (o.feedbackClass || ''), text: o.feedback }) : null
  ]);

  container.replaceChildren(el('div', { class: 'qwrap' }, [info, content]));
}

// Bảng tóm tắt ở màn kết quả
function renderSummary(rows) {
  $('r-summary').replaceChildren(
    ...rows.map(([k, v]) => el('tr', {}, [el('th', { text: k }), el('td', { text: String(v) })]))
  );
}

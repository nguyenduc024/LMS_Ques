// Máy nghe nhạc: vòng điều khiển kiểu iPod + hàng bìa album.
// Phát bằng trình phát YouTube nhúng được ẩn đi (YouTube IFrame API).

const ICONS = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h4v12H3zM9 2h4v12H9z"/></svg>',
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3L1 8l7 5zM15 3L8 8l7 5z"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 3l7 5-7 5zM8 3l7 5-7 5z"/></svg>'
};

// Màu cho bài không có cả ảnh bìa lẫn link YouTube
const COVER_COLORS = ['#c0392b', '#1f3a93', '#e67e22', '#16a085', '#8e44ad', '#2c3e50', '#d35400', '#27ae60'];

function iconButton(cls, icon, label, onclick) {
  const b = el('button', { type: 'button', class: cls, 'aria-label': label, onclick });
  b.innerHTML = ICONS[icon]; // chuỗi SVG cố định, không lấy từ người dùng
  return b;
}

// Cho hàng bìa tự trôi vô hạn và kéo được bằng chuột / ngón tay.
// track chứa danh sách 2 lần nối nhau; pos chạy trong [0, nửa chiều dài) rồi quay vòng.
// Ngang: trôi sang trái. Dọc: trôi từ trên xuống. Kéo theo hướng nào thì list đi theo hướng đó.
function makeScroller(box, track, vertical, secondsPerLoop) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pos = 0;
  let hover = false;
  let drag = null; // { id, start, startPos, moved }
  let suppressClick = false;
  let prev = performance.now();

  const half = () => (vertical ? track.offsetHeight : track.offsetWidth) / 2;

  function frame(now) {
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    const h = half();
    if (h) {
      if (!drag && !hover && !reduceMotion) pos += (h / secondsPerLoop) * dt;
      pos = ((pos % h) + h) % h;
      track.style.transform = vertical ? `translateY(${pos - h}px)` : `translateX(${-pos}px)`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Di chuột vào thì dừng trôi để dễ chọn bài
  box.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover = true; });
  box.addEventListener('pointerleave', () => { hover = false; });

  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, start: vertical ? e.clientY : e.clientX, startPos: pos, moved: false };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = (vertical ? e.clientY : e.clientX) - drag.start;
    if (!drag.moved && Math.abs(d) > 5) {
      drag.moved = true;
      box.setPointerCapture(e.pointerId);
      box.classList.add('dragging');
    }
    if (drag.moved) pos = vertical ? drag.startPos + d : drag.startPos - d;
  });
  const end = () => {
    if (drag && drag.moved) suppressClick = true;
    drag = null;
    box.classList.remove('dragging');
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);

  // Vừa kéo xong thì không tính là bấm chọn bài
  box.addEventListener('click', (e) => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }
  }, true);
}

function formatTime(sec) {
  if (!isFinite(sec)) return '0:00';
  sec = Math.floor(sec);
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

const Music = {
  list: typeof PLAYLIST !== 'undefined' ? PLAYLIST : [],
  idx: 0,
  playing: false,
  enabled: false,
  screen: 'home',
  centers: [],

  yt: null, // YT.Player
  ytReady: false,
  apiLoading: false,
  pending: null, // lệnh chờ khi trình phát chưa sẵn sàng: { id, autoplay }
  errors: 0, // số bài lỗi liên tiếp

  init() {
    this.makeWheel($('wheel-home'), false);
    this.makeWheel($('wheel-mini'), true);
    this.buildCovers();

    $('seek').addEventListener('input', () => {
      if (!this.ytReady) return;
      const dur = this.yt.getDuration() || 0;
      if (dur) this.yt.seekTo(($('seek').value / 1000) * dur, true);
    });

    setInterval(() => this.updateProgress(), 500);
    if (this.list.length) this.select(0, false);
  },

  // Chỉ tải YouTube khi user bật nhạc
  loadApi() {
    if (this.apiLoading) return;
    this.apiLoading = true;
    window.onYouTubeIframeAPIReady = () => {
      const playerVars = { controls: 0, playsinline: 1, rel: 0 };
      if (location.protocol.startsWith('http')) playerVars.origin = location.origin;
      this.yt = new YT.Player('yt-player', {
        width: '200',
        height: '200',
        playerVars,
        events: {
          onReady: () => { this.ytReady = true; this.flush(); },
          onStateChange: (e) => this.onState(e.data),
          onError: (e) => this.onError(e.data)
        }
      });
    };
    document.head.append(el('script', { src: 'https://www.youtube.com/iframe_api' }));
  },

  flush() {
    if (!this.ytReady || !this.pending) return;
    const { id, autoplay } = this.pending;
    this.pending = null;
    if (autoplay) this.yt.loadVideoById(id);
    else this.yt.cueVideoById(id);
  },

  onState(state) {
    if (state === YT.PlayerState.PLAYING) {
      this.playing = true;
      this.errors = 0;
      this.setNote('');
    } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.CUED) {
      this.playing = false;
    } else if (state === YT.PlayerState.ENDED) {
      this.select(this.idx + 1, true);
      return;
    }
    this.updateUI();
  },

  // Mã lỗi: https://developers.google.com/youtube/iframe_api_reference#onError
  onError(code) {
    this.playing = false;
    this.updateUI();

    // Lỗi do cách mở web (mở file trực tiếp), bài nào cũng sẽ lỗi nên không chuyển bài
    if (location.protocol === 'file:' || code === 152 || code === 153) {
      this.setNote(
        'YouTube không phát khi mở index.html trực tiếp (mã lỗi ' + code + '). ' +
        'Hãy mở web qua link đã deploy hoặc chạy node scripts/serve.mjs.'
      );
      return;
    }

    const reasons = {
      2: 'link YouTube sai',
      5: 'trình duyệt không phát được video này',
      100: 'video không tồn tại hoặc đã bị xoá',
      101: 'video chặn phát trên web khác',
      150: 'video chặn phát trên web khác'
    };
    const reason = reasons[code] || 'lỗi không rõ';

    this.errors++;
    if (this.errors >= this.list.length) {
      this.setNote('Không phát được bài nào trong danh sách (mã lỗi ' + code + ': ' + reason + ').');
      return;
    }
    this.setNote('Không phát được "' + this.track().title + '" (mã lỗi ' + code + ': ' + reason + '). Chuyển bài tiếp...');
    // Chỉ tự chuyển bài nếu user vẫn đang bật nhạc
    setTimeout(() => { if (this.enabled) this.select(this.idx + 1, true); }, 1500);
  },

  makeWheel(container, mini) {
    const center = iconButton('w-center', 'play', 'Phát / Dừng', () => this.toggle());
    this.centers.push(center);
    container.replaceChildren(
      el('div', { class: 'wheel' + (mini ? ' mini' : '') }, [
        iconButton('w-btn w-prev', 'prev', 'Bài trước', () => this.prev()),
        iconButton('w-btn w-next', 'next', 'Bài sau', () => this.next()),
        el('span', { class: 'w-label w-bottom', text: 'MEW' }),
        center
      ])
    );
  },

  buildCovers() {
    const seconds = Math.max(12, this.list.length * 3); // khoảng 3 giây mỗi bài
    for (const [box, vertical] of [[$('covers'), false], [$('mini-covers'), true]]) {
      const track = this.coverTrack(vertical);
      box.replaceChildren(track);
      if (this.list.length) makeScroller(box, track, vertical, seconds);
    }
  },

  // Vẽ danh sách 2 lần nối nhau để trôi vòng lặp liền mạch.
  // vertical = cột dọc ở máy nghe nhạc thu nhỏ.
  coverTrack(vertical) {
    const n = this.list.length;
    const items = [...this.list, ...this.list];
    const track = el('div', { class: 'covers-track' });
    track.append(
      ...items.map((t, j) => {
        const i = j % n;
        const copy = j >= n; // bản lặp chỉ để hiển thị
        const b = el('button', {
          type: 'button',
          class: 'cover',
          'aria-label': 'Phát ' + t.title,
          'aria-hidden': copy ? 'true' : false,
          tabindex: copy ? '-1' : false,
          onclick: () => this.select(i, true),
          // Chỉ vào bìa nào thì dòng bên dưới hiện tên bài / ca sĩ của bìa đó
          onmouseenter: () => this.showInfo(t),
          onmouseleave: () => this.showInfo(this.track()),
          onfocus: () => this.showInfo(t),
          onblur: () => this.showInfo(this.track())
        });
        // Ngang: bìa trước đè bìa sau. Dọc: bìa dưới đè bìa trên.
        b.style.zIndex = String(vertical ? j + 1 : 2 * n - j);
        // Không có bìa riêng thì dùng thumbnail YouTube (cắt giữa thành hình vuông)
        const img = t.cover || (t.youtube ? 'https://i.ytimg.com/vi/' + t.youtube + '/mqdefault.jpg' : '');
        if (img) {
          b.style.backgroundImage = 'url("' + encodeURI(img) + '")';
        } else {
          b.style.backgroundColor = COVER_COLORS[i % COVER_COLORS.length];
          b.append(el('span', { text: t.title }));
        }
        return b;
      })
    );
    return track;
  },

  track() {
    return this.list[this.idx];
  },

  select(i, autoplay) {
    if (!this.list.length) return;
    this.idx = (i + this.list.length) % this.list.length;
    const t = this.track();
    this.playing = false;
    this.setNote('');

    if (!t.youtube) {
      if (this.ytReady) this.yt.stopVideo();
      this.pending = null;
      this.setNote('Bài này chưa có link YouTube (thêm vào music/songs.txt).');
    } else {
      this.pending = { id: t.youtube, autoplay };
      if (autoplay) this.loadApi();
      this.flush();
    }
    this.updateUI();
  },

  play() {
    const t = this.track();
    if (!t) return;
    if (!t.youtube) {
      this.setNote('Bài này chưa có link YouTube (thêm vào music/songs.txt).');
      return;
    }
    if (!this.ytReady) {
      this.pending = { id: t.youtube, autoplay: true };
      this.setNote('Đang tải trình phát...');
      this.loadApi();
      return;
    }
    if (this.pending) this.flush();
    else this.yt.playVideo();
  },

  pause() {
    if (this.ytReady) this.yt.pauseVideo();
    if (this.pending) this.pending.autoplay = false;
    this.playing = false;
    this.updateUI();
  },

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  },

  next() {
    this.select(this.idx + 1, this.playing);
  },

  prev() {
    // Đang nghe quá 3 giây thì quay về đầu bài, giống máy nghe nhạc thật
    if (this.ytReady && this.yt.getCurrentTime() > 3) {
      this.yt.seekTo(0, true);
      return;
    }
    this.select(this.idx - 1, this.playing);
  },

  setEnabled(on) {
    this.enabled = on;
    $('music-panel').hidden = !on;
    $('home-box').classList.toggle('wide', on);
    if (on) this.loadApi();
    else this.pause();
    this.updateMini();
  },

  onScreen(name) {
    this.screen = name;
    this.updateMini();
  },

  updateMini() {
    $('mini-player').hidden = !(this.enabled && this.screen !== 'home');
  },

  showInfo(t) {
    t = t || { title: '', artist: '' };
    $('now-title').textContent = t.title || '';
    $('now-artist').textContent = t.artist ? '· ' + t.artist : '';
    $('mini-title').textContent = t.title || '';
    $('mini-artist').textContent = t.artist || '';
  },

  setNote(text) {
    $('music-note').textContent = text;
  },

  updateUI() {
    const t = this.track() || { title: '', artist: '' };
    for (const c of this.centers) {
      c.innerHTML = ICONS[this.playing ? 'pause' : 'play'];
    }
    const n = this.list.length;
    for (const box of [$('covers'), $('mini-covers')]) {
      box.querySelectorAll('.cover').forEach((c, j) => c.classList.toggle('active', j % n === this.idx));
    }
    this.showInfo(t);
    document.querySelectorAll('.wheel').forEach((w) => w.classList.toggle('playing', this.playing));
    this.updateProgress();
  },

  updateProgress() {
    let cur = 0;
    let dur = 0;
    if (this.ytReady && this.track() && this.track().youtube) {
      cur = this.yt.getCurrentTime() || 0;
      dur = this.yt.getDuration() || 0;
    }
    $('t-cur').textContent = formatTime(cur);
    $('t-dur').textContent = formatTime(dur);
    if (document.activeElement !== $('seek')) {
      $('seek').value = dur ? Math.round((cur / dur) * 1000) : 0;
    }
  }
};

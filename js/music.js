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

// Vòng tiến trình quanh đĩa (đơn vị theo viewBox 100x100 của SVG)
const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

const Music = {
  list: typeof PLAYLIST !== 'undefined' ? shuffle(PLAYLIST) : [], // xáo thứ tự mỗi lần mở web
  idx: 0,
  playing: false,
  enabled: false,
  screen: 'home',
  centers: [],
  rings: [],       // thanh tiến trình bao quanh các đĩa
  ringDrag: null,  // đang kéo vòng để tua: phần trăm 0..1
  volume: 100,

  yt: null, // YT.Player
  ytReady: false,
  apiLoading: false,
  pending: null, // lệnh chờ khi trình phát chưa sẵn sàng: { id, autoplay }
  errors: 0, // số bài lỗi liên tiếp

  // Điện thoại chỉ cho phát nhạc ngay lúc người dùng chạm. Nếu bấm play khi trình phát
  // còn đang tải, lệnh phát chạy trễ và bị chặn -> báo người dùng chạm lại.
  // unlocked = đã phát được ít nhất 1 lần, từ đó không cần kiểm tra nữa.
  unlocked: false,
  wantPlay: false,
  blockedTimer: null,

  init() {
    this.makeWheel($('wheel-home'), false);
    this.makeWheel($('wheel-mini'), true);
    this.buildCovers();
    this.setupMiniDock();

    // Thanh âm lượng dưới tên bài ở máy nghe nhạc thu nhỏ
    let saved = null;
    try { saved = localStorage.getItem('lms_volume'); } catch (e) { /* bỏ qua */ }
    this.volume = saved !== null && !isNaN(saved) ? Number(saved) : 100;
    $('mini-volume').value = this.volume;
    $('mini-volume').addEventListener('input', (e) => this.setVolume(e.target.value));

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
          onReady: () => { this.ytReady = true; this.yt.setVolume(this.volume); this.flush(); },
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
      this.unlocked = true;
      clearTimeout(this.blockedTimer);
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
    const wheel = el('div', { class: 'wheel' + (mini ? ' mini' : '') }, [
      iconButton('w-btn w-prev', 'prev', 'Bài trước', () => this.prev()),
      iconButton('w-btn w-next', 'next', 'Bài sau', () => this.next()),
      el('span', { class: 'w-label w-bottom', text: 'MEW' }),
      center
    ]);
    wheel.prepend(this.makeRing());
    container.replaceChildren(wheel);
  },

  // Vòng tiến trình bao quanh đĩa: chạy hết 1 vòng = hết bài.
  // Chạm vào vòng rồi kéo theo đường tròn để tua xuôi / ngược.
  makeRing() {
    const holder = document.createElement('div');
    holder.innerHTML = // SVG cố định, không lấy từ người dùng
      '<svg class="w-ring" viewBox="0 0 100 100" aria-hidden="true">' +
      `<circle class="w-ring-track" cx="50" cy="50" r="${RING_R}"/>` +
      `<circle class="w-ring-bar" cx="50" cy="50" r="${RING_R}"/>` +
      `<circle class="w-ring-hit" cx="50" cy="50" r="${RING_R}"/>` +
      '</svg>';
    const svg = holder.firstChild;
    const bar = svg.querySelector('.w-ring-bar');
    bar.style.strokeDasharray = RING_C;
    bar.style.strokeDashoffset = RING_C;
    this.rings.push(bar);

    // Góc của con trỏ so với tâm đĩa -> phần trăm bài hát (0 ở đỉnh, tăng theo chiều kim đồng hồ)
    const fractionAt = (e) => {
      const r = svg.getBoundingClientRect();
      let a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
      if (a < 0) a += 2 * Math.PI;
      return a / (2 * Math.PI);
    };
    const duration = () => (this.ytReady && this.track() && this.track().youtube ? this.yt.getDuration() || 0 : 0);

    const hit = svg.querySelector('.w-ring-hit');
    let pointerId = null;
    hit.addEventListener('pointerdown', (e) => {
      if (!duration()) return;
      e.preventDefault();
      e.stopPropagation();
      pointerId = e.pointerId;
      hit.setPointerCapture(pointerId);
      document.body.classList.add('ring-seeking');
      this.ringDrag = fractionAt(e);
      this.updateProgress();
    });
    hit.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      let f = fractionAt(e);
      // Không cho nhảy vòng qua đỉnh: kéo quá cuối thì dừng ở cuối, kéo lùi quá đầu thì dừng ở đầu
      if (this.ringDrag > 0.75 && f < 0.25) f = 1;
      if (this.ringDrag < 0.25 && f > 0.75) f = 0;
      this.ringDrag = f;
      this.yt.seekTo(f * duration(), false); // tua xem trước khi đang kéo
      this.updateProgress();
    });
    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      const dur = duration();
      if (dur && this.ringDrag != null) this.yt.seekTo(Math.min(this.ringDrag, 0.999) * dur, true);
      this.ringDrag = null;
      document.body.classList.remove('ring-seeking');
    };
    hit.addEventListener('pointerup', end);
    hit.addEventListener('pointercancel', end);
    return svg;
  },

  // Âm lượng 0-100, nhớ cho lần sau
  setVolume(v) {
    this.volume = Math.max(0, Math.min(100, Math.round(v)));
    try { localStorage.setItem('lms_volume', String(this.volume)); } catch (e) { /* bỏ qua */ }
    if (this.ytReady) {
      this.yt.setVolume(this.volume);
      if (this.volume > 0 && this.yt.isMuted()) this.yt.unMute();
    }
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
      if (autoplay) {
        this.wantPlay = true;
        this.watchBlocked();
      }
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
    this.wantPlay = true;
    this.watchBlocked();
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
    this.wantPlay = false;
    this.playing = false;
    this.updateUI();
  },

  // Chỉ trên màn hình cảm ứng: bấm phát mà sau 2 giây nhạc chưa chạy (bị trình duyệt chặn)
  // thì đưa đĩa về trạng thái dừng và nhắc chạm lại. Lần chạm sau trình phát đã sẵn sàng nên phát được.
  watchBlocked() {
    if (this.unlocked || !window.matchMedia('(pointer: coarse)').matches) return;
    clearTimeout(this.blockedTimer);
    this.blockedTimer = setTimeout(() => {
      if (this.unlocked || !this.wantPlay) return;
      if (!this.ytReady) return this.watchBlocked(); // trình phát chưa tải xong, chờ thêm
      const state = this.yt.getPlayerState();
      if (state === YT.PlayerState.PLAYING) return;
      if (state === YT.PlayerState.BUFFERING) return this.watchBlocked();
      this.wantPlay = false;
      this.playing = false;
      this.setNote('Chạm lại nút phát để bật nhạc.');
      this.updateUI();
    }, 2000);
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
    const box = $('mini-player');
    box.hidden = !(this.enabled && this.screen !== 'home');
    if (box.hidden) box.classList.remove('open');
  },

  // Máy nghe nhạc thu nhỏ thụt nửa đĩa vào mép trái. Rê chuột vào (hoặc chạm vào
  // trên điện thoại) thì mở ra; rời chuột / chạm ra ngoài thì thụt lại.
  setupMiniDock() {
    const box = $('mini-player');
    const open = () => box.classList.add('open');
    const close = () => {
      box.classList.remove('open');
      if (box.contains(document.activeElement)) document.activeElement.blur();
    };
    let swallowClick = false;

    box.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') open(); });
    box.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.ringDrag == null) close();
    });
    // Kéo vòng tua / cột bìa rồi thả chuột ở ngoài thì cũng thụt lại
    document.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && box.classList.contains('open')) {
        setTimeout(() => { if (!box.matches(':hover')) close(); }, 0);
      }
    });

    // Cảm ứng: lần chạm đầu khi đĩa đang thụt chỉ để kéo đĩa ra, không bấm nút / tua
    box.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || box.classList.contains('open')) return;
      e.preventDefault();
      e.stopPropagation();
      swallowClick = true;
      open();
    }, true);
    box.addEventListener('click', (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && !box.contains(e.target)) close();
    });

    // Bàn phím: Tab vào thì mở, Tab ra ngoài thì đóng
    box.addEventListener('focusin', open);
    box.addEventListener('focusout', (e) => {
      if (!box.contains(e.relatedTarget) && !box.matches(':hover')) box.classList.remove('open');
    });
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
    // Đang kéo vòng để tua thì hiện theo vị trí đang kéo
    if (this.ringDrag != null && dur) cur = this.ringDrag * dur;
    $('t-cur').textContent = formatTime(cur);
    $('t-dur').textContent = formatTime(dur);
    if (document.activeElement !== $('seek')) {
      $('seek').value = dur ? Math.round((cur / dur) * 1000) : 0;
    }
    const f = dur ? Math.min(1, cur / dur) : 0;
    for (const bar of this.rings) bar.style.strokeDashoffset = RING_C * (1 - f);
  }
};

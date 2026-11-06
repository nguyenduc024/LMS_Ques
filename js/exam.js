// Luồng 2: đề 40 câu xáo trộn, chấm điểm ở server.
const Exam = {
  async start(name, minutes, subject) {
    const data = await apiGet('exam', { subject });
    if (!data.questions.length) throw new Error('Môn này chưa có câu hỏi');

    this.name = name;
    this.subject = subject;
    this.questions = data.questions;
    this.answers = {};
    this.flags = {};
    this.idx = 0;
    this.limitSec = minutes * 60; // 0 = không giới hạn
    this.startTime = Date.now();
    this.submitting = false;
    this.active = true;

    $('e-timer-label').textContent = this.limitSec ? 'Thời gian còn lại' : 'Thời gian làm bài';
    $('e-status').textContent = '';
    this.buildGrid();
    showScreen('exam');
    this.render();
    this.startTimer();
  },

  elapsed() {
    return Math.floor((Date.now() - this.startTime) / 1000);
  },

  startTimer() {
    clearInterval(this.timer);
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
  },

  tick() {
    const e = this.elapsed();
    if (!this.limitSec) {
      $('e-timer').textContent = formatClock(e);
      return;
    }
    const remain = this.limitSec - e;
    $('e-timer').textContent = formatClock(Math.max(0, remain));
    if (remain <= 0) this.submit(true);
  },

  buildGrid() {
    $('e-grid').replaceChildren(
      ...this.questions.map((q, i) =>
        el('button', { type: 'button', class: 'cell', onclick: () => this.go(i), text: String(i + 1) })
      )
    );
  },

  updateGrid() {
    [...$('e-grid').children].forEach((cell, i) => {
      const id = this.questions[i].id;
      cell.classList.toggle('answered', !!this.answers[id]);
      cell.classList.toggle('flagged', !!this.flags[id]);
      cell.classList.toggle('current', i === this.idx);
    });
  },

  go(i) {
    this.idx = i;
    this.render();
  },

  render() {
    const q = this.questions[this.idx];
    const selected = this.answers[q.id] || null;

    renderQuestion($('e-question'), {
      number: this.idx + 1,
      info: [selected ? 'Đã trả lời' : 'Chưa trả lời', 'Đạt điểm 1,0'],
      q,
      selected,
      onSelect: (L) => { this.answers[q.id] = L; this.render(); },
      onClear: () => { delete this.answers[q.id]; this.render(); },
      flagged: !!this.flags[q.id],
      onFlag: () => { this.flags[q.id] = !this.flags[q.id]; this.render(); }
    });

    const last = this.idx === this.questions.length - 1;
    $('e-prev').hidden = this.idx === 0;
    $('e-next').textContent = last ? 'Finish attempt' : 'Next page';
    this.updateGrid();
  },

  next() {
    if (this.idx === this.questions.length - 1) return this.submit(false);
    this.go(this.idx + 1);
  },

  prev() {
    if (this.idx > 0) this.go(this.idx - 1);
  },

  async submit(auto) {
    if (this.submitting) return;

    if (!auto) {
      const left = this.questions.length - Object.keys(this.answers).length;
      const msg = left > 0 ? 'Còn ' + left + ' câu chưa trả lời. Nộp bài?' : 'Nộp bài?';
      if (!confirm(msg)) return;
    }

    this.submitting = true;
    clearInterval(this.timer);
    const durationSec = this.limitSec ? Math.min(this.elapsed(), this.limitSec) : this.elapsed();
    $('e-status').className = 'status';
    $('e-status').textContent = auto ? 'Hết giờ. Đang nộp bài...' : 'Đang nộp bài...';

    try {
      const res = await apiPost({
        action: 'submitExam',
        name: this.name,
        subject: this.subject,
        ids: this.questions.map((q) => q.id),
        answers: this.answers,
        durationSec
      });
      this.active = false;
      this.showResult(res, durationSec);
    } catch (err) {
      this.submitting = false;
      $('e-status').className = 'status error';
      $('e-status').textContent = 'Nộp bài thất bại: ' + err.message + '. Bấm "Finish attempt ..." để thử lại.';
      // Hết giờ thì không chạy lại đồng hồ, tránh tự nộp lặp liên tục.
      if (!auto) this.startTimer();
    }
  },

  showResult(res, durationSec) {
    $('r-title').textContent = 'Kết quả bài kiểm tra';
    renderSummary([
      ['Họ và tên', this.name],
      ['Môn học', this.subject],
      ['Điểm số (Thang 10)', formatScore(res.score)],
      ['Số câu đúng', res.correct],
      ['Số câu sai', res.wrong],
      ['Tổng số câu', res.total],
      ['Thời gian làm bài', formatDuration(durationSec)]
    ]);
    $('r-status').className = 'status';
    $('r-status').textContent = 'Đã lưu kết quả.';

    // Xem lại từng câu
    const review = this.questions.map((q, i) => {
      const box = el('div');
      const selected = this.answers[q.id] || null;
      const answer = res.key[q.id];
      const ok = selected === answer;
      renderQuestion(box, {
        number: i + 1,
        info: [selected ? (ok ? 'Đúng' : 'Sai') : 'Không trả lời', 'Đạt điểm ' + (ok ? '1,0' : '0,0')],
        q,
        selected,
        locked: true,
        answer,
        feedback: 'Đáp án đúng: ' + answer,
        feedbackClass: ok ? 'ok' : 'bad'
      });
      return box;
    });
    $('r-review').replaceChildren(...review);
    showScreen('result');
  }
};

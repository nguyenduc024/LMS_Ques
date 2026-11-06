// Luồng 1: làm từng câu, hiện đáp án ngay sau khi chọn.
const Practice = {
  reset(name, questions) {
    this.name = name;
    this.bank = shuffle(questions);
    this.idx = 0;
    this.selected = null;
    this.correct = 0;
    this.wrong = 0;
    this.streak = 0; // > 0: đang chuỗi đúng, < 0: đang chuỗi sai
    this.maxCorrectStreak = 0;
    this.maxWrongStreak = 0;
    this.sent = false;
    this.active = true;
  },

  async start(name, subject) {
    const data = await apiGet('practice', { subject });
    if (!data.questions.length) throw new Error('Môn này chưa có câu hỏi');
    this.reset(name, data.questions);
    this.subject = subject;
    showScreen('practice');
    this.render();
  },

  current() {
    return this.bank[this.idx];
  },

  render() {
    const q = this.current();
    const answered = this.selected != null;
    const ok = answered && this.selected === q.ans;

    let streakText = 'Chuỗi: 0';
    if (this.streak > 0) streakText = 'Chuỗi đúng: ' + this.streak;
    if (this.streak < 0) streakText = 'Chuỗi sai: ' + -this.streak;

    renderQuestion($('p-question'), {
      number: this.idx + 1,
      info: ['Đúng: ' + this.correct, 'Sai: ' + this.wrong, streakText, 'Còn lại: ' + (this.bank.length - this.idx - 1)],
      q,
      selected: this.selected,
      locked: answered,
      answer: answered ? q.ans : null,
      onSelect: (L) => this.choose(L),
      feedback: answered ? (ok ? 'Đúng.' : 'Sai. Đáp án đúng là ' + q.ans + '.') : null,
      feedbackClass: ok ? 'ok' : 'bad'
    });

    const last = this.idx === this.bank.length - 1;
    $('p-next').disabled = !answered;
    $('p-next').textContent = last ? 'Xem kết quả' : 'Câu tiếp';
  },

  choose(L) {
    if (this.selected != null) return;
    this.selected = L;
    if (L === this.current().ans) {
      this.correct++;
      this.streak = this.streak > 0 ? this.streak + 1 : 1;
      this.maxCorrectStreak = Math.max(this.maxCorrectStreak, this.streak);
    } else {
      this.wrong++;
      this.streak = this.streak < 0 ? this.streak - 1 : -1;
      this.maxWrongStreak = Math.max(this.maxWrongStreak, -this.streak);
    }
    this.render();
  },

  next() {
    if (this.selected == null) return;
    if (this.idx + 1 >= this.bank.length) return this.finish();
    this.idx++;
    this.selected = null;
    this.render();
  },

  payload() {
    return {
      action: 'savePractice',
      name: this.name,
      subject: this.subject,
      maxCorrectStreak: this.maxCorrectStreak,
      maxWrongStreak: this.maxWrongStreak,
      correct: this.correct,
      wrong: this.wrong
    };
  },

  async finish() {
    this.active = false;
    const total = this.correct + this.wrong;

    $('r-title').textContent = 'Kết quả luyện tập';
    renderSummary([
      ['Họ và tên', this.name],
      ['Môn học', this.subject],
      ['Số câu đúng', this.correct],
      ['Số câu sai', this.wrong],
      ['Tổng số câu', total],
      ['Chuỗi đúng dài nhất', this.maxCorrectStreak],
      ['Chuỗi sai dài nhất', this.maxWrongStreak]
    ]);
    $('r-review').replaceChildren();
    showScreen('result');

    const status = $('r-status');
    status.className = 'status';
    if (total === 0) {
      status.textContent = 'Chưa làm câu nào nên không lưu kết quả.';
      return;
    }
    if (this.sent) return;

    this.sent = true;
    status.textContent = 'Đang lưu kết quả...';
    try {
      await apiPost(this.payload());
      status.textContent = 'Đã lưu kết quả.';
    } catch (err) {
      this.sent = false; // để lần đóng trang sau còn gửi lại được
      status.className = 'status error';
      status.textContent = 'Không lưu được kết quả: ' + err.message;
    }
  },

  // Gọi khi người dùng đóng tab / thoát web giữa chừng.
  flushOnLeave() {
    if (!this.bank || this.sent) return;
    if (this.correct + this.wrong === 0) return;
    this.sent = true;
    apiBeacon(this.payload());
  }
};

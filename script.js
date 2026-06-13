// ==============================
// たちばな ─ ぜんぶやる古典文法クイズ
// GitHub Pages向け / 依存なしSPA
// ==============================

(() => {
  "use strict";

  const STORAGE_KEY = "tachibana-kobun-quiz-state-v1";
  const QUESTIONS_CSV_PATH = "questions.csv";
  const CORRECT_SOUND_PATH = "クイズ正解2.mp3";
  const QUIZ_LENGTH = 10;

  const CATEGORY_ORDER = [
    "動詞",
    "形容詞/形容動詞",
    "助動詞",
    "助詞",
    "識別",
    "演習",
  ];

  const CATEGORY_TO_SECTIONS = {
    "動詞": ["動詞①", "動詞②"],
    "形容詞/形容動詞": ["形容詞", "形容動詞"],
    "助動詞": ["助動詞①", "助動詞②"],
    "助詞": ["助詞①", "助詞②"],
    "識別": ["識別①", "識別②"],
    "演習": ["演習①", "演習②"],
  };

  const appState = {
    loadError: null,
    questions: [],
    history: [],
    currentView: { name: "loading", params: {} },
    session: null,
  };

  let correctAudio = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    renderLoading("読み込み中…");

    try {
      const questions = await loadQuestionsFromCSV(QUESTIONS_CSV_PATH);
      appState.questions = questions;
      ensureStorageInitialized(questions);
      prepareCorrectSound();
      exposeDebugHelpers();
      goTo("home", {}, false);
    } catch (error) {
      console.error(error);
      appState.loadError = error;
      renderFatalError();
    }
  }

  async function loadQuestionsFromCSV(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`questions.csv の読み込みに失敗しました: ${response.status}`);
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText);

    return rows.map((row, index) => {
      const question = {
        id: row.id?.trim() || String(index + 1),
        category: row.category?.trim() || "",
        section: row.section?.trim() || "",
        question: row.question?.trim() || "",
        choices: [
          row.choice1?.trim() || "",
          row.choice2?.trim() || "",
          row.choice3?.trim() || "",
          row.choice4?.trim() || "",
        ].filter(Boolean),
        answer: row.answer?.trim() || "",
      };

      validateQuestion(question, index);
      return question;
    });
  }

  function parseCSV(text) {
    const lines = [];
    let current = "";
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        row.push(current);
        current = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(current);
        if (row.some(cell => cell.trim() !== "")) {
          lines.push(row);
        }
        row = [];
        current = "";
      } else {
        current += char;
      }
    }

    if (current.length > 0 || row.length > 0) {
      row.push(current);
      if (row.some(cell => cell.trim() !== "")) {
        lines.push(row);
      }
    }

    if (lines.length === 0) return [];

    const headers = lines[0].map(header => header.trim());
    return lines.slice(1).map(cells => {
      const result = {};
      headers.forEach((header, index) => {
        result[header] = cells[index] ?? "";
      });
      return result;
    });
  }

  function validateQuestion(question, index) {
    if (!question.id || !question.category || !question.section || !question.question || !question.answer) {
      throw new Error(`CSV ${index + 2}行目の必須項目が不足しています。`);
    }

    if (question.choices.length !== 4) {
      throw new Error(`CSV ${index + 2}行目の選択肢数が4つではありません。`);
    }

    if (!question.choices.includes(question.answer)) {
      throw new Error(`CSV ${index + 2}行目の answer が choice1〜4 に含まれていません。`);
    }
  }

  function createDefaultStorageState(questions) {
    const questionStates = {};

    questions.forEach(question => {
      questionStates[question.id] = {
        seen: false,
        weak: false,
        solvedCorrectOnce: false,
        correctCount: 0,
        incorrectCount: 0,
        lastAnsweredAt: null,
      };
    });

    return {
      version: 1,
      questionStates,
      stats: {
        sessionsPlayed: 0,
        totalAnswers: 0,
        totalCorrectAnswers: 0,
      },
    };
  }

  function ensureStorageInitialized(questions) {
    const saved = getStorageState();

    if (!saved) {
      resetProgress();
      return;
    }

    let changed = false;

    questions.forEach(question => {
      if (!saved.questionStates[question.id]) {
        saved.questionStates[question.id] = {
          seen: false,
          weak: false,
          solvedCorrectOnce: false,
          correctCount: 0,
          incorrectCount: 0,
          lastAnsweredAt: null,
        };
        changed = true;
      }
    });

    Object.keys(saved.questionStates).forEach(id => {
      if (!questions.some(question => question.id === id)) {
        delete saved.questionStates[id];
        changed = true;
      }
    });

    if (!saved.stats) {
      saved.stats = {
        sessionsPlayed: 0,
        totalAnswers: 0,
        totalCorrectAnswers: 0,
      };
      changed = true;
    }

    if (changed) {
      setStorageState(saved);
    }
  }

  function getStorageState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("localStorage 読み込み失敗", error);
      return null;
    }
  }

  function setStorageState(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function resetProgress() {
    const initial = createDefaultStorageState(appState.questions);
    setStorageState(initial);
    return initial;
  }

  function getQuestionState(questionId) {
    return getStorageState()?.questionStates?.[questionId] || null;
  }

  function updateQuestionState(questionId, updater) {
    const data = getStorageState();
    if (!data || !data.questionStates[questionId]) return;

    updater(data.questionStates[questionId], data);
    data.questionStates[questionId].lastAnsweredAt = new Date().toISOString();
    setStorageState(data);
  }

  function getProgressStats(questionsSubset = appState.questions) {
    const data = getStorageState();
    const states = data?.questionStates || {};
    const total = questionsSubset.length;

    let solved = 0;
    let weak = 0;
    let unseen = 0;

    questionsSubset.forEach(question => {
      const state = states[question.id] || {};
      if (!state.seen) unseen += 1;
      if (state.weak) weak += 1;
      if (state.solvedCorrectOnce) solved += 1;
    });

    return {
      total,
      solved,
      weak,
      unseen,
      progressRate: total > 0 ? Math.round((solved / total) * 100) : 0,
    };
  }

  function exposeDebugHelpers() {
    window.tachibanaDebug = {
      getState: () => getStorageState(),
      resetProgress: () => {
        const result = resetProgress();
        rerenderCurrentView();
        return result;
      },
      getQuestions: () => appState.questions,
      getSectionStats: (category, section) => getProgressStats(filterQuestions({ category, section })),
    };
  }

  function prepareCorrectSound() {
    try {
      correctAudio = new Audio(CORRECT_SOUND_PATH);
      correctAudio.preload = "auto";
    } catch (error) {
      console.debug("効果音の事前読み込みをスキップしました", error);
      correctAudio = null;
    }
  }

  function goTo(name, params = {}, pushHistory = true) {
    if (pushHistory && appState.currentView.name !== "loading") {
      appState.history.push(appState.currentView);
    }

    appState.currentView = { name, params };
    render();
  }

  function goBack(fallback = "home") {
    const previous = appState.history.pop();
    if (previous) {
      appState.currentView = previous;
      render();
      return;
    }

    goTo(fallback, {}, false);
  }

  function rerenderCurrentView() {
    render();
  }

  function filterQuestions({ category = null, section = null, weakOnly = false } = {}) {
    return appState.questions.filter(question => {
      if (category && question.category !== category) return false;
      if (section && question.section !== section) return false;
      if (weakOnly && !getQuestionState(question.id)?.weak) return false;
      return true;
    });
  }

  function buildQuizQuestions(mode, options = {}) {
    const storage = getStorageState();
    let pool = [];

    if (mode === "normal") {
      pool = filterQuestions({ category: options.category, section: options.section });
    } else if (mode === "random") {
      pool = [...appState.questions];
    } else if (mode === "weak") {
      pool = filterQuestions({ weakOnly: true });
    }

    if (pool.length === 0) return [];

    const unseen = shuffle(pool.filter(question => !storage.questionStates[question.id]?.seen));
    const seen = shuffle(pool.filter(question => storage.questionStates[question.id]?.seen));
    return [...unseen, ...seen].slice(0, Math.min(QUIZ_LENGTH, pool.length));
  }

  function startQuiz(mode, options = {}) {
    const questions = buildQuizQuestions(mode, options);

    if (questions.length === 0) {
      goTo("empty", {
        message: mode === "weak" ? "苦手問題はありません" : "問題がありません",
        buttonText: "TOPへ",
        onClick: "home",
      });
      return;
    }

    appState.session = {
      mode,
      options,
      title: getModeLabel(mode, options),
      questions: questions.map(question => ({
        ...question,
        shuffledChoices: shuffle([...question.choices]),
      })),
      currentIndex: 0,
      answers: [],
      isAnsweringLocked: false,
      countdown: 3,
      timerId: null,
    };

    goTo("countdown", { label: getModeLabel(mode, options) });
  }

  function getModeLabel(mode, options) {
    if (mode === "normal") return options.category || "問題を解く";
    if (mode === "random") return "ランダム10問";
    if (mode === "weak") return "苦手問題";
    return "";
  }

  function answerCurrentQuestion(selectedChoice, viaUnknown = false) {
    const session = appState.session;
    if (!session || session.isAnsweringLocked) return;

    const current = session.questions[session.currentIndex];
    const isCorrect = selectedChoice === current.answer;
    session.isAnsweringLocked = true;

    updateQuestionState(current.id, (state, root) => {
      state.seen = true;
      root.stats.totalAnswers += 1;

      if (isCorrect) {
        state.correctCount += 1;
        state.solvedCorrectOnce = true;
        root.stats.totalCorrectAnswers += 1;
      } else {
        state.incorrectCount += 1;
        state.weak = true;
      }
    });

    session.answers.push({
      questionId: current.id,
      question: current.question,
      answer: current.answer,
      selectedChoice,
      isCorrect,
      viaUnknown,
    });

    if (isCorrect) {
      playCorrectSound();
    }

    renderQuizQuestion({ reveal: true, selectedChoice, isCorrect });

    window.setTimeout(() => {
      session.currentIndex += 1;
      session.isAnsweringLocked = false;

      if (session.currentIndex >= session.questions.length) {
        finalizeSession();
      } else {
        render();
      }
    }, 3000);
  }

  function removeWeakForCurrentQuestion() {
    const session = appState.session;
    const current = session?.questions?.[session.currentIndex];
    if (!current) return;

    updateQuestionState(current.id, state => {
      state.weak = false;
    });

    const button = document.getElementById("remove-weak-btn");
    if (button) {
      button.disabled = true;
      button.textContent = "苦手から外しました";
      button.classList.add("is-done");
    }
  }

  function finalizeSession() {
    const storage = getStorageState();
    if (storage?.stats) {
      storage.stats.sessionsPlayed += 1;
      setStorageState(storage);
    }
    goTo("result");
  }

  function playCorrectSound() {
    try {
      const audio = correctAudio ? correctAudio.cloneNode() : new Audio(CORRECT_SOUND_PATH);
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => fallbackCorrectBeep());
      }
    } catch (error) {
      fallbackCorrectBeep(error);
    }
  }

  function fallbackCorrectBeep(error) {
    if (error) {
      console.debug("音声ファイル再生に失敗したため簡易音に切り替えます", error);
    }

    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.12);

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
    } catch (beepError) {
      console.debug("簡易音も再生できませんでした", beepError);
    }
  }

  function render() {
    const screen = document.getElementById("screen");
    if (!screen) return;

    const { name, params } = appState.currentView;

    if (name === "home") {
      screen.innerHTML = renderHome();
      bindHomeEvents();
      return;
    }

    if (name === "about") {
      screen.innerHTML = renderAbout();
      bindCommonBack();
      return;
    }

    if (name === "categories") {
      screen.innerHTML = renderCategories();
      bindCategoryEvents();
      bindCommonBack();
      return;
    }

    if (name === "sections") {
      screen.innerHTML = renderSections(params.category);
      bindSectionEvents();
      bindCommonBack();
      return;
    }

    if (name === "countdown") {
      renderCountdown(params.label);
      return;
    }

    if (name === "quiz") {
      renderQuizQuestion();
      return;
    }

    if (name === "result") {
      screen.innerHTML = renderResult();
      bindResultEvents();
      return;
    }

    if (name === "empty") {
      screen.innerHTML = renderEmpty(params.message, params.buttonText);
      bindEmptyEvents(params.onClick);
      return;
    }

    renderLoading(params.message || "読み込み中…");
  }

  function renderLoading(message = "読み込み中…") {
    const screen = document.getElementById("screen");
    if (!screen) return;

    screen.innerHTML = `
      <section class="screen loading-wrap">
        <div class="center-box">
          <div class="spinner" aria-hidden="true"></div>
          <div>${escapeHTML(message)}</div>
        </div>
      </section>
    `;
  }

  function renderFatalError() {
    const screen = document.getElementById("screen");
    if (!screen) return;

    screen.innerHTML = `
      <section class="screen empty-wrap">
        <div class="center-box card">
          <h2 class="section-title">読み込みに失敗しました</h2>
          <p class="section-subtitle">questions.csv の配置や内容をご確認ください。</p>
        </div>
      </section>
    `;
  }

  function renderHome() {
    const stats = getProgressStats();

    return `
      <section class="screen home-screen">
        <div class="title-block is-centered">
          <h1 class="app-title">たちばな</h1>
          <div class="app-subtitle">ぜんぶやる古典文法</div>
        </div>

        <div class="button-row home-button-row">
          <button class="primary-btn large" id="start-normal">問題を解く</button>
          <button class="secondary-btn random-mode-btn" id="start-random">ランダム10問</button>
          <button class="secondary-btn weak-mode-btn" id="start-weak">苦手問題</button>
        </div>

        <section class="card progress-card">
          <div class="progress-card-header">
            <h2 class="progress-card-title">学習進捗</h2>
            <button class="utility-btn" id="open-reset-dialog">リセット</button>
          </div>

          <div class="progress-meta-top">
            <span>進捗率</span>
            <strong class="progress-rate-value">${stats.progressRate}%</strong>
          </div>

          ${renderProgressBar(stats)}

          <div class="progress-meta-bottom progress-meta-home">
            <span>総問題数 ${stats.total}問</span>
            <span class="meta-danger">苦手 ${stats.weak}問</span>
            <span>未挑戦 ${stats.unseen}問</span>
          </div>
        </section>

        <div class="footer-links">
          <button class="footer-link" id="go-about">このサイトについて</button>
          <button class="footer-link" id="dummy-report">問題報告</button>
        </div>

        <div class="dialog-backdrop" id="reset-dialog" hidden>
          <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="reset-dialog-title">
            <div class="dialog-title" id="reset-dialog-title">学習記録を全てリセットしますか？</div>
            <div class="dialog-btn-row">
              <button class="dialog-btn dialog-btn-cancel" id="reset-cancel-btn">いいえ</button>
              <button class="dialog-btn dialog-btn-confirm" id="reset-confirm-btn">はい</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderAbout() {
    return `
      <section class="screen">
        <div class="topbar">
          <button class="back-btn" data-back aria-label="戻る">${renderChevronSVG("left", "back-chevron")}</button>
          <div class="topbar-center"></div>
          <div class="topbar-right"></div>
        </div>

        <section class="card">
          <h2 class="section-title">このサイトについて</h2>
          <p class="question-text">ここにサイトの解説文が入ります</p>
        </section>
      </section>
    `;
  }

  function renderCategories() {
    return `
      <section class="screen">
        <div class="topbar">
          <button class="back-btn" data-back aria-label="戻る">${renderChevronSVG("left", "back-chevron")}</button>
          <div class="topbar-center">カテゴリ選択</div>
          <div class="topbar-right"></div>
        </div>

        <div class="stack category-stack">
          ${CATEGORY_ORDER.map(category => `
            <button class="list-card" data-category="${escapeAttr(category)}">
              <div class="list-card-main">
                <div class="list-card-title">${escapeHTML(category)}</div>
              </div>
              <span class="card-arrow" aria-hidden="true">${renderChevronSVG("right", "card-chevron")}</span>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderSections(category) {
    const sections = CATEGORY_TO_SECTIONS[category] || [];

    return `
      <section class="screen">
        <div class="topbar">
          <button class="back-btn" data-back aria-label="戻る">${renderChevronSVG("left", "back-chevron")}</button>
          <div class="topbar-center">${escapeHTML(category)}</div>
          <div class="topbar-right"></div>
        </div>

        <div class="stack section-stack">
          ${sections.map(section => {
            const questions = filterQuestions({ category, section });
            const stats = getProgressStats(questions);
            const complete = stats.unseen === 0 && stats.weak === 0 && stats.total > 0;

            return `
              <button class="section-card" data-section="${escapeAttr(section)}" data-category="${escapeAttr(category)}">
                <div class="section-card-main">
                  <div class="section-card-head">
                    <div class="section-card-title-row">
                      <div class="section-card-title">${escapeHTML(section)}</div>
                      ${complete ? `<div class="complete-label complete-label-inline">COMPLETE！</div>` : ""}
                    </div>
                    <span class="card-arrow section-card-arrow" aria-hidden="true">${renderChevronSVG("right", "card-chevron")}</span>
                  </div>

                  ${renderProgressBar(stats)}

                  <div class="progress-meta-bottom section-progress-meta">
                    <span>全${stats.total}問</span>
                    ${stats.weak > 0 ? `<span class="meta-danger">苦手${stats.weak}問</span>` : ""}
                    <span>未挑戦${stats.unseen}問</span>
                  </div>
                </div>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderProgressBar(stats) {
    const total = Math.max(stats.total, 1);
    const solvedWidth = (stats.solved / total) * 100;
    const weakWidth = (stats.weak / total) * 100;
    const unseenWidth = Math.max(0, 100 - solvedWidth - weakWidth);

    return `
      <div class="progress-bar" aria-label="進捗ゲージ">
        <div class="progress-segment done" style="width:${solvedWidth}%"></div>
        <div class="progress-segment weak" style="width:${weakWidth}%"></div>
        <div class="progress-segment unseen" style="width:${unseenWidth}%"></div>
      </div>
    `;
  }

  function renderCountdown(label) {
    const screen = document.getElementById("screen");
    const session = appState.session;
    if (!screen || !session) return;

    screen.innerHTML = `
      <section class="screen countdown-wrap">
        <div class="countdown-plain">
          <div class="countdown-label">${escapeHTML(label)}</div>
          <div class="countdown-number">${session.countdown}</div>
        </div>
      </section>
    `;

    clearTimeout(session.timerId);
    session.timerId = window.setTimeout(() => {
      session.countdown -= 1;
      if (session.countdown <= 0) {
        goTo("quiz", {}, false);
      } else {
        renderCountdown(label);
      }
    }, 1000);
  }

  function renderQuizQuestion(revealState = null) {
    const screen = document.getElementById("screen");
    const session = appState.session;
    if (!screen || !session) return;

    const current = session.questions[session.currentIndex];
    const displayIndex = session.currentIndex + 1;
    const isWeakMode = session.mode === "weak";

    let selectedChoice = null;
    let isCorrect = false;
    let overlayMarkup = "";

    if (revealState) {
      selectedChoice = revealState.selectedChoice;
      isCorrect = revealState.isCorrect;
      overlayMarkup = renderFeedbackIcon(isCorrect ? "correct" : "incorrect");
    }

    screen.innerHTML = `
      <section class="screen">
        <div class="topbar">
          <button class="back-btn" id="quiz-back" aria-label="戻る">${renderChevronSVG("left", "back-chevron")}</button>
          <div class="topbar-center">${escapeHTML(session.title)}</div>
          <div class="topbar-right">${displayIndex}/${session.questions.length}</div>
        </div>

        <section class="card question-card">
          <div class="question-text">${escapeHTML(current.question)}</div>
          <div class="feedback-overlay ${revealState ? `show ${isCorrect ? "correct" : "incorrect"}` : ""}">
            ${overlayMarkup}
          </div>
        </section>

        <div class="choice-list">
          ${current.shuffledChoices.map(choice => {
            const classes = ["choice-btn"];
            let icon = "";

            if (revealState) {
              if (choice === current.answer) {
                classes.push("correct");
                icon = "✓";
              } else if (choice === selectedChoice && !isCorrect) {
                classes.push("incorrect");
                icon = "×";
              } else {
                classes.push("dimmed");
              }
            }

            return `
              <button class="${classes.join(" ")}" data-choice="${escapeAttr(choice)}" ${revealState ? "disabled" : ""}>
                ${escapeHTML(choice)}
                ${icon ? `<span class="choice-icon">${icon}</span>` : ""}
              </button>
            `;
          }).join("")}
        </div>

        <div class="helper-link">
          <button id="unknown-btn" ${revealState ? "disabled" : ""}>わからない</button>
        </div>

        ${isWeakMode && revealState && isCorrect && getQuestionState(current.id)?.weak ? `
          <div class="weak-remove-wrap">
            <button class="inline-btn" id="remove-weak-btn">苦手からはずす</button>
          </div>
        ` : ""}
      </section>
    `;

    bindQuizEvents(revealState);
  }

  function renderResult() {
    const session = appState.session;
    if (!session) return "";

    const total = session.questions.length;
    const correctCount = session.answers.filter(answer => answer.isCorrect).length;
    const wrongAnswers = session.answers.filter(answer => !answer.isCorrect);
    const showCategoryButton = session.mode === "normal";

    return `
      <section class="screen result-screen">
        <div class="score-wrap">
          <div class="score-line">
            <span class="score-main">${correctCount}</span>
            <span class="score-total">/${total}</span>
          </div>
          <div class="score-message">${correctCount === total ? "すばらしい！" : "お疲れさまでした"}</div>
        </div>

        ${wrongAnswers.length > 0 ? `
          <section class="stack result-stack">
            <h2 class="result-list-title">間違えた問題</h2>
            <div class="result-list">
              ${wrongAnswers.map(item => `
                <article class="card result-item-card">
                  <div class="result-card-question">${escapeHTML(item.question)}</div>
                  <div class="result-card-answer">
                    <span class="result-answer-label">正解：</span>
                    <span class="result-answer-text">${escapeHTML(item.answer)}</span>
                  </div>
                </article>
              `).join("")}
            </div>
          </section>
        ` : ""}

        <div class="button-row result-button-row">
          <button class="primary-btn" id="retry-btn">もう一度</button>
          ${showCategoryButton ? `<button class="secondary-btn" id="back-category-btn">カテゴリ選択へ</button>` : ""}
          <button class="ghost-btn" id="to-home-btn">TOPへ</button>
        </div>
      </section>
    `;
  }

  function renderEmpty(message, buttonText) {
    return `
      <section class="screen empty-wrap">
        <div class="center-box card">
          <h2 class="section-title">${escapeHTML(message)}</h2>
          <div class="empty-btn-wrap">
            <button class="primary-btn" id="empty-btn">${escapeHTML(buttonText)}</button>
          </div>
        </div>
      </section>
    `;
  }

  function bindHomeEvents() {
    document.getElementById("start-normal")?.addEventListener("click", () => {
      goTo("categories");
    });

    document.getElementById("start-random")?.addEventListener("click", () => {
      startQuiz("random");
    });

    document.getElementById("start-weak")?.addEventListener("click", () => {
      startQuiz("weak");
    });

    document.getElementById("go-about")?.addEventListener("click", () => {
      goTo("about");
    });

    document.getElementById("dummy-report")?.addEventListener("click", () => {
      alert("問題報告は現在準備中です。");
    });

    const dialog = document.getElementById("reset-dialog");
    document.getElementById("open-reset-dialog")?.addEventListener("click", () => {
      if (dialog) dialog.hidden = false;
    });

    document.getElementById("reset-cancel-btn")?.addEventListener("click", () => {
      if (dialog) dialog.hidden = true;
    });

    document.getElementById("reset-confirm-btn")?.addEventListener("click", () => {
      resetProgress();
      rerenderCurrentView();
    });

    dialog?.addEventListener("click", event => {
      if (event.target === dialog) {
        dialog.hidden = true;
      }
    });
  }

  function bindCommonBack() {
    document.querySelector("[data-back]")?.addEventListener("click", () => {
      goBack();
    });
  }

  function bindCategoryEvents() {
    document.querySelectorAll("[data-category]").forEach(button => {
      button.addEventListener("click", () => {
        goTo("sections", { category: button.dataset.category });
      });
    });
  }

  function bindSectionEvents() {
    document.querySelectorAll("[data-section]").forEach(button => {
      button.addEventListener("click", () => {
        startQuiz("normal", {
          category: button.dataset.category,
          section: button.dataset.section,
        });
      });
    });
  }

  function bindQuizEvents(revealState) {
    document.getElementById("quiz-back")?.addEventListener("click", () => {
      if (confirm("このセッションを中断して戻りますか？")) {
        appState.session = null;
        goBack("home");
      }
    });

    if (!revealState) {
      document.querySelectorAll("[data-choice]").forEach(button => {
        button.addEventListener("click", () => {
          answerCurrentQuestion(button.dataset.choice, false);
        });
      });

      document.getElementById("unknown-btn")?.addEventListener("click", () => {
        answerCurrentQuestion("<<UNKNOWN>>", true);
      });
    }

    document.getElementById("remove-weak-btn")?.addEventListener("click", () => {
      removeWeakForCurrentQuestion();
    });
  }

  function bindResultEvents() {
    document.getElementById("retry-btn")?.addEventListener("click", () => {
      const session = appState.session;
      if (!session) return;
      startQuiz(session.mode, session.options);
    });

    document.getElementById("back-category-btn")?.addEventListener("click", () => {
      appState.session = null;
      goTo("categories", {}, false);
    });

    document.getElementById("to-home-btn")?.addEventListener("click", () => {
      appState.session = null;
      appState.history = [];
      goTo("home", {}, false);
    });
  }

  function bindEmptyEvents(onClick) {
    document.getElementById("empty-btn")?.addEventListener("click", () => {
      if (onClick === "home") {
        goTo("home", {}, false);
      } else {
        goBack("home");
      }
    });
  }

  function renderChevronSVG(direction, className = "") {
    const path = direction === "left"
      ? "M16 4.5 L8 12 L16 19.5"
      : "M8 4.5 L16 12 L8 19.5";

    return `
      <svg class="chevron-svg ${escapeAttr(className)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="${path}" />
      </svg>
    `;
  }

  function renderFeedbackIcon(type) {
    if (type === "correct") {
      return `
        <svg class="feedback-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <circle cx="60" cy="60" r="42" />
          <path d="M40 61 L54 74 L81 48" class="feedback-mark" />
        </svg>
      `;
    }

    return `
      <svg class="feedback-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle cx="60" cy="60" r="42" />
        <path d="M46 46 L74 74" class="feedback-mark" />
        <path d="M74 46 L46 74" class="feedback-mark" />
      </svg>
    `;
  }

  function shuffle(array) {
    const copied = [...array];
    for (let i = copied.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copied[i], copied[j]] = [copied[j], copied[i]];
    }
    return copied;
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return escapeHTML(value);
  }
})();

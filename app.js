(() => {
  "use strict";

  const STORAGE_KEY = "aaea-flashcards-v1";
  const CATEGORY_ORDER = [
    "Micro",
    "Macro",
    "Finance",
    "RePo",
    "Quant",
    "Marketing",
    "Management",
    "Potpourri"
  ];
  const VALUE_ORDER = [5, 10, 15, 20, 25];

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const rawData = Array.isArray(window.QUIZ_DATA) ? window.QUIZ_DATA : [];

  const DATA = rawData
    .map((item, index) => {
      const year = Number(item.y);
      const category = String(item.c || "").trim();
      const value = Number(item.v);
      const question = cleanText(item.q);
      const answer = cleanText(item.a);

      return {
        id: `${year}-${category}-${value}-${index}`.replace(/\s+/g, "-"),
        index,
        year,
        category,
        value,
        question,
        answer
      };
    })
    .filter(
      (item) =>
        item.year &&
        item.category &&
        item.value &&
        item.question &&
        item.answer
    );

  const YEARS = [...new Set(DATA.map((item) => item.year))].sort(
    (a, b) => a - b
  );

  const CATEGORIES = CATEGORY_ORDER.filter((cat) =>
    DATA.some((item) => item.category === cat)
  );

  const els = {};

  let state = {
    filters: { year: "all", category: "all" },
    mode: "study",
    deckType: "standard",
    timerSeconds: 0,
    sessionUsedIds: [],
    history: [],
    missed: {},
    stats: freshStats(),
    quiz: null
  };

  let queue = [];
  let current = null;
  let flipped = false;
  let finalizedCurrent = false;
  let timerId = null;
  let timerEndsAt = 0;
  let timerStartedAt = 0;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    state = hydrateState();
    renderFilterChips();
    bindEvents();
    rebuildDeck({ preserveCurrent: false });
    renderAll();
  }

  function cacheElements() {
    Object.assign(els, {
      yearChips: $("#yearChips"),
      categoryChips: $("#categoryChips"),
      modeButtons: $("#modeButtons"),
      timerSelect: $("#timerSelect"),
      resetSessionBtn: $("#resetSessionBtn"),
      card: $("#flashcard"),
      cardInner: $("#cardInner"),
      cardFront: $("#cardFront"),
      cardBack: $("#cardBack"),
      showResponseBtn: $("#showResponseBtn"),
      gotItBtn: $("#gotItBtn"),
      missedBtn: $("#missedBtn"),
      nextBtn: $("#nextBtn"),
      shuffleBtn: $("#shuffleBtn"),
      reviewMissedBtn: $("#reviewMissedBtn"),
      deckCount: $("#deckCount"),
      askedCount: $("#askedCount"),
      accuracyText: $("#accuracyText"),
      scoreText: $("#scoreText"),
      timerWrap: $("#timerWrap"),
      timerFill: $("#timerFill"),
      timerText: $("#timerText"),
      deckNotice: $("#deckNotice"),
      historyList: $("#historyList"),
      missedList: $("#missedList"),
      statsPanel: $("#statsPanel"),
      tabButtons: $("#tabButtons"),
      quizBanner: $("#quizBanner")
    });
  }

  function bindEvents() {
    els.modeButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;

      state.mode = button.dataset.mode;
      state.deckType = "standard";
      state.quiz = null;

      rebuildDeck({ resetUsed: true });
      drawNext();
      saveState();
      renderAll();
    });

    els.timerSelect.value = String(state.timerSeconds);

    els.timerSelect.addEventListener("change", () => {
      state.timerSeconds = Number(els.timerSelect.value || 0);
      saveState();
      restartTimer();
      renderTimer();
    });

    els.resetSessionBtn.addEventListener("click", () => {
      state.sessionUsedIds = [];
      state.quiz = null;
      state.deckType = "standard";

      rebuildDeck({ resetUsed: true });
      drawNext();
      saveState();
      renderAll();
    });

    els.card.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  toggleCard();
});

    els.showResponseBtn.addEventListener("click", toggleCard);
    els.gotItBtn.addEventListener("click", () => markCurrent("correct"));
    els.missedBtn.addEventListener("click", () => markCurrent("missed"));
    els.nextBtn.addEventListener("click", drawNext);

    els.shuffleBtn.addEventListener("click", () => {
      queue = shuffle(queue);
      saveState();
      renderMeta();
      flashNotice("Remaining deck shuffled.");
    });

    els.reviewMissedBtn.addEventListener("click", () => {
      startMissedReview(false);
      renderAll();
    });

    els.tabButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-tab]");
      if (!button) return;

      $$("[data-tab-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== button.dataset.tab;
      });

      $$("#tabButtons button").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
      });
    });

    els.historyList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-review-id]");
      if (!button) return;
      loadSpecificQuestion(button.dataset.reviewId, "history");
    });

    els.missedList.addEventListener("click", (event) => {
      const reviewButton = event.target.closest("button[data-review-id]");
      if (reviewButton) {
        loadSpecificQuestion(reviewButton.dataset.reviewId, "missed");
      }

      const dueButton = event.target.closest("button[data-review-due]");
      if (dueButton) {
        startMissedReview(true);
      }
    });

    document.addEventListener("keydown", (event) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;

      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        toggleCard();
      }

      if (event.key.toLowerCase() === "g") markCurrent("correct");
      if (event.key.toLowerCase() === "m") markCurrent("missed");
      if (event.key.toLowerCase() === "n") drawNext();
    });
  }

  function renderFilterChips() {
    els.yearChips.innerHTML =
      chipMarkup("year", "all", "All years") +
      YEARS.map((year) => chipMarkup("year", year, year)).join("");

    els.categoryChips.innerHTML =
      chipMarkup("category", "all", "All categories") +
      CATEGORIES.map((category) =>
        chipMarkup("category", category, category)
      ).join("");

    [els.yearChips, els.categoryChips].forEach((group) => {
      group.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-filter-kind]");
        if (!button) return;

        const kind = button.dataset.filterKind;
        const value = button.dataset.filterValue;

        state.filters[kind] = value;
        state.deckType = "standard";
        state.quiz = null;

        rebuildDeck({ resetUsed: true });
        drawNext();
        saveState();
        renderAll();
      });
    });
  }

  function chipMarkup(kind, value, label) {
    return `
      <button
        class="chip"
        type="button"
        data-filter-kind="${kind}"
        data-filter-value="${escapeHtml(value)}"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }

  function rebuildDeck(options = {}) {
    const { resetUsed = false, preserveCurrent = false } = options;

    stopTimer();

    if (resetUsed) {
      state.sessionUsedIds = [];
    }

    if (state.mode === "quiz") {
      queue = buildQuizQueue();

      state.quiz = {
        total: queue.length,
        answered: 0,
        score: 0,
        maxScore: queue.reduce((sum, item) => sum + item.value, 0)
      };
    } else if (state.deckType === "missed") {
      queue = buildMissedQueue(false);
    } else {
      queue = shuffle(
        filteredPool().filter(
          (item) => !state.sessionUsedIds.includes(item.id)
        )
      );
    }

    if (!preserveCurrent) {
      current = null;
    }
  }

  function buildQuizQueue() {
    const pool = filteredPool();
    const quizCards = [];

    VALUE_ORDER.forEach((value) => {
      const candidates = pool.filter((item) => item.value === value);
      if (candidates.length) {
        quizCards.push(shuffle(candidates)[0]);
      }
    });

    return shuffle(quizCards);
  }

  function buildMissedQueue(onlyDue) {
    const now = Date.now();

    return shuffle(
      Object.values(state.missed)
        .filter((entry) => !onlyDue || entry.dueAt <= now)
        .map((entry) => byId(entry.id))
        .filter(Boolean)
        .filter(matchesFilters)
    );
  }

  function startMissedReview(onlyDue) {
    state.deckType = "missed";
    state.mode = "study";
    state.quiz = null;
    queue = buildMissedQueue(onlyDue);
    current = null;

    drawNext();
    saveState();
  }

  function filteredPool() {
    return DATA.filter(matchesFilters);
  }

  function matchesFilters(item) {
    const yearOk =
      state.filters.year === "all" ||
      String(item.year) === String(state.filters.year);

    const categoryOk =
      state.filters.category === "all" ||
      item.category === state.filters.category;

    return yearOk && categoryOk;
  }

  function drawNext() {
    if (current && !finalizedCurrent) {
      finalizeAttempt("skipped");
    }

    stopTimer();

    if (queue.length === 0) {
      if (state.mode !== "quiz" && state.deckType === "standard") {
        rebuildDeck({ preserveCurrent: false });
      }
    }

    current = queue.shift() || null;
    flipped = false;
    finalizedCurrent = false;

    if (current && state.deckType === "standard") {
      addUnique(state.sessionUsedIds, current.id);
    }

    saveState();
    renderAll();
    restartTimer();
  }

  function loadSpecificQuestion(id, source) {
    const item = byId(id);
    if (!item) return;

    if (current && !finalizedCurrent) {
      finalizeAttempt("skipped");
    }

    stopTimer();

    current = item;
    flipped = false;
    finalizedCurrent = false;
    state.deckType = source === "missed" ? "missed" : "standard";

    renderAll();
    restartTimer();
  }

function toggleCard() {
  if (!current) return;

  if (flipped) {
    flipToQuestion();
  } else {
    flipToResponse();
  }
}

function flipToResponse() {
  if (!current || flipped) return;

  flipped = true;
  stopTimer(false);
  renderCard();
  renderControls();
  renderTimer();
}

function flipToQuestion() {
  if (!current || !flipped) return;

  flipped = false;
  renderCard();
  renderControls();
  renderTimer();
}

  function markCurrent(result) {
    if (!current || finalizedCurrent) return;

    if (!flipped) {
      flipped = true;
    }

    stopTimer(false);
    finalizeAttempt(result);
    renderAll();
  }

  function finalizeAttempt(result) {
    if (!current || finalizedCurrent) return;

    finalizedCurrent = true;

    const record = {
      id: current.id,
      result,
      at: Date.now(),
      year: current.year,
      category: current.category,
      value: current.value,
      question: current.question,
      answer: current.answer
    };

    state.history.unshift(record);
    state.history = state.history.slice(0, 200);

    if (result === "correct" || result === "missed") {
      updateStats(result, current);
    }

    if (result === "missed") {
      scheduleMissed(current);
    }

    if (result === "correct") {
      clearMissedIfReviewing(current.id);
    }

    if (
      state.mode === "quiz" &&
      state.quiz &&
      (result === "correct" || result === "missed")
    ) {
      state.quiz.answered += 1;

      if (result === "correct") {
        state.quiz.score += current.value;
      }
    }

    saveState();
  }

  function updateStats(result, item) {
    state.stats.attempted += 1;

    if (result === "correct") {
      state.stats.correct += 1;
      state.stats.score += item.value;
    } else {
      state.stats.missed += 1;
    }

    const cat = state.stats.byCategory[item.category] ||= {
      attempted: 0,
      correct: 0
    };

    cat.attempted += 1;

    if (result === "correct") {
      cat.correct += 1;
    }

    const value = state.stats.byValue[item.value] ||= {
      attempted: 0,
      correct: 0
    };

    value.attempted += 1;

    if (result === "correct") {
      value.correct += 1;
    }
  }

  function scheduleMissed(item) {
    const existing = state.missed[item.id] || {
      id: item.id,
      misses: 0,
      reviews: 0
    };

    existing.misses += 1;
    existing.lastMissedAt = Date.now();
    existing.dueAt = Date.now() + nextIntervalMs(existing.misses);

    state.missed[item.id] = existing;
  }

  function clearMissedIfReviewing(id) {
    if (state.deckType === "missed" && state.missed[id]) {
      delete state.missed[id];
    }
  }

  function nextIntervalMs(misses) {
    const minutes = [1, 5, 20, 60, 240, 1440][Math.min(misses - 1, 5)];
    return minutes * 60 * 1000;
  }

  function restartTimer() {
    stopTimer(false);

    if (!current || flipped || finalizedCurrent || !state.timerSeconds) {
      renderTimer();
      return;
    }

    timerStartedAt = Date.now();
    timerEndsAt = timerStartedAt + state.timerSeconds * 1000;
    timerId = window.setInterval(tickTimer, 100);

    tickTimer();
  }

  function tickTimer() {
    const remaining = timerEndsAt - Date.now();

    if (remaining <= 0) {
      stopTimer(false);
      flipped = true;
      finalizeAttempt("missed");
      flashNotice("Time expired — marked missed.");
      renderAll();
      return;
    }

    renderTimer();
  }

  function stopTimer(reset = true) {
    if (timerId) {
      window.clearInterval(timerId);
    }

    timerId = null;

    if (reset) {
      timerStartedAt = 0;
      timerEndsAt = 0;
    }
  }

  function renderAll() {
    renderFilterStates();
    renderModeStates();
    renderCard();
    renderControls();
    renderMeta();
    renderHistory();
    renderMissed();
    renderStats();
    renderTimer();
    renderQuizBanner();
  }

  function renderFilterStates() {
    $$("[data-filter-kind='year']").forEach((button) => {
      button.classList.toggle(
        "active",
        String(button.dataset.filterValue) === String(state.filters.year)
      );
    });

    $$("[data-filter-kind='category']").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.filterValue === state.filters.category
      );
    });
  }

  function renderModeStates() {
    $$("[data-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.mode);
    });

    els.timerSelect.value = String(state.timerSeconds);
  }

  function renderCard() {
    els.card.classList.toggle("is-flipped", flipped);
    els.card.classList.toggle("is-empty", !current);

    if (!current) {
      const poolSize = filteredPool().length;

      const title =
        state.deckType === "missed"
          ? "No missed questions due"
          : state.mode === "quiz"
            ? "Quiz complete"
            : "Deck complete";

      const subtitle =
        state.deckType === "missed"
          ? "You do not have missed questions matching these filters."
          : poolSize
            ? "Reset the session or change filters to keep drilling."
            : "No questions match the selected filters.";

      els.cardFront.innerHTML = emptyCardMarkup(title, subtitle);
      els.cardBack.innerHTML = emptyCardMarkup(title, subtitle);
      return;
    }

    els.cardFront.innerHTML = `
      <div class="card-topline">
        <span class="badge badge-green">${escapeHtml(current.category)}</span>
        <span class="badge">${current.year}</span>
      </div>

      <p class="eyebrow">Question</p>
      <h2>${escapeHtml(current.question)}</h2>
      <p class="card-hint">Click the card, press Space, or use Show Response.</p>
    `;

    els.cardBack.innerHTML = `
      <div class="answer-layout">
        <div class="buzzer-chip" aria-label="${current.value} point question">
          <span>${current.value}</span>
          <small>pts</small>
        </div>

        <div>
          <div class="card-topline compact">
            <span class="badge badge-green">${escapeHtml(current.category)}</span>
            <span class="badge">${current.year}</span>
          </div>

          <p class="eyebrow">Response</p>
          <h2>${escapeHtml(current.answer)}</h2>
          <p class="answer-meta">Question value: <strong>${current.value}</strong></p>
        </div>
      </div>
    `;
  }

  function emptyCardMarkup(title, subtitle) {
    return `
      <div class="empty-card">
        <p class="eyebrow">AAEA Drill Deck</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </div>
    `;
  }

  function renderControls() {
    const hasCurrent = Boolean(current);

    els.showResponseBtn.disabled = !hasCurrent;
    els.showResponseBtn.textContent = flipped ? "Show Question" : "Show Response";
    els.gotItBtn.disabled = !hasCurrent || finalizedCurrent;
    els.missedBtn.disabled = !hasCurrent || finalizedCurrent;
    els.nextBtn.disabled = !hasCurrent && queue.length === 0;
    els.shuffleBtn.disabled = queue.length < 2;
    els.reviewMissedBtn.disabled = Object.keys(state.missed).length === 0;

    els.gotItBtn.textContent = finalizedCurrent ? "Recorded" : "Got It";
    els.nextBtn.textContent = current ? "Next Question" : "Load Question";
  }

  function renderMeta() {
    const poolSize = filteredPool().length;
    const asked = state.history.length;
    const accuracy = state.stats.attempted
      ? Math.round((state.stats.correct / state.stats.attempted) * 100)
      : 0;

    els.deckCount.textContent =
      state.mode === "quiz" && state.quiz
        ? `${queue.length} left in quiz`
        : `${queue.length}${current ? " + current" : ""} / ${poolSize} available`;

    els.askedCount.textContent = `${asked} in history`;
    els.accuracyText.textContent = `${accuracy}% accuracy`;
    els.scoreText.textContent = `${state.stats.score} pts banked`;
  }

  function renderTimer() {
    const active = Boolean(timerId && timerEndsAt && current && !flipped);

    els.timerWrap.classList.toggle(
      "active",
      active || Boolean(state.timerSeconds)
    );

    if (!state.timerSeconds) {
      els.timerFill.style.width = "0%";
      els.timerText.textContent = "Timer off";
      return;
    }

    if (!active) {
      els.timerFill.style.width = current && !flipped ? "100%" : "0%";
      els.timerText.textContent = `${state.timerSeconds}s timer`;
      return;
    }

    const total = timerEndsAt - timerStartedAt;
    const remaining = Math.max(0, timerEndsAt - Date.now());
    const percent = Math.max(0, Math.min(100, (remaining / total) * 100));

    els.timerFill.style.width = `${percent}%`;
    els.timerText.textContent = `${Math.ceil(remaining / 1000)}s`;
  }

  function renderQuizBanner() {
    if (state.mode !== "quiz" || !state.quiz) {
      els.quizBanner.hidden = true;
      return;
    }

    els.quizBanner.hidden = false;

    els.quizBanner.innerHTML = `
      <strong>Quiz mode</strong>
      <span>${state.quiz.answered}/${state.quiz.total} answered</span>
      <span>${state.quiz.score}/${state.quiz.maxScore} points</span>
    `;
  }

  function renderHistory() {
    if (!state.history.length) {
      els.historyList.innerHTML = `
        <p class="muted">
          Questions you answer, miss, skip, or time out on will appear here.
        </p>
      `;
      return;
    }

    els.historyList.innerHTML = state.history
      .slice(0, 80)
      .map(
        (item) => `
          <article class="side-card">
            <div class="side-card-head">
              <span class="result ${item.result}">${labelResult(item.result)}</span>
              <span>${item.category} · ${item.year} · ${item.value} pts</span>
            </div>

            <p>${escapeHtml(item.question)}</p>

            <details>
              <summary>Answer</summary>
              <p>${escapeHtml(item.answer)}</p>
            </details>

            <button class="mini-btn" type="button" data-review-id="${escapeHtml(item.id)}">
              Go back to this question
            </button>
          </article>
        `
      )
      .join("");
  }

  function renderMissed() {
    const missed = Object.values(state.missed)
      .map((entry) => ({ ...entry, card: byId(entry.id) }))
      .filter((entry) => entry.card)
      .sort((a, b) => a.dueAt - b.dueAt);

    const dueCount = missed.filter((entry) => entry.dueAt <= Date.now()).length;

    if (!missed.length) {
      els.missedList.innerHTML = `
        <p class="muted">
          Missed questions will collect here. Getting one right during missed
          review removes it from the pile.
        </p>
      `;
      return;
    }

    els.missedList.innerHTML = `
      <div class="missed-actions">
        <button class="mini-btn" type="button" data-review-due="true">
          Review due now (${dueCount})
        </button>
      </div>

      ${missed
        .map(
          (entry) => `
            <article class="side-card">
              <div class="side-card-head">
                <span class="result missed">Missed x${entry.misses}</span>
                <span>${entry.card.category} · ${entry.card.year} · ${entry.card.value} pts</span>
              </div>

              <p>${escapeHtml(entry.card.question)}</p>
              <p class="muted">Due ${formatDue(entry.dueAt)}</p>

              <button class="mini-btn" type="button" data-review-id="${escapeHtml(entry.id)}">
                Review now
              </button>
            </article>
          `
        )
        .join("")}
    `;
  }

  function renderStats() {
    const accuracy = state.stats.attempted
      ? Math.round((state.stats.correct / state.stats.attempted) * 100)
      : 0;

    const categoryRows = CATEGORIES.map((category) =>
      statRow(category, state.stats.byCategory[category])
    ).join("");

    const valueRows = VALUE_ORDER.map((value) =>
      statRow(`${value} pts`, state.stats.byValue[value])
    ).join("");

    els.statsPanel.innerHTML = `
      <div class="stat-grid">
        <div class="stat-box">
          <strong>${state.stats.attempted}</strong>
          <span>Attempts</span>
        </div>

        <div class="stat-box">
          <strong>${state.stats.correct}</strong>
          <span>Correct</span>
        </div>

        <div class="stat-box">
          <strong>${state.stats.missed}</strong>
          <span>Missed</span>
        </div>

        <div class="stat-box">
          <strong>${accuracy}%</strong>
          <span>Accuracy</span>
        </div>
      </div>

      <h3>By category</h3>
      <div class="stats-list">${categoryRows}</div>

      <h3>By value</h3>
      <div class="stats-list">${valueRows}</div>

      <button class="mini-btn danger" type="button" id="resetStatsBtn">
        Reset stats and history
      </button>
    `;

    $("#resetStatsBtn").addEventListener("click", () => {
      state.stats = freshStats();
      state.history = [];
      state.missed = {};
      saveState();
      renderAll();
    });
  }

  function statRow(label, data) {
    const attempted = data?.attempted || 0;
    const correct = data?.correct || 0;
    const percent = attempted ? Math.round((correct / attempted) * 100) : 0;

    return `
      <div class="stat-row">
        <div class="stat-row-top">
          <span>${escapeHtml(label)}</span>
          <span>${correct}/${attempted} · ${percent}%</span>
        </div>

        <div class="bar">
          <span style="width:${percent}%"></span>
        </div>
      </div>
    `;
  }

  function hydrateState() {
    const saved = readStorage();

    return {
      ...state,
      ...saved,
      filters: { ...state.filters, ...(saved.filters || {}) },
      stats: { ...freshStats(), ...(saved.stats || {}) },
      sessionUsedIds: Array.isArray(saved.sessionUsedIds)
        ? saved.sessionUsedIds
        : [],
      history: Array.isArray(saved.history) ? saved.history : [],
      missed:
        saved.missed && typeof saved.missed === "object" ? saved.missed : {}
    };
  }

  function readStorage() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private browsing or localStorage limits should not break the app.
    }
  }

  function freshStats() {
    return {
      attempted: 0,
      correct: 0,
      missed: 0,
      score: 0,
      byCategory: {},
      byValue: {}
    };
  }

  function byId(id) {
    return DATA.find((item) => item.id === id);
  }

  function addUnique(array, value) {
    if (!array.includes(value)) {
      array.push(value);
    }
  }

  function shuffle(input) {
    const array = [...input];

    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/Page\s+\d+\s+of\s+\d+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function labelResult(result) {
    return (
      {
        correct: "Got It",
        missed: "Missed",
        skipped: "Skipped"
      }[result] || result
    );
  }

  function formatDue(timestamp) {
    const diff = timestamp - Date.now();

    if (diff <= 0) return "now";

    const minutes = Math.ceil(diff / 60000);

    if (minutes < 60) return `in ${minutes} min`;

    const hours = Math.ceil(minutes / 60);

    if (hours < 24) return `in ${hours} hr`;

    return `in ${Math.ceil(hours / 24)} day(s)`;
  }

  function flashNotice(message) {
    els.deckNotice.textContent = message;
    els.deckNotice.classList.add("show");

    window.setTimeout(() => {
      els.deckNotice.classList.remove("show");
    }, 1600);
  }
})();

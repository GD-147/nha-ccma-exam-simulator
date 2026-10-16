// app/runner.js

function decodeHtmlEntitiesDeep(text = "") {
  let s = String(text);

  for (let i = 0; i < 3; i++) {
    const ta = document.createElement("textarea");
    ta.innerHTML = s;
    const decoded = ta.value;
    if (decoded === s) break;
    s = decoded;
  }

  return s;
}

function renderInlineMarkup(text = "") {
  let s = decodeHtmlEntitiesDeep(text);

  // lascia passare solo tag semplici e sicuri
  s = s.replace(/<(?!\/?(u|i|br)\b)[^>]*>/gi, "");

  return s;
}

function normalizeAnswerList(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim().toUpperCase()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map(v => v.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeQuestion(q) {
  const choices = {};
  for (const [k, v] of Object.entries(q.choices || {})) {
    choices[String(k).trim().toUpperCase()] = decodeHtmlEntitiesDeep(v);
  }

  const rawType = String(q.itemType || q.type || "").trim().toLowerCase();

  let itemType = "mcq_single";

  if (
    rawType === "multi_select" ||
    rawType === "multiselect" ||
    rawType === "multiple_select"
  ) {
    itemType = "multi_select";
  } else if (
    rawType === "constructed" ||
    rawType === "constructed_response"
  ) {
    itemType = "constructed_response";
  }

  const correctAnswers = normalizeAnswerList(
    q.correctAnswers != null ? q.correctAnswers : q.correct
  );

  return {
    ...q,
    itemType,
    correct: correctAnswers[0] || "",
    correctAnswers,
    domain: String(q.domain || q.Domain || "").trim(),
    skill: String(q.skill || q.Skill || "").trim(),
    part: String(q.part || "").trim(),
    credits: Number(q.credits || 0),
    prompt: decodeHtmlEntitiesDeep(q.prompt || ""),
    isScenarioBased: q.isScenarioBased === true,
    unscored: q.unscored === true || q.isUnscored === true || q.pilot === true,
    scenarioContext: decodeHtmlEntitiesDeep(q.scenarioContext || ""),
    instruction: decodeHtmlEntitiesDeep(q.instruction || ""),
    explanation: decodeHtmlEntitiesDeep(q.explanation || ""),
    modelAnswer: decodeHtmlEntitiesDeep(q.modelAnswer || ""),
    scoringGuidance: decodeHtmlEntitiesDeep(q.scoringGuidance || ""),
    rubric: decodeHtmlEntitiesDeep(q.rubric || ""),
    choices
  };
}
function renderQuestionPrompt(q) {
  const questionHtml =
    `<div class="questionPrompt">${renderInlineMarkup(q.prompt || "")}</div>`;

  if (!q.isScenarioBased || !q.scenarioContext) {
    return questionHtml;
  }

  const scenarioHtml =
    `<div class="scenarioContext">` +
      `<span class="scenarioLabel">Scenario</span>` +
      `<div>${renderInlineMarkup(q.scenarioContext)}</div>` +
    `</div>`;

  return scenarioHtml + questionHtml;
}

function getPartLabel(q) {
  const part = String(q.part || "").trim();
  const credits = Number(q.credits || 0);
  const creditText = credits ? `${credits} credit${credits === 1 ? "" : "s"}` : "";
  return [part ? `Part ${part}` : "", creditText].filter(Boolean).join(" — ");
}

function getDefaultInstruction(q) {
  if (q.itemType === "constructed_response") {
    return "Show your work. Use the response box to write your reasoning and final answer.";
  }

  if (q.itemType === "multi_select") {
    const required = (q.correctAnswers || []).length;
    return required
      ? `Select exactly ${required} answer${required === 1 ? "" : "s"}.`
      : "Select all required answers.";
  }

  return "Select one answer choice.";
}

function normalizeSelectedAnswer(value) {
  if (Array.isArray(value)) {
    return [...value].map(v => String(v).toUpperCase()).sort();
  }

  if (!value) return [];

  return String(value)
    .split(",")
    .map(v => v.trim().toUpperCase())
    .filter(Boolean)
    .sort();
}

function isQuestionCorrect(q, answer) {
  if (q.itemType === "multi_select") {
    const user = normalizeSelectedAnswer(answer);
    const correct = normalizeSelectedAnswer(q.correctAnswers);

    return (
      user.length === correct.length &&
      user.every((value, index) => value === correct[index])
    );
  }

  return String(answer || "").toUpperCase() === String(q.correct || "").toUpperCase();
}

function formatAnswer(answer) {
  if (Array.isArray(answer)) {
    return answer.length ? answer.join(", ") : "(no answer)";
  }

  return answer || "(no answer)";
}

function answerDraftKey(examId, sectionId, qid) {
  return `constructedDraft_${examId}_${sectionId}_${qid}`;
}
function normalizeDomain(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  const aliases = {
    "1": "I",
    "I": "I",
    "DOMAIN 1": "I",
    "DOMAIN I": "I",
    "FOUNDATIONAL KNOWLEDGE AND BASIC SCIENCE": "I",
    "2": "II",
    "II": "II",
    "DOMAIN 2": "II",
    "DOMAIN II": "II",
    "ANATOMY AND PHYSIOLOGY": "II",
    "3": "III",
    "III": "III",
    "DOMAIN 3": "III",
    "DOMAIN III": "III",
    "CLINICAL PATIENT CARE": "III",
    "4": "IV",
    "IV": "IV",
    "DOMAIN 4": "IV",
    "DOMAIN IV": "IV",
    "PATIENT CARE COORDINATION AND EDUCATION": "IV",
    "5": "V",
    "V": "V",
    "DOMAIN 5": "V",
    "DOMAIN V": "V",
    "ADMINISTRATIVE ASSISTING": "V",
    "6": "VI",
    "VI": "VI",
    "DOMAIN 6": "VI",
    "DOMAIN VI": "VI",
    "COMMUNICATION AND CUSTOMER SERVICE": "VI",
    "7": "VII",
    "VII": "VII",
    "DOMAIN 7": "VII",
    "DOMAIN VII": "VII",
    "MEDICAL LAW AND ETHICS": "VII",
  };
  return aliases[raw] || raw;
}

function filterQuestionsForSection(questions, section) {
  if (!section.domain) return questions;

  const target = normalizeDomain(section.domain);

  return questions.filter(q =>
    !q.unscored &&
    normalizeDomain(q.domain) === target
  );
}

async function loadQuestionFiles(examId, files) {
  const all = [];

  for (const f of files) {
    const path = `../packs/${examId}/data/${f}`;
    const res = await fetch(path, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`Missing question file: ${path}`);
    }

    const raw = await res.json();

    const rawQuestions = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw.questions) ? raw.questions : []);

    all.push({
      file: f,
      questions: rawQuestions.map(normalizeQuestion)
    });
  }

  return all;
}

async function loadQuestionsForSection(examId, section, cfg) {
  let files = [];

  if (section.examFiles && section.examFiles.length) {
    files = section.examFiles;
  } else if (cfg.examFiles && cfg.examFiles.length) {
    files = cfg.examFiles;
  } else {
    files = [`nha-ccma_exam_01.json`];
  }

  return loadQuestionFiles(examId, files);
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function decodeHtmlEntitiesDeep(text = "") {
  let s = String(text);

  for (let i = 0; i < 3; i++) {
    const ta = document.createElement("textarea");
    ta.innerHTML = s;
    const decoded = ta.value;

    if (decoded === s) break;
    s = decoded;
  }

  return s;
}

function renderInlineMarkup(text = "") {
  let s = decodeHtmlEntitiesDeep(text);

  // lascia passare solo tag semplici e sicuri
  s = s.replace(/<(?!\/?(u|i|br)\b)[^>]*>/gi, "");

  return s;
}
function practiceCursorKey(examId, sectionId) {
  return `practiceCursor_${examId}_${sectionId}`;
}

function getPracticeSlice(allQs, chunkSize, examId, sectionId) {
  const key = practiceCursorKey(examId, sectionId);
  let cursor = parseInt(localStorage.getItem(key) || "0", 10);

  if (cursor >= allQs.length) cursor = 0;

  const start = cursor;
  const end = Math.min(cursor + chunkSize, allQs.length);

  const slice = allQs.slice(start, end);

  cursor = end;
  if (cursor >= allQs.length) cursor = 0;
  localStorage.setItem(key, String(cursor));

  return { slice, start, end, total: allQs.length };
}



function qs(id) { return document.getElementById(id); }

(async function () {
  const examId = getExamFromUrl();
  if (!isAccessGranted(examId)) { goToWelcome(examId); return; }

  const cfg = await loadConfig(examId);
  applyTheme(cfg.theme || "dark");
  qs("brand").textContent = cfg.brandName;
  qs("logo").src = cfg.logoPath;

  const params = new URLSearchParams(window.location.search);
  const sectionId = params.get("section");
  const mode = params.get("mode"); // "exam" | "practice"

  const section = cfg.sections.find(s => s.id === sectionId);
  if (!section) {
    qs("title").textContent = "Error";
    qs("desc").textContent = "Unknown section.";
    return;
  }

  // Essay placeholder (gestiamo Writing nello step successivo)
  // ===== ESSAY MODE =====
if (section.type === "essay") {
  const examSets = await loadQuestionsForSection(examId, section, cfg);
  const pooledPrompts = examSets.flatMap(s => s.questions || []);

  if (!pooledPrompts.length) {
    qs("title").textContent = "No essay prompt available";
    qs("desc").textContent = "No essay prompt was found for this section. Check the imported JSON file and config.json.";
    return;
  }

  // pick prompt (rotate like exams; practice also cycles)
  let promptObj = null;
  let metaText = "";

  if (mode === "practice") {
    const key = `essayCursor_${examId}_${sectionId}`;
    let cur = parseInt(localStorage.getItem(key) || "0", 10);
    if (!Number.isFinite(cur) || cur < 0 || cur >= pooledPrompts.length) cur = 0;
    promptObj = pooledPrompts[cur];
    localStorage.setItem(key, String((cur + 1) % pooledPrompts.length));
    metaText = `Prompt: ${promptObj.id || "Essay"} (practice)`;
  } else {
    const rotKey = `essayRotation_${examId}_${sectionId}`;
    let rot = parseInt(localStorage.getItem(rotKey) || "0", 10);
    if (!Number.isFinite(rot) || rot < 0 || rot >= pooledPrompts.length) rot = 0;
    promptObj = pooledPrompts[rot];
    localStorage.setItem(rotKey, String((rot + 1) % pooledPrompts.length));
    metaText = `Prompt: ${promptObj.id || "Essay"} (timed)`;
  }

  if (!promptObj || !promptObj.prompt) {
    qs("title").textContent = "Essay prompt error";
    qs("desc").textContent = "The essay file loaded, but the prompt field is missing.";
    return;
  }

  // show essay panel
  qs("runnerPanel").classList.add("hidden");
  qs("resultsPanel").classList.add("hidden");
  qs("essayPanel").classList.remove("hidden");
  qs("essayResultsPanel").classList.add("hidden");

  qs("essayTitle").textContent = `${section.label} — ${mode === "practice" ? "Practice Mode" : "Exam Mode"}`;
  qs("essayDesc").textContent = mode === "practice"
    ? "Untimed writing practice. Use this to rehearse structure and evidence."
    : `Timed writing: ${section.timeMin} minutes.`;
  qs("essayMeta").textContent = metaText;

  qs("essayPrompt").innerHTML = renderInlineMarkup(promptObj.prompt);

  // timer for exam mode
  let timerInterval = null;
  let remaining = section.timeMin * 60;
  const startTime = Date.now();

  if (mode !== "practice") {
    const timerEl = qs("timer");
    if (timerEl) timerEl.classList.remove("hidden");
    if (timerEl) timerEl.textContent = fmtTime(remaining);
    timerInterval = setInterval(() => {
      remaining--;
      if (timerEl) timerEl.textContent = fmtTime(Math.max(0, remaining));
      if (remaining <= 0) finishEssay();
    }, 1000);
  } else {
    const timerEl = qs("timer");
    if (timerEl) timerEl.classList.add("hidden");
  }

  // autosave key per prompt
  const draftKey = `draft_${examId}_${sectionId}_${promptObj.id}`;
  const box = qs("essayText");

  // load draft if exists
  box.value = localStorage.getItem(draftKey) || "";

  function updateWordCount() {
    const words = box.value.trim() ? box.value.trim().split(/\s+/).length : 0;
    qs("wordCount").textContent = String(words);
  }
  updateWordCount();

  box.addEventListener("input", () => {
    updateWordCount();
    localStorage.setItem(draftKey, box.value);
  });

  qs("essaySaveBtn").addEventListener("click", () => {
    localStorage.setItem(draftKey, box.value);
  });

  function finishEssay() {
    if (timerInterval) clearInterval(timerInterval);

    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const words = box.value.trim() ? box.value.trim().split(/\s+/).length : 0;

    qs("essayPanel").classList.add("hidden");
    qs("essayResultsPanel").classList.remove("hidden");

    qs("essayTimeLine").textContent = `Time used: ${fmtTime(elapsedSec)}`;
    qs("essayWordLine").textContent = `Word count: ${words}`;

    const modelGuidanceEl = qs("essayModelGuidance");
    if (modelGuidanceEl) {
      modelGuidanceEl.innerHTML = promptObj.modelAnswer
        ? `<strong>Model guidance:</strong><br>${renderInlineMarkup(promptObj.modelAnswer)}`
        : `<strong>Model guidance:</strong><br>Review whether your essay presents a clear position, develops ideas with specific support, uses logical organization, and demonstrates control of Standard English.`;
    }

    const rubricEl = qs("essayRubric");
    if (rubricEl) {
      rubricEl.innerHTML = promptObj.rubric
        ? `<strong>Rubric:</strong><br>${renderInlineMarkup(promptObj.rubric)}`
        : `<strong>Rubric:</strong><br>Evaluate your essay for focus, development, organization, sentence control, and conventions.`;
    }

    qs("essayHomeBtn").onclick = () => {
      window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
    };
  }

  qs("essayFinishBtn").addEventListener("click", finishEssay);
  qs("backLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
  });

  return;
  }

  // Carica domande MCQ (supporta più examFiles)
  const loadedExamSets = await loadQuestionsForSection(examId, section, cfg);

  const examSets = loadedExamSets
    .map(set => ({
      ...set,
      questions: filterQuestionsForSection(set.questions, section)
    }))
    .filter(set => set.questions.length > 0);

  if (!examSets.length) {
    throw new Error(`No questions available for section: ${section.label}`);
  }

  // Pool globale per Practice Mode
  const pooledQs = examSets.flatMap(set => set.questions);

  // Scegli set domande per la sessione
let sessionQs;
let metaText = "";

if (mode === "practice") {
  const info = getPracticeSlice(pooledQs, cfg.practiceChunkSize || 10, examId, sectionId);
  sessionQs = info.slice;
  metaText = `Practice block: ${info.start + 1}–${info.end} of ${info.total}`;
} else {
  const rotKey = `examRotation_${examId}_${sectionId}`;
  let rot = parseInt(localStorage.getItem(rotKey) || "0", 10);

  if (rot >= examSets.length) rot = 0;

  const chosen = examSets[rot];

  if (!chosen) {
    throw new Error(`No exam set available for section: ${section.label}`);
  }

  localStorage.setItem(
    rotKey,
    String((rot + 1) % examSets.length)
  );

  if (section.id === "full") {
    const expectedCount = Number(section.questionCount || 0);

    if (
      expectedCount > 0 &&
      chosen.questions.length !== expectedCount
    ) {
      throw new Error(
        `${chosen.file} must contain exactly ${expectedCount} questions for Full-Length Exam Mode; found ${chosen.questions.length}.`
      );
    }

    sessionQs = chosen.questions;

    metaText =
      `Full-Length Practice Test — ${chosen.file} — ${sessionQs.length} questions`;
  } else {
    sessionQs = chosen.questions;

    metaText =
      `${section.label} — ${chosen.file} — ${sessionQs.length} questions`;
  }
}

// stampa subito la riga meta
const metaEl = qs("metaLine");
if (metaEl) metaEl.textContent = metaText;


  // UI state
  let idx = 0;
  const answers = {}; // q.id -> single answer string or multi-select array
  const startTime = Date.now();

  // Timer (solo Exam Mode)
  let timerInterval = null;
  let remaining = section.timeMin * 60;

  function render() {
    const q = sessionQs[idx];
    qs("title").textContent = `${section.label} — ${mode === "practice" ? "Practice Mode" : "Exam Mode"}`;
    qs("desc").textContent = mode === "practice"
      ? `10-question set (progress cycles automatically).`
      : `Timed full section: ${sessionQs.length} questions in ${section.timeMin} minutes.`;

      qs("metaLine").textContent = metaText;

    qs("progress").textContent = `Question ${idx + 1} of ${sessionQs.length}`;

    const partEl = qs("itemPart");
    if (partEl) partEl.textContent = getPartLabel(q);

    const instructionEl = qs("itemInstruction");
    if (instructionEl) instructionEl.textContent = q.instruction || getDefaultInstruction(q);

    qs("prompt").innerHTML = renderQuestionPrompt(q);

    const box = qs("choices");
    box.innerHTML = "";

    if (q.itemType === "constructed_response") {
      const wrap = document.createElement("div");
      wrap.className = "constructedWrap";

      const label = document.createElement("label");
      label.className = "label";
      label.textContent = "Your Response";

      const textarea = document.createElement("textarea");
      textarea.className = "essayBox";
      textarea.placeholder = "Write your work, reasoning, and final answer here.";

      const draftKey = answerDraftKey(examId, sectionId, q.id);
      const saved = answers[q.id] ?? localStorage.getItem(draftKey) ?? "";
      textarea.value = saved;
      answers[q.id] = saved;

      textarea.addEventListener("input", () => {
        answers[q.id] = textarea.value;
        localStorage.setItem(draftKey, textarea.value);
      });

      const helper = document.createElement("p");
      helper.className = "helper";
      helper.textContent = "Your response is saved automatically in this browser.";

      wrap.appendChild(label);
      wrap.appendChild(textarea);
      wrap.appendChild(helper);
      box.appendChild(wrap);
    } else {
      const letters = Object.keys(q.choices || {}).sort();

      letters.forEach(letter => {
        const row = document.createElement("label");
        row.className = "choice";

        const input = document.createElement("input");
        input.name = `choice_${q.id}`;
        input.value = letter;

        if (q.itemType === "multi_select") {
          input.type = "checkbox";

          const selected = Array.isArray(answers[q.id])
            ? answers[q.id]
            : [];

          input.checked = selected.includes(letter);

          input.addEventListener("change", () => {
            let current = Array.isArray(answers[q.id])
              ? [...answers[q.id]]
              : [];

            const required = (q.correctAnswers || []).length;

            if (input.checked) {
              if (!current.includes(letter)) {
                if (required && current.length >= required) {
                  input.checked = false;
                  return;
                }
                current.push(letter);
              }
            } else {
              current = current.filter(v => v !== letter);
            }

            answers[q.id] = current.sort();

            if (required) {
              const selectedCount = answers[q.id].length;

              box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (!cb.checked) {
                  cb.disabled = selectedCount >= required;
                }
              });
            }
          });
        } else {
          input.type = "radio";
          input.checked = answers[q.id] === letter;

          input.addEventListener("change", () => {
            answers[q.id] = letter;
          });
        }

        const span = document.createElement("span");
        span.className = "choiceText";
        span.innerHTML = `${letter}. ${renderInlineMarkup(q.choices[letter])}`;

        row.appendChild(input);
        row.appendChild(span);
        box.appendChild(row);
      });

      if (q.itemType === "multi_select") {
        const required = (q.correctAnswers || []).length;
        const selected = Array.isArray(answers[q.id]) ? answers[q.id] : [];

        if (required && selected.length >= required) {
          box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            if (!cb.checked) cb.disabled = true;
          });
        }
      }
    }

    qs("prevBtn").disabled = idx === 0;
    qs("nextBtn").disabled = idx === sessionQs.length - 1;
  }

  function finish() {
    if (timerInterval) clearInterval(timerInterval);

    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

    const mcqQs = sessionQs.filter(q => q.itemType !== "constructed_response");
    const constructedQs = sessionQs.filter(q => q.itemType === "constructed_response");
    const scoredQs = mcqQs.filter(q => !q.unscored);
    const unscoredQs = mcqQs.filter(q => q.unscored);

    let correct = 0;

    scoredQs.forEach(q => {
      if (isQuestionCorrect(q, answers[q.id])) {
        correct++;
      }
    });

    const incorrect = scoredQs.length - correct;
    const pct = scoredQs.length ? Math.round((correct / scoredQs.length) * 100) : 0;

    qs("runnerPanel").classList.add("hidden");
    qs("resultsPanel").classList.remove("hidden");

    qs("scoreLine").textContent =
      `Practice performance: ${correct}/${scoredQs.length} scored questions correct (${pct}%). ` +
      `Correct: ${correct}. Incorrect: ${incorrect}.` +
      (unscoredQs.length
        ? ` ${unscoredQs.length} unscored pilot questions were excluded from this percentage.`
        : "");

    qs("timeLine").textContent = `Time used: ${fmtTime(elapsedSec)}`;

    const review = qs("review");
    review.innerHTML = "";

    sessionQs.forEach((q, i) => {
      const isConstructed = q.itemType === "constructed_response";
      const rawUser = answers[q.id];
      const user = formatAnswer(rawUser);
      const ok = !isConstructed && isQuestionCorrect(q, rawUser);

      const block = document.createElement("div");
      block.className = "reviewBlock";

      const num = document.createElement("div");
      num.className = isConstructed ? "qnum" : (ok ? "qnum qnum-ok" : "qnum qnum-bad");
      num.textContent = `Q${i + 1}`;

      const text = document.createElement("div");
      text.className = "reviewText";

      const part = document.createElement("div");
      part.className = "reviewAns";
      part.textContent = getPartLabel(q);

      const p = document.createElement("div");
      p.className = "reviewPrompt";
      p.innerHTML = renderQuestionPrompt(q);

      text.appendChild(part);
      text.appendChild(p);

      if (isConstructed) {
        const a = document.createElement("div");
        a.className = "reviewAns";
        a.textContent = `Your response: ${user}`;

        const model = document.createElement("div");
        model.className = "reviewExp";
        model.innerHTML = q.modelAnswer
          ? `<strong>Model answer:</strong><br>${renderInlineMarkup(q.modelAnswer)}`
          : "<strong>Model answer:</strong><br>Review the scoring guidance for this response.";

        const guidance = document.createElement("div");
        guidance.className = "reviewExp";
        guidance.innerHTML = q.scoringGuidance || q.rubric
          ? `<strong>Scoring guidance:</strong><br>${renderInlineMarkup(q.scoringGuidance || q.rubric)}`
          : "<strong>Scoring guidance:</strong><br>No rubric provided for this item.";

        text.appendChild(a);
        text.appendChild(model);
        text.appendChild(guidance);
      } else {
        const a = document.createElement("div");
        a.className = "reviewAns";

        const correctDisplay = q.itemType === "multi_select"
          ? (q.correctAnswers || []).join(", ")
          : q.correct;

        a.textContent = `Your answer: ${user}    |    Correct: ${correctDisplay}`;

        const ex = document.createElement("div");
        ex.className = "reviewExp";
        ex.textContent = q.explanation || "No explanation provided.";

        text.appendChild(a);
        text.appendChild(ex);
      }

      block.appendChild(num);
      block.appendChild(text);
      review.appendChild(block);
    });
  }

  if (mode !== "practice") {
    const timerEl = qs("timer");
    if (timerEl) timerEl.classList.remove("hidden");
    if (timerEl) timerEl.textContent = fmtTime(remaining);

    timerInterval = setInterval(() => {
      remaining--;
      if (timerEl) timerEl.textContent = fmtTime(Math.max(0, remaining));
      if (remaining <= 0) finish();
    }, 1000);
  }

  qs("prevBtn").addEventListener("click", () => { if (idx > 0) { idx--; render(); } });
  qs("nextBtn").addEventListener("click", () => { if (idx < sessionQs.length - 1) { idx++; render(); } });
  qs("finishBtn").addEventListener("click", finish);

  qs("backLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
  });

  qs("homeBtn").addEventListener("click", () => {
    window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
  });

  render();
})();

const sb = supabase.createClient(window.PASS_ONCE_URL, window.PASS_ONCE_KEY);
const $ = (id) => document.getElementById(id);

let signup = false,
  user = null,
  profile = null,
  classRow = null;
let currentSubject = null,
  currentTopic = null,
  currentQuestions = [],
  currentAnswers = [],
  currentIndex = 0,
  currentScore = 0,
  answered = false;
let periodicTestMode = false;

function show(id) {
  [
    "auth",
    "setup",
    "subjectSelect",
    "dash",
    "parentDash",
    "quiz",
    "lessonView",
    "tutorView",
  ].forEach((x) => $(x).classList.add("hidden"));

  $(id).classList.remove("hidden");
}
function message(text = "") {
  $("msg").textContent = text;
}
function parentMessage(text = "") {
  $("parentMsg").textContent = text;
}
function setupMessage(text = "") {
  $("setupMsg").textContent = text;
}
function escapeHtml(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[
        m
      ])
  );
}
function normalizeLevel(level) {
  return String(level || "JSS 1")
    .replace(/\s+/g, "")
    .toUpperCase();
}
function redirectUrl() {
  return window.location.origin + window.location.pathname;
}
async function getCurrentUser() {
  // A refresh may happen before a valid session exists. A missing session
  // is a normal signed-out state, not an error to show on the login screen.
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session?.user || null;
}

function setAuthMode(isSignup) {
  signup = isSignup;
  $("loginTab").classList.toggle("active", !signup);
  $("signupTab").classList.toggle("active", signup);
  $("nameBox").classList.toggle("hidden", !signup);
  $("accountTypeBox").classList.toggle("hidden", !signup);
  $("authBtn").innerHTML = signup
    ? "Create account <span>→</span>"
    : "Log in <span>→</span>";
  $("authTitle").textContent = signup
    ? "Create your Pass Once AI account"
    : "Welcome Back!";
  $("authSubtitle").textContent = signup
    ? "Start your learning journey today."
    : "Log in to continue your learning journey.";
  $("password").setAttribute(
    "autocomplete",
    signup ? "new-password" : "current-password"
  );
  message("");
}
$("loginTab").onclick = () => setAuthMode(false);
$("signupTab").onclick = () => setAuthMode(true);

$("authBtn").onclick = async () => {
  const email = $("email").value.trim(),
    password = $("password").value;
  if (!email || !password)
    return message("Please enter your email and password.");
  if (signup && !$("name").value.trim())
    return message("Please enter your full name.");
  try {
    $("authBtn").disabled = true;
    const result = signup
      ? await sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: $("name").value.trim(),
              account_type: $("accountType").value,
            },
            emailRedirectTo: redirectUrl(),
          },
        })
      : await sb.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (signup && !result.data.session) {
      message(
        "Account created! Check your email, then tap the verification link to return to Pass Once AI."
      );
      return;
    }
    await load();
  } catch (e) {
    message(e.message || "Authentication failed.");
  } finally {
    $("authBtn").disabled = false;
  }
};

async function load() {
  try {
    user = await getCurrentUser();
    if (!user) {
      $("logout").classList.add("hidden");
      show("auth");
      return;
    }
    $("logout").classList.remove("hidden");
    const { data: p, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!p) {
      const requestedRole =
        user.user_metadata?.account_type === "parent" ? "parent" : "student";
      prepareSetup(requestedRole);
      show("setup");
      return;
    }
    profile = p;
    if (profile.role === "parent") await renderParentDash();
    else await renderDash();
  } catch (e) {
    const msg = e.message || "Could not load your account.";
    // Treat an expired/missing auth session as signed out. Keep the login
    // screen clean; show messages only for errors that need user attention.
    if (/auth session missing|session missing|no session/i.test(msg)) {
      user = null;
      profile = null;
      $("logout").classList.add("hidden");
      show("auth");
      message("");
      return;
    }
    if ($("setupMsg") && !$("setup").classList.contains("hidden"))
      setupMessage("❌ " + msg);
    else message(msg);
  }
}

function prepareSetup(role) {
  $("setupPill").textContent =
    role === "parent" ? "Parent profile" : "Student profile";
  $("setupTitle").textContent =
    role === "parent"
      ? "Set up your parent account"
      : "Tell us about your learning";
  $("setupName").value = user?.user_metadata?.full_name || "";
  $("studentSetupFields").classList.toggle("hidden", role === "parent");
}

$("saveProfile").onclick = async () => {
  try {
    user = await getCurrentUser();
    if (!user) return show("auth");
    const role =
      user.user_metadata?.account_type === "parent" ? "parent" : "student";
    const p = {
      id: user.id,
      full_name:
        $("setupName").value.trim() ||
        user.user_metadata?.full_name ||
        user.email.split("@")[0],
      role,
    };
    if (role === "student") {
      p.country = $("country").value;
      p.level = $("level").value;
      p.language = $("language").value;
    }
    setupMessage("");
    const { data: savedProfile, error } = await sb
      .from("profiles")
      .insert(p)
      .select("*")
      .single();
    if (error) throw error;
    profile = savedProfile || p;
    if (role === "parent") await renderParentDash();
    else await renderDash();
  } catch (e) {
    setupMessage("❌ " + (e.message || "Could not save profile."));
  }
};

async function findClass() {
  const wanted = normalizeLevel(profile?.level);
  const { data, error } = await sb.from("classes").select("id,name");
  if (error) throw error;
  const found = (data || []).find((c) => normalizeLevel(c.name) === wanted);
  // Keep the current JSS1 practice demo usable even if the class mapping table is empty.
  if (found) return found;
  if (wanted === "JSS1") return { id: 1, name: "JSS1" };
  return null;
}

async function getStudentProgressData() {
  const { data: attempts, error } = await sb
    .from("quiz_attempts")
    .select("score,total,subject,topic_id,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const a = attempts || [];

  const attempted = a.reduce(
    (n, x) => n + Number(x.total || 0),
    0
  );

  const correct = a.reduce(
    (n, x) => n + Number(x.score || 0),
    0
  );

  const accuracy = attempted
    ? Math.round((correct / attempted) * 100)
    : 0;

  const { data: progress, error: progressError } = await sb
    .from("student_progress")
    .select("id,completed")
    .eq("student_id", user.id)
    .eq("completed", true);

  if (progressError) throw progressError;

  /* --------------------------------
     SUBJECT PROGRESS
  -------------------------------- */

  const bySubject = {};

  for (const item of a) {
    const subject = item.subject || "Other";

    if (!bySubject[subject]) {
      bySubject[subject] = {
        score: 0,
        total: 0,
        attempts: 0,
        last: item.created_at
      };
    }

    bySubject[subject].score += Number(item.score || 0);
    bySubject[subject].total += Number(item.total || 0);
    bySubject[subject].attempts++;

    if (
      new Date(item.created_at) >
      new Date(bySubject[subject].last || 0)
    ) {
      bySubject[subject].last = item.created_at;
    }
  }

  const subjectStats = Object.entries(bySubject)
    .map(([name, v]) => ({
      name,
      score: v.score,
      total: v.total,
      attempts: v.attempts,
      percentage: v.total
        ? Math.round((v.score / v.total) * 100)
        : 0,
      last: v.last
    }))
    .sort((a, b) => b.percentage - a.percentage);

  const bestSubject =
    subjectStats.length ? subjectStats[0] : null;

  const attentionSubject =
    subjectStats.length
      ? [...subjectStats].sort(
          (a, b) => a.percentage - b.percentage
        )[0]
      : null;

  /* --------------------------------
     TOPIC PROGRESS
  -------------------------------- */

  const topicIds = [
    ...new Set(
      a
        .filter(x => x.topic_id !== null)
        .map(x => Number(x.topic_id))
    )
  ];

  let topicRows = [];

  if (topicIds.length) {
    const { data: topics, error: topicError } = await sb
      .from("topics")
      .select("id,name")
      .in("id", topicIds);

    if (topicError) throw topicError;

    topicRows = topics || [];
  }

  const topicNames = {};

  for (const topic of topicRows) {
    topicNames[Number(topic.id)] = topic.name;
  }

  const byTopic = {};

  for (const item of a) {
    if (item.topic_id === null) continue;

    const topicId = Number(item.topic_id);

    if (!byTopic[topicId]) {
      byTopic[topicId] = {
        id: topicId,
        name: topicNames[topicId] || `Topic ${topicId}`,
        subject: item.subject || "Other",
        score: 0,
        total: 0,
        attempts: 0,
        last: item.created_at
      };
    }

    byTopic[topicId].score += Number(item.score || 0);
    byTopic[topicId].total += Number(item.total || 0);
    byTopic[topicId].attempts++;

    if (
      new Date(item.created_at) >
      new Date(byTopic[topicId].last || 0)
    ) {
      byTopic[topicId].last = item.created_at;
    }
  }

  const topicStats = Object.values(byTopic)
    .map(v => ({
      ...v,
      percentage: v.total
        ? Math.round((v.score / v.total) * 100)
        : 0
    }))
    .sort((a, b) => b.percentage - a.percentage);

  const bestTopic =
    topicStats.length ? topicStats[0] : null;

  const attentionTopic =
    topicStats.length
      ? [...topicStats].sort(
          (a, b) => a.percentage - b.percentage
        )[0]
      : null;

  /* --------------------------------
     LEARNING STREAK
  -------------------------------- */

  const practiceDays = [
    ...new Set(
      a
        .filter(x => x.created_at)
        .map(x => {
          const d = new Date(x.created_at);

          return `${d.getFullYear()}-${String(
            d.getMonth() + 1
          ).padStart(2, "0")}-${String(
            d.getDate()
          ).padStart(2, "0")}`;
        })
    )
  ];

  let streak = 0;

  if (practiceDays.length) {
    const dates = practiceDays
      .map(x => new Date(x + "T00:00:00"))
      .sort((a, b) => b - a);

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const latest = dates[0];

    const differenceFromToday = Math.floor(
      (today - latest) / 86400000
    );

    if (differenceFromToday <= 1) {
      streak = 1;

      for (let i = 1; i < dates.length; i++) {
        const difference = Math.round(
          (dates[i - 1] - dates[i]) / 86400000
        );

        if (difference === 1) {
          streak++;
        } else {
          break;
        }
      }
    }
  }

  /* --------------------------------
     SMART RECOMMENDATION
  -------------------------------- */

  let recommendation =
    "Start a practice session to build your learning record.";

  if (attentionTopic && attentionTopic.percentage < 70) {
    recommendation =
      `Focus on ${attentionTopic.name}. Your current score is ${attentionTopic.percentage}%. Practising this topic can make a big difference.`;
  } else if (attentionSubject && attentionSubject.percentage < 70) {
    recommendation =
      `Focus on ${attentionSubject.name}. Your current score is ${attentionSubject.percentage}%. A little more practice can make a big difference.`;
  } else if (attentionTopic && attentionTopic.percentage < 85) {
    recommendation =
      `Keep practising ${attentionTopic.name}. You are at ${attentionTopic.percentage}% and can push this topic even higher.`;
  } else if (attentionSubject && attentionSubject.percentage < 85) {
    recommendation =
      `Keep practising ${attentionSubject.name}. You are at ${attentionSubject.percentage}% and can push this subject even higher.`;
  } else if (bestTopic) {
    recommendation =
      `Excellent work! You are performing strongly. Keep practising ${bestTopic.name} to maintain your progress.`;
  }

  return {
    attempts: a,
    attempted,
    correct,
    accuracy,
    lessons: progress?.length || 0,

    bySubject,
    subjectStats,
    bestSubject,
    attentionSubject,

    byTopic,
    topicStats,
    bestTopic,
    attentionTopic,

    streak,
    recommendation
  };
}
async function showStudentProgress() {
  try {
    const box = $("progressPanel");

    if (!box) return;

    box.innerHTML = `
      <div class="card">
        <p>Loading your progress…</p>
      </div>
    `;

    box.classList.remove("hidden");

    const d = await getStudentProgressData();

    /* SUBJECT CARDS */

    const subjectRows =
      d.subjectStats
        .map(v => {
          const pct = v.percentage;

          return `
            <div
              class="card"
              style="padding:14px;margin-top:10px"
            >
              <div
                style="
                  display:flex;
                  justify-content:space-between;
                  gap:10px
                "
              >
                <strong>${escapeHtml(v.name)}</strong>
                <b>${pct}%</b>
              </div>

              <div
                style="
                  height:9px;
                  background:#e8eef7;
                  border-radius:99px;
                  overflow:hidden;
                  margin:8px 0
                "
              >
                <i
                  style="
                    display:block;
                    width:${Math.min(pct,100)}%;
                    height:100%;
                    background:${pct < 70 ? "#f4b400" : "#2e7d32"};
                  "
                ></i>
              </div>

              <span class="muted">
                ${v.attempts}
                practice session${v.attempts === 1 ? "" : "s"}
                • ${v.score}/${v.total} correct
              </span>
            </div>
          `;
        })
        .join("") ||
      `
        <p class="muted">
          No practice recorded yet.
          Start a topic to begin building your progress.
        </p>
      `;

    /* TOPIC CARDS */

const topicRows =
  d.topicStats
    .map(v => {
      const pct = v.percentage;

      return `
        <div
          class="card"
          style="padding:14px;margin-top:10px"
        >
          <div
            style="
              display:flex;
              justify-content:space-between;
              gap:10px
            "
          >
            <div>
              <strong>${escapeHtml(v.name)}</strong>

              <div
                class="muted"
                style="font-size:0.85rem;margin-top:3px"
              >
                ${escapeHtml(v.subject)}
              </div>
            </div>

            <b>${pct}%</b>
          </div>

          <div
            style="
              height:9px;
              background:#e8eef7;
              border-radius:99px;
              overflow:hidden;
              margin:8px 0
            "
          >
            <i
              style="
                display:block;
                width:${Math.min(pct,100)}%;
                height:100%;
                background:${pct < 70 ? "#f4b400" : "#2e7d32"};
              "
            ></i>
          </div>

          <span class="muted">
            ${v.attempts}
            practice session${v.attempts === 1 ? "" : "s"}
            • ${v.score}/${v.total} correct
          </span>

          <div style="margin-top:12px">
            <button
              class="primary practice-again-btn"
              type="button"
              data-topic-id="${v.id}"
              data-subject="${escapeHtml(v.subject)}"
              data-topic-name="${escapeHtml(v.name)}"
            >
              🎯 Practice Again
            </button>
          </div>
        </div>
      `;
    })
    .join("") ||
  `
    <div class="card" style="margin-top:10px">
      <p class="muted">
        Topic-level progress will appear here after you
        practise more topics.
      </p>
    </div>
  `;

    /* ASSESSMENT HISTORY: latest 10 saved attempts */

    const recent =
      d.attempts
        .slice(0, 10)
        .map(x => {
          const isPeriodicTest = String(x.subject || "").toLowerCase().includes("periodic test");
          const topicName =
            x.topic_id !== null
              ? (d.byTopic[Number(x.topic_id)]?.name ||
                 `Topic ${x.topic_id}`)
              : (isPeriodicTest ? "Full assessment" : "General practice");
          const total = Number(x.total || 0);
          const score = Number(x.score || 0);
          const pct = total > 0 ? Math.round((score / total) * 100) : 0;
          const dateLabel = x.created_at
            ? new Date(x.created_at).toLocaleString(undefined, {
                year: "numeric", month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit"
              })
            : "Date unavailable";

          return `
            <li class="card" style="list-style:none;padding:12px;margin:10px 0">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
                <div>
                  <strong>${escapeHtml(x.subject || "Practice")}</strong>
                  <div class="muted" style="font-size:.88rem;margin-top:4px">${escapeHtml(topicName)}</div>
                  <div class="muted" style="font-size:.82rem;margin-top:4px">${escapeHtml(dateLabel)}</div>
                </div>
                <div style="text-align:right;white-space:nowrap">
                  <strong>${score}/${total}</strong>
                  <div style="font-size:.9rem;color:${pct < 70 ? "#b45309" : "#2e7d32"};font-weight:700">${pct}%</div>
                  <span class="muted" style="font-size:.78rem">${isPeriodicTest ? "Periodic test" : "Practice"}</span>
                </div>
              </div>
            </li>
          `;
        })
        .join("") ||
      `<li class="muted" style="list-style:none">No assessments recorded yet. Complete a practice session or test to see it here.</li>`;

    const message =
      d.accuracy >= 80
        ? "🌟 Excellent work! Keep it up."
        : d.accuracy >= 60
        ? "💪 Good progress! Keep practising to improve."
        : "🚀 Keep going! Focus on the areas that need more practice.";

    /* BEST + ATTENTION */

    const bestTopicText = d.bestTopic
      ? `${escapeHtml(d.bestTopic.name)} — ${d.bestTopic.percentage}%`
      : "Not enough topic data yet.";

    const attentionTopicText = d.attentionTopic
      ? `${escapeHtml(d.attentionTopic.name)} — ${d.attentionTopic.percentage}%`
      : "Not enough topic data yet.";

    box.innerHTML = `
      <div
        class="card"
        style="margin-top:14px"
      >

        <div
          style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:10px
          "
        >
          <div>
            <h3 style="margin:0">
              📈 My Learning Progress
            </h3>

            <p
              class="muted"
              style="margin:4px 0 0"
            >
              Your real practice performance,
              updated from your activity.
            </p>
          </div>

          <button
            class="ghost"
            type="button"
            id="closeProgress"
          >
            Back
          </button>
        </div>

        <div
          class="stats"
          style="margin-top:14px"
        >
          <div>
            <b>${d.attempted}</b>
            <small>Questions</small>
          </div>

          <div>
            <b>${d.correct}</b>
            <small>Correct</small>
          </div>

          <div>
            <b>${d.accuracy}%</b>
            <small>Accuracy</small>
          </div>

          <div>
            <b>${d.lessons}</b>
            <small>Lessons done</small>
          </div>
        </div>

        <div
          class="stats"
          style="margin-top:10px"
        >
          <div>
            <b>🔥 ${d.streak}</b>
            <small>Day streak</small>
          </div>

          <div>
            <b>🏆</b>
            <small>Best topic</small>
            <span class="muted">
              ${bestTopicText}
            </span>
          </div>

          <div>
            <b>⚠️</b>
            <small>Needs attention</small>
            <span class="muted">
              ${attentionTopicText}
            </span>
          </div>
        </div>

        <p style="margin-top:16px">
          ${message}
        </p>

        <div
          class="card"
          style="
            padding:14px;
            margin-top:12px;
            background:#f7fbff
          "
        >
          <strong>🎯 Personalised Recommendation</strong>

          <p
            style="margin:7px 0 0"
          >
            ${escapeHtml(d.recommendation)}
          </p>
        </div>

        <h4 style="margin-top:20px">
          📚 Subject Progress
        </h4>

        ${subjectRows}

        <h4 style="margin-top:22px">
          🎯 Topic-Level Progress
        </h4>

        ${topicRows}

        <h4 style="margin-top:22px">
          🧾 Assessment History
        </h4>
        <p class="muted" style="margin-top:-8px">Your 10 most recent saved practice sessions and tests.</p>

        <ul
          style="
            padding-left:20px;
            line-height:1.9
          "
        >
          ${recent}
        </ul>

      </div>
    `;

    $("closeProgress").onclick = () => {
      box.classList.add("hidden");
    };
document.querySelectorAll(".practice-again-btn").forEach(btn => {
  btn.onclick = async () => {
    const topicId = Number(btn.dataset.topicId);
    const subjectName = btn.dataset.subject;
    const topicName = btn.dataset.topicName;

    box.classList.add("hidden");

    try {
      await startTopic(
        topicId,
        subjectName,
        topicName
      );

      $("quiz").classList.remove("hidden");
    } catch (e) {
      console.error("Practice Again error:", e);
    }
  };
});
  }   catch (e) {
    const box = $("progressPanel");

    if (box) {
      box.innerHTML = `
        <div class="card">
          <p>
            Could not load progress:
            ${escapeHtml(
              e.message || "Please try again."
            )}
          </p>
        </div>
      `;
    }
  }
}
async function renderDash(openPractice = true) {
  $("welcome").textContent = `Welcome, ${profile.full_name} 👋🏾`;
  $(
    "profile"
  ).textContent = `${profile.country} • ${profile.level} • ${profile.language}`;
  classRow = await findClass();
  const { data: attempts, error: attemptsError } = await sb
    .from("quiz_attempts")
    .select("score,total")
    .eq("user_id", user.id);
  if (attemptsError) throw attemptsError;
  const a = attempts || [],
    attempted = a.reduce((n, x) => n + Number(x.total || 0), 0),
    correct = a.reduce((n, x) => n + Number(x.score || 0), 0);
  $("attempts").textContent = attempted;
  $("correct").textContent = correct;
  $("accuracy").textContent =
    (attempted ? Math.round((correct / attempted) * 100) : 0) + "%";
  let unique = [];
  if (classRow) {
    const mapped = await sb
      .from("curriculum_subjects")
      .select("subject_id, subjects(id,name)")
      .eq("class_id", classRow.id);
    for (const row of mapped.data || []) {
      const s = row.subjects;
      if (s && !unique.some((x) => x.id === s.id)) unique.push(s);
    }
  }
  if (!unique.length) {
    const fallback = await sb.from("subjects").select("id,name").order("id");
    if (!fallback.error) unique = fallback.data || [];
  }
  if (!unique.length && normalizeLevel(profile?.level) === "JSS1")
    unique = [
      { id: 1, name: "Mathematics" },
      { id: 2, name: "English Studies" },
      { id: 3, name: "Basic Science" },
    ];
  const subjectCards =
    unique
      .map(
        (s) =>
          `<button class="card subject" data-id="${ s.id }" data-name="${escapeHtml( s.name )}" type="button" style="cursor:pointer;text-align:left;width:100%;min-height:92px;font-size:1.05rem">📚 <strong>${escapeHtml( s.name )}</strong><small style="display:block;margin-top:6px;opacity:.7">Tap to start practice</small></button>`
      )
      .join("") || `<div class="card">No subjects found yet.</div>`;
  $(
    "subjects"
  ).innerHTML = `<div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 4px">📈 My Learning Progress</h3><p class="muted" style="margin:0 0 12px">See your real practice performance.</p><button class="primary" type="button" id="openProgress">View My Progress</button></div><div id="progressPanel" class="hidden"></div><h3 style="margin:18px 0 10px">Subjects</h3>${subjectCards}`;
  const isJSS1 = normalizeLevel(profile?.level) === "JSS1";
  const periodicTestCard = isJSS1 ? `
    <div class="card" style="margin-top:16px;border:2px solid #0b57d0">
      <h3 style="margin:0 0 6px">📝 JSS1 First Term Periodic Test</h3>
      <p class="muted">Mathematics • 20 questions • Review your answers after submission.</p>
      <button class="primary" type="button" id="startPeriodicTest">Start Periodic Test</button>
      <p id="periodicTestMsg" class="muted" style="margin-bottom:0"></p>
    </div>` : "";
  $("practiceSubjects").innerHTML = subjectCards + periodicTestCard;
  const periodicTestButton = $("startPeriodicTest");
  if (periodicTestButton) periodicTestButton.onclick = startPeriodicTest;
  $("openProgress").onclick = showStudentProgress;
  const progressBtn = $("progress");
  if (progressBtn) progressBtn.onclick = showStudentProgress;
  document
    .querySelectorAll("#subjects .subject, #practiceSubjects .subject")
    .forEach(
      (btn) =>
        (btn.onclick = () => start(Number(btn.dataset.id), btn.dataset.name))
    );
  if (openPractice) show("subjectSelect");
  else show("dash");
}

async function generateParentCode() {
  try {
    $("generateParentCode").disabled = true;
    const { data, error } = await sb.rpc("create_parent_link_code");
    if (error) throw error;
    $(
      "parentCodeResult"
    ).innerHTML = `Your parent code is <strong style="font-size:1.25rem;letter-spacing:2px">${escapeHtml( data )}</strong><br>Share this code with your parent.`;
  } catch (e) {
    $("parentCodeResult").textContent =
      e.message || "Could not generate a parent code.";
  } finally {
    $("generateParentCode").disabled = false;
  }
}

async function renderParentDash() {
  show("parentDash");
  $("parentWelcome").textContent = `Welcome, ${profile.full_name} 👋🏾`;
  parentMessage("");
  $("parentDetails").classList.add("hidden");
  const { data: links, error } = await sb
    .from("parent_child_links")
    .select("child_id,created_at")
    .eq("parent_id", user.id)
    .eq("status", "active");
  if (error) throw error;
  const childIds = (links || []).map((x) => x.child_id);
  if (!childIds.length) {
    $(
      "children"
    ).innerHTML = `<div class="card"><h3>No child connected yet</h3><p class="muted">Generate a code from your child's Student Dashboard, then enter it above.</p></div>`;
    return;
  }
  const { data: children, error: childError } = await sb
    .from("profiles")
    .select("id,full_name,country,level,language")
    .in("id", childIds);
  if (childError) throw childError;

  const cards = [];
  for (const child of children || []) {
    const { data: attempts, error: attemptError } = await sb
      .from("quiz_attempts")
      .select("score,total,subject,created_at")
      .eq("user_id", child.id)
      .order("created_at", { ascending: false });
    if (attemptError) throw attemptError;
    const a = attempts || [];
    const totalQuestions = a.reduce((n, x) => n + Number(x.total || 0), 0);
    const correct = a.reduce((n, x) => n + Number(x.score || 0), 0);
    const accuracy = totalQuestions
      ? Math.round((correct / totalQuestions) * 100)
      : 0;
    const { data: progress, error: progressError } = await sb
      .from("student_progress")
      .select("completed")
      .eq("student_id", child.id)
      .eq("completed", true);
    if (progressError) throw progressError;

    const bySubject = {};
    for (const item of a) {
      const subject = item.subject || "Other";
      if (!bySubject[subject])
        bySubject[subject] = {
          score: 0,
          total: 0,
          attempts: 0,
          last: item.created_at,
        };
      bySubject[subject].score += Number(item.score || 0);
      bySubject[subject].total += Number(item.total || 0);
      bySubject[subject].attempts++;
      if (new Date(item.created_at) > new Date(bySubject[subject].last || 0))
        bySubject[subject].last = item.created_at;
    }
    const subjectRows = Object.entries(bySubject)
      .map(([name, v]) => {
        const pct = v.total ? Math.round((v.score / v.total) * 100) : 0;
        const attention = pct < 70;
        return `<div class="card" style="padding:14px"><strong>${escapeHtml( name )}</strong><div style="display:flex;justify-content:space-between;margin:8px 0 6px"><span class="muted">${ v.attempts } practice${ v.attempts === 1 ? "" : "s" }</span><b>${pct}%</b></div><div style="height:8px;background:#e8eef7;border-radius:99px;overflow:hidden"><i style="display:block;width:${Math.min( pct, 100 )}%;height:100%;background:${ attention ? "#f4b400" : "#2e7d32" }"></i></div></div>`;
      })
      .join("");

    const weak = Object.entries(bySubject)
      .filter(([, v]) => v.total && Math.round((v.score / v.total) * 100) < 70)
      .map(
        ([name, v]) =>
          `${escapeHtml(name)} (${Math.round((v.score / v.total) * 100)}%)`
      );
    const recent = a
      .slice(0, 5)
      .map(
        (x) =>
          `<li><strong>${escapeHtml( x.subject || "Practice" )}</strong> — ${Number(x.score || 0)}/${Number( x.total || 0 )} <span class="muted">${formatDate(x.created_at)}</span></li>`
      )
      .join("");
    const recentBlock = recent
      ? `<ul style="padding-left:20px;line-height:1.9">${recent}</ul>`
      : `<p class="muted">No practice attempts yet.</p>`;
    const weakBlock = weak.length
      ? `<p>🔍 <strong>Needs more practice:</strong> ${weak.join(" • ")}</p>`
      : `<p>🌟 <strong>Needs more practice:</strong> No subject is currently below 70% based on recorded practice.</p>`;

    cards.push(
      `<div class="card"><h3>🎓 ${escapeHtml( child.full_name )}</h3><p class="muted">${escapeHtml( child.level || "Student" )} • ${escapeHtml(child.language || "English")} • ${escapeHtml( child.country || "" )}</p><div class="stats"><div><b>${totalQuestions}</b><small>Questions</small></div><div><b>${correct}</b><small>Correct</small></div><div><b>${accuracy}%</b><small>Accuracy</small></div></div><p><strong>Lessons completed:</strong> ${ progress?.length || 0 }</p>${weakBlock}<h4 style="margin-bottom:10px">📚 Subject progress</h4><div class="grid">${ subjectRows || '<div class="card"><p class="muted">No subject practice recorded yet.</p></div>' }</div><h4 style="margin:18px 0 8px">🕘 Recent practice</h4>${recentBlock}</div>`
    );
  }
  $("children").innerHTML =
    cards.join("") || `<div class="card">No linked children found.</div>`;
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return ` • ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", })}`;
}

$("connectChild").onclick = async () => {
  const code = $("childCode").value.trim().toUpperCase();
  if (!code) return parentMessage("Please enter the parent code.");
  try {
    $("connectChild").disabled = true;
    const { data, error } = await sb.rpc("redeem_parent_link_code", {
      p_code: code,
    });
    if (error) throw error;
    parentMessage(data || "Child connected successfully.");
    $("childCode").value = "";
    await renderParentDash();
  } catch (e) {
    parentMessage(e.message || "Could not connect this child.");
  } finally {
    $("connectChild").disabled = false;
  }
};
$("generateParentCode").onclick = generateParentCode;

async function start(subjectId, subjectName) {
  if (!classRow) classRow = { id: 1, name: "JSS1" };
  currentSubject = { id: subjectId, name: subjectName };
  currentTopic = null;
  show("quiz");
  $("subject").textContent = subjectName + " — Choose a Topic";
  $("count").textContent = "";
  $("bar").style.width = "0%";
  $("question").textContent = "Choose a topic to begin your practice.";
  $("explain").classList.add("hidden");
  $("next").classList.add("hidden");
  ensureSubmitButton();
  $("submitQuiz").classList.add("hidden");
  try {
    const topics = await getPracticeTopics(subjectId, classRow.id);
    if (!topics.length) {
      $(
        "options"
      ).innerHTML = `<p class="muted">No topics are available for ${escapeHtml( subjectName )} yet.</p>`;
      return;
    }
$("options").innerHTML = topics
  .map(
    (t) =>
      `
      <div class="card" style="margin-bottom:12px;">
        <strong>${escapeHtml(t.name)}</strong>

        ${
          t.description
            ? `<div class="muted" style="margin-top:5px;">
                ${escapeHtml(t.description)}
              </div>`
            : ""
        }

        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">

          <button
            class="primary learn-topic-btn"
            type="button"
            data-topic-id="${t.id}"
            data-subject="${escapeHtml(subjectName)}"
            data-topic-name="${escapeHtml(t.name)}"
          >
            📖 Learn
          </button>

          <button
            class="ghost practice-topic-btn"
            type="button"
            data-topic-id="${t.id}"
            data-subject="${escapeHtml(subjectName)}"
            data-topic-name="${escapeHtml(t.name)}"
          >
            📝 Practice
          </button>

        </div>
      </div>
      `
  )
document.querySelectorAll(".learn-topic-btn").forEach((btn) => {
  btn.onclick = () => {
    startLesson(
      Number(btn.dataset.topicId),
      btn.dataset.subject,
      btn.dataset.topicName
    );
  };
});

document.querySelectorAll(".practice-topic-btn").forEach((btn) => {
  btn.onclick = () => {
    startTopic(
      Number(btn.dataset.topicId),
      btn.dataset.subject,
      btn.dataset.topicName
    );
  };
});
  } catch (e) {
    console.error(e);
    $("options").innerHTML = `<p>Could not load topics right now.</p>`;
  }
}
async function getPracticeTopics(subjectId, classId) {
  let r = await sb
    .from("topics")
    .select("id,name,description,class_id,subject_id")
    .eq("subject_id", subjectId)
    .eq("class_id", classId)
    .order("id");
  if (r.error) throw r.error;
  let rows = r.data || [];
  if (!rows.length) {
    r = await sb
      .from("topics")
      .select("id,name,description,class_id,subject_id")
      .eq("subject_id", subjectId)
      .order("id");
    if (r.error) throw r.error;
    rows = r.data || [];
  }
  return rows;
}
async function startTopic(
  topicId,
  subjectName,
  topicName,
  lessonId = null
) {
  periodicTestMode = false;
  currentTopic = {
    id: topicId,
    name: topicName
  };

  currentSubject = {
    id: currentSubject?.id || null,
    name: subjectName
  };

  currentQuestions = [];
  currentAnswers = [];
  currentIndex = 0;
  currentScore = 0;
  answered = false;

  show("quiz");

  $("subject").textContent =
    subjectName + " — " + topicName;

  $("question").textContent =
    "Loading questions…";

  $("options").innerHTML = "";

  $("explain").classList.add("hidden");
  $("next").classList.add("hidden");

  ensureSubmitButton();
  $("submitQuiz").classList.add("hidden");

  try {
    let questionPool = [];

    /*
      ==========================================
      LESSON-SPECIFIC PRACTICE
      ==========================================
    */

    if (lessonId) {
      // Get the questions deliberately connected
      // to this lesson as Core / Revision / Challenge.
      const { data: links, error: linkError } =
        await sb
          .from("lesson_question_links")
          .select(
            "question_id, role, weight"
          )
          .eq("lesson_id", lessonId);

      if (linkError) throw linkError;

      const questionIds = [
        ...new Set(
          (links || []).map(
            x => Number(x.question_id)
          )
        )
      ];

      if (!questionIds.length) {
        $("question").textContent =
          "No questions available for this lesson yet.";

        $("options").innerHTML = `
          <button class="ghost" type="button" id="backToLesson">
            ← Back to Lesson
          </button>
        `;

        $("backToLesson").onclick = () =>
          displayLesson(
            lessonId,
            topicId,
            subjectName,
            topicName
          );

        return;
      }

      const { data: questions, error: questionError } =
        await sb
          .from("questions")
          .select(
            "id,topic_id,question,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,language_code,exam_type"
          )
          .in("id", questionIds)
          .eq("language_code", "en")
          .eq("is_published", true);

      if (questionError) throw questionError;

      const roleMap = new Map(
        (links || []).map(link => [
          Number(link.question_id),
          link.role
        ])
      );

      questionPool = (questions || []).map(q => ({
        ...q,
        practiceRole:
          roleMap.get(Number(q.id)) || "core"
      }));

    } else {

      /*
        ==========================================
        NORMAL TOPIC PRACTICE
        ==========================================
        Used by existing "Practice Again"
        buttons and other topic-level practice.
      */

      const { data, error } = await sb
        .from("questions")
        .select(
          "id,topic_id,question,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,language_code,exam_type"
        )
        .eq("language_code", "en")
        .eq("topic_id", topicId)
        .eq("is_published", true)
        .order("id");

      if (error) throw error;

      questionPool = data || [];
    }

    /*
      ==========================================
      SMART RANDOM SELECTION
      ==========================================
    */

    if (!questionPool.length) {
      $("question").textContent =
        "No questions available for this lesson yet.";

      $("options").innerHTML = `
        <button class="ghost" type="button" id="backToTopics">
          ← Back to Topics
        </button>
      `;

      $("backToTopics").onclick = () =>
        start(currentSubject.id, subjectName);

      return;
    }

    /*
      Lesson practice:
      Keep revision questions available,
      but prioritize Core questions.

      For a 15-question practice:
      - up to 12 Core
      - up to 2 Revision
      - up to 1 Challenge

      If a category doesn't have enough questions,
      the remaining places are filled from
      the available pool.
    */

    let selected = [];

    if (lessonId) {
      const core = questionPool.filter(
        q => q.practiceRole === "core"
      );

      const revision = questionPool.filter(
        q => q.practiceRole === "revision"
      );

      const challenge = questionPool.filter(
        q => q.practiceRole === "challenge"
      );

      const shuffle = arr => {
        const copy = [...arr];

        for (
          let i = copy.length - 1;
          i > 0;
          i--
        ) {
          const j =
            Math.floor(Math.random() * (i + 1));

          [copy[i], copy[j]] =
            [copy[j], copy[i]];
        }

        return copy;
      };

      selected.push(
        ...shuffle(core).slice(0, 12)
      );

      selected.push(
        ...shuffle(revision).slice(0, 2)
      );

      selected.push(
        ...shuffle(challenge).slice(0, 1)
      );

      /*
        Fill any remaining spaces.
      */

      const selectedIds = new Set(
        selected.map(q => Number(q.id))
      );

      const remaining = shuffle(
        questionPool.filter(
          q => !selectedIds.has(Number(q.id))
        )
      );

      while (
        selected.length < 15 &&
        remaining.length
      ) {
        selected.push(
          remaining.shift()
        );
      }

      /*
        If the lesson has fewer than 15
        connected questions, use everything.
      */

      selected = selected.slice(0, 15);

    } else {

      /*
        Preserve our existing topic-level
        smart-random behaviour.
      */

      const easy = questionPool.filter(
        q =>
          String(q.difficulty || "")
            .toLowerCase() === "easy"
      );

      const medium = questionPool.filter(
        q =>
          String(q.difficulty || "")
            .toLowerCase() === "medium"
      );

      const hard = questionPool.filter(
        q => {
          const d =
            String(q.difficulty || "")
              .toLowerCase();

          return (
            d === "hard" ||
            d === "challenging"
          );
        }
      );

      const shuffle = arr => {
        const copy = [...arr];

        for (
          let i = copy.length - 1;
          i > 0;
          i--
        ) {
          const j =
            Math.floor(Math.random() * (i + 1));

          [copy[i], copy[j]] =
            [copy[j], copy[i]];
        }

        return copy;
      };

      selected = [
        ...shuffle(easy).slice(0, 5),
        ...shuffle(medium).slice(0, 7),
        ...shuffle(hard).slice(0, 3)
      ];

      const selectedIds = new Set(
        selected.map(q => Number(q.id))
      );

      const remaining = shuffle(
        questionPool.filter(
          q => !selectedIds.has(Number(q.id))
        )
      );

      while (
        selected.length < 15 &&
        remaining.length
      ) {
        selected.push(
          remaining.shift()
        );
      }

      selected = shuffle(
        selected.slice(0, 15)
      );
    }

    /*
      Final question set
    */

    currentQuestions = selected;

    currentAnswers =
      new Array(
        currentQuestions.length
      ).fill(null);

    renderQ();

  } catch (e) {
    console.error(
      "Practice loading error:",
      e
    );

    $("question").textContent =
      "Could not load questions.";

    $("explain").textContent =
      e.message;

    $("explain").classList.remove(
      "hidden"
    );
  }
}
async function topicIds(subjectId, classId) {
  const { data, error } = await sb
    .from("topics")
    .select("id")
    .eq("subject_id", subjectId)
    .eq("class_id", classId)
    .order("id");
  if (error) throw error;
  return (data || []).map((x) => x.id);
}
async function startPeriodicTest() {
  periodicTestMode = true;
  currentSubject = { id: 1, name: "Mathematics — JSS1 First Term Periodic Test" };
  currentTopic = { id: null, name: "First Term Periodic Test" };
  currentQuestions = [];
  currentAnswers = [];
  currentIndex = 0;
  currentScore = 0;
  answered = false;

  show("quiz");
  $("subject").textContent = currentSubject.name;
  $("question").textContent = "Loading periodic-test questions…";
  $("options").innerHTML = "";
  $("explain").classList.add("hidden");
  $("next").classList.add("hidden");
  ensureSubmitButton().classList.add("hidden");

  try {
    const { data, error } = await sb
      .from("questions")
      .select("id,topic_id,question,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,language_code,exam_type")
      .eq("exam_type", "JSS1_FIRST_TERM_PERIODIC_TEST")
      .eq("language_code", "en")
      .order("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      $("question").textContent = "The periodic test is not available yet. Please try again later.";
      return;
    }
    currentQuestions = data;
    currentAnswers = data.map(() => null);
    currentIndex = 0;
    renderQ();
  } catch (e) {
    $("question").textContent = "Could not load the periodic test.";
    $("explain").textContent = e.message || "Please try again.";
    $("explain").classList.remove("hidden");
  }
}

function ensureSubmitButton() {
  let b = $("submitQuiz");
  if (!b) {
    b = document.createElement("button");
    b.id = "submitQuiz";
    b.className = "primary";
    b.type = "button";
    b.textContent = "Submit Quiz";
    const next = $("next");
    if (next) next.insertAdjacentElement("afterend", b);
  }
  b.type = "button";
  b.classList.remove("hidden");
  b.style.display = "inline-block";
  b.disabled = false;
  b.onclick = submitQuiz;
  return b;
}
function applySelectedStyle(button, selected) {
  button.classList.toggle("selected", selected);
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  if (selected) {
    button.style.border = "3px solid #0b57d0";
    button.style.background = "#e8f0fe";
    button.style.boxShadow = "0 0 0 3px rgba(11,87,208,.12)";
    button.style.fontWeight = "700";
  } else {
    button.style.border = "";
    button.style.background = "";
    button.style.boxShadow = "";
    button.style.fontWeight = "";
  }
}
function renderQ() {
  const submitBtn = ensureSubmitButton();
  const q = currentQuestions[currentIndex],
    opts = [q.option_a, q.option_b, q.option_c, q.option_d];
  $("subject").textContent =
    currentSubject.name + " — " + (currentTopic?.name || "");
  $("count").textContent = `Question ${currentIndex + 1} of ${ currentQuestions.length }`;
  $("bar").style.width =
    ((currentIndex + 1) / currentQuestions.length) * 100 + "%";
  $("question").textContent = q.question;
  $("options").innerHTML = opts
    .map(
      (x, n) =>
        `<button class="option" data-i="${n}" type="button">${String.fromCharCode( 65 + n )}. ${escapeHtml(x)}</button>`
    )
    .join("");
  $("explain").classList.add("hidden");
  $("next").classList.add("hidden");
  submitBtn.classList.remove("hidden");
  submitBtn.style.display = "inline-block";
  submitBtn.disabled = false;
  submitBtn.onclick = submitQuiz;
  answered = currentAnswers[currentIndex] !== null;
  document.querySelectorAll(".option").forEach((b) => {
    const selected = currentAnswers[currentIndex] === Number(b.dataset.i);
    b.onclick = () => answer(Number(b.dataset.i));
    applySelectedStyle(b, selected);
  });
}
function correctIndex(q) {
  const v = String(q.correct_answer || "")
    .trim()
    .toUpperCase();
  if (["A", "B", "C", "D"].includes(v)) return v.charCodeAt(0) - 65;
  if (["1", "2", "3", "4"].includes(v)) return Number(v) - 1;
  return -1;
}
function answer(n) {
  currentAnswers[currentIndex] = n;
  answered = true;
  document
    .querySelectorAll(".option")
    .forEach((b) => applySelectedStyle(b, Number(b.dataset.i) === n));
  $("explain").classList.add("hidden");
  $("next").textContent =
    currentIndex < currentQuestions.length - 1
      ? "Next Question"
      : "Review & Submit";
  $("next").classList.remove("hidden");
  const submitBtn = ensureSubmitButton();
  submitBtn.classList.remove("hidden");
  submitBtn.style.display = "inline-block";
  submitBtn.disabled = false;
}
function nextQuestion() {
  if (currentIndex < currentQuestions.length - 1) {
    currentIndex++;
    renderQ();
  } else submitQuiz();
}
$("next").onclick = nextQuestion;
async function submitQuiz() {
  if (!currentQuestions.length) return;
  const answeredCount = currentAnswers.filter((x) => x !== null).length;
  currentScore = currentQuestions.reduce(
    (s, q, i) =>
      s +
      (currentAnswers[i] !== null && currentAnswers[i] === correctIndex(q)
        ? 1
        : 0),
    0
  );
  const submitBtn = $("submitQuiz");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
  }
  try {
    const { error } = await sb
      .from("quiz_attempts")
     .insert({
  user_id: user.id,
  subject: currentSubject.name,
  topic_id: periodicTestMode ? null : Number(currentTopic.id),
  score: currentScore,
  total: currentQuestions.length,
});
    if (error) throw error;
    const review = currentQuestions
      .map((q, i) => {
        const chosen = currentAnswers[i],
          right = correctIndex(q),
          status =
            chosen === null
              ? "⏭️ Not answered"
              : chosen === right
              ? "✅ Correct"
              : "❌ Incorrect";
        const chosenText =
          chosen === null
            ? "No answer"
            : q[["option_a", "option_b", "option_c", "option_d"][chosen]];
        const correctText =
          right >= 0
            ? q[["option_a", "option_b", "option_c", "option_d"][right]] || ""
            : "";
        return `<div class="card" style="margin-top:12px;padding:14px"><strong>${ i + 1 }. ${escapeHtml( q.question )}</strong><p>${status}</p><p><b>Your answer:</b> ${escapeHtml( chosenText || "No answer" )}</p><p><b>Correct answer:</b> ${escapeHtml(correctText)}</p>${ q.explanation ? `<p class="muted"><b>Explanation:</b> ${escapeHtml( q.explanation )}</p>` : "" }</div>`;
      })
      .join("");
    $("question").textContent = "Practice complete! 🎉";
    $("options").innerHTML = `<div class="result card"><h2>${currentScore}/${ currentQuestions.length }</h2><p>You answered ${answeredCount} of ${ currentQuestions.length } question${ answeredCount === 1 ? "" : "s" }.</p><p><strong>Answers and explanations are now revealed below.</strong></p><button class="primary" id="resultDash">Back to Dashboard</button><button class="ghost" id="resultTopics" style="margin-left:8px">Choose Another Topic</button></div>${review}`;
    $("explain").classList.add("hidden");
    $("next").classList.add("hidden");
    if (submitBtn) submitBtn.classList.add("hidden");
    $("resultDash").onclick = () => renderDash(false);
    $("resultTopics").onclick = () => {
      if (periodicTestMode) {
        periodicTestMode = false;
        renderDash(true);
      } else {
        start(currentSubject.id, currentSubject.name);
      }
    };
  } catch (e) {
    $(
      "explain"
    ).textContent = `Your score is ${currentScore}/${currentQuestions.length}, but it could not be saved: ${e.message}`;
    $("explain").classList.remove("hidden");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Quiz";
      submitBtn.onclick = submitQuiz;
    }
  }
}

$("goDashboard").onclick = () => renderDash(false);
$("back").onclick = () => renderDash(true);
$("logout").onclick = async () => {
  await sb.auth.signOut();
  user = null;
  profile = null;
  classRow = null;
  $("logout").classList.add("hidden");
  show("auth");
  setAuthMode(false);
};
$("tutor").onclick = () => {
  show("tutorView");
  $("chat").innerHTML =
    '<div class="bubble">Hi! I am your Pass Once AI Tutor. Ask me a school question.</div>';
};
$("backTutor").onclick = load;
$("chatForm").onsubmit = (e) => {
  e.preventDefault();
  const t = $("ask").value.trim();
  if (!t) return;
  const safe = escapeHtml(t),
    lower = t.toLowerCase(),
    reply = lower.includes("quadratic")
      ? "A quadratic equation has x² as its highest power. A common form is ax² + bx + c = 0."
      : lower.includes("photosynthesis")
      ? "Photosynthesis is how green plants use light energy to make food from carbon dioxide and water."
      : "The full AI Tutor service will provide a tailored explanation, examples and practice questions. This interface is ready for the secure server-side AI connection.";
  $("chat").insertAdjacentHTML(
    "beforeend",
    `<div class="bubble user">${safe}</div><div class="bubble">${escapeHtml( reply )}</div>`
  );
  $("ask").value = "";
};
sb.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session) {
    setTimeout(load, 0);
  }
});
setAuthMode(false);
load();
async function startLesson(topicId, subjectName, topicName) {
  currentTopic = {
    id: topicId,
    name: topicName
  };

  currentSubject = {
    id: currentSubject?.id || null,
    name: subjectName
  };

  show("lessonView");

  $("lessonTitle").textContent = "Loading lessons…";
  $("lessonSubject").textContent =
    subjectName + " — " + topicName;

  $("lessonContent").innerHTML = `
    <p class="muted">Please wait while we load your lessons.</p>
  `;

  $("lessonMsg").textContent = "";

  try {
    const { data, error } = await sb
      .from("lessons")
      .select("id,topic_id,title,content,lesson_order")
      .eq("topic_id", topicId)
      .order("lesson_order", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw error;

    const lessons = data || [];
    /*
      Load this student's completed lessons
      for the current topic.
    */
    let completedLessonIds = new Set();

    if (user) {
      const lessonIds = lessons.map(
        lesson => Number(lesson.id)
      );

      if (lessonIds.length) {
        const { data: progressRows, error: progressError } =
          await sb
            .from("student_progress")
            .select("lesson_id,completed")
            .eq("student_id", user.id)
            .in("lesson_id", lessonIds);

        if (progressError) throw progressError;

        (progressRows || []).forEach(row => {
          if (row.completed) {
            completedLessonIds.add(
              Number(row.lesson_id)
            );
          }
        });
      }
    }

    const completedCount =
      completedLessonIds.size;

    const totalLessons =
      lessons.length;

    const progressPercent =
      totalLessons > 0
        ? Math.round(
            (completedCount / totalLessons) * 100
          )
        : 0;
    if (!lessons.length) {
      $("lessonTitle").textContent = topicName;

      $("lessonContent").innerHTML = `
        <div class="card">
          <h3>📖 Lesson coming soon</h3>
          <p class="muted">
            We don't have a lesson for this topic yet.
          </p>
        </div>
      `;

      return;
    }

    /*
      Load this student's completed lessons
      for the current topic.
    */

    /*
      If there is more than one lesson,
      show the lesson list with progress.
    */
    if (lessons.length > 1) {
$("lessonTitle").textContent = "📚 Lessons";

$("lessonContent").innerHTML = `
  <div class="card" style="margin-bottom:18px;">
    <div style="
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:12px;
      margin-bottom:10px;
    ">
      <strong>📈 Topic Progress</strong>

      <strong>
        ${completedCount} / ${totalLessons}
      </strong>
    </div>

    <div style="
      width:100%;
      height:10px;
      background:#e8eef7;
      border-radius:999px;
      overflow:hidden;
    ">
      <div style="
        width:${progressPercent}%;
        height:100%;
        background:linear-gradient(
          90deg,
          #0b57d0,
          #16a34a
        );
        border-radius:999px;
        transition:width .3s ease;
      "></div>
    </div>

    <p class="muted" style="margin:10px 0 0;">
      ${progressPercent}% complete
    </p>
  </div>

  <p class="muted" style="margin-bottom:16px;">
    Choose a lesson to start learning.
  </p>

  <div id="lessonList">
    ${lessons
      .map(
        (lesson, index) => {
          const isCompleted =
            completedLessonIds.has(
              Number(lesson.id)
            );

          return `
            <div
              class="card"
              style="margin-bottom:12px;"
            >
              <div style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                gap:10px;
              ">
                <div class="muted">
                  Lesson ${index + 1}
                </div>

                <div>
                  ${
                    isCompleted
                      ? `
                        <span style="
                          color:#15803d;
                          font-weight:700;
                        ">
                          ✅ Completed
                        </span>
                      `
                      : `
                        <span style="
                          color:#64748b;
                          font-weight:600;
                        ">
                          ⭕ Not started
                        </span>
                      `
                  }
                </div>
              </div>

              <h3 style="margin:6px 0 12px;">
                ${escapeHtml(lesson.title)}
              </h3>

              <button
                class="primary open-lesson-btn"
                type="button"
                data-lesson-id="${lesson.id}"
              >
                ${
                  isCompleted
                    ? "🔄 Review Lesson"
                    : "📖 Open Lesson"
                }
              </button>
            </div>
          `;
        }
      )
      .join("")}
  </div>
`;

document
  .querySelectorAll(".open-lesson-btn")
  .forEach((btn) => {
    btn.onclick = () => {
      try {
        const lessonId =
          Number(btn.dataset.lessonId);

        const selectedLesson =
          lessons.find(
            lesson =>
              Number(lesson.id) === lessonId
          );

        if (!selectedLesson) {
          $("lessonMsg").textContent =
            "Could not find this lesson. Please try again.";
          return;
        }

        show("lessonView");

        displayLesson(
          selectedLesson,
          subjectName,
          topicName,
          topicId,
          lessons
        );

        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });

      } catch (e) {
        console.error(
          "Open lesson error:",
          e
        );

        $("lessonMsg").textContent =
          "Could not open this lesson: " +
          (e.message || "Please try again.");
      }
    };
  });

      return;
    }

    /*
      If there is only one lesson,
      open it directly.
    */
    displayLesson(
      lessons[0],
      subjectName,
      topicName,
      topicId,
      lessons
    );

  } catch (e) {
    console.error(
      "Lesson loading error:",
      e
    );

    $("lessonTitle").textContent =
      "Could not load lessons";

    $("lessonContent").innerHTML = `
      <p class="muted">
        We couldn't load these lessons right now.
      </p>
    `;

    $("lessonMsg").textContent =
      e.message ||
      "Please try again.";
  }
}
function displayLesson(
  lesson,
  subjectName,
  topicName,
  topicId,
  lessons = []
) {
  $("lessonTitle").textContent = lesson.title;

  $("lessonSubject").textContent =
    subjectName + " — " + topicName;

  $("lessonContent").innerHTML = `
    <div style="line-height:1.8;">
      ${lesson.content || "<p>No lesson content available yet.</p>"}
    </div>

    ${
      lessons.length > 1
        ? `
          <div style="
            margin-top:24px;
            padding-top:18px;
            border-top:1px solid #e8eef7;
          ">
            <button
              class="ghost"
              type="button"
              id="backToLessonList"
            >
              ← Back to Lessons
            </button>
          </div>
        `
        : ""
    }
  `;
  // Always start a newly opened lesson from the top
  requestAnimationFrame(() => {
    window.scrollTo({
      top: 0,
      behavior: "auto"
    });
  });
  $("markLessonComplete").dataset.lessonId = lesson.id;

  /*
    Reset the completion button whenever
    a different lesson is opened.
  */
  $("markLessonComplete").disabled = false;
  $("markLessonComplete").textContent =
    "✅ Mark Lesson Complete";

  $("lessonMsg").textContent = "";

$("practiceLesson").onclick = async () => {
  try {
    await startTopic(
      Number(topicId),
      subjectName,
      topicName,
      Number(lesson.id)
    );
  } catch (e) {
    console.error("Practice This Lesson error:", e);

    $("lessonMsg").textContent =
      "Could not start practice: " +
      (e.message || "Please try again.");
  }
};

  $("backLesson").onclick = () => {
    start(
      currentSubject.id,
      currentSubject.name
    );
  };

  /*
    Return to the list of lessons.
  */
  if (lessons.length > 1) {
    $("backToLessonList").onclick = () => {
      startLesson(
        topicId,
        subjectName,
        topicName
      );
    };
  }

  /*
    Mark this particular lesson as complete.
  */
  $("markLessonComplete").onclick = async () => {
    const lessonId = Number(
      $("markLessonComplete").dataset.lessonId
    );

    if (!lessonId || !user) {
      $("lessonMsg").textContent =
        "Please log in before marking a lesson complete.";
      return;
    }

    try {
      const button = $("markLessonComplete");

      button.disabled = true;
      button.textContent = "Saving…";
      $("lessonMsg").textContent = "";

      const { data: existing, error: findError } = await sb
        .from("student_progress")
        .select("id")
        .eq("student_id", user.id)
        .eq("lesson_id", lessonId)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      if (existing) {
        const { error: updateError } = await sb
          .from("student_progress")
          .update({
            completed: true,
            updated_at: new Date().toISOString()
          })
          .eq("id", existing.id);

        if (updateError) throw updateError;

      } else {
        const { error: insertError } = await sb
          .from("student_progress")
          .insert({
            student_id: user.id,
            lesson_id: lessonId,
            completed: true,
            updated_at: new Date().toISOString()
          });

        if (insertError) throw insertError;
      }

button.textContent = "✅ Lesson Completed";

$("lessonMsg").textContent =
  "Great job! This lesson has been marked as completed. 🎉";

if (lessons.length > 1) {
  const currentIndex = lessons.findIndex(
    l => Number(l.id) === Number(lesson.id)
  );

  const nextLesson = lessons[currentIndex + 1];

  if (nextLesson) {
    const nextButton = document.createElement("button");

    nextButton.type = "button";
    nextButton.className = "primary";
    nextButton.textContent = "➡️ Continue to Next Lesson";

    nextButton.style.marginTop = "12px";

    nextButton.onclick = () => {
      displayLesson(
        nextLesson,
        subjectName,
        topicName,
        topicId,
        lessons
      );
    };

    $("lessonMsg").appendChild(nextButton);
  } else {
    const finishedMsg = document.createElement("p");

    finishedMsg.style.marginTop = "12px";
    finishedMsg.innerHTML =
      "<strong>🎉 Amazing! You have completed all the lessons in this topic.</strong>";

    $("lessonMsg").appendChild(finishedMsg);
  }
}

    } catch (e) {
      console.error(
        "Mark lesson complete error:",
        e
      );

      $("markLessonComplete").disabled = false;

      $("markLessonComplete").textContent =
        "✅ Mark Lesson Complete";

      $("lessonMsg").textContent =
        "Could not save your lesson progress: " +
        (e.message || "Please try again.");
    }
  };
}

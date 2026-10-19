const sb = supabase.createClient(window.PASS_ONCE_URL, window.PASS_ONCE_KEY);
const $ = (id) => document.getElementById(id);

let signup = false,
  user = null,
  profile = null,
  classRow = null;
let currentSubject = null,
  currentTopic = null,
  curriculumReturn = null,
  currentQuestions = [],
  currentAnswers = [],
  currentIndex = 0,
  currentScore = 0,
  answered = false;

function show(id) {
  [
    "auth",
    "setup",
    "subjectSelect",
    "curriculumView",
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
  // A missing session is a normal signed-out state.
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

if (profile.role === "parent") {
  await renderParentDash();
} else {
  await renderDash();
  await resumeTimRequest();
}
  } catch (e) {
    const msg = e.message || "Could not load your account.";
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

if (role === "parent") {
  await renderParentDash();
} else {
  await renderDash();
  await resumeTimRequest();
}
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
      last: item.created_at,

      latestScore: Number(item.score || 0),
      latestTotal: Number(item.total || 0),

      previousScore: null,
      previousTotal: null
    };
  } else if (byTopic[topicId].attempts === 1) {
    byTopic[topicId].previousScore = Number(item.score || 0);
    byTopic[topicId].previousTotal = Number(item.total || 0);
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
  .map(v => {
    const latestPercentage =
      v.latestTotal > 0
        ? Math.round((v.latestScore / v.latestTotal) * 100)
        : null;

    const previousPercentage =
      v.previousTotal !== null && v.previousTotal > 0
        ? Math.round((v.previousScore / v.previousTotal) * 100)
        : null;

    return {
      ...v,
      percentage: v.total
        ? Math.round((v.score / v.total) * 100)
        : 0,
      latestPercentage,
      previousPercentage,
      trend: previousPercentage !== null
        ? latestPercentage - previousPercentage
        : null
    };
  })
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
const latestPct =
  Number(v.latestTotal) > 0
    ? Math.round(
        (Number(v.latestScore) / Number(v.latestTotal)) * 100
      )
    : null;

const previousPct =
  Number(v.previousTotal) > 0
    ? Math.round(
        (Number(v.previousScore) / Number(v.previousTotal)) * 100
      )
    : null;

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
      const latestPct =
  Number(v.latestTotal) > 0
    ? Math.round(
        (Number(v.latestScore) / Number(v.latestTotal)) * 100
      )
    : null;

const previousPct =
  Number(v.previousTotal) > 0
    ? Math.round(
        (Number(v.previousScore) / Number(v.previousTotal)) * 100
      )
    : null;
      return `
    <div
  class="card"
  style="
    width:100%;
    max-width:100%;
    min-width:0;
    box-sizing:border-box;
    padding:14px;
    margin-top:10px;
  "
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

<div
  class="muted"
  style="margin-top:8px;font-size:0.9rem;line-height:1.7"
>
  <div>
    Latest practice:
    <strong>${latestPct !== null ? `${latestPct}%` : "—"}</strong>
  </div>

  ${
    previousPct !== null
      ? `
        <div>
          Previous practice:
          <strong>${previousPct}%</strong>
        </div>

        <div style="margin-top:4px;max-width:100%;overflow-wrap:anywhere">
          ${
            latestPct > previousPct
              ? `📈 Improved by ${latestPct - previousPct} percentage points`
              : latestPct < previousPct
              ? `📉 Decreased by ${previousPct - latestPct} percentage points`
              : "➡️ No change from the previous practice"
          }
        </div>
      `
      : `
        <div>
          Complete another practice session
          to track your improvement.
        </div>
      `
  }
</div>

          <div style="margin-top:8px">
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

    /* RECENT ACTIVITY */

    const recent =
      d.attempts
        .slice(0, 5)
        .map(x => {
          const topicName =
            x.topic_id !== null
              ? (d.byTopic[Number(x.topic_id)]?.name ||
                 `Topic ${x.topic_id}`)
              : "Previous practice";

          return `
            <li>
              <strong>
                ${escapeHtml(x.subject || "Practice")}
              </strong>
              — ${escapeHtml(topicName)}
              — ${Number(x.score || 0)}/${Number(x.total || 0)}
            </li>
          `;
        })
        .join("") ||
      `<li>No recent practice yet.</li>`;

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

<p style="margin:7px 0 0">
  ${escapeHtml(d.recommendation)}
</p>

${
  d.attentionTopic
    ? `
      <button
        class="primary"
        type="button"
        id="practiseRecommendedTopic"
        style="margin-top:12px;width:100%"
      >
        🎯 Practise This Topic
      </button>
    `
    : ""
}

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
          🕘 Recent Activity
        </h4>

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
  
const recommendedPracticeBtn = $("practiseRecommendedTopic");

if (recommendedPracticeBtn && d.attentionTopic) {
  recommendedPracticeBtn.onclick = async () => {
    const topic = d.attentionTopic;

    if (!topic.id || !topic.subject || !topic.name) {
      alert("Topic details are incomplete. Please try again.");
      return;
    }

    try {
      recommendedPracticeBtn.disabled = true;
      recommendedPracticeBtn.textContent = "Loading topic…";

      await startTopic(
        Number(topic.id),
        topic.subject,
        topic.name
      );

      $("quiz").classList.remove("hidden");
    } catch (e) {
      console.error("Recommended topic practice error:", e);
      alert("Could not open this topic. Please try again.");
    } finally {
      recommendedPracticeBtn.disabled = false;
      recommendedPracticeBtn.textContent = "🎯 Practise This Topic";
    }
  };
}
  
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

$("subjects").innerHTML = `
  <div style="
    display:grid;
    grid-template-columns:minmax(0,1fr);
    gap:18px;
    width:100%;
    min-width:0;
    box-sizing:border-box;
  ">
    <div
      class="card"
      style="
        width:100%;
        min-width:0;
        box-sizing:border-box;
        margin:0;
        padding:18px;
      "
    >
      <h3 style="margin:0 0 4px">
        📈 My Learning Progress
      </h3>

      <p class="muted" style="margin:0 0 12px">
        See your real practice performance.
      </p>

      <button
        class="primary"
        type="button"
        id="openProgress"
        style="width:100%"
      >
        View My Progress
      </button>
    </div>


<div id="progressPanel" class="hidden"></div>

<!-- Personalised topic recommendation -->
<div
  id="recommendedTopicCard"
  class="card hidden"
  style="
    width:100%;
    min-width:0;
    box-sizing:border-box;
    margin:0;
    padding:18px;
  "
></div>

<div style="width:100%;min-width:0">
  <h3 style="margin:0 0 12px">
    📚 Your Subjects
  </h3>


      
<div class="dashboard-subject-grid">
        ${subjectCards}
      </div>
    </div>
  </div>
`;

  $("practiceSubjects").innerHTML = subjectCards;
  
  // Load the student's personalised topic recommendation
  const recommendationCard = $("recommendedTopicCard");

  if (recommendationCard) {
    recommendationCard.classList.add("hidden");
    recommendationCard.innerHTML = "";

    try {
      const progressData = await getStudentProgressData();
      const topic = progressData.attentionTopic;

      if (topic && topic.id && topic.subject && topic.name) {
        recommendationCard.innerHTML = `
          <h3 style="margin:0 0 8px">
            🎯 Recommended for You
          </h3>
          <h4 style="margin:0 0 6px">
            ${escapeHtml(topic.name)}
          </h4>
          <p class="muted" style="margin:0 0 12px">
            ${escapeHtml(topic.subject)}
          </p>
          <p style="margin:0 0 12px">
            ${escapeHtml(progressData.recommendation)}
          </p>
          <button
            class="primary"
            type="button"
            id="dashboardPractiseRecommendedTopic"
            style="width:100%"
          >
            🎯 Practise This Topic
          </button>
        `;

        recommendationCard.classList.remove("hidden");

const recommendedPracticeBtn =
  $("dashboardPractiseRecommendedTopic");

if (recommendedPracticeBtn) {
  recommendedPracticeBtn.onclick = async (event) => {
          const btn = event.currentTarget;
          btn.disabled = true;
          btn.textContent = "Loading topic…";

          try {
            await startTopic(
              Number(topic.id),
              topic.subject,
              topic.name
            );
            $("quiz").classList.remove("hidden");
          } catch (e) {
            console.error("Dashboard recommendation error:", e);
            alert("Could not open this topic. Please try again.");
          } finally {
            btn.disabled = false;
            btn.textContent = "🎯 Practise This Topic";
          }
                };
      }
      }
    } catch (e) {
      console.error("Dashboard recommendation could not load:", e);
    }
  }

 const openProgressBtn = $("openProgress");

if (openProgressBtn) {
  openProgressBtn.onclick = showStudentProgress;
}
  const curriculumBtn = $("openCurriculum");
  if (curriculumBtn) curriculumBtn.onclick = openCurriculum;
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

/* --------------------------------
   CURRICULUM BROWSER
   First release: JSS1 Mathematics
-------------------------------- */

async function openCurriculum() {
  if (!classRow) classRow = await findClass();

  if (!classRow) {
    show("curriculumView");
    $("curriculumContent").innerHTML =
      '<div class="card"><p class="muted">We could not identify your class. Please check your student profile.</p></div>';
    return;
  }

  show("curriculumView");
  $("curriculumContent").innerHTML =
    '<div class="card"><p>Loading all subjects and weekly topics…</p></div>';
  curriculumReturn = null;

  try {
    const { data: subjects, error: subjectsError } = await sb
  .from("subjects")
  .select("id,name");

if (subjectsError) throw subjectsError;

// Display core subjects in our preferred order.
const subjectOrder = [
  "mathematics",
  "english studies",
  "basic science"
];

subjects.sort((a, b) => {
  const nameA = String(a.name || "").trim().toLowerCase();
  const nameB = String(b.name || "").trim().toLowerCase();

  const indexA = subjectOrder.indexOf(nameA);
  const indexB = subjectOrder.indexOf(nameB);

  const rankA = indexA === -1 ? subjectOrder.length : indexA;
  const rankB = indexB === -1 ? subjectOrder.length : indexB;

  if (rankA !== rankB) return rankA - rankB;

  return nameA.localeCompare(nameB);
});

    if (!subjects || !subjects.length) {
      throw new Error("No subjects are available yet.");
    }

    const { data: version, error: versionError } = await sb
      .from("curriculum_versions")
      .select("id,name,code")
      .eq("is_current", true)
      .limit(1)
      .maybeSingle();

    if (versionError) throw versionError;
    if (!version) {
      throw new Error("No current curriculum version is available.");
    }

    const { data: terms, error: termsError } = await sb
      .from("curriculum_terms")
      .select("id,name,term_number,class_id")
      .eq("class_id", classRow.id)
      .order("term_number");

    if (termsError) throw termsError;

    if (!terms || !terms.length) {
      $("curriculumContent").innerHTML =
        '<div class="card"><p class="muted">No terms have been configured for your class yet.</p></div>';
      return;
    }

    const { data: allWeekly, error: weeklyError } = await sb
      .from("curriculum_weekly_topics")
      .select("id,curriculum_term_id,subject_id,week_number,title,content_outline,source_reference")
      .eq("curriculum_version_id", version.id)
      .in("curriculum_term_id", terms.map(t => t.id))
      .order("week_number");

    if (weeklyError) throw weeklyError;

    const subjectById = new Map(
      subjects.map(s => [Number(s.id), s])
    );

    const subjectSections = subjects.map(subject => {
      const subjectId = Number(subject.id);

      const subjectTopics = (allWeekly || []).filter(
        w => Number(w.subject_id) === subjectId
      );

      const termButtons = terms.map(term => {
        const count = subjectTopics.filter(
          w => Number(w.curriculum_term_id) === Number(term.id)
        ).length;

        return `
          <button
            class="card curriculum-term-btn"
            type="button"
            data-term-id="${Number(term.id)}"
            data-term-name="${escapeHtml(term.name)}"
            data-subject-id="${subjectId}"
            style="text-align:left;cursor:pointer;width:100%"
          >
            <strong>${escapeHtml(term.name)}</strong>
            <p class="muted" style="margin:6px 0 0">
              ${count ? `${count} weekly topics available` : "Topics coming soon"}
            </p>
          </button>
        `;
      }).join("");

      return `
        <section class="card" style="margin-bottom:20px">
          <h2 style="margin:0 0 12px">
            ${escapeHtml(subject.name)}
          </h2>

          <div class="grid" style="gap:10px">
            ${termButtons}
          </div>

          <div
            id="curriculumWeeks-${subjectId}"
            style="margin-top:16px"
          ></div>
        </section>
      `;
    }).join("");

    $("curriculumContent").innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <p class="muted" style="margin:0 0 5px">
          ${escapeHtml(classRow.name)}
        </p>
        <h3 style="margin:0">
          ${escapeHtml(version.name || "Current Curriculum")}
        </h3>
        <p class="muted" style="margin:8px 0 0">
          Choose a subject and term to explore weekly topics and available lessons.
        </p>
      </div>

      ${subjectSections}
    `;

    
document.querySelectorAll(".curriculum-term-btn").forEach(btn => {
  btn.onclick = () => {
    const subject = subjectById.get(
      Number(btn.dataset.subjectId)
    );

    if (!subject) {
      console.error("Curriculum subject not found.");
      return;
    }

    const targetWeeksId =
      `curriculumWeeks-${Number(subject.id)}`;

    // Close all previously opened terms across every subject.
    document.querySelectorAll('[id^="curriculumWeeks-"]').forEach(box => {
      if (box.id !== targetWeeksId) {
        box.innerHTML = "";
      }
    });

    // Load the selected term into its own subject section.
    openCurriculumTerm(
      Number(btn.dataset.termId),
      btn.dataset.termName,
      subject,
      version.id,
      targetWeeksId
    );
  };
});

  } catch (e) {
    console.error("Curriculum loading error:", e);

    $("curriculumContent").innerHTML = `
      <div class="card">
        <p>Could not load the curriculum.</p>
        <p class="muted">
          ${escapeHtml(e.message || "Please try again.")}
        </p>
        <button class="ghost" id="retryCurriculum" type="button">
          Try again
        </button>
      </div>
    `;

    const retry = $("retryCurriculum");
    if (retry) retry.onclick = openCurriculum;
  }
}

async function openCurriculumTerm(
  termId,
  termName,
  subject,
  versionId,
  weeksBoxId = "curriculumWeeks"
) {
  const weeksBox = $(weeksBoxId) || $("curriculumWeeks");

  if (!weeksBox) {
    console.error("Curriculum weekly topics container not found:", weeksBoxId);
    return;
  }
  weeksBox.innerHTML = '<div class="card"><p>Loading weekly topics…</p></div>';
  curriculumReturn = { termId, termName, subject, versionId };

  try {
    
const { data: weeklyTopics, error: weeklyError } = await sb
  .from("curriculum_weekly_topics")
  .select("id,curriculum_term_id,week_number,title,content_outline,source_reference")
  .eq("curriculum_version_id", versionId)
  .eq("curriculum_term_id", termId)
  .eq("subject_id", Number(subject.id))
  .order("week_number");

    if (weeklyError) throw weeklyError;

    if (!(weeklyTopics || []).length) {
      weeksBox.innerHTML = `<div class="card"><h3>${escapeHtml(termName)}</h3><p class="muted">Curriculum coming soon. Weekly topics and lessons for this term have not been added yet.</p></div>`;
      return;
    }

    const { data: links, error: linksError } = await sb
      .from("curriculum_weekly_topic_lessons")
      .select("weekly_topic_id,lesson_id,lesson_order")
      .in("weekly_topic_id", weeklyTopics.map(w => w.id))
      .order("lesson_order");
    if (linksError) throw linksError;

    const lessonIds = [...new Set((links || []).map(x => Number(x.lesson_id)))];
    let lessons = [];
    let topics = [];
    if (lessonIds.length) {
      const { data: lessonRows, error: lessonsError } = await sb
        .from("lessons")
        .select("id,topic_id,title,content,lesson_order")
        .in("id", lessonIds);
      if (lessonsError) throw lessonsError;
      lessons = lessonRows || [];
      const topicIdsForLessons = [...new Set(lessons.map(l => Number(l.topic_id)))];
      if (topicIdsForLessons.length) {
        const { data: topicRows, error: topicsError } = await sb
          .from("topics")
          .select("id,name,subject_id,class_id")
          .in("id", topicIdsForLessons);
        if (topicsError) throw topicsError;
        topics = topicRows || [];
      }
    }

    const lessonById = new Map(lessons.map(l => [Number(l.id), l]));
    const lessonsByWeek = new Map();
    const topicById = new Map(topics.map(t => [Number(t.id), t]));
    const cards = weeklyTopics.map(week => {
      const weekLinks = (links || [])
        .filter(link => Number(link.weekly_topic_id) === Number(week.id))
        .sort((a, b) => Number(a.lesson_order) - Number(b.lesson_order));
      const mappedLessons = weekLinks.map(link => {
        const lesson = lessonById.get(Number(link.lesson_id));
        if (!lesson) return null;
        const topic = topicById.get(Number(lesson.topic_id));
        if (!topic || Number(topic.subject_id) !== Number(subject.id)) return null;
        return { ...lesson, topicName: topic.name, topicId: Number(topic.id) };
      }).filter(Boolean);
      lessonsByWeek.set(Number(week.id), mappedLessons);
      return `<article class="card" style="margin-bottom:12px">
        <div class="pill" style="display:inline-block">Week ${Number(week.week_number)}</div>
        <h3 style="margin:10px 0 6px">${escapeHtml(week.title)}</h3>
        ${week.content_outline ? `<p class="muted">${escapeHtml(week.content_outline)}</p>` : ""}
        ${mappedLessons.length ? `<div style="display:grid;gap:9px;margin-top:12px">${mappedLessons.map(lesson => `
          <div style="border:1px solid #e5eaf2;border-radius:12px;padding:12px">
            <strong>📖 ${escapeHtml(lesson.title)}</strong>
            <div style="margin-top:10px"><button class="primary curriculum-open-lesson" type="button" data-lesson-id="${Number(lesson.id)}" data-week-id="${Number(week.id)}" data-topic-id="${lesson.topicId}" data-topic-name="${escapeHtml(lesson.topicName)}" data-week-title="${escapeHtml(week.title)}">Open Lesson</button></div>
          </div>`).join("")}</div>` : `<p class="muted" style="margin-bottom:0">Lesson content coming soon.</p>`}
      </article>`;
    }).join("");

    weeksBox.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap"><h3 style="margin:0">${escapeHtml(termName)} — Weekly Topics</h3><span class="muted">${weeklyTopics.length} weeks</span></div>${cards}`;

    weeksBox.querySelectorAll(".curriculum-open-lesson").forEach(btn => {
      btn.onclick = () => {
        const lessonId = Number(btn.dataset.lessonId);
        const topicId = Number(btn.dataset.topicId);
        const lesson = lessonById.get(lessonId);
        if (!lesson) return;
        currentSubject = { id: subject.id, name: subject.name };
        currentTopic = { id: topicId, name: btn.dataset.topicName };
        show("lessonView");
      const lessons = lessonsByWeek.get(Number(btn.dataset.weekId)) || [lesson];
displayLesson(lesson, subject.name, btn.dataset.weekTitle, topicId, lessons);
      };
    });
  } catch (e) {
    console.error("Weekly curriculum error:", e);
    weeksBox.innerHTML = `<div class="card"><p>Could not load weekly topics.</p><p class="muted">${escapeHtml(e.message || "Please try again.")}</p><button class="ghost" id="retryCurriculumTerm" type="button">Try again</button></div>`;
    const retry = $("retryCurriculumTerm");
 if (retry) {
  retry.onclick = () =>
    openCurriculumTerm(
      termId,
      termName,
      subject,
      versionId,
      weeksBoxId
    );
}
  }
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

    const questionFields =
      "id,topic_id,question,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,language_code,exam_type";

    /*
      ==========================================
      LESSON-SPECIFIC PRACTICE WITH FALLBACKS
      ==========================================

      Priority:
      1. lesson_question_links
      2. questions.lesson_id
      3. questions.topic_id
    */

    if (lessonId) {
      // SOURCE 1: Questions linked to this lesson.
      const {
        data: links,
        error: linkError
      } = await sb
        .from("lesson_question_links")
        .select("question_id, role, weight")
        .eq("lesson_id", lessonId);

      if (linkError) throw linkError;

      const uniqueLinks = [];
      const seenLinkIds = new Set();

      for (const link of links || []) {
        const id = Number(link.question_id);

        if (
          Number.isFinite(id) &&
          !seenLinkIds.has(id)
        ) {
          seenLinkIds.add(id);
          uniqueLinks.push({
            ...link,
            question_id: id
          });
        }
      }

      const questionIds = uniqueLinks.map(
        link => link.question_id
      );

      if (questionIds.length) {
        const {
          data: linkedQuestions,
          error: linkedError
        } = await sb
          .from("questions")
          .select(questionFields)
          .in("id", questionIds)
          .eq("language_code", "en")
          .eq("is_published", true);

        if (linkedError) throw linkedError;

        const roleMap = new Map(
          uniqueLinks.map(link => [
            link.question_id,
            String(link.role || "core").toLowerCase()
          ])
        );

        questionPool = (
          linkedQuestions || []
        ).map(q => ({
          ...q,
          practiceRole:
            roleMap.get(Number(q.id)) || "core"
        }));
      }

      // SOURCE 2: Questions assigned directly to the lesson.
      if (!questionPool.length) {
        const {
          data: lessonQuestions,
          error: lessonQuestionError
        } = await sb
          .from("questions")
          .select(questionFields)
          .eq("lesson_id", lessonId)
          .eq("language_code", "en")
          .eq("is_published", true)
          .order("id");

        if (lessonQuestionError) {
          throw lessonQuestionError;
        }

        questionPool = (
          lessonQuestions || []
        ).map(q => ({
          ...q,
          practiceRole: "core"
        }));
      }

      // SOURCE 3: Published questions assigned to the topic.
      if (!questionPool.length) {
        const {
          data: topicQuestions,
          error: topicQuestionError
        } = await sb
          .from("questions")
          .select(questionFields)
          .eq("topic_id", topicId)
          .eq("language_code", "en")
          .eq("is_published", true)
          .order("id");

        if (topicQuestionError) {
          throw topicQuestionError;
        }

        questionPool = (
          topicQuestions || []
        ).map(q => ({
          ...q,
          practiceRole: "core"
        }));
      }

    } else {
      /*
        ==========================================
        NORMAL TOPIC PRACTICE
        ==========================================
        Preserves existing topic-level practice.
      */

      const {
        data,
        error
      } = await sb
        .from("questions")
        .select(questionFields)
        .eq("language_code", "en")
        .eq("topic_id", topicId)
        .eq("is_published", true)
        .order("id");

      if (error) throw error;

      questionPool = data || [];
    }

    /*
      ==========================================
      HANDLE EMPTY QUESTION POOL
      ==========================================
    */

    if (!questionPool.length) {
      $("question").textContent =
        "No published practice questions are available for this topic yet.";

      $("options").innerHTML = `
        <button class="ghost" type="button" id="backToTopics">
          ← Back to Topics
        </button>
      `;

      $("backToTopics").onclick = () => {
        if (lessonId) {
          displayLesson(
            lessonId,
            topicId,
            subjectName,
            topicName
          );
        } else if (currentSubject?.id) {
          start(currentSubject.id, subjectName);
        }
      };

      return;
    }

    /*
      ==========================================
      SHUFFLE HELPER
      ==========================================
    */

    const shuffle = arr => {
      const copy = [...arr];

      for (
        let i = copy.length - 1;
        i > 0;
        i--
      ) {
        const j = Math.floor(
          Math.random() * (i + 1)
        );

        [copy[i], copy[j]] =
          [copy[j], copy[i]];
      }

      return copy;
    };

    /*
      ==========================================
      SMART RANDOM SELECTION
      ==========================================
    */

    let selected = [];

    if (lessonId) {
      /*
        Prioritize Core questions, then Revision,
        then Challenge. Fallback questions are
        treated as Core.
      */

      const core = questionPool.filter(
        q =>
          String(q.practiceRole || "core")
            .toLowerCase() === "core"
      );

      const revision = questionPool.filter(
        q =>
          String(q.practiceRole || "")
            .toLowerCase() === "revision"
      );

      const challenge = questionPool.filter(
        q =>
          String(q.practiceRole || "")
            .toLowerCase() === "challenge"
      );

      selected.push(
        ...shuffle(core).slice(0, 12)
      );

      selected.push(
        ...shuffle(revision).slice(0, 2)
      );

      selected.push(
        ...shuffle(challenge).slice(0, 1)
      );

      // Fill any remaining spaces without duplicates.
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
        selected.push(remaining.shift());
      }

      selected = selected.slice(0, 15);

    } else {
      /*
        Preserve existing topic-level selection:
        5 Easy, 7 Medium, 3 Hard/Challenging,
        then fill remaining places if necessary.
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

      const hard = questionPool.filter(q => {
        const difficulty =
          String(q.difficulty || "")
            .toLowerCase();

        return (
          difficulty === "hard" ||
          difficulty === "challenging"
        );
      });

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
        selected.push(remaining.shift());
      }

      selected = shuffle(
        selected.slice(0, 15)
      );
    }

    /*
      ==========================================
      FINAL QUESTION SET
      ==========================================
    */

    currentQuestions = selected;

    currentAnswers = new Array(
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

    $("explain").classList.remove("hidden");
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
  topic_id: Number(currentTopic.id),
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
    $("resultTopics").onclick = () =>
      start(currentSubject.id, currentSubject.name);
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
  
  // Clear Tim's previous question and messages on logout.
  const timQuestionBox = document.querySelector(
    ".tim-question-box textarea"
  );

  if (timQuestionBox) {
    timQuestionBox.value = "";
  }

  if ($("timMsg")) {
    $("timMsg").textContent = "";
  }

  if ($("timSolutionMsg")) {
    $("timSolutionMsg").textContent = "";
  }

  if ($("timSolutionCard")) {
    $("timSolutionCard").classList.add("hidden");
  }

  if ($("timDashboardStatus")) {
    $("timDashboardStatus").classList.add("hidden");
  }

  sessionStorage.removeItem("passOnceTimRequest");

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
    if (curriculumReturn) {
      show("curriculumView");
      openCurriculumTerm(
        curriculumReturn.termId,
        curriculumReturn.termName,
        curriculumReturn.subject,
        curriculumReturn.versionId
      );
      return;
    }
    start(currentSubject.id, currentSubject.name);
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

const timStartBtn = $("timStartBtn");

if (timStartBtn) {
  timStartBtn.onclick = () => {
    const request = $("timRequest")?.value.trim();

    if (!request) {
      const timMsg = $("timMsg");
      if (timMsg) {
        timMsg.textContent =
          "Tell me your assignment, question, or topic first.";
      }
      return;
    }

    // Keep Tim's question while the visitor logs in.
    sessionStorage.setItem("passOnceTimRequest", request);

    const timMsg = $("timMsg");
    if (timMsg) {
      timMsg.textContent =
        "Wonderful! Please log in or create your account so we can continue learning.";
    }

    // Bring the login form into focus.
    $("email")?.focus();
  };
}

function solveTimMathQuestion(question) {
  
  // Tim: Solve simple past-and-future age word problems.
  const ageQuestion = String(question || "").toLowerCase();

  const pastAgeMatch = ageQuestion.match(
  /\b(?:was|were)\s+(\d+)\s+years?(?:\s+old)?\s+(\d+)\s+years?\s+ago\b/
);

  const futureYearsMatch = ageQuestion.match(
    /\b(?:in|after)\s+(\d+)\s+years?(?:\s+time)?\b/
  );

  if (pastAgeMatch && futureYearsMatch) {
    const ageInPast = Number(pastAgeMatch[1]);
    const yearsAgo = Number(pastAgeMatch[2]);
    const yearsIntoFuture = Number(futureYearsMatch[1]);

    const presentAge = ageInPast + yearsAgo;
    const futureAge = presentAge + yearsIntoFuture;

    
const steps = [
  `Step 1: ${yearsAgo} years ago, the man was ${ageInPast} years old. Add ${yearsAgo} years to find his present age.`,
  `${ageInPast} + ${yearsAgo} = ${presentAge}.`,
  `Step 2: In ${yearsIntoFuture} years, he will be ${presentAge} years old plus ${yearsIntoFuture} more years.`,
  `${presentAge} + ${yearsIntoFuture} = ${futureAge}.`,
  `Final answer: ${futureAge} years old.`
];


    return {
      answer: `${futureAge} years old`,
      steps
    };
  }

  const text = String(question || "").toLowerCase();

  // Recognise a simple calculation with two numbers.
  const match = text.match(
    /(-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?)\s*(\+|addition|plus|−|–|-|subtraction|minus|×|x|\*|multiplication|times|÷|\/|division|divided by)\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?)/i
  );

  if (!match) return null;

  const parseNumber = (value) => {
    const parts = value.replace(/\s/g, "").split("/");

    if (parts.length === 2) {
      const numerator = Number(parts[0]);
      const denominator = Number(parts[1]);

      if (
        !Number.isFinite(numerator) ||
        !Number.isFinite(denominator) ||
        denominator === 0
      ) {
        return null;
      }

      return {
        n: numerator,
        d: denominator
      };
    }

    const number = Number(value);

    if (!Number.isFinite(number)) return null;

    const decimalPlaces = (value.split(".")[1] || "").length;
    const denominator = 10 ** decimalPlaces;

    return {
      n: Math.round(number * denominator),
      d: denominator
    };
  };

  const gcd = (a, b) => {
    a = Math.abs(a);
    b = Math.abs(b);

    while (b) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }

    return a || 1;
  };

  const format = (fraction) => {
    let n = fraction.n;
    let d = fraction.d;

    if (d < 0) {
      n = -n;
      d = -d;
    }

    const divisor = gcd(n, d);
    n /= divisor;
    d /= divisor;

    if (d === 1) return String(n);

    return `${n}/${d}`;
  };

  const a = parseNumber(match[1]);
  const b = parseNumber(match[3]);

  if (!a || !b) return null;

  const operatorText = match[2].toLowerCase();
  let operator;

  if (["+", "addition", "plus"].includes(operatorText)) {
    operator = "+";
  } else if (
    ["−", "–", "-", "subtraction", "minus"].includes(operatorText)
  ) {
    operator = "-";
  } else if (
    ["×", "x", "*", "multiplication", "times"].includes(operatorText)
  ) {
    operator = "*";
  } else {
    operator = "/";
  }

  if (operator === "/" && b.n === 0) {
    return {
      answer: "Undefined",
      steps: ["You cannot divide by zero."]
    };
  }

  let result;
  const steps = [];

  // Use natural explanations for whole-number calculations.
  const isWholeNumber =
    Number.isInteger(a.n / a.d) &&
    Number.isInteger(b.n / b.d);

 
if (
  isWholeNumber &&
  (operator === "+" || operator === "-" || operator === "*")
) {

    const first = a.n / a.d;
    const second = b.n / b.d;
    
let answer;

if (operator === "+") {
  answer = first + second;
} else if (operator === "-") {
  answer = first - second;
} else if (["*", "×", "x"].includes(operator)) {
  answer = first * second;
}


    
    if (operator === "+") {
      steps.push(`Let's start with ${first}.`);
      steps.push(`Add ${second} more.`);
      steps.push(`${first} + ${second} = ${answer}.`);
    } else if (operator === "-") {
      steps.push(`We start with ${first}.`);
      steps.push(`Take away ${second}.`);
      steps.push(`${first} - ${second} = ${answer}.`);
    } else {
      steps.push(`We have ${first} groups of ${second}.`);
      steps.push(
        `Multiplying ${first} by ${second} gives ${answer}.`
      );
    }

    steps.push(`Final answer: ${answer}`);



    return {
      answer: String(answer),
      steps
    };
  }

  if (operator === "+" || operator === "-") {
    const numerator =
      operator === "+"
        ? a.n * b.d + b.n * a.d
        : a.n * b.d - b.n * a.d;

    const denominator = a.d * b.d;

    steps.push(
      `Step 1: Use a common denominator: ${a.n}/${a.d} and ${b.n}/${b.d}.`
    );

    steps.push(
      `Step 2: ${operator === "+" ? "Add" : "Subtract"} the numerators: (${a.n} × ${b.d}) ${operator} (${b.n} × ${a.d}) = ${numerator}.`
    );

    steps.push(`Step 3: Keep the denominator: ${denominator}.`);

    result = { n: numerator, d: denominator };
  } else if (operator === "*") {
    result = {
      n: a.n * b.n,
      d: a.d * b.d
    };

    steps.push("Step 1: Multiply the numerators.");
    steps.push(`${a.n} × ${b.n} = ${result.n}.`);
    steps.push("Step 2: Multiply the denominators.");
    steps.push(`${a.d} × ${b.d} = ${result.d}.`);
  } else {
    result = {
      n: a.n * b.d,
      d: a.d * b.n
    };

    steps.push("Step 1: Keep the first fraction and flip the second.");
    steps.push(
      `${a.n}/${a.d} ÷ ${b.n}/${b.d} = ${a.n}/${a.d} × ${b.d}/${b.n}.`
    );
    steps.push("Step 2: Multiply the numerators and denominators.");
    steps.push(`${a.n} × ${b.d} = ${result.n}; ${a.d} × ${b.n} = ${result.d}.`);
  }

  const answer = format(result);
  const simplified = answer !== `${result.n}/${result.d}`;

  if (simplified) {
    steps.push(`Step ${steps.length + 1}: Simplify the fraction.`);
  }

  steps.push(`Final answer: ${answer}`);

  return {
    answer,
    steps
  };
}

function formatTimAIText(text) {
  return String(text || "")
    // Make common maths notation easier to read.
    .replace(/\$\$?([\s\S]*?)\$\$?/g, "$1")
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(
      /\\xrightarrow(?:\[[^\]]*\])?\{([^{}]*)\}/g,
      " --$1--> "
    )
    .replace(/\\times\b/g, " × ")
    .replace(/\\div\b/g, " ÷ ")
    .replace(/\\cdot\b/g, " · ")
    .replace(/\\,/g, " ")
    .replace(/\\\\/g, "\n")
    // Remove Markdown heading and divider symbols.
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    // Remove Markdown bold, italic and inline-code markers.
    .replace(/\*\*(.*?)\*\*/gs, "$1")
    .replace(/__(.*?)__/gs, "$1")
    .replace(/\*(.*?)\*/gs, "$1")
    .replace(/_(.*?)_/gs, "$1")
    .replace(/`([^`]*)`/g, "$1")
    // Make Markdown list markers look cleaner.
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, (match) => match.trim() + " ")
    // Tidy excessive blank lines and surrounding spaces.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


async function showTimAIAnswer(request) {
  const timMsg = $("timMsg");
  const solutionCard = $("timSolutionCard");
  const solutionQuestion = $("timSolutionQuestion");
  const solutionSteps = $("timSolutionSteps");
  const solutionAnswer = $("timSolutionAnswer");
  const solutionMsg = $("timSolutionMsg");
  if (timMsg) {
  timMsg.textContent =
    "⏳ Hold on! Tim is preparing your answer. " +
    "It will appear here shortly. Please keep this page open.";
}

if (solutionMsg) {
  solutionMsg.textContent = "Tim is working on your question...";
}

const dashboardStatus = $("timDashboardStatus");
const dashboardMessage = $("timDashboardMessage");
const countdownDisplay = $("timCountdown");
const dashboardRetry = $("timDashboardRetry");

let countdownInterval = null;
let secondsRemaining = 60;

if (dashboardStatus) {
  dashboardStatus.classList.remove("hidden");
}

if (dashboardMessage) {
  dashboardMessage.textContent =
    "Tim is preparing your answer. Please wait.";
}

if (countdownDisplay) {
  countdownDisplay.classList.remove("hidden");
  countdownDisplay.textContent = "Time remaining: 60 seconds";
}

if (dashboardRetry) {
  dashboardRetry.classList.add("hidden");
  dashboardRetry.onclick = null;
}

show("dash");

countdownInterval = setInterval(() => {
  secondsRemaining = Math.max(0, secondsRemaining - 1);

  if (countdownDisplay) {
    countdownDisplay.textContent =
      `Time remaining: ${secondsRemaining} seconds`;
  }
}, 1000);

  try {
    const subjectName =
      typeof currentSubject !== "undefined"
        ? currentSubject?.name || ""
        : "";

    
    let timeoutId;

    const aiRequest = sb.functions.invoke("tim-tutor", {
      body: {
        question: request,
        subject: subjectName,
        classLevel:
          profile?.level ||
          profile?.class_level ||
          profile?.class_name ||
          "",
        language:
          profile?.learning_language ||
          profile?.language ||
          "English"
      }
    });

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("TIM_TIMEOUT"));
      }, 60000);
    });

    let result;

    try {
      result = await Promise.race([
        aiRequest,
        timeoutPromise
      ]);
    } finally {
  clearTimeout(timeoutId);
  clearInterval(countdownInterval);
}

    const { data, error } = result;


    if (error) throw error;
    if (!data?.answer) {
      throw new Error("Tim received no AI answer.");
    }

    if (solutionQuestion) {
      solutionQuestion.textContent = "Question: " + request;
    }

    if (solutionSteps) {
  solutionSteps.textContent = formatTimAIText(data.answer);
  solutionSteps.style.whiteSpace = "pre-wrap";
}

    if (solutionAnswer) {
      solutionAnswer.textContent = "Tim's AI Explanation";
    }

    if (solutionCard) {
  solutionCard.classList.remove("hidden");
}

    
const learnMore = $("timLearnMore");
if (learnMore) {
  learnMore.disabled = true;
  learnMore.onclick = null;
  learnMore.style.opacity = "0.55";
  learnMore.style.cursor = "not-allowed";
  learnMore.title = "No matching lesson is available for this answer.";
}


    if (solutionMsg) {
      solutionMsg.textContent =
        "No suitable lesson was found in our database, so Tim's AI tutor has helped with your question.";
    }

    if (timMsg) {
      timMsg.textContent =
        "Tim has answered using his AI tutor because a matching lesson wasn't available.";
    }
if (dashboardMessage) {
  dashboardMessage.textContent = formatTimAIText(data.answer);
  dashboardMessage.style.whiteSpace = "pre-wrap";
}

if (countdownDisplay) {
  countdownDisplay.classList.add("hidden");
}

if (dashboardRetry) {
  dashboardRetry.classList.add("hidden");
}
    return true;
  
} catch (error) {
  console.error("Tim AI fallback error:", error);
    
show("dash");

if (dashboardStatus) {
  dashboardStatus.classList.remove("hidden");
}


if (dashboardMessage) {
  dashboardMessage.textContent =
    error?.message === "TIM_TIMEOUT"
      ? "Tim is busy right now. We couldn't prepare your answer within 60 seconds. You can try again or continue learning from your Dashboard."
      : "Tim is busy right now and couldn't prepare your answer. You can try again or continue learning from your Dashboard.";
}


if (countdownDisplay) {
  countdownDisplay.classList.remove("hidden");
  countdownDisplay.textContent =
    error?.message === "TIM_TIMEOUT"
      ? "Time limit reached."
      : "Timer stopped.";
}

if (dashboardRetry) {
  dashboardRetry.classList.remove("hidden");

  dashboardRetry.onclick = () => {
    sessionStorage.setItem("passOnceTimRequest", request);
    dashboardStatus?.classList.add("hidden");
    resumeTimRequest();
  };
}

    if (solutionCard) {
  solutionCard.classList.remove("hidden");
}

const backToDashboard = $("timBackToDashboard");

if (backToDashboard) {
  backToDashboard.classList.remove("hidden");

  backToDashboard.onclick = () => {
    show("dash");
  };
}

  if (error?.message === "TIM_TIMEOUT") {
    const backToDashboard = $("timBackToDashboard");

if (backToDashboard) {
  backToDashboard.classList.remove("hidden");

  backToDashboard.onclick = () => {
    show("dash");
  };
}
    if (timMsg) {
      timMsg.textContent =
        "⏳ Tim couldn't prepare your answer within 60 seconds. " +
        "Please visit your Dashboard to continue learning from available lessons and CBT practice, or try again later.";
    }

    if (solutionMsg) {
      solutionMsg.textContent =
        "Tim's response took too long. Please try again later.";
    }
  } else {
    const backToDashboard = $("timBackToDashboard");

if (backToDashboard) {
  backToDashboard.classList.remove("hidden");

  backToDashboard.onclick = () => {
    show("dash");
  };
}
    if (timMsg) {
  timMsg.textContent = "";
}

    if (solutionMsg) {
      solutionMsg.textContent =
        "Tim couldn't prepare an answer right now. Please try again later.";
    }
  }

  return false;
}
}


async function resumeTimRequest() {
  const request = (
    sessionStorage.getItem("passOnceTimRequest") || ""
  ).trim();

  if (!request || !user || !profile) return;

  // Consume the request so it cannot run again on the next login.
  sessionStorage.removeItem("passOnceTimRequest");

  if (profile.role === "parent") return;

  
const timMsg = $("timMsg");

// Try solving a supported maths calculation first.
const mathSolution = solveTimMathQuestion(request);

const solutionCard = $("timSolutionCard");
const solutionQuestion = $("timSolutionQuestion");
const solutionSteps = $("timSolutionSteps");
const solutionAnswer = $("timSolutionAnswer");

if (solutionCard) {
  solutionCard.classList.add("hidden");
}

if (mathSolution && solutionCard) {
  if (solutionQuestion) {
    solutionQuestion.textContent = "Question: " + request;
  }

  if (solutionSteps) {
    solutionSteps.textContent = mathSolution.steps.join("\n");
    solutionSteps.style.whiteSpace = "pre-line";
  }

  if (solutionAnswer) {
    solutionAnswer.textContent =
      "Final answer: " + mathSolution.answer;
  }

    solutionCard.classList.remove("hidden");
  return;
}

if (timMsg) {
  timMsg.textContent =
    "⏳ Hold on! Tim is preparing your answer. " +
    "Your answer will appear here shortly. Please keep this page open.";
}



  try {
    // Find the student's actual class.
    const studentClass = await findClass();

    if (!studentClass) {
  await showTimAIAnswer(request);
  return;
}

    // Load topics for this class.
    const { data: topics, error: topicsError } = await sb
      .from("topics")
      .select("id,name,subject_id,class_id")
      .eq("class_id", studentClass.id);

    if (topicsError) throw topicsError;

    if (!topics?.length) {
  await showTimAIAnswer(request);
  return;
}

    // Load subject names to help match the student's request.
    const subjectIds = [
      ...new Set(topics.map((topic) => topic.subject_id))
    ];

    const { data: subjects, error: subjectsError } = await sb
      .from("subjects")
      .select("id,name")
      .in("id", subjectIds);

    if (subjectsError) throw subjectsError;

    const subjectById = new Map(
      (subjects || []).map((subject) => [
        Number(subject.id),
        subject.name
      ])
    );

    // Search topic names and subject names using the request.
    const normalize = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const requestText = normalize(request);


const getTimLearningIntent = (text) => {
  const normalized = normalize(text);

  const intentGroups = [
    {
      name: "addition",
      words: [
        "addition",
        "add",
        "adding",
        "sum",
        "plus",
        "summation",
        "total"
      ]
    },
    {
      name: "subtraction",
      words: [
        "subtraction",
        "subtract",
        "subtracting",
        "minus",
        "difference",
        "take away"
      ]
    },
    {
      name: "multiplication",
      words: [
        "multiplication",
        "multiply",
        "multiplying",
        "product",
        "times"
      ]
    },
    {
      name: "division",
      words: [
        "division",
        "divide",
        "dividing",
        "quotient",
        "sharing equally"
      ]
    },
    {
      name: "simplification",
      words: [
        "simplify",
        "simplifying",
        "simplification",
        "reduce",
        "lowest terms"
      ]
    }
  ];

  const matchedIntents = intentGroups
    .filter((group) =>
      group.words.some((word) =>
        (` ${normalized} `).includes(` ${word} `)
      )
    )
    .map((group) => group.name);

  // Recognise mathematical symbols as learning intents.
  const rawText = String(text || "").toLowerCase();

  const operationPatterns = [
    { name: "addition", pattern: /\d\s*\+\s*\d/ },
    { name: "subtraction", pattern: /\d\s*-\s*\d/ },
    { name: "multiplication", pattern: /\d\s*(?:×|\*|x)\s*\d/ },
    { name: "division", pattern: /\d\s*(?:÷|\/)\s*\d/ }
  ];

  for (const operation of operationPatterns) {
    if (
      operation.pattern.test(rawText) &&
      !matchedIntents.includes(operation.name)
    ) {
      matchedIntents.push(operation.name);
    }
  }

  
  return {
    text: normalized,
    intents: matchedIntents
  };
};

const timLearningIntent = getTimLearningIntent(request);


const ignoredWords = new Set([
  "explain",
  "teach",
  "learn",
  "learning",
  "understand",
  "want",
  "like",
  "help",
  "please",
  "tell",
  "show",
  "about",
  "into",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "why",
  "can",
  "could",
  "would",
  "me",
  "my",
  "the",
  "and",
  "for",
  "you",
  "i"
]);

const words = requestText
  .split(" ")
  .filter(
    (word) => word.length > 2 && !ignoredWords.has(word)
  );


    // Load existing lessons for the student's class topics.
    const topicIds = topics.map((topic) => Number(topic.id));

    const { data: classLessons, error: classLessonsError } = await sb
      .from("lessons")
      .select("id,topic_id,title,content,lesson_order")
      .in("topic_id", topicIds);

    if (classLessonsError) throw classLessonsError;

    const lessonsByTopic = new Map();

    for (const lesson of classLessons || []) {
      const id = Number(lesson.topic_id);

      if (!lessonsByTopic.has(id)) {
        lessonsByTopic.set(id, []);
      }

      lessonsByTopic.get(id).push(lesson);
    }




    // Tim: rank topics and lessons together.
    const intentWords = {
      addition: [
        "addition", "add", "adding", "sum", "plus",
        "summation", "total"
      ],
      subtraction: [
        "subtraction", "subtract", "subtracting",
        "minus", "difference", "take away"
      ],
      multiplication: [
        "multiplication", "multiply", "multiplying",
        "product", "times"
      ],
      division: [
        "division", "divide", "dividing",
        "quotient"
      ],
      simplification: [
        "simplify", "simplifying", "simplification",
        "reduce", "lowest terms"
      ],
      conversion: [
        "convert", "conversion", "converting"
      ]
    };

    const conceptGroups = [
      {
        name: "fractions",
        words: ["fraction", "fractions"]
      },
      {
        name: "decimals",
        words: ["decimal", "decimals"]
      },
      {
        name: "percentages",
        words: ["percentage", "percentages", "percent"]
      }
    ];

    const hasWord = (text, word) =>
      (` ${text} `).includes(` ${word} `);

    const requestedConcepts = conceptGroups.filter((group) =>
      group.words.some((word) => hasWord(requestText, word))
    );

    const requestedIntents = timLearningIntent.intents.slice();

    // Also recognize conversion as a learning skill.
    if (
      /\b(convert|conversion|converting)\b/.test(requestText) &&
      !requestedIntents.includes("conversion")
    ) {
      requestedIntents.push("conversion");
    }

    const matches = topics.map((topic) => {
      const topicName = normalize(topic.name);
      const subjectName =
        subjectById.get(Number(topic.subject_id)) || "";

      const topicLessons =
        lessonsByTopic.get(Number(topic.id)) || [];

      // Score the topic's relevance to the requested concept.
      let topicScore = 0;

      if (topicName && hasWord(requestText, topicName)) {
        topicScore += 12;
      }

      for (const word of words) {
        if (hasWord(topicName, word)) topicScore += 2;
        if (hasWord(normalize(subjectName), word)) {
          topicScore += 1;
        }
      }

      for (const concept of requestedConcepts) {
        if (
          concept.words.some((word) => hasWord(topicName, word))
        ) {
          topicScore += 15;
        }
      }

      // Score each lesson by title, concept, and lesson content.
      const scoredLessons = topicLessons.map((lesson) => {
        const title = normalize(lesson.title);
        const content = normalize(lesson.content);
        let lessonScore = 0;

        const matchedConcepts = requestedConcepts.filter(
          (concept) =>
            concept.words.some((word) =>
              hasWord(title, word)
            )
        );

        const contentConcepts = requestedConcepts.filter(
          (concept) =>
            concept.words.some((word) =>
              hasWord(content, word)
            )
        );

        // A concept in the title is stronger evidence than
        // a concept appearing only in the lesson content.
        lessonScore += matchedConcepts.length * 20;
        lessonScore += contentConcepts.length * 5;

        // Reward the requested operation or learning skill.
        for (const intent of requestedIntents) {
          const terms = intentWords[intent] || [];

          const titleMatchesIntent = terms.some((word) =>
            hasWord(title, word)
          );

          const contentMatchesIntent = terms.some((word) =>
            hasWord(content, word)
          );

          if (titleMatchesIntent) {
            lessonScore += 25;
          } else if (contentMatchesIntent) {
            lessonScore += 6;
          }
        }

        // Match other meaningful words from the request.
        for (const word of words) {
          if (hasWord(title, word)) lessonScore += 3;
          if (hasWord(content, word)) lessonScore += 1;
        }

        // Strongly prefer lessons that match both the concept
        // and the requested skill.
        if (
          requestedConcepts.length > 0 &&
          matchedConcepts.length > 0 &&
          requestedIntents.length > 0
        ) {
          const terms = requestedIntents.flatMap(
            (intent) => intentWords[intent] || []
          );

          if (terms.some((word) => hasWord(title, word))) {
            lessonScore += 20;
          }
        }

        
        
        // Avoid recommending specialised lessons when the
        // student has not requested that specific concept.
        const requestsDecimals = requestedConcepts.some(
          (concept) => concept.name === "decimals"
        );

        const requestsFractions = requestedConcepts.some(
          (concept) => concept.name === "fractions"
        );

        const requestsPercentages = requestedConcepts.some(
          (concept) => concept.name === "percentages"
        );

        if (!requestsDecimals && title.includes("decimal")) {
          lessonScore = -100;
        }

        if (!requestsFractions && title.includes("fraction")) {
          lessonScore = -100;
        }

        if (
          !requestsPercentages &&
          (title.includes("percentage") || title.includes("percent"))
        ) {
          lessonScore = -100;
        }


        return { lesson, score: lessonScore };

      });

      scoredLessons.sort((a, b) => b.score - a.score);

      const topLessonScore = scoredLessons[0]?.score || 0;

      return {
        topic,
        subjectName,
        topicScore,
        scoredLessons,
        score: topicScore + topLessonScore
      };
    });

    
    // Do not guess a lesson for a standalone maths calculation.
    const isStandaloneMathExpression =
      /^[\d\s()+\-−×x*÷\/.]+$/.test(String(request || "").trim());

    if (mathSolution && isStandaloneMathExpression) {
      matches.length = 0;
    }

    // Prefer topics whose lessons best match the whole request.
    matches.sort((a, b) => b.score - a.score);


    if (!matches.length || matches[0].score < 6) {
  if (mathSolution && solutionCard) {
    solutionCard.classList.remove("hidden");

    const learnMore = $("timLearnMore");
    if (learnMore) {
      learnMore.disabled = true;
    }

    const solutionMsg = $("timSolutionMsg");
    if (solutionMsg) {
      solutionMsg.textContent =
        "I solved your maths question, but couldn't find a matching lesson in your class yet.";
    }
  } else {
  await showTimAIAnswer(request);
}

  return;
}

    const best = matches[0];

    // Use the already-ranked lessons from the selected topic.
    const lessons = (lessonsByTopic.get(Number(best.topic.id)) || [])
      .slice()
      .sort(
        (a, b) =>
          Number(a.lesson_order || 0) - Number(b.lesson_order || 0) ||
          Number(a.id) - Number(b.id)
      );

    if (!lessons.length) {
      if (timMsg) {
        timMsg.textContent =
          `I found ${best.topic.name}, but its lesson content isn't available yet.`;
      }
      return;
    }


    
    // Select only a lesson with a positive relevance score.
    const selectedMatch = best.scoredLessons.find(
      (item) => item.score > 0
    );

    const selectedLesson = selectedMatch?.lesson;

    // If no lesson matches, keep the maths solution but
    // don't recommend an unrelated lesson.
    if (!selectedLesson) {
      if (mathSolution && solutionCard) {
        solutionCard.classList.remove("hidden");

        const learnMore = $("timLearnMore");
        if (learnMore) {
          learnMore.disabled = true;
        }

        const solutionMsg = $("timSolutionMsg");
        if (solutionMsg) {
          solutionMsg.textContent =
            "I solved your maths question, but a closely matching lesson isn't available in your class yet.";
        }
      } else {
  await showTimAIAnswer(request);
}

      return;
    }


    // Prepare the selected lesson for the Learn More button.
    currentSubject = {
      id: Number(best.topic.subject_id),
      name: best.subjectName
    };

    const learnMore = $("timLearnMore");
    const solutionMsg = $("timSolutionMsg");

    if (mathSolution && solutionCard) {
      // Keep Tim's answer visible in the CBT practice area.
      solutionCard.classList.remove("hidden");

      if (solutionQuestion) {
        solutionQuestion.textContent = "Question: " + request;
      }

      if (solutionSteps) {
        solutionSteps.textContent = mathSolution.steps.join("\n");
        solutionSteps.style.whiteSpace = "pre-line";
      }

      if (solutionAnswer) {
        solutionAnswer.textContent =
          "Final answer: " + mathSolution.answer;
      }

      if (solutionMsg) {
        solutionMsg.textContent =
          `Want to learn more? I found "${selectedLesson.title}" for you.`;
      }

      if (learnMore) {
        learnMore.disabled = false;

        learnMore.onclick = () => {
          show("lessonView");

          displayLesson(
            selectedLesson,
            best.subjectName,
            best.topic.name,
            Number(best.topic.id),
            lessons
          );
        };
      }
    } else {
      // Preserve the existing lesson flow for other questions.
      show("lessonView");

      displayLesson(
        selectedLesson,
        best.subjectName,
        best.topic.name,
        Number(best.topic.id),
        lessons
      );

      if (timMsg) {
        timMsg.textContent =
          `I found ${best.topic.name}. Let's start with "${selectedLesson.title}"!`;
      }
    }

    sessionStorage.removeItem("passOnceTimRequest");


  
} catch (error) {
  console.error("Tim lesson matching error:", error);

  // If the database search fails, try Tim's AI tutor.
  await showTimAIAnswer(request);
}

}

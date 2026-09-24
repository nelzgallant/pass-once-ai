const sb = supabase.createClient(window.PASS_ONCE_URL, window.PASS_ONCE_KEY);
const $ = id => document.getElementById(id);

let signup = false, user = null, profile = null, classRow = null;
let currentSubject = null, currentQuestions = [], currentIndex = 0, currentScore = 0, answered = false;

function show(id){
  ["auth","setup","dash","parentDash","quiz","tutorView"]
    .forEach(x => $(x).classList.add("hidden"));

  $(id).classList.remove("hidden");
}
function message(text=""){ $("msg").textContent=text; }
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));}
function normalizeLevel(level){return String(level||"JSS 1").replace(/\s+/g,"").toUpperCase();}
function redirectUrl(){return window.location.origin + window.location.pathname;}
async function getCurrentUser(){const {data,error}=await sb.auth.getUser();if(error) throw error;return data.user;}

function setAuthMode(isSignup){
  signup = isSignup;

  $("loginTab").classList.toggle("active", !signup);
  $("signupTab").classList.toggle("active", signup);

  $("nameBox").classList.toggle("hidden", !signup);
  $("accountTypeBox").classList.toggle("hidden", !signup);

  $("authBtn").innerHTML =
    signup
      ? 'Create account <span>→</span>'
      : 'Log in <span>→</span>';

  $("authTitle").textContent =
    signup
      ? 'Create your Pass Once AI account'
      : 'Welcome Back!';

  $("authSubtitle").textContent =
    signup
      ? 'Start your learning journey today.'
      : 'Log in to continue your learning journey.';

  $("password").setAttribute(
    "autocomplete",
    signup ? "new-password" : "current-password"
  );

  message();
}
$("loginTab").onclick=()=>setAuthMode(false);
$("signupTab").onclick=()=>setAuthMode(true);

$("authBtn").onclick=async()=>{
 const email=$("email").value.trim(), password=$("password").value;
 if(!email||!password)return message("Please enter your email and password.");
 try{
  $("authBtn").disabled=true;
  const result=signup
   await sb.auth.signUp({
  email,
  password,
  options:{
    data:{
      full_name:$("name").value.trim(),
      account_type:$("accountType").value
    },
    emailRedirectTo:redirectUrl()
  }
})
   : await sb.auth.signInWithPassword({email,password});
  if(result.error)throw result.error;
  if(signup&&!result.data.session){message("Account created! Check your email, then tap the verification link to return to Pass Once AI.");return;}
  await load();
 }catch(e){message(e.message||"Authentication failed.");}
 finally{$("authBtn").disabled=false;}
};

async function load(){
 try{
  user=await getCurrentUser();
  if(!user){$("logout").classList.add("hidden");show("auth");return;}
  $("logout").classList.remove("hidden");
  const {data:p,error}=await sb.from("profiles").select("*").eq("id",user.id).maybeSingle();
  if(error)throw error;
  if(!p)show("setup"); else{profile=p;await renderDash();}
 }catch(e){message(e.message||"Could not load your account.");}
}

$("saveProfile").onclick=async()=>{try{user=await getCurrentUser();if(!user)return show("auth");const p={id:user.id,full_name:$("name").value.trim()||user.user_metadata?.full_name||user.email.split("@")[0],country:$("country").value,level:$("level").value,language:$("language").value};const {error}=await sb.from("profiles").upsert(p);if(error)throw error;profile=p;await renderDash();}catch(e){message(e.message||"Could not save profile.");}};

async function findClass(){const wanted=normalizeLevel(profile?.level);const {data,error}=await sb.from("classes").select("id,name");if(error)throw error;return(data||[]).find(c=>normalizeLevel(c.name)===wanted)||null;}
async function renderDash(){show("dash");$("welcome").textContent=`Welcome, ${profile.full_name} 👋🏾`;$("profile").textContent=`${profile.country} • ${profile.level} • ${profile.language}`;classRow=await findClass();const {data:attempts,error:attemptsError}=await sb.from("quiz_attempts").select("score,total").eq("user_id",user.id);if(attemptsError)throw attemptsError;const a=attempts||[],attempted=a.reduce((n,x)=>n+Number(x.total||0),0),correct=a.reduce((n,x)=>n+Number(x.score||0),0);$("attempts").textContent=attempted;$("correct").textContent=correct;$("accuracy").textContent=(attempted?Math.round(correct/attempted*100):0)+"%";if(!classRow){$("subjects").innerHTML=`<div class="card">Choose JSS1 for the current practice demo.</div>`;return;}const {data:subjects,error}=await sb.from("curriculum_subjects").select("subject_id, subjects(id,name)").eq("class_id",classRow.id);if(error)throw error;const unique=[];for(const row of(subjects||[])){const s=row.subjects;if(s&&!unique.some(x=>x.id===s.id))unique.push(s);}if(!unique.length){const fallback=await sb.from("subjects").select("id,name").order("id");if(fallback.error)throw fallback.error;unique.push(...(fallback.data||[]));}$("subjects").innerHTML=unique.map(s=>`<button class="card subject" data-id="${s.id}" data-name="${escapeHtml(s.name)}">📚 ${escapeHtml(s.name)}</button>`).join("")||`<div class="card">No subjects found yet.</div>`;document.querySelectorAll(".subject").forEach(btn=>btn.onclick=()=>start(Number(btn.dataset.id),btn.dataset.name));}

async function start(subjectId,subjectName){if(!classRow)return;currentSubject={id:subjectId,name:subjectName};currentQuestions=[];currentIndex=0;currentScore=0;show("quiz");$("question").textContent="Loading questions…";$("options").innerHTML="";$("explain").classList.add("hidden");$("next").classList.add("hidden");try{const ids=await topicIds(subjectId,classRow.id);if(!ids.length){$("question").textContent=`No topics are loaded for ${subjectName} yet.`;return;}const {data,error}=await sb.from("questions").select("id,topic_id,question,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,language_code,exam_type").eq("language_code","en").in("topic_id",ids);if(error)throw error;currentQuestions=data||[];if(!currentQuestions.length){$("question").textContent=`No practice questions are loaded for ${subjectName} yet.`;$("options").innerHTML=`<p>Add questions in Supabase and they will appear here automatically.</p>`;return;}renderQ();}catch(e){$("question").textContent="Could not load questions.";$("explain").textContent=e.message;$("explain").classList.remove("hidden");}}
async function topicIds(subjectId,classId){const {data,error}=await sb.from("topics").select("id").eq("subject_id",subjectId).eq("class_id",classId).order("id");if(error)throw error;return(data||[]).map(x=>x.id);}
function renderQ(){const q=currentQuestions[currentIndex],opts=[q.option_a,q.option_b,q.option_c,q.option_d];$("subject").textContent=currentSubject.name;$("count").textContent=`${currentIndex+1}/${currentQuestions.length}`;$("bar").style.width=((currentIndex+1)/currentQuestions.length*100)+"%";$("question").textContent=q.question;$("options").innerHTML=opts.map((x,n)=>`<button class="option" data-i="${n}">${String.fromCharCode(65+n)}. ${escapeHtml(x)}</button>`).join("");$("explain").classList.add("hidden");$("next").classList.add("hidden");answered=false;document.querySelectorAll(".option").forEach(b=>b.onclick=()=>answer(Number(b.dataset.i)));}
function correctIndex(q){const v=String(q.correct_answer||"").trim().toUpperCase();if(["A","B","C","D"].includes(v))return v.charCodeAt(0)-65;if(["1","2","3","4"].includes(v))return Number(v)-1;return-1;}
function answer(n){if(answered)return;answered=true;const q=currentQuestions[currentIndex],right=correctIndex(q),buttons=document.querySelectorAll(".option");buttons.forEach(b=>b.disabled=true);if(right>=0)buttons[right].classList.add("correct");if(n===right)currentScore++;else if(n>=0)buttons[n].classList.add("wrong");$("explain").textContent=(n===right?"✅ Correct! ":"❌ Not quite. ")+(q.explanation||"Review the lesson and try again.");$("explain").classList.remove("hidden");$("next").textContent=currentIndex<currentQuestions.length-1?"Next Question":"Finish Practice";$("next").classList.remove("hidden");$("next").onclick=nextQuestion;}
async function nextQuestion(){if(currentIndex<currentQuestions.length-1){currentIndex++;renderQ();return;}try{const {error}=await sb.from("quiz_attempts").insert({user_id:user.id,subject:currentSubject.name,score:currentScore,total:currentQuestions.length});if(error)throw error;$("question").textContent="Practice complete! 🎉";$("options").innerHTML=`<div class="result card"><h2>${currentScore}/${currentQuestions.length}</h2><p>Your result has been saved to your Pass Once AI progress.</p><button class="primary" id="resultDash">Back to Dashboard</button></div>`;$("explain").classList.add("hidden");$("next").classList.add("hidden");$("resultDash").onclick=renderDash;}catch(e){$("explain").textContent=`Your score is ${currentScore}/${currentQuestions.length}, but it could not be saved: ${e.message}`;$("explain").classList.remove("hidden");}}

$("back").onclick=load;$("logout").onclick=async()=>{await sb.auth.signOut();user=null;profile=null;classRow=null;$("logout").classList.add("hidden");show("auth");};$("tutor").onclick=()=>{show("tutorView");$("chat").innerHTML='<div class="bubble">Hi! I am your Pass Once AI Tutor. Ask me a school question.</div>';};$("backTutor").onclick=load;$("chatForm").onsubmit=e=>{e.preventDefault();const t=$("ask").value.trim();if(!t)return;const safe=escapeHtml(t),lower=t.toLowerCase(),reply=lower.includes("quadratic")?"A quadratic equation has x² as its highest power. A common form is ax² + bx + c = 0.":lower.includes("photosynthesis")?"Photosynthesis is how green plants use light energy to make food from carbon dioxide and water.":"The full AI Tutor service will provide a tailored explanation, examples and practice questions. This interface is ready for the secure server-side AI connection.";$("chat").insertAdjacentHTML("beforeend",`<div class="bubble user">${safe}</div><div class="bubble">${escapeHtml(reply)}</div>`);$("ask").value="";};

sb.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_IN"&&session){setTimeout(load,0);}});
load();

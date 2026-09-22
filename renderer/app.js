// ============================================================
// WinLens — Renderer App Logic
// Handles: UI state, question input, voice, AI API, markdown
// ============================================================
'use strict';

const CONFIG = {
  WORKER_URL: 'https://winlens-api.mohalex.workers.dev', // set after worker deploy
  MAX_HISTORY: 12,
  IMAGE_QUALITY: 0.82,
  MODES: {
    windows:    { label: 'Windows',    color: 'mode-windows' },
    excel:      { label: 'Excel',      color: 'mode-excel' },
    office:     { label: 'Office',     color: 'mode-office' },
    browser:    { label: 'Browser',    color: 'mode-browser' },
    enterprise: { label: 'Enterprise', color: 'mode-enterprise' },
    other:      { label: 'Other',      color: 'mode-other' },
  },
  QUICK_QUESTIONS: {
    windows: [
      'What does this screen do?',
      'How do I find settings for this?',
      'What does this error mean?',
      'How do I navigate from here?',
      'What is this app?',
    ],
    excel: [
      'Explain this formula',
      'How do I create a pivot table from here?',
      'What does this error mean?',
      'How do I apply this to all rows?',
      'How do I filter this data?',
      'How do I create a chart from this?',
    ],
    office: [
      'How do I do this in Word?',
      'How do I find this setting?',
      'What does this button do?',
      'How do I share this?',
      'How do I change the layout?',
    ],
    browser: [
      'What is on this page?',
      'How do I find developer tools?',
      'What does this error mean?',
      'How do I clear cache?',
    ],
    enterprise: [
      'Explain what I am looking at',
      'How do I complete this workflow?',
      'What does this field mean?',
      'What does this status mean?',
      'How do I save and proceed?',
    ],
    other: [
      'Explain what I am looking at',
      'How do I complete this task?',
      'What does this button do?',
      'What does this error mean?',
    ],
  },
};

// ── State ─────────────────────────────────────────────────────
const state = {
  screenshot: null,       // base64 JPEG
  screenshotDataUrl: null,// full data URL for display
  capturedAt: null,
  mode: 'windows',
  history: [],
  response: null,
  isAnalyzing: false,
  isListening: false,
  isPinned: true,
  recognition: null,
  abortController: null,
  currentQuestion: '',
};

// ── DOM ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];

// ── Markdown (zero dependencies) ─────────────────────────────
function md(text) {
  if (!text) return '';
  let h = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  h = h.replace(/^### (.+)$/gm,'<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm,'<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm,'<h1>$1</h1>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g,'<em>$1</em>');
  h = h.replace(/`([^`]+)`/g,'<code>$1</code>');
  h = h.replace(/^---+$/gm,'<hr>');
  h = h.replace(/^&gt; (.+)$/gm,'<blockquote>$1</blockquote>');
  h = h.replace(/^(\d+)\. (.+)$/gm,(_,n,c)=>`<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:7px;"><span class="step-number">${n}</span><span>${c}</span></div>`);
  h = h.replace(/^[*-] (.+)$/gm,'<li>$1</li>');
  return h.split('\n').map(l=>{
    const t=l.trim();
    if(!t)return'';
    if(/^<(h[123]|li|hr|blockquote|div|p)/.test(t))return t;
    return`<p>${t}</p>`;
  }).join('\n');
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, ms=2800) {
  const el=$('toast');
  el.textContent=msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),ms);
}

// ── UI Sections visibility ────────────────────────────────────
function setSection(name) {
  // name: 'welcome' | 'question' | 'analyzing' | 'response'
  $('welcome-section').classList.toggle('hidden', name !== 'welcome');
  $('screenshot-section').classList.toggle('hidden', name === 'welcome');
  $('mode-section').classList.toggle('hidden', name === 'welcome');
  $('question-section').classList.toggle('hidden', name === 'welcome' || name === 'analyzing');
  $('qq-section').classList.toggle('hidden', name !== 'question');
  $('analyzing-section').classList.toggle('hidden', name !== 'analyzing');
  $('response-section').classList.toggle('hidden', name !== 'response');
  $('followup-bar').classList.toggle('hidden', name !== 'response');
}

// ── Screenshot ────────────────────────────────────────────────
function showScreenshot(dataUrl) {
  state.screenshotDataUrl = dataUrl;
  state.screenshot = dataUrl.split(',')[1];
  state.capturedAt = new Date().toLocaleTimeString();
  state.history = [];
  state.response = null;
  const img = $('screenshot-img');
  if (img) { img.src = dataUrl; }
  const time = $('screenshot-time');
  if (time) time.textContent = `Captured ${state.capturedAt}`;
  setSection('question');
  renderQuickQuestions();
  setTimeout(() => $('question-input')?.focus(), 200);
}

// ── Mode ──────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  $$('.mode-chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
  renderQuickQuestions();
}

function renderQuickQuestions() {
  const c = $('qq-pills'); if (!c) return;
  const qs = CONFIG.QUICK_QUESTIONS[state.mode] || CONFIG.QUICK_QUESTIONS.other;
  c.innerHTML = qs.map(q=>`<button class="qq-pill" data-q="${q.replace(/"/g,'&quot;')}">${q}</button>`).join('');
  c.querySelectorAll('.qq-pill').forEach(p=>p.addEventListener('click',()=>{
    const qi=$('question-input');
    if(qi){qi.value=p.dataset.q;qi.dispatchEvent(new Event('input'));qi.focus();}
  }));
}

// ── Voice ─────────────────────────────────────────────────────
function setupVoice(inputEl, btn, onFinal) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { if(btn){btn.style.opacity='.4';btn.style.pointerEvents='none';} return null; }
  const r = new SR();
  r.lang='en-US'; r.interimResults=true; r.continuous=false;
  r.onstart=()=>{
    state.isListening=true;
    if(btn){btn.classList.add('listening');btn.innerHTML='<div class="voice-waveform"><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span></div>Stop';}
  };
  r.onresult=e=>{
    let t='';
    for(const res of e.results)t+=res[0].transcript;
    if(inputEl){inputEl.value=t;inputEl.dispatchEvent(new Event('input'));}
    if(e.results[e.results.length-1].isFinal&&onFinal)onFinal(t);
  };
  r.onerror=e=>{stopVoice(r,btn);if(e.error==='not-allowed')toast('Microphone permission denied');};
  r.onend=()=>stopVoice(r,btn);
  return r;
}
function startVoice(r){if(!state.isListening){try{r.start();}catch{}}}
function stopVoice(r,btn){
  state.isListening=false;
  if(btn){btn.classList.remove('listening');btn.innerHTML='🎤 Speak';}
  try{r.stop();}catch{}
}

// ── Timer ─────────────────────────────────────────────────────
let timerStart=null, timerInterval=null;
function startTimer(){
  timerStart=Date.now();
  const el=$('analyzing-timer');
  timerInterval=setInterval(()=>{if(el)el.textContent=`${((Date.now()-timerStart)/1000).toFixed(1)}s`;},100);
}
function stopTimer(){clearInterval(timerInterval);timerInterval=null;}

function stopAnalysis() {
  if (state.abortController) {
    try { state.abortController.abort(); } catch {}
    state.abortController = null;
  }
  stopTimer();
  state.isAnalyzing = false;
  toast('⏹ Analysis cancelled');
  setSection(state.screenshot ? 'question' : 'welcome');
  const qi = $('question-input');
  if (qi && state.currentQuestion) {
    qi.value = state.currentQuestion;
    qi.focus();
  }
}

// ── API Call ──────────────────────────────────────────────────
async function askAI(question) {
  if (!state.screenshot) { toast('No screenshot yet — press Alt+Shift+W to capture'); return; }
  if (!question.trim()) { toast('Enter or speak a question first.'); return; }
  if (state.isAnalyzing) return;
  state.isAnalyzing = true;
  state.currentQuestion = question.trim();

  // Create abort controller for request cancellation
  if (state.abortController) {
    try { state.abortController.abort(); } catch {}
  }
  state.abortController = new AbortController();

  setSection('analyzing');
  startTimer();

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/api/analyze`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      signal: state.abortController.signal,
      body: JSON.stringify({
        image_base64: state.screenshot,
        question: question.trim(),
        mode: state.mode,
        history: state.history.slice(-CONFIG.MAX_HISTORY),
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(()=>({error:`HTTP ${res.status}`}));
      throw new Error(e.error||`Server error ${res.status}`);
    }
    const data = await res.json();
    stopTimer();
    state.history.push({role:'user',content:question.trim()});
    state.history.push({role:'model',content:data.answer});
    state.response = data.answer;
    renderResponse(question.trim(), data.answer);
    setSection('response');
  } catch(err) {
    stopTimer();
    if (err.name === 'AbortError') {
      // Clean cancellation by user — stopAnalysis already notified UI
      return;
    }
    toast(`⚠️ ${err.message||'Analysis failed. Check your connection.'}`);
    setSection(state.screenshot ? 'question' : 'welcome');
  } finally {
    state.isAnalyzing = false;
    state.abortController = null;
  }
}

// ── Render Response ───────────────────────────────────────────
function renderResponse(question, answer) {
  const qEl=$('response-question');
  const cEl=$('response-content');
  if(qEl)qEl.textContent=question;
  if(cEl)cEl.innerHTML=md(answer);
  const fi=$('followup-input');
  if(fi){fi.value='';fi.style.height='auto';}
  $('panel-body')?.scrollTo({top:0,behavior:'smooth'});
}

// ── Clipboard copy ────────────────────────────────────────────
async function copyText(text){
  try{await navigator.clipboard.writeText(text);return true;}
  catch{
    const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');
    document.body.removeChild(ta);return ok;
  }
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  // Display hotkey
  const hotkey = await window.winlens.getHotkey().catch(()=>'Alt+Shift+W');
  const hkEl = $('hotkey-display');
  if (hkEl) hkEl.textContent = hotkey;

  // Listen for screenshots from main process
  window.winlens.onScreenshot(dataUrl => showScreenshot(dataUrl));
  window.winlens.onCaptureError(msg => {
    toast(`Capture failed: ${msg}`);
    if (!state.screenshot) setSection('welcome');
  });

  // Titlebar controls
  $('btn-hide')?.addEventListener('click', () => window.winlens.hideWindow());
  $('btn-pin')?.addEventListener('click', function() {
    state.isPinned = !state.isPinned;
    window.winlens.setAlwaysOnTop(state.isPinned);
    this.classList.toggle('pin-active', state.isPinned);
    this.title = state.isPinned ? 'Unpin (always on top)' : 'Pin (always on top)';
    toast(state.isPinned ? '📌 Pinned on top' : '📌 Unpinned');
  });

  // Capture button (welcome state)
  $('btn-capture-welcome')?.addEventListener('click', () => window.winlens.captureScreen());

  // Recapture button
  $('btn-recapture')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.winlens.captureScreen();
  });

  // Cancel / Stop analysis button
  $('btn-stop-analyzing')?.addEventListener('click', (e) => {
    e.stopPropagation();
    stopAnalysis();
  });

  // Click screenshot to expand (show full image in dedicated viewer window)
  $('screenshot-card')?.addEventListener('click', () => {
    if (state.screenshotDataUrl) {
      window.winlens.viewFullScreenshot(state.screenshotDataUrl);
    }
  });

  // Mode chips
  $$('.mode-chip').forEach(c => c.addEventListener('click', () => setMode(c.dataset.mode)));

  // Question textarea auto-resize
  $('question-input')?.addEventListener('input', function(){
    this.style.height='auto';
    this.style.height=`${Math.min(this.scrollHeight,130)}px`;
  });

  // Voice
  const voiceBtn=$('voice-btn'), qi=$('question-input');
  if(voiceBtn){
    state.recognition=setupVoice(qi,voiceBtn,q=>{if(q&&q.length>3)setTimeout(()=>askAI(q),700);});
    voiceBtn.addEventListener('click',()=>{
      if(!state.recognition)return;
      state.isListening?stopVoice(state.recognition,voiceBtn):startVoice(state.recognition);
    });
  }

  // Ask button
  $('btn-ask')?.addEventListener('click',()=>askAI($('question-input')?.value||''));
  $('question-input')?.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();askAI(e.target.value);}
  });

  // Copy response
  $('btn-copy')?.addEventListener('click', async function(){
    if(!state.response)return;
    if(await copyText(state.response)){
      this.classList.add('copied');this.textContent='✓ Copied';
      setTimeout(()=>{this.classList.remove('copied');this.textContent='📋 Copy';},2000);
    }
  });

  // New question (back to question input)
  $('btn-new-question')?.addEventListener('click',()=>{
    const qi=$('question-input');if(qi){qi.value='';qi.style.height='auto';}
    setSection('question');
    renderQuickQuestions();
    setTimeout(()=>$('question-input')?.focus(),100);
  });

  // Follow-up
  $('followup-input')?.addEventListener('input',function(){
    this.style.height='auto';this.style.height=`${Math.min(this.scrollHeight,90)}px`;
  });
  $('followup-send')?.addEventListener('click',()=>{
    const q=$('followup-input')?.value.trim();if(q)askAI(q);
  });
  $('followup-input')?.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const q=e.target.value.trim();if(q)askAI(q);}
  });

  // Follow-up voice
  const fuBtn=$('followup-voice-btn'),fuIn=$('followup-input');
  if(fuBtn&&fuIn){
    const fuR=setupVoice(fuIn,fuBtn,q=>{if(q&&q.length>3)setTimeout(()=>askAI(q),700);});
    fuBtn.addEventListener('click',()=>{if(!fuR)return;state.isListening?stopVoice(fuR,fuBtn):startVoice(fuR);});
  }

  // Render quick questions on mode chips
  renderQuickQuestions();

  // Start at welcome state
  setSection('welcome');
}

document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();

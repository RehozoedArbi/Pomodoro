import { useState, useEffect, useRef, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  Play, Pause, RotateCcw, Volume2, VolumeX,
  CloudRain, Wind, Music2, ExternalLink, ArrowLeft,
  Flame, Clock, TrendingUp, CheckCircle2, Cloud,
  Sun, Moon, Globe, X, ChevronRight, Eye, EyeOff,
  Lock, Mail, Minimize2, AlertCircle,
  LogOut, User, Wifi, Menu, Timer, Bell, StopCircle,
} from "lucide-react";

// ─────────────────────────────────────────────
// ⚙️  SUPABASE CONFIG
// ─────────────────────────────────────────────
const SUPABASE_URL  = "https://VOTRE_PROJECT_ID.supabase.co";
const SUPABASE_ANON = "VOTRE_ANON_KEY";
const SITE_URL = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.host}`
  : "http://localhost:5173";

// ─────────────────────────────────────────────
// SUPABASE CLIENT
// ─────────────────────────────────────────────
const sb = {
  h: (token) => ({
    "Content-Type":  "application/json",
    "apikey":        SUPABASE_ANON,
    "Authorization": `Bearer ${token || SUPABASE_ANON}`,
  }),
  async signUp(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method:"POST", headers:this.h(),
      body: JSON.stringify({ email, password, options:{ emailRedirectTo: SITE_URL } }),
    });
    return r.json();
  },
  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:"POST", headers:this.h(), body:JSON.stringify({ email, password }),
    });
    return r.json();
  },
  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method:"POST", headers:this.h(token) });
  },
  async upsertSession(token, session) {
    await fetch(`${SUPABASE_URL}/rest/v1/focus_sessions`, {
      method:"POST",
      headers:{ ...this.h(token), "Prefer":"resolution=merge-duplicates" },
      body:JSON.stringify(session),
    });
  },
  async getSessions(token, userId) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/focus_sessions?user_id=eq.${userId}&order=completed_at.desc&limit=50`,
      { headers:this.h(token) }
    );
    return r.json();
  },
  async upsertSettings(token, settings) {
    await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
      method:"POST",
      headers:{ ...this.h(token), "Prefer":"resolution=merge-duplicates" },
      body:JSON.stringify(settings),
    });
  },
};

// ─────────────────────────────────────────────
// INDEXEDDB
// ─────────────────────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("aurafocus", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", { keyPath:"id" });
        s.createIndex("completed_at","completed_at");
      }
      if (!db.objectStoreNames.contains("kv"))
        db.createObjectStore("kv", { keyPath:"k" });
    };
    req.onsuccess = (e) => res(e.target.result);
    req.onerror   = () => rej(req.error);
  });
}
const idb = {
  async put(store, val) {
    const db = await openDB();
    return new Promise((res) => {
      const tx = db.transaction(store,"readwrite");
      tx.objectStore(store).put(val);
      tx.oncomplete = res;
    });
  },
  async get(store, key) {
    const db = await openDB();
    return new Promise((res) => {
      const req = db.transaction(store,"readonly").objectStore(store).get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => res(null);
    });
  },
  async getAll(store) {
    const db = await openDB();
    return new Promise((res) => {
      const req = db.transaction(store,"readonly").objectStore(store).getAll();
      req.onsuccess = () => res(req.result ?? []);
      req.onerror   = () => res([]);
    });
  },
  async setKV(k, v) { await this.put("kv", { k, v }); },
  async getKV(k)    { const r = await this.get("kv", k); return r?.v ?? null; },
  async saveSession(s) { await this.put("sessions", s); },
  async allSessions() {
    const all = await this.getAll("sessions");
    return all.sort((a,b) => new Date(b.completed_at) - new Date(a.completed_at));
  },
};

// ─────────────────────────────────────────────
// WEB AUDIO ENGINE
// ─────────────────────────────────────────────
class AudioEngine {
  constructor() { this.ctx = null; this.nodes = {}; this.active = null; }

  unlock() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = this.ctx.createBuffer(1, 1, 22050);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start(0);
    if (this.ctx.state === "running") return Promise.resolve(this.ctx);
    return this.ctx.resume().then(() => this.ctx).catch(() => this.ctx);
  }

  _noise(hipass = 0, lopass = 22000, gain = 0.25) {
    const buf  = this.ctx.createBuffer(1, this.ctx.sampleRate * 3, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const hp = this.ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = hipass;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass";  lp.frequency.value = lopass;
    const g  = this.ctx.createGain(); g.gain.value = gain;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.ctx.destination);
    src.start();
    return { source:src, gainNode:g };
  }

  _lofi() {
    const master = this.ctx.createGain(); master.gain.value = 0.10;
    master.connect(this.ctx.destination);
    const convBuf = this.ctx.createBuffer(2, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = convBuf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2.5);
    }
    const conv = this.ctx.createConvolver(); conv.buffer = convBuf; conv.connect(master);
    const CHORD = [130.81, 164.81, 196.00, 246.94, 261.63];
    let tick = 0;
    const iv = setInterval(() => {
      if (!this.ctx) return;
      const freq = CHORD[tick % CHORD.length] * (tick % 3 === 0 ? 2 : 1); tick++;
      const osc = this.ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = freq;
      const eg = this.ctx.createGain();
      eg.gain.setValueAtTime(0, this.ctx.currentTime);
      eg.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.08);
      eg.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 3);
      osc.connect(eg); eg.connect(conv); osc.start(); osc.stop(this.ctx.currentTime + 3);
    }, 2200);
    return { interval:iv, masterGain:master };
  }

  play(id) {
    this.unlock().then(() => {
      this.stop(); this.active = id;
      if (id === "rain")       this.nodes = this._noise(900,  7000, 0.30);
      if (id === "whitenoise") this.nodes = this._noise(20,  20000, 0.18);
      if (id === "lofi")       this.nodes = this._lofi();
    });
  }

  stop() {
    try {
      this.nodes.source?.stop();
      if (this.nodes.interval)   clearInterval(this.nodes.interval);
      if (this.nodes.gainNode)   this.nodes.gainNode.gain.value = 0;
      if (this.nodes.masterGain) this.nodes.masterGain.gain.value = 0;
    } catch (_) {}
    this.nodes = {}; this.active = null;
  }

  setVolume(v) {
    const g = this.nodes.gainNode || this.nodes.masterGain;
    if (g) g.gain.value = v;
  }

  playChime() {
    this.unlock().then(() => {
      const freqs = [523.25, 659.25, 783.99];
      freqs.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const g   = this.ctx.createGain();
        osc.type = "sine"; osc.frequency.value = freq;
        g.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.22);
        g.gain.linearRampToValueAtTime(0.32, this.ctx.currentTime + i * 0.22 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.22 + 1.2);
        osc.connect(g); g.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + i * 0.22);
        osc.stop(this.ctx.currentTime + i * 0.22 + 1.2);
      });
    });
  }

  playBreakChime() {
    this.unlock().then(() => {
      const freqs = [783.99, 659.25, 523.25];
      freqs.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const g   = this.ctx.createGain();
        osc.type = "triangle"; osc.frequency.value = freq;
        g.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.20);
        g.gain.linearRampToValueAtTime(0.22, this.ctx.currentTime + i * 0.20 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.20 + 1.0);
        osc.connect(g); g.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + i * 0.20);
        osc.stop(this.ctx.currentTime + i * 0.20 + 1.0);
      });
    });
  }
}
const audio = new AudioEngine();
// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const DEFAULT_FOCUS = 25;
const DEFAULT_BREAK = 5;
const RING_R  = 138;
const RING_C  = 2 * Math.PI * RING_R;
const BREAK_R = 118;
const BREAK_C = 2 * Math.PI * BREAK_R;
const ORANGE  = "#f97316";
const RED     = "#ef4444";
const GREEN   = "#10b981";

// ─────────────────────────────────────────────
// TOKENS
// ─────────────────────────────────────────────
const TK = {
  dark: {
    bg:"#09090b", card:"rgba(255,255,255,0.028)", border:"rgba(255,255,255,0.08)",
    text:"#fafafa", muted:"rgba(255,255,255,0.30)", subtle:"rgba(255,255,255,0.15)",
    pill:"rgba(255,255,255,0.04)", pillB:"rgba(255,255,255,0.07)",
    divider:"rgba(255,255,255,0.06)",
    overlay:"rgba(0,0,0,0.82)", modalBg:"#111113", modalB:"rgba(255,255,255,0.09)",
    menuBg:"#0e0e10", menuB:"rgba(255,255,255,0.08)",
  },
  light: {
    bg:"#f8fafc", card:"rgba(255,255,255,0.85)", border:"#e2e8f0",
    text:"#0f172a", muted:"#64748b", subtle:"#94a3b8",
    pill:"rgba(15,23,42,0.05)", pillB:"#e2e8f0",
    divider:"#f1f5f9",
    overlay:"rgba(15,23,42,0.55)", modalBg:"#ffffff", modalB:"#e2e8f0",
    menuBg:"#ffffff", menuB:"#e2e8f0",
  },
};

// ─────────────────────────────────────────────
// TRANSLATIONS
// ─────────────────────────────────────────────
const T = {
  en: {
    app:"AxisFocus", focus:"Focus", brk:"Break", stats:"Stats",
    sessions:"sessions", placeholder:"What will you focus on?",
    hint:"Enter a task to start", focusing:"focusing", ready:"ready",
    sound:"Soundscape", playing:"playing", rain:"Rain", noise:"Noise", lofi:"Lofi", silence:"Off",
    breakLabel:"Break Time", resting:"resting", paused:"paused",
    breakTag:"While your mind rests",
    breakCopy:"Check out my portfolio. I build seamless web apps just like this one.",
    portfolio:"View Portfolio",
    cloudBanner:"Sync your history across devices.", saveCloud:"Save to Cloud",
    analytics:"Focus Analytics", analyticsWk:"Last 7 days",
    hrs:"Total Hours", done_s:"Sessions Done", best:"Best Day", avg:"Avg Session",
    wkChart:"Weekly Focus", rate:"Completion Rate",
    recent:"Recent Sessions", done:"done",
    modalTitle:"Save to Cloud", modalSub:"Sync your focus history across devices.",
    emailLbl:"Email", emailPh:"you@example.com", passLbl:"Password", passPh:"At least 6 characters",
    create:"Create Free Account", haveAcc:"Already have an account?", signIn:"Sign in",
    signInTitle:"Welcome back", signInSub:"Sign in to access your synced history.",
    signInBtn:"Sign In", noAcc:"No account yet?", signUp:"Sign up",
    cycle:"deep work cycle", breakCycle:"recovery break",
    escHint:"Press Esc or tap to exit", exitHint:"Exit focus mode",
    syncing:"Syncing…", synced:"Synced!", loggedAs:"Logged in as",
    logout:"Sign out", local:"local", cloud:"cloud",
    empty:"No sessions yet — start your first focus cycle!",
    abandoned:"Abandoned", completed:"Completed",
    confirmTitle:"Check your email", confirmBody:"We sent a confirmation link to",
    backToSignIn:"Back to sign in",
    invalidEmail:"Invalid email address.", minChars:"Minimum 6 characters.",
    emailNotConfirmed:"Check your inbox and click the confirmation link before signing in.",
    invalidCreds:"Incorrect email or password.",
    signInError:"Sign-in error. Please try again.",
    alreadyRegistered:"An account already exists with this email. Sign in instead.",
    signUpError:"Sign-up error. Please try again.",
    serverError:"Could not reach the server. Check your connection.",
    // ── FIX #4 — abandon confirmation
    abandonTitle:"Abandon session?",
    abandonBody:"Your progress will be saved as an incomplete session.",
    abandonConfirm:"Yes, abandon",
    abandonCancel:"Keep going",
    // ── FIX #5 — duration picker
    durationTitle:"Session duration",
    focusDur:"Focus",
    breakDur:"Break",
    minutes:"min",
    saveSettings:"Save",
    sessionComplete:"Session complete! 🎉",
    breakComplete:"Break over — back to focus!",
  },
  fr: {
    app:"AxisFocus", focus:"Focus", brk:"Pause", stats:"Stats",
    sessions:"séances", placeholder:"Sur quoi allez-vous vous concentrer ?",
    hint:"Entrez une tâche pour commencer", focusing:"en cours", ready:"prêt",
    sound:"Ambiance", playing:"lecture", rain:"Pluie", noise:"Bruit blanc", lofi:"Lofi", silence:"Silence",
    breakLabel:"Pause", resting:"en repos", paused:"en pause",
    breakTag:"Pendant que votre esprit se repose",
    breakCopy:"Découvrez mes services. J'aide les entreprises à créer des apps aussi fluides que celle-ci.",
    portfolio:"Voir le portfolio",
    cloudBanner:"Synchronisez votre historique sur tous vos appareils.", saveCloud:"Sauvegarder",
    analytics:"Analytique", analyticsWk:"7 derniers jours",
    hrs:"Heures totales", done_s:"Séances réalisées", best:"Meilleur jour", avg:"Séance moy.",
    wkChart:"Minutes hebdomadaires", rate:"Taux de complétion",
    recent:"Séances récentes", done:"terminé",
    modalTitle:"Sauvegarder sur le Cloud", modalSub:"Synchronisez votre historique sur tous vos appareils.",
    emailLbl:"E-mail", emailPh:"vous@exemple.com", passLbl:"Mot de passe", passPh:"6 caractères minimum",
    create:"Créer un compte gratuit", haveAcc:"Déjà un compte ?", signIn:"Se connecter",
    signInTitle:"Bon retour", signInSub:"Connectez-vous pour accéder à votre historique.",
    signInBtn:"Se connecter", noAcc:"Pas encore de compte ?", signUp:"S'inscrire",
    cycle:"cycle de travail profond", breakCycle:"pause de récupération",
    escHint:"Échap ou tap pour quitter", exitHint:"Quitter le mode focus",
    syncing:"Synchronisation…", synced:"Synchronisé !", loggedAs:"Connecté en tant que",
    logout:"Déconnexion", local:"local", cloud:"cloud",
    empty:"Aucune séance — commencez votre premier cycle !",
    abandoned:"Abandonné", completed:"Complété",
    confirmTitle:"Vérifiez votre e-mail", confirmBody:"Nous avons envoyé un lien de confirmation à",
    backToSignIn:"Retour à la connexion",
    invalidEmail:"Adresse e-mail invalide.", minChars:"Minimum 6 caractères.",
    emailNotConfirmed:"Vérifiez votre boîte mail et cliquez sur le lien de confirmation.",
    invalidCreds:"Email ou mot de passe incorrect.",
    signInError:"Erreur de connexion. Réessayez.",
    alreadyRegistered:"Un compte existe déjà avec cet e-mail. Connectez-vous plutôt.",
    signUpError:"Erreur d'inscription. Réessayez.",
    serverError:"Impossible de contacter le serveur. Vérifiez votre connexion.",
    abandonTitle:"Abandonner la séance ?",
    abandonBody:"Votre progression sera enregistrée comme séance incomplète.",
    abandonConfirm:"Oui, abandonner",
    abandonCancel:"Continuer",
    durationTitle:"Durée des sessions",
    focusDur:"Focus",
    breakDur:"Pause",
    minutes:"min",
    saveSettings:"Enregistrer",
    sessionComplete:"Séance terminée ! 🎉",
    breakComplete:"Pause terminée — retour au focus !",
  },
};

const DAYS = {
  en:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
  fr:["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"],
};

function fmt(s) {
  return `${String(Math.floor(s / 60)).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
}
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────
function Toasts({ list }) {
  return (
    <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", zIndex:60, display:"flex", flexDirection:"column", alignItems:"center", gap:8, pointerEvents:"none" }}>
      {list.map(toast => (
        <div key={toast.id} style={{
          display:"flex", alignItems:"center", gap:8, padding:"9px 16px", borderRadius:14,
          fontSize:12, fontWeight:500, backdropFilter:"blur(16px)",
          background: toast.type==="success"?"rgba(16,185,129,0.15)":toast.type==="error"?"rgba(239,68,68,0.15)":"rgba(249,115,22,0.12)",
          border:`1px solid ${toast.type==="success"?"rgba(16,185,129,0.3)":toast.type==="error"?"rgba(239,68,68,0.3)":"rgba(249,115,22,0.25)"}`,
          color: toast.type==="success"?GREEN:toast.type==="error"?RED:ORANGE,
          boxShadow:"0 8px 32px rgba(0,0,0,0.3)",
          animation:"toastIn 0.3s cubic-bezier(0.16,1,0.3,1)",
          whiteSpace:"nowrap",
        }}>
          {toast.type==="success"?<CheckCircle2 size={13}/>:<AlertCircle size={13}/>}
          {toast.msg}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// FIX #4 — ABANDON CONFIRM DIALOG
// ─────────────────────────────────────────────
function AbandonDialog({ t, tk, onConfirm, onCancel, elapsed }) {
  return (
    <div style={{ position:"fixed", inset:0, zIndex:55, display:"flex", alignItems:"center", justifyContent:"center", padding:20, background:tk.overlay }}>
      <div style={{
        width:"100%", maxWidth:360, borderRadius:20, overflow:"hidden",
        background:tk.modalBg, border:`1px solid ${tk.modalB}`,
        backdropFilter:"blur(24px)", boxShadow:"0 40px 80px rgba(0,0,0,0.5)",
        animation:"modalIn 0.2s cubic-bezier(0.16,1,0.3,1)",
        padding:24, display:"flex", flexDirection:"column", gap:20,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:40, height:40, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)", flexShrink:0 }}>
            <StopCircle size={18} style={{ color:RED }}/>
          </div>
          <div>
            <div style={{ fontSize:14, fontWeight:600, color:tk.text }}>{t.abandonTitle}</div>
            <div style={{ fontSize:12, color:tk.muted, marginTop:3 }}>
              {t.abandonBody}
              {elapsed > 0 && (
                <span style={{ display:"block", marginTop:4, fontFamily:"'JetBrains Mono',monospace", color:ORANGE, fontSize:11 }}>
                  {fmt(elapsed)} {t.focus?.toLowerCase()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onCancel} style={{
            flex:1, padding:"11px", borderRadius:12, border:`1px solid ${tk.border}`,
            background:tk.card, color:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer",
            fontFamily:"'Inter',sans-serif",
          }}>{t.abandonCancel}</button>
          <button onClick={onConfirm} style={{
            flex:1, padding:"11px", borderRadius:12, border:"none",
            background:`linear-gradient(140deg,${RED},#dc2626)`,
            color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer",
            fontFamily:"'Inter',sans-serif",
            boxShadow:"0 0 20px rgba(239,68,68,0.3)",
          }}>{t.abandonConfirm}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// FIX #5 — DURATION PICKER MODAL
// ─────────────────────────────────────────────
const FOCUS_PRESETS = [15, 20, 25, 30, 45, 50, 60, 90];
const BREAK_PRESETS = [3, 5, 10, 15, 20];

function DurationModal({ t, tk, focusMins, breakMins, onSave, onClose }) {
  const [f, setF] = useState(focusMins);
  const [b, setB] = useState(breakMins);

  return (
    <div style={{ position:"fixed", inset:0, zIndex:55, display:"flex", alignItems:"center", justifyContent:"center", padding:20, background:tk.overlay }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width:"100%", maxWidth:380, borderRadius:22, overflow:"hidden",
        background:tk.modalBg, border:`1px solid ${tk.modalB}`,
        backdropFilter:"blur(24px)", boxShadow:"0 40px 80px rgba(0,0,0,0.5)",
        animation:"modalIn 0.22s cubic-bezier(0.16,1,0.3,1)",
      }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 22px 14px", borderBottom:`1px solid ${tk.divider}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(249,115,22,0.1)", border:"1px solid rgba(249,115,22,0.18)" }}>
              <Timer size={14} style={{ color:ORANGE }}/>
            </div>
            <div style={{ fontSize:13, fontWeight:600, color:tk.text }}>{t.durationTitle}</div>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer" }}>
            <X size={13}/>
          </button>
        </div>

        <div style={{ padding:"22px 22px 24px", display:"flex", flexDirection:"column", gap:22 }}>
          {/* Focus duration */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.15em", textTransform:"uppercase", color:tk.muted }}>{t.focusDur}</span>
              <span style={{ fontSize:22, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:ORANGE }}>{f}<span style={{ fontSize:12, fontWeight:500, color:tk.muted, marginLeft:3 }}>{t.minutes}</span></span>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {FOCUS_PRESETS.map(v => (
                <button key={v} onClick={() => setF(v)} style={{
                  padding:"7px 12px", borderRadius:10, fontSize:12, fontWeight:500,
                  background: f===v?"rgba(249,115,22,0.12)":"rgba(249,115,22,0.03)",
                  border: f===v?"1px solid rgba(249,115,22,0.4)":"1px solid rgba(249,115,22,0.1)",
                  color: f===v?ORANGE:"rgba(249,115,22,0.45)", cursor:"pointer", transition:"all 0.15s",
                }}>{v}</button>
              ))}
            </div>
            {/* Custom slider */}
            <input type="range" min="5" max="120" step="5" value={f} onChange={e => setF(Number(e.target.value))}
              style={{ width:"100%", background:`linear-gradient(to right,${ORANGE} ${(f-5)/115*100}%,rgba(249,115,22,0.15) ${(f-5)/115*100}%)` }}
            />
          </div>

          {/* Break duration */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.15em", textTransform:"uppercase", color:tk.muted }}>{t.breakDur}</span>
              <span style={{ fontSize:22, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:GREEN }}>{b}<span style={{ fontSize:12, fontWeight:500, color:tk.muted, marginLeft:3 }}>{t.minutes}</span></span>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {BREAK_PRESETS.map(v => (
                <button key={v} onClick={() => setB(v)} style={{
                  padding:"7px 12px", borderRadius:10, fontSize:12, fontWeight:500,
                  background: b===v?"rgba(16,185,129,0.12)":"rgba(16,185,129,0.03)",
                  border: b===v?"1px solid rgba(16,185,129,0.4)":"1px solid rgba(16,185,129,0.1)",
                  color: b===v?GREEN:"rgba(16,185,129,0.45)", cursor:"pointer", transition:"all 0.15s",
                }}>{v}</button>
              ))}
            </div>
            <input type="range" min="1" max="30" step="1" value={b} onChange={e => setB(Number(e.target.value))}
              style={{ width:"100%", background:`linear-gradient(to right,${GREEN} ${(b-1)/29*100}%,rgba(16,185,129,0.15) ${(b-1)/29*100}%)` }}
            />
          </div>

          <button onClick={() => onSave(f, b)} style={{
            padding:"13px", borderRadius:14, border:"none",
            background:`linear-gradient(140deg,${ORANGE},${RED})`,
            color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer",
            boxShadow:"0 0 28px rgba(249,115,22,0.3)", fontFamily:"'Inter',sans-serif",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          }}>
            {t.saveSettings}<ChevronRight size={14}/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MOBILE MENU
// ─────────────────────────────────────────────
function MobileMenu({ open, onClose, mode, switchMode, theme, setTheme, lang, setLang, user, setShowCloud, setShowDuration, tk, t }) {
  if (!open) return null;
  return (
    <>
      <div style={{ position:"fixed", inset:0, zIndex:40, background:"rgba(0,0,0,0.4)", backdropFilter:"blur(4px)" }} onClick={onClose}/>
      <div style={{ position:"fixed", top:0, right:0, bottom:0, zIndex:50, width:240, display:"flex", flexDirection:"column", background:tk.menuBg, borderLeft:`1px solid ${tk.menuB}`, boxShadow:"-20px 0 60px rgba(0,0,0,0.4)", animation:"menuSlide 0.25s cubic-bezier(0.16,1,0.3,1)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"20px 16px 16px", borderBottom:`1px solid ${tk.divider}` }}>
          <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.2em", color:tk.muted, textTransform:"uppercase" }}>Menu</span>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer" }}>
            <X size={13}/>
          </button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:4, padding:"12px 10px" }}>
          {[["focus",t.focus],["break",t.brk],["stats",t.stats]].map(([m,label]) => (
            <button key={m} onClick={() => { switchMode(m); onClose(); }} style={{
              display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:12,
              background: mode===m?"rgba(249,115,22,0.1)":"transparent",
              border: mode===m?"1px solid rgba(249,115,22,0.2)":"1px solid transparent",
              color: mode===m?ORANGE:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer", textAlign:"left",
            }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:mode===m?ORANGE:tk.subtle, flexShrink:0 }}/>
              {label}
            </button>
          ))}
        </div>
        <div style={{ height:1, background:tk.divider, margin:"0 10px" }}/>
        <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"12px 10px" }}>
          <button onClick={() => { setShowDuration(true); onClose(); }} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer" }}>
            <Timer size={14}/>{t.durationTitle}
          </button>
          <button onClick={() => setLang(l => l==="en"?"fr":"en")} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer" }}>
            <Globe size={14}/>{lang==="en"?"Français":"English"}
          </button>
          <button onClick={() => setTheme(x => x==="dark"?"light":"dark")} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer" }}>
            {theme==="dark"?<Sun size={14}/>:<Moon size={14}/>}
            {theme==="dark"?"Light mode":"Dark mode"}
          </button>
          <button onClick={() => { setShowCloud(true); onClose(); }} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12, background:user?"rgba(16,185,129,0.08)":tk.card, border:user?"1px solid rgba(16,185,129,0.2)":`1px solid ${tk.border}`, color:user?GREEN:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer" }}>
            {user?<Wifi size={14}/>:<Cloud size={14}/>}
            {user ? user.email.split("@")[0] : "Cloud"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// CLOUD MODAL
// ─────────────────────────────────────────────
function CloudModal({ onClose, t, tk, onAuth, user }) {
  const [view,    setView]    = useState(user ? "user" : "signup");
  const [email,   setEmail]   = useState("");
  const [pass,    setPass]    = useState("");
  const [showP,   setShowP]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState("");

  const go = (v) => { setEmail(""); setPass(""); setErr(""); setView(v); };

  const strength = Math.min(4, Math.floor(pass.length / 3));

  const handleSubmit = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr(t.invalidEmail); return; }
    if (pass.length < 6) { setErr(t.minChars); return; }
    setErr(""); setLoading(true);
    try {
      const data = view==="signup" ? await sb.signUp(email, pass) : await sb.signIn(email, pass);
      if (data.access_token) { onAuth(data); onClose(); return; }
      if (view==="signup") {
        if (data.user?.id || data.id) { go("confirm"); setEmail(email); }
        else setErr((data.msg||data.error_description||"").toLowerCase().includes("already") ? t.alreadyRegistered : t.signUpError);
      } else {
        const msg = (data.msg||data.error_description||data.message||"").toLowerCase();
        if (msg.includes("not confirmed")) setErr(t.emailNotConfirmed);
        else if (msg.includes("invalid"))  setErr(t.invalidCreds);
        else setErr(t.signInError);
      }
    } catch { setErr(t.serverError); }
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", padding:16, background:tk.overlay }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ width:"100%", maxWidth:400, borderRadius:22, overflow:"hidden", background:tk.modalBg, border:`1px solid ${tk.modalB}`, backdropFilter:"blur(24px)", boxShadow:"0 40px 80px rgba(0,0,0,0.55)", animation:"modalIn 0.25s cubic-bezier(0.16,1,0.3,1)" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 20px 14px", borderBottom:`1px solid ${tk.divider}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(249,115,22,0.1)", border:"1px solid rgba(249,115,22,0.18)" }}>
              {user ? <Wifi size={14} style={{color:GREEN}}/> : <Cloud size={14} style={{color:ORANGE}}/>}
            </div>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:tk.text }}>
                {view==="confirm" ? t.confirmTitle : view==="user" ? t.loggedAs : view==="signup" ? t.modalTitle : t.signInTitle}
              </div>
              <div style={{ fontSize:11, color:tk.muted, marginTop:2 }}>
                {view==="confirm" ? `${t.confirmBody} ${email}` : view==="user" ? user?.email : view==="signup" ? t.modalSub : t.signInSub}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer" }}>
            <X size={13}/>
          </button>
        </div>

        <div style={{ padding:"20px 20px 22px" }}>
          {/* User */}
          {view==="user" && (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, paddingBottom:4 }}>
                <div style={{ width:52, height:52, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.25)" }}>
                  <User size={24} style={{color:GREEN}}/>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:13, fontWeight:600, color:tk.text }}>{user?.email}</div>
                  <div style={{ fontSize:10, color:GREEN, marginTop:4, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}><Wifi size={9}/>Synced</div>
                </div>
              </div>
              <button onClick={() => { onAuth(null); onClose(); }} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"11px", borderRadius:12, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                <LogOut size={13}/>{t.logout}
              </button>
            </div>
          )}

          {/* Confirm email sent */}
          {view==="confirm" && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:18, paddingTop:8, textAlign:"center" }}>
              <div style={{ width:52, height:52, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(249,115,22,0.1)", border:"1px solid rgba(249,115,22,0.2)" }}>
                <Mail size={22} style={{color:ORANGE}}/>
              </div>
              <div style={{ fontSize:12, color:tk.muted, lineHeight:1.7 }}>
                {t.confirmBody} <strong style={{color:tk.text}}>{email}</strong>
              </div>
              <button onClick={() => go("signin")} style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 16px", borderRadius:12, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                <ArrowLeft size={12}/>{t.backToSignIn}
              </button>
            </div>
          )}

          {/* Sign-up / Sign-in form */}
          {(view==="signup"||view==="signin") && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <CField label={t.emailLbl} icon={<Mail size={13}/>} tk={tk}>
                <input type="email" value={email} placeholder={t.emailPh}
                  onChange={e => { setEmail(e.target.value); setErr(""); }}
                  onKeyDown={e => e.key==="Enter" && handleSubmit()}
                  style={{ width:"100%", background:"transparent", border:"none", outline:"none", fontSize:13, color:tk.text, fontFamily:"'Inter',sans-serif" }}
                />
              </CField>
              <CField label={t.passLbl} icon={<Lock size={13}/>} tk={tk} suffix={
                <button type="button" onClick={() => setShowP(x=>!x)} style={{ color:tk.subtle, cursor:"pointer", lineHeight:0 }}>
                  {showP?<EyeOff size={13}/>:<Eye size={13}/>}
                </button>
              }>
                <input type={showP?"text":"password"} value={pass} placeholder={t.passPh}
                  onChange={e => { setPass(e.target.value); setErr(""); }}
                  onKeyDown={e => e.key==="Enter" && handleSubmit()}
                  style={{ width:"100%", background:"transparent", border:"none", outline:"none", fontSize:13, color:tk.text, fontFamily:"'Inter',sans-serif" }}
                />
              </CField>
              {pass.length > 0 && (
                <div style={{ display:"flex", gap:3, marginTop:-6 }}>
                  {[1,2,3,4].map(i => (
                    <div key={i} style={{ height:2, flex:1, borderRadius:4, transition:"background 0.3s", background: i<=strength?(strength<=1?RED:strength<=2?ORANGE:GREEN):tk.border }}/>
                  ))}
                </div>
              )}
              {err && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", borderRadius:10, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", fontSize:12, color:RED }}>
                  <AlertCircle size={12}/>{err}
                </div>
              )}
              <button onClick={handleSubmit} disabled={loading||!email||!pass} style={{
                display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"13px", borderRadius:14, border:"none",
                background:`linear-gradient(140deg,${ORANGE},${RED})`, color:"#fff", fontSize:13, fontWeight:600,
                cursor:loading||!email||!pass?"not-allowed":"pointer", opacity:loading||!email||!pass?0.45:1,
                boxShadow:email&&pass?"0 0 28px rgba(249,115,22,0.3)":"none", transition:"all 0.2s", fontFamily:"'Inter',sans-serif",
              }}>
                {loading ? <><Spin/>{" "}Chargement…</> : <>{view==="signup"?t.create:t.signInBtn}<ChevronRight size={14}/></>}
              </button>
              <p style={{ textAlign:"center", fontSize:11, color:tk.subtle }}>
                {view==="signup"?t.haveAcc:t.noAcc}{" "}
                <button onClick={() => go(view==="signup"?"signin":"signup")} style={{ color:ORANGE, fontWeight:600, cursor:"pointer", background:"none", border:"none", fontFamily:"inherit" }}>
                  {view==="signup"?t.signIn:t.signUp}
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CField({ label, icon, suffix, children, tk }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      <label style={{ fontSize:11, fontWeight:500, color:tk.muted }}>{label}</label>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", borderRadius:12, background:tk.card, border:`1px solid ${focused?"rgba(249,115,22,0.45)":tk.border}`, transition:"border-color 0.2s" }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
        <span style={{ color:tk.subtle, lineHeight:0, flexShrink:0 }}>{icon}</span>
        <div style={{ flex:1 }}>{children}</div>
        {suffix}
      </div>
    </div>
  );
}

function Spin() {
  return <div style={{ width:14, height:14, borderRadius:"50%", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", animation:"spin 0.7s linear infinite" }}/>;
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  // ── FIX #5 — custom durations
  const [focusMins,   setFocusMins]   = useState(DEFAULT_FOCUS);
  const [breakMins,   setBreakMins]   = useState(DEFAULT_BREAK);

  const [mode,        setMode]        = useState("focus");
  const [timeLeft,    setTimeLeft]    = useState(DEFAULT_FOCUS * 60);
  const [isRunning,   setIsRunning]   = useState(false);
  const [task,        setTask]        = useState("");
  const [taskTouched, setTaskTouched] = useState(false);
  const [activeSound, setActiveSound] = useState(null);
  const [volume,      setVolume]      = useState(0.6);
  const [theme,       setTheme]       = useState("dark");
  const [lang,        setLang]        = useState("en");
  const [isImmersive, setIsImmersive] = useState(false);
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [showCloud,   setShowCloud]   = useState(false);
  const [showDuration,setShowDuration]= useState(false);
  const [statsReady,  setStatsReady]  = useState(false);
  const [toasts,      setToasts]      = useState([]);
  const [user,        setUser]        = useState(null);
  const [token,       setToken]       = useState(null);
  const [localSess,   setLocalSess]   = useState([]);
  const [cloudSess,   setCloudSess]   = useState([]);
  const [streak,      setStreak]      = useState(0);
  // ── FIX #4 — abandon dialog
  const [showAbandon, setShowAbandon] = useState(false);

  const timerRef  = useRef(null);
  const taskRef   = useRef(null);
  const startRef  = useRef(null);  // timestamp when timer started
  const elapsedRef= useRef(0);     // seconds elapsed (updated each tick)

  const tk = TK[theme];
  const t  = T[lang];
  const taskValid = task.trim().length > 0;
  const isBreak   = mode === "break";
  const FOCUS_DUR = focusMins * 60;
  const BREAK_DUR = breakMins * 60;

  // ── Boot
  useEffect(() => {
    (async () => {
      const [th, lg, vl, tk2, usr, fm, bm, sessions] = await Promise.all([
        idb.getKV("theme"), idb.getKV("lang"), idb.getKV("volume"),
        idb.getKV("sb_token"), idb.getKV("sb_user"),
        idb.getKV("focusMins"), idb.getKV("breakMins"),
        idb.allSessions(),
      ]);
      if (th)  setTheme(th);
      if (lg)  setLang(lg);
      if (vl)  setVolume(vl);
      if (fm)  { setFocusMins(fm); setTimeLeft(fm * 60); }
      if (bm)  setBreakMins(bm);
      if (tk2 && usr) { setToken(tk2); setUser(usr); }
      setLocalSess(sessions);
      calcStreak(sessions);
    })();
  }, []);

  const calcStreak = (sessions) => {
    const days = new Set(sessions.filter(s => s.status==="completed").map(s => s.completed_at?.slice(0,10)));
    let sk = 0; const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      if (days.has(d.toISOString().slice(0,10))) sk++; else if (i > 0) break;
    }
    setStreak(sk);
  };

  useEffect(() => { idb.setKV("theme", theme); }, [theme]);
  useEffect(() => { idb.setKV("lang", lang);   }, [lang]);
  useEffect(() => { idb.setKV("volume", volume); audio.setVolume(volume); }, [volume]);

  // Cloud sessions
  useEffect(() => {
    if (!user || !token) { setCloudSess([]); return; }
    sb.getSessions(token, user.id).then(d => { if (Array.isArray(d)) setCloudSess(d); });
  }, [user, token]);

  // ── Timer
  const clearTimer = () => { if (timerRef.current) clearInterval(timerRef.current); };

  const resetTimer = useCallback((m, fm, bm) => {
    clearTimer(); setIsRunning(false); setIsImmersive(false);
    elapsedRef.current = 0;
    setTimeLeft(m === "break" ? (bm ?? breakMins) * 60 : (fm ?? focusMins) * 60);
  }, [focusMins, breakMins]);

  useEffect(() => {
    clearTimer();
    if (isRunning) {
      if (!startRef.current) startRef.current = Date.now();
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearTimer(); setIsRunning(false); setIsImmersive(false);
            if (mode === "focus") {
              commitSession("completed", focusMins); // ← always focusMins for completed
              audio.playChime();
              addToast(t.sessionComplete, "success");
              setMode("break"); return BREAK_DUR;
            } else {
              audio.playBreakChime();
              addToast(t.breakComplete, "info");
              setMode("focus"); return FOCUS_DUR;
            }
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      startRef.current = null;
    }
    return clearTimer;
  }, [isRunning, mode, focusMins, breakMins]);

  // Esc
  useEffect(() => {
    const h = e => { if (e.key === "Escape" && isImmersive) setIsImmersive(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [isImmersive]);

  // ── Toast
  const addToast = useCallback((msg, type = "info") => {
    const id = uid();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 3500);
  }, []);

  // ── FIX #2 — commit session with accurate duration
const commitSession = async (status, forceMins) => {
  // Durée exacte en secondes (sans arrondi) — pour l'affichage uniquement
  const exactSecs = status === "completed"
    ? (forceMins ?? focusMins) * 60
    : Math.max(1, elapsedRef.current);

  // Inchangé : durée en minutes arrondie, utilisée par les stats/analytics
  const durMins = status === "completed"
    ? (forceMins ?? focusMins)
    : Math.max(1, Math.round(elapsedRef.current / 60));

  const sess = {
    id:               uid(),
    task_title:       task.trim() || "Session",
    duration_minutes: durMins,
    status,
    completed_at:     new Date().toISOString(),
  };
  elapsedRef.current = 0;

  // Version locale avec le champ exact en plus (juste pour l'affichage)
  await idb.saveSession({ ...sess, duration_seconds: exactSecs });
  const updated = await idb.allSessions();
  setLocalSess(updated);
  calcStreak(updated);

  if (user && token) {
    try {
      // On envoie la version SANS duration_seconds au cloud (schema inchangé)
      await sb.upsertSession(token, { ...sess, user_id: user.id });
      const cloud = await sb.getSessions(token, user.id);
      if (Array.isArray(cloud)) setCloudSess(cloud);
      addToast(t.synced, "success");
    } catch (_) {}
  }
};

  // ── Auth
  const handleAuth = async (data) => {
    if (!data) {
      if (token) sb.signOut(token).catch(() => {});
      setUser(null); setToken(null); setCloudSess([]);
      await idb.setKV("sb_token", null); await idb.setKV("sb_user", null);
      addToast("Déconnecté", "info"); return;
    }
    const tk2 = data.access_token;
    const usr = { id: data.user.id, email: data.user.email };
    setToken(tk2); setUser(usr);
    await idb.setKV("sb_token", tk2); await idb.setKV("sb_user", usr);
    addToast(t.syncing, "info");
    try {
      await sb.upsertSettings(tk2, { user_id:usr.id, theme, focus_duration:focusMins, short_break:breakMins });
      const cloud = await sb.getSessions(tk2, usr.id);
      if (Array.isArray(cloud)) setCloudSess(cloud);
      for (const s of localSess.slice(0, 20)) {
        await sb.upsertSession(tk2, { ...s, user_id:usr.id }).catch(() => {});
      }
      addToast(t.synced, "success");
    } catch (_) { addToast("Erreur de sync", "error"); }
  };

  // ── Sound — FIX #1: unlock audio context on first user interaction
  const toggleSound = (id) => {
    audio.unlock(); // ensures iOS context is running before play
    if (id === null) { audio.stop(); setActiveSound(null); return; }
    if (activeSound === id) { audio.stop(); setActiveSound(null); }
    else { audio.play(id); audio.setVolume(volume); setActiveSound(id); }
  };

  // ── FIX #5 — save custom durations
  const saveDurations = (fm, bm) => {
    setFocusMins(fm); setBreakMins(bm);
    idb.setKV("focusMins", fm); idb.setKV("breakMins", bm);
    if (!isRunning) {
      setTimeLeft(mode === "break" ? bm * 60 : fm * 60);
    }
    setShowDuration(false);
    addToast(`Focus ${fm}min · Break ${bm}min`, "success");
  };

  // ── Play/pause — FIX #4: show abandon dialog instead of instant abandon
  const handlePlay = () => {
    if (!isRunning && !taskValid && mode === "focus") {
      setTaskTouched(true); taskRef.current?.focus(); return;
    }
    if (isRunning) {
      // Show confirmation before abandoning a focus session
      if (mode === "focus" && elapsedRef.current > 5) {
        clearTimer(); // pause visually while dialog is open
        setIsRunning(false); setIsImmersive(false);
        setShowAbandon(true);
      } else {
        setIsRunning(false); setIsImmersive(false);
      }
    } else {
      audio.unlock(); // FIX #1 — unlock on play gesture
      setIsRunning(true);
      if (mode === "focus") setIsImmersive(true);
    }
  };

  const confirmAbandon = () => {
    setShowAbandon(false);
    commitSession("abandoned");
    resetTimer(mode);
    setTask("");
  };

  const cancelAbandon = () => {
    setShowAbandon(false);
    // resume timer
    setIsRunning(true);
    if (mode === "focus") setIsImmersive(true);
  };

  const switchMode = (m) => {
    if (isRunning && mode === "focus" && m !== "focus") {
      clearTimer(); setIsRunning(false); setIsImmersive(false);
      if (elapsedRef.current > 5) {
        setShowAbandon(true);
        return; // wait for confirmation before switching
      }
    }
    if (m === "stats") {
      setStatsReady(false); setTimeout(() => setStatsReady(true), 20);
      setMode("stats"); clearTimer(); setIsRunning(false); setIsImmersive(false);
    } else {
      setMode(m); resetTimer(m); setStatsReady(false);
    }
  };

  // Progress arcs
  const totalDur = mode === "break" ? BREAK_DUR : FOCUS_DUR;
  const progress  = 1 - timeLeft / totalDur;
  const focusOff  = RING_C  * (1 - progress);
  const breakOff  = BREAK_C * (1 - progress);

  const dimStyle = () => isImmersive
    ? { opacity:0.12, pointerEvents:"none", transition:"opacity 0.7s ease" }
    : { opacity:1,    pointerEvents:"auto",  transition:"opacity 0.7s ease" };

  // Analytics
  const allSess = [
    ...localSess.map(s => ({ ...s, src:"local" })),
    ...cloudSess.filter(c => !localSess.some(l => l.id === c.id)).map(s => ({ ...s, src:"cloud" })),
  ].sort((a,b) => new Date(b.completed_at) - new Date(a.completed_at));

  const completedN = allSess.filter(s => s.status === "completed").length;
  const totalN     = allSess.length;
  const totalMins  = allSess.reduce((a, s) => a + (s.duration_minutes || 0), 0);
  const compRate   = totalN > 0 ? Math.round(completedN / totalN * 100) : 0;
  const donutData  = totalN > 0
    ? [{ name:"c", value:compRate }, { name:"a", value:100-compRate }]
    : [{ name:"c", value:0 }, { name:"a", value:100 }];

  const weeklyMap = {};
  allSess.forEach(s => {
    const d = s.completed_at?.slice(0,10);
    if (d) weeklyMap[d] = (weeklyMap[d] || 0) + (s.duration_minutes || 0);
  });
  const chartData = DAYS[lang].map((day, i) => {
    const d = new Date(); d.setDate(d.getDate() - 6 + i);
    return { day, minutes: weeklyMap[d.toISOString().slice(0,10)] || 0 };
  });
  const chartHasData = chartData.some(c => c.minutes > 0);

  return (
    <div style={{ minHeight:"100vh", width:"100%", background:tk.bg, fontFamily:"'Inter',sans-serif", display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>
      <style>{`
        @keyframes toastIn   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes modalIn   { from{opacity:0;transform:translateY(16px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes menuSlide { from{opacity:0;transform:translateX(30px)} to{opacity:1;transform:translateX(0)} }
        @keyframes statsIn   { from{opacity:0;transform:translateX(32px)} to{opacity:1;transform:translateX(0)} }
        @keyframes pulse     { 0%,100%{opacity:0.75} 50%{opacity:1} }
        @keyframes ringPulse { 0%,100%{filter:drop-shadow(0 0 5px rgba(249,115,22,0.4))} 50%{filter:drop-shadow(0 0 14px rgba(249,115,22,0.75))} }
        @keyframes ringPulseG{ 0%,100%{filter:drop-shadow(0 0 5px rgba(16,185,129,0.4))} 50%{filter:drop-shadow(0 0 14px rgba(16,185,129,0.75))} }
        @keyframes spin      { to{transform:rotate(360deg)} }
        @keyframes fadeIn    { from{opacity:0} to{opacity:1} }
        @keyframes slideUp   { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes breathe   { 0%,100%{transform:scale(1)} 50%{transform:scale(1.012)} }
        input[type=range]{ -webkit-appearance:none; appearance:none; height:3px; border-radius:4px; outline:none; cursor:pointer; }
        input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:${ORANGE}; cursor:pointer; box-shadow:0 0 8px rgba(249,115,22,0.5); }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.2);border-radius:2px}
        .nav-pills{ display:none }
        .nav-right{ display:none }
        .nav-burger{ display:flex }
        @media(min-width:768px){
          .nav-pills{ display:flex }
          .nav-right{ display:flex }
          .nav-burger{ display:none !important }
        }
      `}</style>

      {theme === "dark" && (
        <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", opacity:0.015, backgroundImage:"linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)", backgroundSize:"48px 48px" }}/>
      )}

      {/* ── NAV ── */}
      <nav style={{ ...dimStyle(), position:"relative", zIndex:20, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 24px", maxWidth:960, margin:"0 auto", width:"100%" }}>
        {/* Wordmark */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:isBreak?`radial-gradient(circle,${GREEN},rgba(16,185,129,0.3))`:`radial-gradient(circle,${ORANGE},rgba(249,115,22,0.3))`, boxShadow:isBreak?`0 0 8px rgba(16,185,129,0.8),0 0 18px rgba(16,185,129,0.2)`:`0 0 8px rgba(249,115,22,0.8),0 0 18px rgba(249,115,22,0.2)`, animation:"pulse 3s ease-in-out infinite" }}/>
          <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.24em", textTransform:"uppercase", color:tk.muted }}>{t.app}</span>
          {streak > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:20, background:"rgba(249,115,22,0.08)", border:"1px solid rgba(249,115,22,0.15)" }}>
              <Flame size={9} style={{color:ORANGE}}/><span style={{ fontSize:10, fontWeight:600, color:ORANGE }}>{streak}</span>
            </div>
          )}
        </div>

        {/* Desktop pills */}
        <div className="nav-pills" style={{ alignItems:"center", gap:4, borderRadius:99, padding:4, background:tk.pill, border:`1px solid ${tk.pillB}` }}>
          {[["focus",t.focus],["break",t.brk],["stats",t.stats]].map(([m,label]) => {
            const active = mode === m;
            return (
              <button key={m} onClick={() => switchMode(m)} style={{
                padding:"7px 16px", borderRadius:99, fontSize:11, fontWeight:500, letterSpacing:"0.1em", textTransform:"uppercase",
                background:active?(theme==="dark"?"rgba(255,255,255,0.09)":"rgba(255,255,255,0.9)"):"transparent",
                color:active?tk.text:tk.muted, border:active?`1px solid ${tk.border}`:"1px solid transparent",
                cursor:"pointer", transition:"all 0.2s",
              }}>{label}</button>
            );
          })}
        </div>

        {/* Desktop right */}
        <div className="nav-right" style={{ alignItems:"center", gap:8 }}>
          <button onClick={() => setShowDuration(true)} style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:10, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:11, fontWeight:500, cursor:"pointer" }}>
            <Timer size={11}/>{focusMins}m
          </button>
          {user && (
            <button onClick={() => setShowCloud(true)} style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 10px", borderRadius:10, background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.2)", color:GREEN, fontSize:11, fontWeight:500, cursor:"pointer" }}>
              <Wifi size={11}/><span style={{ maxWidth:70, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.email.split("@")[0]}</span>
            </button>
          )}
          <button onClick={() => setLang(l => l==="en"?"fr":"en")} style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:10, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:11, fontWeight:600, cursor:"pointer" }}>
            <Globe size={11}/>{lang.toUpperCase()}
          </button>
          <button onClick={() => setTheme(x => x==="dark"?"light":"dark")} style={{ width:32, height:32, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer" }}>
            {theme==="dark"?<Sun size={13}/>:<Moon size={13}/>}
          </button>
          {!user && (
            <button onClick={() => setShowCloud(true)} style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:10, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:11, cursor:"pointer" }}>
              <Cloud size={11}/>Cloud
            </button>
          )}
        </div>

        {/* Mobile burger */}
        <button className="nav-burger" onClick={() => setMenuOpen(true)} style={{ width:36, height:36, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer" }}>
          <Menu size={16}/>
        </button>
      </nav>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)}
        mode={mode} switchMode={switchMode} theme={theme} setTheme={setTheme}
        lang={lang} setLang={setLang} user={user} setShowCloud={setShowCloud}
        setShowDuration={setShowDuration} tk={tk} t={t}/>

      {isImmersive && (
        <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", zIndex:30, display:"flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:99, background:"rgba(0,0,0,0.6)", border:"1px solid rgba(255,255,255,0.08)", backdropFilter:"blur(12px)", color:"rgba(255,255,255,0.4)", fontSize:11, animation:"fadeIn 0.5s ease" }}>
          <Minimize2 size={11}/>{t.escHint}
        </div>
      )}

      {/* ══ FOCUS ══ */}
      {mode === "focus" && (
        <main style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:28, padding:"0 24px 40px" }}>
          {/* Task input */}
          <div style={{ ...dimStyle(), width:"100%", maxWidth:360, display:"flex", flexDirection:"column", gap:6 }}>
            <span style={{ textAlign:"center", fontSize:10, fontWeight:700, letterSpacing:"0.25em", textTransform:"uppercase", color:`${ORANGE}cc` }}>
              {lang==="fr"?"Votre tâche":"Your task"}
            </span>
            <div style={{ borderRadius:16, padding:"14px 18px", background:theme==="light"?"rgba(255,255,255,0.95)":"rgba(255,255,255,0.04)", border:`1.5px solid ${taskTouched&&!taskValid?"#ef4444":theme==="light"?"#e2e8f0":"rgba(255,255,255,0.12)"}`, boxShadow:theme==="light"?"0 2px 16px rgba(249,115,22,0.07),0 1px 4px rgba(0,0,0,0.05)":"0 0 0 1px rgba(249,115,22,0.06)", transition:"border-color 0.2s, box-shadow 0.2s" }}>
              <input ref={taskRef} type="text" value={task}
                onChange={e => { setTask(e.target.value); setTaskTouched(false); }}
                onBlur={() => setTaskTouched(true)}
                placeholder={t.placeholder}
                onFocus={e => { const p = e.target.parentElement; p.style.borderColor="rgba(249,115,22,0.5)"; p.style.boxShadow=theme==="light"?"0 0 0 3px rgba(249,115,22,0.1)":"0 0 0 2px rgba(249,115,22,0.2)"; }}
                onBlurCapture={e => { const p = e.target.parentElement; p.style.borderColor=taskTouched&&!task.trim()?"#ef4444":theme==="light"?"#e2e8f0":"rgba(255,255,255,0.12)"; p.style.boxShadow=theme==="light"?"0 2px 16px rgba(249,115,22,0.07)":"0 0 0 1px rgba(249,115,22,0.06)"; }}
                style={{ width:"100%", background:"transparent", border:"none", outline:"none", textAlign:"center", fontSize:14, fontWeight:500, color:theme==="light"?(task?"#0f172a":"#94a3b8"):(task?"#fafafa":"rgba(255,255,255,0.3)"), fontFamily:"'Inter',sans-serif", caretColor:ORANGE }}
              />
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:5, opacity:taskTouched&&!taskValid?1:0, height:14, transition:"opacity 0.2s" }}>
              <AlertCircle size={10} style={{color:RED}}/><span style={{ fontSize:10, color:RED }}>{t.hint}</span>
            </div>
          </div>

          {/* Timer ring */}
          <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center", userSelect:"none", cursor:isImmersive?"pointer":"default" }}
            onClick={() => isImmersive && setIsImmersive(false)}>
            <svg width="340" height="340" style={{ position:"absolute", transform:"rotate(-90deg)", opacity:isImmersive?0.3:0.5, transition:"opacity 0.7s" }}>
              <circle cx="170" cy="170" r="160" fill="none" stroke={theme==="dark"?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.04)"} strokeWidth="1" strokeDasharray="2 10"/>
            </svg>
            <svg width="300" height="300" style={{ transform:"rotate(-90deg)", animation:isRunning?"ringPulse 3s ease-in-out infinite":"none" }}>
              <circle cx="150" cy="150" r={RING_R} fill="none" stroke={theme==="dark"?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.05)"} strokeWidth="1.5"/>
              <circle cx="150" cy="150" r={RING_R} fill="none" stroke="url(#fg)" strokeWidth="1.5"
                strokeLinecap="round" strokeDasharray={RING_C} strokeDashoffset={focusOff}
                style={{ transition:"stroke-dashoffset 1s linear" }}/>
              <defs>
                <linearGradient id="fg" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={RED}/><stop offset="100%" stopColor={ORANGE}/>
                </linearGradient>
              </defs>
            </svg>
            <div style={{ position:"absolute", display:"flex", flexDirection:"column", alignItems:"center", gap:8, animation:isRunning&&isImmersive?"breathe 4s ease-in-out infinite":"none" }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:isImmersive?"clamp(3.8rem,14vw,5.5rem)":"clamp(3.2rem,11vw,4.6rem)", fontWeight:700, letterSpacing:"-0.03em", color:tk.text, lineHeight:1, textShadow:isRunning?"0 0 50px rgba(249,115,22,0.18)":"none", transition:"font-size 0.5s ease" }}>
                {fmt(timeLeft)}
              </span>
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.38em", textTransform:"uppercase", color:isRunning?"rgba(249,115,22,0.7)":tk.subtle, transition:"color 0.4s" }}>
                {isRunning ? t.focusing : t.ready}
              </span>
              {/* Duration label */}
              <span style={{ fontSize:9, color:tk.subtle, opacity:0.7 }}>{focusMins} {t.minutes} {t.cycle}</span>
              {isImmersive && <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)", marginTop:4 }}>{t.exitHint}</span>}
            </div>
          </div>

          {/* Controls */}
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <CtrlBtn onClick={() => resetTimer("focus")} tk={tk}><RotateCcw size={15}/></CtrlBtn>
            <button onClick={handlePlay} style={{
              width:72, height:72, borderRadius:"50%", flexShrink:0,
              display:"flex", alignItems:"center", justifyContent:"center",
              background:taskValid||isRunning?`linear-gradient(140deg,${ORANGE},${RED})`:(theme==="dark"?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)"),
              border:!taskValid&&!isRunning?`1px solid ${tk.border}`:"none",
              boxShadow:taskValid||isRunning?"0 0 0 1px rgba(249,115,22,0.25),0 0 32px rgba(249,115,22,0.4),0 0 64px rgba(249,115,22,0.1)":"none",
              color:taskValid||isRunning?"#09090b":tk.subtle,
              cursor:"pointer", transition:"all 0.25s cubic-bezier(0.16,1,0.3,1)", position:"relative",
            }}>
              {isRunning ? <Pause size={22} fill={taskValid||isRunning?"#09090b":tk.subtle}/> : <Play size={22} fill={taskValid||isRunning?"#09090b":tk.subtle}/>}
              {isRunning && <span style={{ position:"absolute", inset:0, borderRadius:"50%", boxShadow:"0 0 0 8px rgba(249,115,22,0.08)", animation:"pulse 2s ease-in-out infinite" }}/>}
            </button>
            <CtrlBtn onClick={() => switchMode("break")} tk={tk}>
              <span style={{ fontSize:10, fontWeight:600, fontFamily:"'JetBrains Mono',monospace" }}>{breakMins}m</span>
            </CtrlBtn>
          </div>

          {/* Soundscape + Cloud */}
          <div style={{ ...dimStyle(), width:"100%", maxWidth:360, display:"flex", flexDirection:"column", gap:10 }}>
            <SoundCard activeSound={activeSound} toggleSound={toggleSound} volume={volume} setVolume={setVolume} tk={tk} t={t}/>
            <button onClick={() => setShowCloud(true)} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", borderRadius:14, background:tk.card, border:`1px solid ${tk.border}`, cursor:"pointer" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                {user?<Wifi size={13} style={{color:GREEN}}/>:<Cloud size={13} style={{color:ORANGE}}/>}
                <span style={{ fontSize:12, color:tk.muted }}>{user?`${t.loggedAs} ${user.email}`:t.cloudBanner}</span>
              </div>
              <ChevronRight size={13} style={{color:tk.subtle, flexShrink:0}}/>
            </button>
          </div>
        </main>
      )}

      {/* ══ BREAK ══ */}
      {mode === "break" && (
        <main style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:32, padding:"0 24px 48px" }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.4em", textTransform:"uppercase", color:"rgba(16,185,129,0.6)" }}>{t.breakLabel}</span>
          <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="260" height="260" style={{ transform:"rotate(-90deg)", animation:isRunning?"ringPulseG 3s ease-in-out infinite":"none" }}>
              <circle cx="130" cy="130" r={BREAK_R} fill="none" stroke={theme==="dark"?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.05)"} strokeWidth="1.5"/>
              <circle cx="130" cy="130" r={BREAK_R} fill="none" stroke="url(#bg)" strokeWidth="1.5"
                strokeLinecap="round" strokeDasharray={BREAK_C} strokeDashoffset={breakOff}
                style={{ transition:"stroke-dashoffset 1s linear" }}/>
              <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor={GREEN}/>
                </linearGradient>
              </defs>
            </svg>
            <div style={{ position:"absolute", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:"clamp(2.5rem,9vw,3.6rem)", fontWeight:700, letterSpacing:"-0.03em", color:tk.text, lineHeight:1 }}>{fmt(timeLeft)}</span>
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.38em", textTransform:"uppercase", color:isRunning?"rgba(16,185,129,0.7)":tk.subtle }}>
                {isRunning ? t.resting : t.paused}
              </span>
              <span style={{ fontSize:9, color:tk.subtle, opacity:0.7 }}>{breakMins} {t.minutes} {t.breakCycle}</span>
            </div>
          </div>
          <div style={{ width:"100%", maxWidth:340, borderRadius:20, padding:24, background:theme==="dark"?"rgba(16,185,129,0.04)":"rgba(16,185,129,0.03)", border:"1px solid rgba(16,185,129,0.15)", display:"flex", flexDirection:"column", gap:18 }}>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:GREEN, boxShadow:"0 0 8px rgba(16,185,129,0.8)" }}/>
                <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.3em", textTransform:"uppercase", color:"rgba(16,185,129,0.6)" }}>{t.breakTag}</span>
              </div>
              <p style={{ fontSize:13, color:tk.muted, lineHeight:1.8 }}>{t.breakCopy}</p>
            </div>
            <a href="https://drehozoe.web.app/" style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"14px", borderRadius:14, textDecoration:"none", background:`linear-gradient(135deg,${GREEN},#059669)`, color:"#f0fdf4", fontSize:13, fontWeight:600, boxShadow:"0 0 0 1px rgba(16,185,129,0.25),0 0 28px rgba(16,185,129,0.25)" }}>
              {t.portfolio}<ExternalLink size={13}/>
            </a>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <CtrlBtn onClick={() => resetTimer("break")} tk={tk}><RotateCcw size={15}/></CtrlBtn>
            <button onClick={() => { audio.unlock(); setIsRunning(r => !r); }} style={{ width:64, height:64, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", background:`linear-gradient(140deg,${GREEN},#059669)`, boxShadow:"0 0 0 1px rgba(16,185,129,0.25),0 0 28px rgba(16,185,129,0.3)", color:"#052e16", border:"none", cursor:"pointer" }}>
              {isRunning ? <Pause size={20} fill="#052e16"/> : <Play size={20} fill="#052e16"/>}
            </button>
            <CtrlBtn onClick={() => switchMode("focus")} tk={tk}><ArrowLeft size={15}/></CtrlBtn>
          </div>
        </main>
      )}

      {/* ══ STATS ══ */}
      {mode === "stats" && (
        <main style={{ flex:1, display:"flex", flexDirection:"column", gap:20, padding:"8px 24px 48px", maxWidth:900, margin:"0 auto", width:"100%", overflowY:"auto", animation:statsReady?"statsIn 0.35s cubic-bezier(0.16,1,0.3,1) forwards":"none" }}>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between" }}>
            <div>
              <h1 style={{ fontSize:22, fontWeight:600, letterSpacing:"-0.02em", color:tk.text, margin:0 }}>{t.analytics}</h1>
              <p style={{ fontSize:11, color:tk.subtle, marginTop:4, display:"flex", alignItems:"center", gap:6 }}>
                {t.analyticsWk}
                {user && <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:GREEN }}><Wifi size={9}/>synced</span>}
              </p>
            </div>
            <button onClick={() => switchMode("focus")} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 12px", borderRadius:10, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:11, fontWeight:500, cursor:"pointer" }}>
              <ArrowLeft size={11}/>{t.focus}
            </button>
          </div>

          {/* KPI */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10 }}>
            {[
              { label:t.hrs,    val:totalMins>0?(totalMins/60).toFixed(1):"—", unit:"hrs", Icon:Clock,        c:ORANGE },
              { label:t.done_s, val:totalN>0?String(totalN):"—",               unit:"",    Icon:CheckCircle2, c:GREEN  },
              { label:t.best,   val:(() => { if (!chartHasData) return "—"; const b=chartData.reduce((a,x)=>x.minutes>a.minutes?x:a,chartData[0]); return b.minutes>0?b.day:"—"; })(), unit:"", Icon:TrendingUp, c:"#fb923c" },
              { label:t.avg,    val:totalN>0?(totalMins/totalN).toFixed(1):"—",unit:"min", Icon:Flame,        c:ORANGE },
            ].map(({ label, val, unit, Icon, c }) => (
              <div key={label} style={{ borderRadius:16, padding:16, display:"flex", flexDirection:"column", gap:12, background:tk.card, border:`1px solid ${tk.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <Icon size={12} style={{color:c}}/><span style={{ fontSize:10, fontWeight:500, color:tk.muted }}>{label}</span>
                </div>
                <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:26, fontWeight:700, color:tk.text, letterSpacing:"-0.02em", lineHeight:1 }}>{val}</span>
                  {unit && <span style={{ fontSize:11, color:tk.muted }}>{unit}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div style={{ display:"grid", gap:12, gridTemplateColumns:"minmax(0,1.6fr) minmax(0,1fr)" }}>
            <div style={{ borderRadius:16, padding:20, background:tk.card, border:`1px solid ${tk.border}` }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                <span style={{ fontSize:10, fontWeight:600, letterSpacing:"0.18em", textTransform:"uppercase", color:tk.muted }}>{t.wkChart}</span>
                {chartHasData && <span style={{ fontSize:10, color:tk.subtle, fontFamily:"'JetBrains Mono',monospace" }}>{totalMins} min</span>}
              </div>
              {chartHasData ? (
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={chartData} barSize={18} margin={{ top:4,right:4,left:-20,bottom:0 }}>
                    <XAxis dataKey="day" tick={{ fill:tk.subtle, fontSize:10, fontFamily:"'Inter',sans-serif" }} axisLine={false} tickLine={false}/>
                    <YAxis hide/>
                    <Tooltip contentStyle={{ background:theme==="dark"?"#18181b":"#fff", border:`1px solid ${tk.border}`, borderRadius:10, color:tk.text, fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}
                      formatter={v => [`${v} min`,"Focus"]} cursor={{ fill:"rgba(255,255,255,0.02)" }}/>
                    <Bar dataKey="minutes" radius={[5,5,0,0]}>
                      {chartData.map((_, i) => {
                        const mx = Math.max(...chartData.map(d => d.minutes));
                        return <Cell key={i} fill={chartData[i].minutes===mx&&mx>0?"url(#barG)":(theme==="dark"?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.07)")}/>;
                      })}
                    </Bar>
                    <defs>
                      <linearGradient id="barG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ORANGE}/><stop offset="100%" stopColor={RED}/>
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState tk={tk} t={t}/>}
            </div>

            <div style={{ borderRadius:16, padding:20, background:tk.card, border:`1px solid ${tk.border}`, display:"flex", flexDirection:"column", gap:12 }}>
              <span style={{ fontSize:10, fontWeight:600, letterSpacing:"0.18em", textTransform:"uppercase", color:tk.muted }}>{t.rate}</span>
              <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                {totalN > 0 ? (
                  <>
                    <div style={{ position:"relative" }}>
                      <ResponsiveContainer width={130} height={130}>
                        <PieChart>
                          <Pie data={donutData} cx="50%" cy="50%" innerRadius={42} outerRadius={56} dataKey="value" strokeWidth={0} startAngle={90} endAngle={-270}>
                            <Cell fill="url(#doG)"/>
                            <Cell fill={theme==="dark"?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.06)"}/>
                          </Pie>
                          <defs>
                            <linearGradient id="doG" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor={ORANGE}/><stop offset="100%" stopColor={RED}/>
                            </linearGradient>
                          </defs>
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:22, fontWeight:700, color:tk.text, lineHeight:1 }}>{compRate}%</span>
                        <span style={{ fontSize:9, color:tk.subtle, marginTop:3 }}>{t.done}</span>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:14, marginTop:8 }}>
                      {[{ c:ORANGE, l:t.completed },{ c:theme==="dark"?"rgba(255,255,255,0.18)":"rgba(0,0,0,0.12)", l:t.abandoned }].map(({ c, l }) => (
                        <div key={l} style={{ display:"flex", alignItems:"center", gap:5 }}>
                          <div style={{ width:6, height:6, borderRadius:"50%", background:c }}/><span style={{ fontSize:10, color:tk.muted }}>{l}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <EmptyState tk={tk} t={t} small/>}
              </div>
            </div>
          </div>

          {/* Session history */}
          <div style={{ borderRadius:16, padding:20, background:tk.card, border:`1px solid ${tk.border}` }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <span style={{ fontSize:10, fontWeight:600, letterSpacing:"0.18em", textTransform:"uppercase", color:tk.muted }}>{t.recent}</span>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                {localSess.length>0 && <span style={{ fontSize:10, color:tk.subtle }}>{localSess.length} {t.local}</span>}
                {cloudSess.length>0 && <span style={{ fontSize:10, color:GREEN, display:"flex", alignItems:"center", gap:4 }}><Wifi size={9}/>{cloudSess.length} {t.cloud}</span>}
              </div>
            </div>
            {allSess.length === 0 ? (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:"32px 0" }}>
                <Clock size={22} style={{color:tk.subtle}}/>
                <p style={{ fontSize:12, color:tk.subtle, textAlign:"center" }}>{t.empty}</p>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column" }}>
                {allSess.slice(0, 12).map((s, i) => (
                  <div key={s.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 4px", borderBottom:i<Math.min(allSess.length,12)-1?`1px solid ${tk.divider}`:"none", animation:`slideUp 0.3s ease ${i*0.04}s both` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
                      <div style={{ width:5, height:5, borderRadius:"50%", flexShrink:0, background:s.status==="completed"?ORANGE:(theme==="dark"?"rgba(255,255,255,0.15)":"rgba(0,0,0,0.12)") }}/>
                      <span style={{ fontSize:13, color:s.status==="completed"?tk.text:tk.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.task_title||s.task}</span>
                      {s.src==="cloud" && <Wifi size={8} style={{color:GREEN, flexShrink:0}}/>}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:16, flexShrink:0 }}>
                      {/* FIX #2 — show exact duration */}
<span style={{ fontSize:11, fontFamily:"'JetBrains Mono',monospace", color:s.status==="completed"?"rgba(249,115,22,0.7)":tk.subtle }}>
  {fmt(s.duration_seconds ?? (s.duration_minutes||0) * 60)}
</span>
                      <span style={{ fontSize:10, fontFamily:"'JetBrains Mono',monospace", color:tk.subtle }}>
                        {s.completed_at ? new Date(s.completed_at).toLocaleTimeString(lang==="fr"?"fr-FR":"en-US",{hour:"2-digit",minute:"2-digit"}) : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cloud CTA */}
          <button onClick={() => setShowCloud(true)} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px", borderRadius:16, background:tk.card, border:`1px solid ${tk.border}`, cursor:"pointer" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:32, height:32, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(249,115,22,0.08)", border:"1px solid rgba(249,115,22,0.15)" }}>
                {user?<Wifi size={13} style={{color:GREEN}}/>:<Cloud size={13} style={{color:ORANGE}}/>}
              </div>
              <span style={{ fontSize:13, color:tk.muted }}>{user?`${t.loggedAs} ${user.email}`:t.cloudBanner}</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:10, fontSize:11, fontWeight:600, color:"#fff", flexShrink:0, background:user?`linear-gradient(140deg,${GREEN},#059669)`:`linear-gradient(140deg,${ORANGE},${RED})` }}>
              {user?t.logout:t.saveCloud}<ChevronRight size={11}/>
            </div>
          </button>
        </main>
      )}

      {/* Bottom label */}
      {mode !== "stats" && (
        <div style={{ ...dimStyle(), textAlign:"center", paddingBottom:20, zIndex:10, position:"relative" }}>
          <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.2em", textTransform:"uppercase", color:tk.subtle }}>
            {focusMins} {t.minutes} {mode==="focus"?t.cycle:t.breakCycle}
          </span>
        </div>
      )}

      {/* Modals */}
      {showAbandon && (
        <AbandonDialog t={t} tk={tk}
          elapsed={elapsedRef.current}
          onConfirm={confirmAbandon}
          onCancel={cancelAbandon}/>
      )}
      {showDuration && (
        <DurationModal t={t} tk={tk}
          focusMins={focusMins} breakMins={breakMins}
          onSave={saveDurations} onClose={() => setShowDuration(false)}/>
      )}
      {showCloud && (
        <CloudModal onClose={() => setShowCloud(false)} t={t} tk={tk} onAuth={handleAuth} user={user}/>
      )}
      <Toasts list={toasts}/>
    </div>
  );
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────
function CtrlBtn({ onClick, children, tk }) {
  return (
    <button onClick={onClick} style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer", transition:"transform 0.15s" }}>
      {children}
    </button>
  );
}

function SoundCard({ activeSound, toggleSound, volume, setVolume, tk, t }) {
  const isSilence = activeSound === null;
  return (
    <div style={{ borderRadius:18, padding:16, background:"rgba(249,115,22,0.04)", border:"1px solid rgba(249,115,22,0.12)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        {activeSound ? <Volume2 size={11} style={{color:ORANGE}}/> : <VolumeX size={11} style={{color:"rgba(249,115,22,0.45)"}}/>}
        <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.25em", textTransform:"uppercase", color:"rgba(249,115,22,0.5)" }}>{t.sound}</span>
        {activeSound && <span style={{ marginLeft:"auto", fontSize:9, color:"rgba(249,115,22,0.65)", fontFamily:"'JetBrains Mono',monospace" }}>{t.playing}</span>}
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:activeSound?12:0 }}>
        {[
          { id:null,         label:t.silence, Icon:VolumeX  },
          { id:"rain",       label:t.rain,    Icon:CloudRain },
          { id:"whitenoise", label:t.noise,   Icon:Wind      },
          { id:"lofi",       label:t.lofi,    Icon:Music2    },
        ].map(({ id, label, Icon }) => {
          const active = activeSound === id;
          return (
            <button key={String(id)} onClick={() => toggleSound(id)} style={{
              flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6,
              padding:"12px 4px", borderRadius:12, fontSize:10, fontWeight:500,
              background:active?"rgba(249,115,22,0.12)":"rgba(249,115,22,0.03)",
              border:active?"1px solid rgba(249,115,22,0.35)":"1px solid rgba(249,115,22,0.1)",
              color:active?ORANGE:"rgba(249,115,22,0.38)", cursor:"pointer", transition:"all 0.2s",
            }}>
              <Icon size={14}/>{label}
            </button>
          );
        })}
      </div>
      {activeSound && (
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <VolumeX size={10} style={{color:"rgba(249,115,22,0.35)", flexShrink:0}}/>
          <input type="range" min="0" max="1" step="0.02" value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            style={{ flex:1, background:`linear-gradient(to right,${ORANGE} ${volume*100}%,rgba(249,115,22,0.15) ${volume*100}%)` }}
          />
          <Volume2 size={10} style={{color:"rgba(249,115,22,0.35)", flexShrink:0}}/>
        </div>
      )}
    </div>
  );
}

function EmptyState({ tk, t, small }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, padding:small?"20px 0":"40px 0", opacity:0.5 }}>
      <TrendingUp size={small?18:22} style={{color:tk.subtle}}/>
      <span style={{ fontSize:10, color:tk.subtle, textAlign:"center" }}>{t.empty}</span>
    </div>
  );
}
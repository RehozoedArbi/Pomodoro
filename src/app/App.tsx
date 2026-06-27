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
  LogOut, User, Wifi, Menu,
} from "lucide-react";

// ─────────────────────────────────────────────
// ⚙️  SUPABASE CONFIG
// ─────────────────────────────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ─────────────────────────────────────────────
// FIX #4 — Site URL dynamique (fini le localhost en prod)
// On lit l'URL de la page courante pour que Supabase redirige
// vers le bon domaine (vercel, localhost, peu importe).
// ─────────────────────────────────────────────
const SITE_URL = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.host}`
  : "http://localhost:5173";

// ─────────────────────────────────────────────
// SUPABASE CLIENT (fetch natif, sans SDK)
// ─────────────────────────────────────────────
const sb = {
  h: (token?: string | null) => ({
    "Content-Type":  "application/json",
    "apikey":        SUPABASE_ANON,
    "Authorization": `Bearer ${token || SUPABASE_ANON}`,
  }),
  async signUp(email: string, password: string) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: this.h(),
      // FIX #4 — passe le redirect URL à l'inscription
      body: JSON.stringify({ email, password, options: { emailRedirectTo: SITE_URL } }),
    });
    return r.json();
  },
  async signIn(email: string, password: string) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: this.h(), body: JSON.stringify({ email, password }),
    });
    return r.json();
  },
  async signOut(token: string) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method:"POST", headers: this.h(token) });
  },
  async recover(email: string) {
    // FIX #4 — passe le redirect URL à la récupération de mot de passe
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: "POST",
      headers: this.h(),
      body: JSON.stringify({ email, options: { emailRedirectTo: SITE_URL } }),
    });
    return r.json();
  },
  async upsertSession(token: string, session: object) {
    await fetch(`${SUPABASE_URL}/rest/v1/focus_sessions`, {
      method: "POST",
      headers: { ...this.h(token), "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(session),
    });
  },
  async getSessions(token: string, userId: string) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/focus_sessions?user_id=eq.${userId}&order=completed_at.desc&limit=50`,
      { headers: this.h(token) }
    );
    return r.json();
  },
  async upsertSettings(token: string, settings: object) {
    await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
      method: "POST",
      headers: { ...this.h(token), "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(settings),
    });
  },
};

// ─────────────────────────────────────────────
// INDEXEDDB
// ─────────────────────────────────────────────
function openDB() {
  return new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open("aurafocus", 1);
    req.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", { keyPath:"id" });
        s.createIndex("completed_at","completed_at");
      }
      if (!db.objectStoreNames.contains("kv"))
        db.createObjectStore("kv", { keyPath:"k" });
    };
    req.onsuccess = (e: any) => res(e.target.result);
    req.onerror   = () => rej(req.error);
  });
}
const idb = {
  async put(store: string, val: object) {
    const db  = await openDB();
    return new Promise<void>((res) => {
      const tx  = db.transaction(store,"readwrite");
      tx.objectStore(store).put(val);
      tx.oncomplete = () => res();
    });
  },
  async get(store: string, key: string) {
    const db  = await openDB();
    return new Promise<any>((res) => {
      const req = db.transaction(store,"readonly").objectStore(store).get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => res(null);
    });
  },
  async getAll(store: string) {
    const db  = await openDB();
    return new Promise<any[]>((res) => {
      const req = db.transaction(store,"readonly").objectStore(store).getAll();
      req.onsuccess = () => res(req.result ?? []);
      req.onerror   = () => res([]);
    });
  },
  async setKV(k: string, v: any) { await this.put("kv", { k, v }); },
  async getKV(k: string) { const r = await this.get("kv", k); return r?.v ?? null; },
  async saveSession(s: object) { await this.put("sessions", s); },
  async allSessions() {
    const all = await this.getAll("sessions");
    return all.sort((a,b) => new Date(b.completed_at).getTime()-new Date(a.completed_at).getTime());
  },
};

// ─────────────────────────────────────────────
// WEB AUDIO ENGINE
// ─────────────────────────────────────────────
class AudioEngine {
  ctx: AudioContext | null = null;
  nodes: any = {};
  active: string | null = null;

  _init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (this.ctx.state==="suspended") this.ctx.resume();
  }
  _noise(hipass=0, lopass=22000, gain=0.25) {
    const buf  = this.ctx!.createBuffer(1, this.ctx!.sampleRate*3, this.ctx!.sampleRate);
    const data = buf.getChannelData(0);
    for (let i=0; i<data.length; i++) data[i]=Math.random()*2-1;
    const src  = this.ctx!.createBufferSource();
    src.buffer = buf; src.loop = true;
    const hp   = this.ctx!.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=hipass;
    const lp   = this.ctx!.createBiquadFilter(); lp.type="lowpass";  lp.frequency.value=lopass;
    const g    = this.ctx!.createGain(); g.gain.value=gain;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.ctx!.destination);
    src.start();
    return { source:src, gainNode:g };
  }
  _lofi() {
    const master = this.ctx!.createGain(); master.gain.value=0.10;
    master.connect(this.ctx!.destination);
    const convBuf = this.ctx!.createBuffer(2, this.ctx!.sampleRate*2, this.ctx!.sampleRate);
    for (let c=0;c<2;c++) {
      const ch=convBuf.getChannelData(c);
      for (let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*Math.pow(1-i/ch.length,2.5);
    }
    const conv=this.ctx!.createConvolver(); conv.buffer=convBuf; conv.connect(master);
    const CHORD=[130.81,164.81,196.00,246.94,261.63];
    let tick=0;
    const iv=setInterval(()=>{
      if (!this.ctx) return;
      const freq=CHORD[tick%CHORD.length]*( tick%3===0?2:1 ); tick++;
      const osc=this.ctx.createOscillator(); osc.type="sine"; osc.frequency.value=freq;
      const eg=this.ctx.createGain();
      eg.gain.setValueAtTime(0,this.ctx.currentTime);
      eg.gain.linearRampToValueAtTime(0.5,this.ctx.currentTime+0.08);
      eg.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+3);
      osc.connect(eg); eg.connect(conv); osc.start(); osc.stop(this.ctx.currentTime+3);
    },2200);
    return { interval:iv, masterGain:master };
  }
  play(id: string) {
    this._init(); this.stop(); this.active=id;
    if (id==="rain")       this.nodes=this._noise(900,7000,0.30);
    if (id==="whitenoise") this.nodes=this._noise(20,20000,0.18);
    if (id==="lofi")       this.nodes=this._lofi();
  }
  stop() {
    try {
      this.nodes.source?.stop();
      if (this.nodes.interval) clearInterval(this.nodes.interval);
      if (this.nodes.gainNode) this.nodes.gainNode.gain.value=0;
      if (this.nodes.masterGain) this.nodes.masterGain.gain.value=0;
    } catch(_){}
    this.nodes={}; this.active=null;
  }
  setVolume(v: number) {
    const g=this.nodes.gainNode||this.nodes.masterGain;
    if (g) g.gain.value=v;
  }
}
const audio = new AudioEngine();

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const FOCUS_DUR  = 25*60;
const BREAK_DUR  = 5*60;
const RING_R     = 138;
const RING_C     = 2*Math.PI*RING_R;
const BREAK_R    = 118;
const BREAK_C    = 2*Math.PI*BREAK_R;
const ORANGE     = "#f97316";
const RED        = "#ef4444";
const GREEN      = "#10b981";

// ─────────────────────────────────────────────
// TOKENS
// ─────────────────────────────────────────────
const TK = {
  dark: {
    bg:"#09090b", card:"rgba(255,255,255,0.028)", border:"rgba(255,255,255,0.08)",
    text:"#fafafa", muted:"rgba(255,255,255,0.30)", subtle:"rgba(255,255,255,0.15)",
    pill:"rgba(255,255,255,0.04)", pillB:"rgba(255,255,255,0.07)",
    line:"rgba(255,255,255,0.10)", divider:"rgba(255,255,255,0.06)",
    overlay:"rgba(0,0,0,0.80)", modalBg:"#111113", modalB:"rgba(255,255,255,0.09)",
    menuBg:"#0e0e10", menuB:"rgba(255,255,255,0.08)",
  },
  light: {
    bg:"#f8fafc", card:"rgba(255,255,255,0.85)", border:"#e2e8f0",
    text:"#0f172a", muted:"#64748b", subtle:"#94a3b8",
    pill:"rgba(15,23,42,0.05)", pillB:"#e2e8f0",
    line:"#cbd5e1", divider:"#f1f5f9",
    overlay:"rgba(15,23,42,0.55)", modalBg:"#ffffff", modalB:"#e2e8f0",
    menuBg:"#ffffff", menuB:"#e2e8f0",
  },
};

// ─────────────────────────────────────────────
// TRANSLATIONS
// ─────────────────────────────────────────────
const T = {
  en: {
    app:"AuraFocus", focus:"Focus", brk:"Break", stats:"Stats",
    sessions:"sessions", placeholder:"What will you focus on?",
    hint:"Enter a task to start", focusing:"focusing", ready:"ready",
    sound:"Soundscape", playing:"playing", rain:"Rain", noise:"Noise", lofi:"Lofi",
    breakLabel:"Break Time", resting:"resting", paused:"paused",
    breakTag:"While your mind rests",
    breakCopy:"Check out my portfolio. I build seamless web apps just like this one.",
    portfolio:"View Portfolio",
    cloudBanner:"Sync your history across devices.",
    saveCloud:"Save to Cloud", analytics:"Focus Analytics",
    analyticsWk:"Week of June 23–29",
    hrs:"Total Hours", done_s:"Sessions Done", best:"Best Day", avg:"Avg Session",
    wkChart:"Weekly Focus", wkTotal:"885 min", rate:"Completion Rate",
    recent:"Recent Sessions", done:"done",
    modalTitle:"Save to Cloud", modalSub:"Sync your focus history across devices.",
    emailLbl:"Email", emailPh:"you@example.com", passLbl:"Password", passPh:"At least 6 characters",
    create:"Create Free Account", haveAcc:"Already have an account?", signIn:"Sign in",
    signInTitle:"Welcome back", signInSub:"Sign in to access your synced history.",
    signInBtn:"Sign In", noAcc:"No account yet?", signUp:"Sign up",
    cycle:"25 min deep work", breakCycle:"5 min recovery",
    escHint:"Press Esc or tap to exit", exitHint:"Exit focus mode",
    syncing:"Syncing…", synced:"Synced!", loggedAs:"Logged in as",
    logout:"Sign out", local:"local", cloud:"cloud",
    empty:"No sessions yet — start your first focus cycle!",
    vol:"Volume", abandoned:"Abandoned", completed:"Completed", silence:"Off",
    confirmTitle: "Check your email",
    confirmBody: "We sent a confirmation link to",
    backToSignIn: "Back to sign in",
    invalidEmail: "Invalid email address.",
    minChars: "Minimum 6 characters.",
    emailNotConfirmed: "Check your inbox and click the confirmation link before signing in.",
    invalidCreds: "Incorrect email or password.",
    signInError: "Sign-in error. Please try again.",
    alreadyRegistered: "An account already exists with this email. Sign in instead.",
    signUpError: "Sign-up error. Please try again.",
    serverError: "Could not reach the server. Check your connection.",
    wrongCurrentPass: "Current password is incorrect.",
  },
  fr: {
    app:"AuraFocus", focus:"Focus", brk:"Pause", stats:"Stats",
    sessions:"séances", placeholder:"Sur quoi allez-vous vous concentrer ?",
    hint:"Entrez une tâche pour commencer", focusing:"en cours", ready:"prêt",
    sound:"Ambiance", playing:"lecture", rain:"Pluie", noise:"Bruit blanc", lofi:"Lofi",
    breakLabel:"Pause", resting:"en repos", paused:"en pause",
    breakTag:"Pendant que votre esprit se repose",
    breakCopy:"Découvrez mes services. J'aide les entreprises à créer des apps aussi fluides que celle-ci.",
    portfolio:"Voir le portfolio",
    cloudBanner:"Synchronisez votre historique sur tous vos appareils.",
    saveCloud:"Sauvegarder", analytics:"Analytique",
    analyticsWk:"Semaine du 23–29 juin",
    hrs:"Heures totales", done_s:"Séances réalisées", best:"Meilleur jour", avg:"Séance moy.",
    wkChart:"Minutes hebdomadaires", wkTotal:"885 min", rate:"Taux de complétion",
    recent:"Séances récentes", done:"terminé",
    modalTitle:"Sauvegarder sur le Cloud", modalSub:"Synchronisez votre historique sur tous vos appareils.",
    emailLbl:"E-mail", emailPh:"vous@exemple.com", passLbl:"Mot de passe", passPh:"6 caractères minimum",
    create:"Créer un compte gratuit", haveAcc:"Déjà un compte ?", signIn:"Se connecter",
    signInTitle:"Bon retour", signInSub:"Connectez-vous pour accéder à votre historique.",
    signInBtn:"Se connecter", noAcc:"Pas encore de compte ?", signUp:"S'inscrire",
    cycle:"25 min de travail profond", breakCycle:"5 min de récupération",
    escHint:"Échap ou tap pour quitter", exitHint:"Quitter le mode focus",
    syncing:"Synchronisation…", synced:"Synchronisé !", loggedAs:"Connecté en tant que",
    logout:"Déconnexion", local:"local", cloud:"cloud",
    empty:"Aucune séance — commencez votre premier cycle !",
    vol:"Volume", abandoned:"Abandonné", completed:"Complété", silence:"Silence",
    confirmTitle: "Vérifiez votre e-mail",
    confirmBody: "Nous avons envoyé un lien de confirmation à",
    invalidEmail: "Adresse e-mail invalide.",
    minChars: "Minimum 6 caractères.",
    emailNotConfirmed: "Vérifiez votre boîte mail et cliquez sur le lien de confirmation avant de vous connecter.",
    invalidCreds: "Email ou mot de passe incorrect.",
    signInError: "Erreur de connexion. Réessayez.",
    alreadyRegistered: "Un compte existe déjà avec cet e-mail. Connectez-vous plutôt.",
    signUpError: "Erreur d'inscription. Réessayez.",
    serverError: "Impossible de contacter le serveur. Vérifiez votre connexion.",
    backToSignIn: "Retour à la connexion",
    wrongCurrentPass: "Mot de passe actuel incorrect.",
  },
};
const DAYS = {
  en:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
  fr:["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"],
};

function fmt(s: number) { return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2); }

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────
function Toasts({ list }: { list: any[] }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      {list.map(t => (
        <div key={t.id} style={{
          display:"flex", alignItems:"center", gap:8, padding:"9px 16px", borderRadius:14,
          fontSize:12, fontWeight:500, backdropFilter:"blur(16px)",
          background: t.type==="success"?"rgba(16,185,129,0.15)":t.type==="error"?"rgba(239,68,68,0.15)":"rgba(249,115,22,0.12)",
          border: `1px solid ${t.type==="success"?"rgba(16,185,129,0.3)":t.type==="error"?"rgba(239,68,68,0.3)":"rgba(249,115,22,0.25)"}`,
          color: t.type==="success"?GREEN:t.type==="error"?RED:ORANGE,
          boxShadow:"0 8px 32px rgba(0,0,0,0.3)",
          animation:"toastIn 0.3s cubic-bezier(0.16,1,0.3,1)",
        }}>
          {t.type==="success"?<CheckCircle2 size={13}/>:<AlertCircle size={13}/>}
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// MOBILE MENU
// ─────────────────────────────────────────────
function MobileMenu({ open, onClose, mode, switchMode, theme, setTheme, lang, setLang, user, setShowCloud, tk, t }: any) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} style={{ background:"rgba(0,0,0,0.4)", backdropFilter:"blur(4px)" }}/>
      <div className="fixed top-0 right-0 bottom-0 z-50 w-64 flex flex-col" style={{
        background: tk.menuBg, borderLeft:`1px solid ${tk.menuB}`,
        boxShadow:"-20px 0 60px rgba(0,0,0,0.4)",
        animation:"menuSlide 0.25s cubic-bezier(0.16,1,0.3,1)",
      }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4" style={{ borderBottom:`1px solid ${tk.divider}` }}>
          <span style={{ fontSize:13, fontWeight:600, letterSpacing:"0.15em", color:tk.muted, textTransform:"uppercase" }}>Menu</span>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer" }}>
            <X size={13}/>
          </button>
        </div>
        <div className="flex flex-col gap-1 px-3 py-4">
          {[["focus",t.focus],["break",t.brk],["stats",t.stats]].map(([m,label]) => (
            <button key={m} onClick={() => { switchMode(m); onClose(); }} style={{
              display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:12,
              background: mode===m?"rgba(249,115,22,0.1)":"transparent",
              border: mode===m?"1px solid rgba(249,115,22,0.2)":"1px solid transparent",
              color: mode===m?ORANGE:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer", textAlign:"left",
            }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background: mode===m?ORANGE:tk.subtle, flexShrink:0 }}/>
              {label}
            </button>
          ))}
        </div>
        <div style={{ borderTop:`1px solid ${tk.divider}`, margin:"0 12px" }}/>
        <div className="flex flex-col gap-2 px-3 py-4">
          <button onClick={() => setLang((l: string) => l==="en"?"fr":"en")} style={{
            display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12,
            background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer",
          }}>
            <Globe size={14}/>{lang==="en"?"Français":"English"}
          </button>
          <button onClick={() => setTheme((x: string) => x==="dark"?"light":"dark")} style={{
            display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12,
            background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer",
          }}>
            {theme==="dark"?<Sun size={14}/>:<Moon size={14}/>}
            {theme==="dark"?"Light mode":"Dark mode"}
          </button>
          <button onClick={() => { setShowCloud(true); onClose(); }} style={{
            display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12,
            background: user?"rgba(16,185,129,0.08)":tk.card,
            border: user?"1px solid rgba(16,185,129,0.2)":`1px solid ${tk.border}`,
            color: user?GREEN:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer",
          }}>
            {user?<Wifi size={14}/>:<Cloud size={14}/>}
            {user ? user.email.split("@")[0] : "Save to Cloud"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// CLOUD MODAL
// ─────────────────────────────────────────────
type CloudView =
  | "signup" | "signin" | "confirm"
  | "forgot" | "confirm-forgot"
  | "reset"  | "user"
  | "change-pass" | "delete";

function CloudModal({
  onClose, t, tk, onAuth, user, token, recoveryToken, lang,
}: {
  onClose: () => void;
  t: typeof T["en"];
  tk: typeof TK["dark"];
  onAuth: (data: any) => void;
  user: { id: string; email: string } | null;
  token: string | null;
  recoveryToken: string | null;
  lang: string;
}) {
  const [view, setView]       = useState<CloudView>(recoveryToken ? "reset" : (user ? "user" : "signup"));
  const [email, setEmail]     = useState("");
  const [pass,  setPass]      = useState("");
  const [pass2, setPass2]     = useState("");
  const [curPass, setCurPass] = useState("");
  const [delConfirm, setDelConfirm] = useState("");
  const [showP,  setShowP]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState("");
  const [ok,      setOk]      = useState("");

  const reset = () => { setEmail(""); setPass(""); setPass2(""); setCurPass(""); setDelConfirm(""); setErr(""); setOk(""); };
  const go = (v: CloudView) => { reset(); setView(v); };

  const strength = Math.min(4, Math.floor(pass.length / 3));

  const apiBase = `${SUPABASE_URL}/auth/v1`;
  const headers = (tok?: string | null) => ({
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${tok || SUPABASE_ANON}`,
  });

  const supaPost = async (path: string, body: object, tok?: string | null) => {
    const r = await fetch(`${apiBase}${path}`, { method:"POST", headers:headers(tok), body:JSON.stringify(body) });
    return r.json();
  };
  const supaPut = async (path: string, body: object, tok: string) => {
    const r = await fetch(`${apiBase}${path}`, { method:"PUT", headers:headers(tok), body:JSON.stringify(body) });
    return r.json();
  };

  const handleSignup = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr(t.invalidEmail); return; }
    if (pass.length < 6) { setErr(t.minChars); return; }
    setErr(""); setLoading(true);
    try {
      // FIX #4 — emailRedirectTo vers le bon domaine
      const data = await supaPost("/signup", { email, password: pass, options: { emailRedirectTo: SITE_URL } });
      if (data.access_token) { onAuth(data); onClose(); return; }
      const msg = data.msg || data.error_description || data.message || "";
      if (msg.toLowerCase().includes("already")) setErr(t.alreadyRegistered);
      else if (data.user?.id || data.id) go("confirm");
      else setErr(msg || t.signUpError);
    } catch { setErr(t.serverError); }
    setLoading(false);
  };

  const handleSignin = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr(t.invalidEmail); return; }
    if (pass.length < 6) { setErr(t.minChars); return; }
    setErr(""); setLoading(true);
    try {
      const data = await supaPost("/token?grant_type=password", { email, password: pass });
      if (data.access_token) { onAuth(data); onClose(); return; }
      const msg = (data.msg || data.error_description || data.message || "").toLowerCase();
      if (msg.includes("not confirmed")) setErr(t.emailNotConfirmed);
      else if (msg.includes("invalid")) setErr(t.invalidCreds);
      else setErr(msg || t.signInError);
    } catch { setErr(t.serverError); }
    setLoading(false);
  };

  const handleForgot = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr(t.invalidEmail); return; }
    setErr(""); setLoading(true);
    try {
      // FIX #4 — emailRedirectTo vers le bon domaine
      await supaPost("/recover", { email, options: { emailRedirectTo: SITE_URL } });
      go("confirm-forgot");
    } catch { setErr(t.serverError); }
    setLoading(false);
  };

  const handleReset = async () => {
    if (pass.length < 6) { setErr(t.minChars); return; }
    if (pass !== pass2)  { setErr(lang === "fr" ? "Les mots de passe ne correspondent pas." : "Passwords don't match."); return; }
    if (!recoveryToken) { setErr(lang === "fr" ? "Lien invalide ou expiré. Recommencez depuis « Mot de passe oublié »." : "Invalid or expired link. Please restart from \"Forgot password\"."); return; }
    setErr(""); setLoading(true);
    try {
      const data = await supaPut("/user", { password: pass }, recoveryToken);
      if (data.id) {
        setOk(lang === "fr" ? "Mot de passe mis à jour !" : "Password updated!");
        setTimeout(() => onClose(), 1800);
      } else {
        setErr(data.msg || data.error_description || (lang === "fr" ? "Erreur" : "Error"));
      }
    } catch { setErr(t.serverError); }
    setLoading(false);
  };

  const handleChangePass = async () => {
    if (pass.length < 6) { setErr(t.minChars); return; }
    if (pass !== pass2)  { setErr(lang === "fr" ? "Les mots de passe ne correspondent pas." : "Passwords don't match."); return; }
    if (!token || !user) { setErr(lang === "fr" ? "Non connecté." : "Not signed in."); return; }
    setErr(""); setLoading(true);
    try {
      const verify = await supaPost("/token?grant_type=password", { email: user.email, password: curPass });
      if (!verify.access_token) {
        setErr(lang === "fr" ? "Mot de passe actuel incorrect." : "Current password is incorrect.");
        setLoading(false);
        return;
      }
      const data = await supaPut("/user", { password: pass }, token);
      if (data.id) { setOk(lang === "fr" ? "Mot de passe mis à jour !" : "Password updated!"); setTimeout(() => go("user"), 1600); }
      else setErr(data.msg || data.error_description || (lang === "fr" ? "Erreur" : "Error"));
    } catch { setErr(t.serverError); }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!token || !user) return;
    setErr(""); setLoading(true);
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "apikey": SUPABASE_ANON,
        },
      });
      const result = await r.json();
      if (!r.ok || result.error) { setErr(result.error || t.serverError); setLoading(false); return; }
      const db = await openDB();
      const tx = db.transaction(["sessions", "kv"], "readwrite");
      tx.objectStore("sessions").clear();
      tx.objectStore("kv").clear();
      onAuth(null);
      onClose();
    } catch { setErr(t.serverError); }
    setLoading(false);
  };

  const meta: Record<CloudView, { icon: React.ReactNode; title: string; sub: string }> = {
    signup: { icon: <Cloud size={14} style={{ color: ORANGE }}/>, title: t.modalTitle, sub: t.modalSub },
    signin: { icon: <User size={14} style={{ color: ORANGE }}/>, title: t.signInTitle, sub: t.signInSub },
    confirm: { icon: <Mail size={14} style={{ color: ORANGE }}/>, title: t.confirmTitle, sub: `${t.confirmBody} ${email}` },
    forgot: { icon: <Mail size={14} style={{ color: ORANGE }}/>, title: lang === "fr" ? "Mot de passe oublié" : "Forgot password", sub: lang === "fr" ? "Entrez votre adresse e-mail." : "Enter your email address." },
    "confirm-forgot": { icon: <Mail size={14} style={{ color: GREEN }}/>, title: lang === "fr" ? "E-mail envoyé" : "Email sent", sub: email },
    reset: { icon: <Lock size={14} style={{ color: ORANGE }}/>, title: lang === "fr" ? "Nouveau mot de passe" : "New password", sub: lang === "fr" ? "Choisissez un mot de passe sécurisé." : "Choose a secure password." },
    user: { icon: <Wifi size={14} style={{ color: GREEN }}/>, title: t.loggedAs, sub: user?.email ?? "" },
    "change-pass": { icon: <Lock size={14} style={{ color: ORANGE }}/>, title: lang === "fr" ? "Changer le mot de passe" : "Change password", sub: lang === "fr" ? "Entrez votre mot de passe actuel." : "Enter your current password." },
    delete: { icon: <AlertCircle size={14} style={{ color: RED }}/>, title: lang === "fr" ? "Supprimer le compte" : "Delete account", sub: lang === "fr" ? "Action irréversible." : "This cannot be undone." },
  };
  const { icon, title, sub } = meta[view];

  const Err = () => err ? (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", borderRadius:10, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", fontSize:12, color:RED }}>
      <AlertCircle size={12}/>{err}
    </div>
  ) : null;

  const Ok = () => ok ? (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", borderRadius:10, background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.2)", fontSize:12, color:GREEN }}>
      <CheckCircle2 size={12}/>{ok}
    </div>
  ) : null;

  const PrimaryBtn = ({ label, onClick, disabled: d }: { label: string; onClick: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={loading || !!d} style={{
      display:"flex", alignItems:"center", justifyContent:"center", gap:8,
      padding:"13px", borderRadius:14, border:"none",
      background:`linear-gradient(140deg,${ORANGE},${RED})`,
      color:"#fff", fontSize:13, fontWeight:600,
      cursor: loading || d ? "not-allowed" : "pointer",
      opacity: loading || d ? 0.45 : 1,
      boxShadow: !d && !loading ? "0 0 28px rgba(249,115,22,0.3)" : "none",
      transition:"all 0.2s", fontFamily:"'Inter',sans-serif",
    }}>
      {loading ? <><Spin/> {lang === "fr" ? "Chargement…" : "Loading…"}</> : <>{label}<ChevronRight size={14}/></>}
    </button>
  );

  const GhostBtn = ({ label, onClick, icon: ic }: { label: string; onClick: () => void; icon?: React.ReactNode }) => (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", justifyContent:"center", gap:7,
      padding:"10px 16px", borderRadius:12, background:tk.card, border:`1px solid ${tk.border}`,
      color:tk.muted, fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"'Inter',sans-serif",
    }}>
      {ic}{label}
    </button>
  );

  const renderBody = () => {
    switch (view) {
      case "signup": return (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <Field label={t.emailLbl} icon={<Mail size={13}/>} tk={tk}>
            <input type="email" value={email} placeholder={t.emailPh}
              onChange={e => { setEmail(e.target.value); setErr(""); }}
              onKeyDown={e => e.key === "Enter" && handleSignup()}
              style={{ width:"100%", background:"transparent", border:"none", outline:"none", fontSize:13, color:tk.text, fontFamily:"'Inter',sans-serif" }}
            />
          </Field>
          <Field label={t.passLbl} icon={<Lock size={13}/>} tk={tk} suffix={
            <button type="button" onClick={() => setShowP(x=>!x)} style={{ color:tk.subtle, cursor:"pointer", lineHeight:0 }}>
              {showP ? <EyeOff size={13}/> : <Eye size={13}/>}
            </button>
          }>
            <input type={showP ? "text" : "password"} value={pass} placeholder={t.passPh}
              onChange={e => { setPass(e.target.value); setErr(""); }}
              onKeyDown={e => e.key === "Enter" && handleSignup()}
              style={{ width:"100%", background:"transparent", border:"none", outline:"none", fontSize:13, color:tk.text, fontFamily:"'Inter',sans-serif" }}
            />
          </Field>
          {pass.length > 0 && (
            <div style={{ display:"flex", gap:3, marginTop:-8 }}>
              {[1,2,3,4].map(i => (
                <div key={i} style={{ height:2, flex:1, borderRadius:4, transition:"background .3s",
                  background: i <= strength ? (strength <= 1 ? RED : strength <= 2 ? ORANGE : GREEN) : tk.border }}/>
              ))}
            </div>
          )}
          <Err/>
          <PrimaryBtn label={t.create} onClick={handleSignup} disabled={!email || !pass}/>
          <p style={{ textAlign:"center", fontSize:11, color:tk.subtle }}>
            {t.haveAcc}{" "}
            <button onClick={() => go("signin")} style={{ color:ORANGE, fontWeight:600, cursor:"pointer", background:"none", border:"none", fontFamily:"inherit" }}>{t.signIn}</button>
          </p>
        </div>
      );

      case "signin": return (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <Field label={t.emailLbl} icon={<Mail size={13}/>} tk={tk}>
            <input type="email" value={email} placeholder={t.emailPh}
              onChange={e => { setEmail(e.target.value); setErr(""); }}
              onKeyDown={e => e.key === "Enter" && handleSignin()}
              style={{ width:"100%", background:"transparent", border:"none", outline:"none", fontSize:13, color:tk.text, fontFamily:"'Inter',sans-serif" }}
            />
          </Field>
          <Field label={t.passLbl} icon={<Lock size={13}/>} tk={tk} suffix={
            <button type="button" onClick={() => setShowP(x=>!x)} style={{ color:tk.subtle, cursor:"pointer", lineHeight:0 }}>
              {showP ? <EyeOff size={13}/> : <Eye size={13}/>}
            </button>
          }>
            <input type={showP ? "text" : "password"} value={pass} placeholder={t.passPh}
              onChange={e => { setPass(e.target.value); setErr(""); }}
              onKeyDown={e => e.key === "Enter" && handleSignin()}
              style={{ width:"100%", background:"transparent", border:"none", outline:"none", fontSize:13, color:tk.text, fontFamily:"'Inter',sans-serif" }}
            />
          </Field>
          <div style={{ textAlign:"right", marginTop:-8 }}>
            <button onClick={() => go("forgot")} style={{ color:tk.subtle, fontSize:11, cursor:"pointer", background:"none", border:"none", fontFamily:"inherit" }}>
              {lang === "fr" ? "Mot de passe oublié ?" : "Forgot password?"}
            </button>
          </div>
          <Err/>
          <PrimaryBtn label={t.signInBtn} onClick={handleSignin} disabled={!email || !pass}/>
          <p style={{ textAlign:"center", fontSize:11, color:tk.subtle }}>
            {t.noAcc}{" "}
            <button onClick={() => go("signup")} style={{ color:ORANGE, fontWeight:600, cursor:"pointer", background:"none", border:"none", fontFamily:"inherit" }}>{t.signUp}</button>
          </p>
        </div>
      );

      case "confirm": return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:18, padding:"24px 0 8px", textAlign:"center" }}>
          <div style={{ width:52, height:52, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(249,115,22,0.1)", border:"1px solid rgba(249,115,22,0.2)" }}>
            <Mail size={22} style={{ color:ORANGE }}/>
          </div>
          <div>
            <div style={{ fontSize:14, fontWeight:600, color:tk.text }}>{t.confirmTitle}</div>
            <div style={{ fontSize:12, color:tk.muted, marginTop:6, lineHeight:1.6 }}>
              {t.confirmBody} <strong style={{ color:tk.text }}>{email}</strong>
            </div>
          </div>
          <GhostBtn label={t.backToSignIn} onClick={() => go("signin")} icon={<ArrowLeft size={12}/>}/>
        </div>
      );

      case "forgot": return (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={{ padding:"12px", borderRadius:12, background:"rgba(249,115,22,0.06)", border:"1px solid rgba(249,115,22,0.14)", fontSize:12, color:"rgba(249,115,22,.8)", lineHeight:1.7 }}>
            {lang === "fr"
              ? "Entrez votre adresse e-mail. Nous vous enverrons un lien pour réinitialiser votre mot de passe."
              : "Enter your email address. We'll send you a reset link."}
          </div>
          <Field label={t.emailLbl} icon={<Mail size={13}/>} tk={tk}>
            <input type="email" value={email} placeholder={t.emailPh}
              onChange={e => { setEmail(e.target.value); setErr(""); }}
              onKeyDown={e => e.key === "Enter" && handleForgot()}
              style={{ width:"100%", background:"transparent", border:"none", outline:"none", fontSize:13, color:tk.text, fontFamily:"'Inter',sans-serif" }}
            />
          </Field>
          <Err/>
          <PrimaryBtn label={lang === "fr" ? "Envoyer le lien" : "Send reset link"} onClick={handleForgot} disabled={!email}/>
          <GhostBtn label={t.backToSignIn} onClick={() => go("signin")} icon={<ArrowLeft size={12}/>}/>
        </div>
      );

      case "confirm-forgot": return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:18, padding:"24px 0 8px", textAlign:"center" }}>
          <div style={{ width:52, height:52, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.25)" }}>
            <Mail size={22} style={{ color:GREEN }}/>
          </div>
          <div>
            <div style={{ fontSize:14, fontWeight:600, color:tk.text }}>
              {lang === "fr" ? "E-mail envoyé !" : "Email sent!"}
            </div>
            <div style={{ fontSize:12, color:tk.muted, marginTop:6, lineHeight:1.6 }}>
              {lang === "fr"
                ? <><strong style={{ color:tk.text }}>{email}</strong> — vérifiez et cliquez sur le lien.</>
                : <>Check <strong style={{ color:tk.text }}>{email}</strong> and click the link.</>}
            </div>
          </div>
          <GhostBtn label={t.backToSignIn} onClick={() => go("signin")} icon={<ArrowLeft size={12}/>}/>
        </div>
      );

      case "reset": return (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {!recoveryToken && (
            <div style={{ padding:"12px", borderRadius:12, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", fontSize:12, color:RED, lineHeight:1.7 }}>
              {lang === "fr"
                ? "Lien invalide ou expiré. Recommencez la procédure depuis « Mot de passe oublié »."
                : "Invalid or expired link. Please restart from \"Forgot password\"."}
            </div>
          )}
          <PasswordField label={lang === "fr" ? "Nouveau mot de passe" : "New password"} val={pass} onChange={(v: string) => { setPass(v); setErr(""); }} tk={tk} onEnter={handleReset}/>
          <PasswordField label={lang === "fr" ? "Confirmer" : "Confirm password"} val={pass2} onChange={(v: string) => { setPass2(v); setErr(""); }} tk={tk} onEnter={handleReset}/>
          {pass.length > 0 && (
            <div style={{ display:"flex", gap:3, marginTop:-8 }}>
              {[1,2,3,4].map(i => (
                <div key={i} style={{ height:2, flex:1, borderRadius:4, transition:"background .3s",
                  background: i <= strength ? (strength <= 1 ? RED : strength <= 2 ? ORANGE : GREEN) : tk.border }}/>
              ))}
            </div>
          )}
          <Err/><Ok/>
          <PrimaryBtn label={lang === "fr" ? "Changer le mot de passe" : "Update password"} onClick={handleReset} disabled={!pass || !pass2 || !recoveryToken}/>
        </div>
      );

      case "user": return (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, paddingBottom:4 }}>
            <div style={{ width:52, height:52, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.25)" }}>
              <User size={24} style={{ color:GREEN }}/>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:13, fontWeight:600, color:tk.text }}>{user?.email}</div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:4, marginTop:5, fontSize:10, color:GREEN }}>
                <Wifi size={9}/>{lang === "fr" ? "Synchronisé" : "Synced"}
              </div>
            </div>
          </div>
          <div style={{ height:1, background:tk.divider }}/>
          <button onClick={() => go("change-pass")} style={{
            display:"flex", alignItems:"center", gap:10, padding:"11px 14px", borderRadius:12,
            background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"inherit",
          }}>
            <Lock size={13}/>{lang === "fr" ? "Changer le mot de passe" : "Change password"}
          </button>
          <button onClick={() => go("delete")} style={{
            display:"flex", alignItems:"center", gap:10, padding:"11px 14px", borderRadius:12,
            background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.18)", color:RED,
            fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"inherit",
          }}>
            <AlertCircle size={13}/>{lang === "fr" ? "Supprimer mon compte" : "Delete account"}
          </button>
          <button onClick={() => { onAuth(null); onClose(); }} style={{
            display:"flex", alignItems:"center", gap:10, padding:"11px 14px", borderRadius:12,
            background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"inherit",
          }}>
            <LogOut size={13}/>{t.logout}
          </button>
        </div>
      );

      case "change-pass": return (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <PasswordField label={lang === "fr" ? "Mot de passe actuel" : "Current password"} val={curPass} onChange={(v: string) => { setCurPass(v); setErr(""); }} tk={tk}/>
          <PasswordField label={lang === "fr" ? "Nouveau mot de passe" : "New password"} val={pass} onChange={(v: string) => { setPass(v); setErr(""); }} tk={tk} onEnter={handleChangePass}/>
          <PasswordField label={lang === "fr" ? "Confirmer" : "Confirm"} val={pass2} onChange={(v: string) => { setPass2(v); setErr(""); }} tk={tk} onEnter={handleChangePass}/>
          {pass.length > 0 && (
            <div style={{ display:"flex", gap:3, marginTop:-8 }}>
              {[1,2,3,4].map(i => (
                <div key={i} style={{ height:2, flex:1, borderRadius:4, transition:"background .3s",
                  background: i <= strength ? (strength <= 1 ? RED : strength <= 2 ? ORANGE : GREEN) : tk.border }}/>
              ))}
            </div>
          )}
          <Err/><Ok/>
          <PrimaryBtn label={lang === "fr" ? "Mettre à jour" : "Update"} onClick={handleChangePass} disabled={!curPass || !pass || !pass2}/>
          <GhostBtn label={lang === "fr" ? "Retour" : "Back"} onClick={() => go("user")} icon={<ArrowLeft size={12}/>}/>
        </div>
      );

      case "delete": return (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ padding:16, borderRadius:14, background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.18)", display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <AlertCircle size={16} style={{ color:RED, flexShrink:0 }}/>
              <span style={{ fontSize:13, fontWeight:600, color:RED }}>
                {lang === "fr" ? "Suppression définitive" : "Permanent deletion"}
              </span>
            </div>
            <p style={{ fontSize:12, color:tk.muted, lineHeight:1.75 }}>
              {lang === "fr"
                ? <><strong style={{ color:RED }}>Irréversible</strong>. Toutes vos sessions et données cloud seront effacées.</>
                : <><strong style={{ color:RED }}>Irreversible</strong>. All sessions, stats, and cloud data will be permanently erased.</>}
            </p>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <label style={{ fontSize:11, color:"rgba(239,68,68,0.7)" }}>
                {lang === "fr" ? 'Tapez "supprimer" pour confirmer' : 'Type "delete" to confirm'}
              </label>
              <input type="text" value={delConfirm} onChange={e => setDelConfirm(e.target.value)}
                placeholder={lang === "fr" ? "supprimer" : "delete"}
                style={{ padding:"9px 12px", borderRadius:10, border:"1px solid rgba(239,68,68,0.25)", background:"rgba(239,68,68,0.05)", color:tk.text, fontSize:12, fontFamily:"'Inter',sans-serif", outline:"none" }}
              />
            </div>
            <button onClick={handleDelete} disabled={loading || delConfirm.toLowerCase() !== (lang === "fr" ? "supprimer" : "delete")} style={{
              display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"11px", borderRadius:12, border:"none",
              background:RED, color:"#fff", fontSize:12, fontWeight:600,
              cursor: loading || delConfirm.toLowerCase() !== (lang === "fr" ? "supprimer" : "delete") ? "not-allowed" : "pointer",
              opacity: loading || delConfirm.toLowerCase() !== (lang === "fr" ? "supprimer" : "delete") ? 0.35 : 1,
              transition:"all .2s", fontFamily:"'Inter',sans-serif",
            }}>
              {loading ? <><Spin/> {lang === "fr" ? "Suppression…" : "Deleting…"}</> : <>{lang === "fr" ? "Supprimer définitivement" : "Delete permanently"}</>}
            </button>
          </div>
          <Err/>
          <GhostBtn label={lang === "fr" ? "Annuler" : "Cancel"} onClick={() => go("user")} icon={<ArrowLeft size={12}/>}/>
        </div>
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: tk.overlay }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:"100%", maxWidth:420, borderRadius:22, overflow:"hidden", background:tk.modalBg, border:`1px solid ${tk.modalB}`, backdropFilter:"blur(24px)", boxShadow:"0 40px 80px rgba(0,0,0,0.55)", animation:"modalIn 0.25s cubic-bezier(0.16,1,0.3,1)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 22px 14px", borderBottom:`1px solid ${tk.divider}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:34, height:34, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(249,115,22,0.1)", border:"1px solid rgba(249,115,22,0.18)" }}>{icon}</div>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:tk.text }}>{title}</div>
              <div style={{ fontSize:11, color:tk.muted, marginTop:2, maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sub}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer" }}>
            <X size={13}/>
          </button>
        </div>
        <div style={{ padding:"22px 22px 24px" }}>{renderBody()}</div>
      </div>
    </div>
  );
}

function Field({ label, icon, suffix, children, tk }: any) {
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

function PasswordField({ label, val, onChange, tk, onEnter, placeholder = "••••••••" }: any) {
  const [vis, setVis] = useState(false);
  return (
    <Field label={label} icon={<Lock size={13}/>} tk={tk} suffix={
      <button type="button" onClick={() => setVis((x: boolean) => !x)} style={{ color:tk.subtle, cursor:"pointer", lineHeight:0 }}>
        {vis ? <EyeOff size={13}/> : <Eye size={13}/>}
      </button>
    }>
      <input type={vis ? "text" : "password"} value={val} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && onEnter) onEnter(); }}
        style={{ width:"100%", background:"transparent", border:"none", outline:"none", fontSize:13, color:tk.text, fontFamily:"'Inter',sans-serif" }}
      />
    </Field>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [mode,          setMode]          = useState("focus");
  const [timeLeft,      setTimeLeft]      = useState(FOCUS_DUR);
  const [isRunning,     setIsRunning]     = useState(false);
  const [task,          setTask]          = useState("");
  const [taskTouched,   setTaskTouched]   = useState(false);
  const [activeSound,   setActiveSound]   = useState<string | null>(null);
  const [volume,        setVolume]        = useState(0.6);
  // FIX #1 — theme par défaut = "light"
  const [theme,         setTheme]         = useState("light");
  const [lang,          setLang]          = useState("en");
  const [isImmersive,   setIsImmersive]   = useState(false);
  const [menuOpen,      setMenuOpen]      = useState(false);
  const [showCloud,     setShowCloud]     = useState(false);
  const [statsReady,    setStatsReady]    = useState(false);
  const [toasts,        setToasts]        = useState<any[]>([]);
  const [user,          setUser]          = useState<{ id: string; email: string } | null>(null);
  const [token,         setToken]         = useState<string | null>(null);
  const [localSess,     setLocalSess]     = useState<any[]>([]);
  const [cloudSess,     setCloudSess]     = useState<any[]>([]);
  const [syncing,       setSyncing]       = useState(false);
  const [streak,        setStreak]        = useState(0);
  const [resetToken,    setResetToken]    = useState<string | null>(null);

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskRef     = useRef<HTMLInputElement | null>(null);
  const startRef    = useRef<number | null>(null);

  const tk = TK[theme as keyof typeof TK];
  const t  = T[lang as keyof typeof T];
  const taskValid  = task.trim().length > 0;
  const isBreak    = mode === "break";

  // ── Boot: load from IndexedDB
  useEffect(() => {
    (async () => {
      const [th, lg, vl, tk2, usr, sessions] = await Promise.all([
        idb.getKV("theme"), idb.getKV("lang"), idb.getKV("volume"),
        idb.getKV("sb_token"), idb.getKV("sb_user"),
        idb.allSessions(),
      ]);
      // FIX #1 — on charge le thème sauvegardé, sinon "light" par défaut
      if (th) setTheme(th); // si pas de thème stocké, reste "light" (valeur initiale)
      if (lg) setLang(lg);
      if (vl) setVolume(vl);
      if (tk2 && usr) { setToken(tk2); setUser(usr); }
      setLocalSess(sessions);
      const days = new Set(sessions.filter((s: any) => s.status==="completed").map((s: any) => s.completed_at?.slice(0,10)));
      let s=0; const today=new Date();
      for (let i=0;i<30;i++) {
        const d=new Date(today); d.setDate(d.getDate()-i);
        if (days.has(d.toISOString().slice(0,10))) s++; else if (i>0) break;
      }
      setStreak(s);
    })();
  }, []);

  // ── Détecte le lien de récupération de mot de passe
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      const params = new URLSearchParams(hash.slice(1));
      const at = params.get("access_token");
      if (at) {
        setResetToken(at);
        setShowCloud(true);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
  }, []);

  // ── Persist settings
  useEffect(() => { idb.setKV("theme",theme); }, [theme]);
  useEffect(() => { idb.setKV("lang",lang);   }, [lang]);
  useEffect(() => { idb.setKV("volume",volume); audio.setVolume(volume); }, [volume]);

  // ── Fetch cloud sessions on login
  useEffect(() => {
    if (!user || !token) { setCloudSess([]); return; }
    sb.getSessions(token, user.id).then((d: any) => { if (Array.isArray(d)) setCloudSess(d); });
  }, [user, token]);

  // ── Timer
  const clearTimer = () => { if (timerRef.current) clearInterval(timerRef.current); };
  const resetTimer = useCallback((m: string) => {
    clearTimer(); setIsRunning(false); setIsImmersive(false);
    setTimeLeft(m==="break"?BREAK_DUR:FOCUS_DUR);
  }, []);

  useEffect(() => {
    clearTimer();
    if (isRunning) {
      startRef.current = startRef.current || Date.now();
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearTimer(); setIsRunning(false); setIsImmersive(false);
            if (mode==="focus") {
              finishSession("completed");
              setMode("break"); return BREAK_DUR;
            } else {
              setMode("focus"); return FOCUS_DUR;
            }
          }
          return prev-1;
        });
      }, 1000);
    } else { startRef.current = null; }
    return clearTimer;
  }, [isRunning, mode]);

  // ── Esc key
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key==="Escape"&&isImmersive) setIsImmersive(false); };
    window.addEventListener("keydown",h);
    return () => window.removeEventListener("keydown",h);
  }, [isImmersive]);

  // ── Toast
  const toast = useCallback((msg: string, type="info") => {
    const id = uid();
    setToasts(p => [...p, {id,msg,type}]);
    setTimeout(() => setToasts(p=>p.filter((x: any)=>x.id!==id)), 3200);
  }, []);

  // ── Finish session
  const finishSession = async (status: string) => {
    const elapsed = startRef.current ? Math.round((Date.now()-startRef.current)/60000) : 25;
    const sess = {
      id:               uid(),
      task_title:       task.trim() || "Session",
      duration_minutes: status==="completed"?25:Math.max(1,elapsed),
      status,
      completed_at:     new Date().toISOString(),
    };
    await idb.saveSession(sess);
    const updated = await idb.allSessions();
    setLocalSess(updated);
    const days = new Set(updated.filter((s: any)=>s.status==="completed").map((s: any)=>s.completed_at?.slice(0,10)));
    let sk=0; const today=new Date();
    for (let i=0;i<30;i++) {
      const d=new Date(today); d.setDate(d.getDate()-i);
      if (days.has(d.toISOString().slice(0,10))) sk++; else if (i>0) break;
    }
    setStreak(sk);
    if (user && token) {
      try {
        await sb.upsertSession(token, {...sess, user_id:user.id});
        const cloud = await sb.getSessions(token, user.id);
        if (Array.isArray(cloud)) setCloudSess(cloud);
        toast(t.synced,"success");
      } catch(_) {}
    }
  };

  // ── Auth
  const handleAuth = async (data: any) => {
    if (!data) {
      if (token) sb.signOut(token).catch(()=>{});
      setUser(null); setToken(null); setCloudSess([]);
      await idb.setKV("sb_token",null); await idb.setKV("sb_user",null);
      toast("Déconnecté","info"); return;
    }
    const tk2  = data.access_token;
    const usr  = { id:data.user.id, email:data.user.email };
    setToken(tk2); setUser(usr);
    await idb.setKV("sb_token",tk2); await idb.setKV("sb_user",usr);
    setSyncing(true); toast(t.syncing,"info");
    try {
      await sb.upsertSettings(tk2, { user_id:usr.id, theme, focus_duration:25, short_break:5, long_break:15 });
      const cloud = await sb.getSessions(tk2, usr.id);
      if (Array.isArray(cloud)) setCloudSess(cloud);
      for (const s of localSess.slice(0,20)) {
        await sb.upsertSession(tk2, {...s, user_id:usr.id}).catch(()=>{});
      }
      toast(t.synced,"success");
    } catch(_) { toast("Erreur de sync","error"); }
    setSyncing(false);
  };

  // ── Sound
  const toggleSound = (id: string | null) => {
    if (id === null) { audio.stop(); setActiveSound(null); return; }
    if (activeSound===id) { audio.stop(); setActiveSound(null); }
    else { audio.play(id); audio.setVolume(volume); setActiveSound(id); }
  };

  // ── Start/pause + FIX #3 — Abandoned quand on arrête un timer en cours
  const handlePlay = () => {
    if (!isRunning && !taskValid && mode==="focus") {
      setTaskTouched(true); taskRef.current?.focus(); return;
    }
    if (isRunning) {
      // FIX #3 — on arrête le timer → on enregistre "abandoned" si focus et > 0s écoulées
      if (mode === "focus" && startRef.current) {
        finishSession("abandoned");
      }
      setIsRunning(false);
      setIsImmersive(false);
    } else {
      setIsRunning(true);
      if (mode==="focus") setIsImmersive(true);
    }
  };

  const switchMode = (m: string) => {
    // FIX #3 — si on change de mode avec le timer en cours → abandoned
    if (isRunning && mode === "focus" && m !== "focus" && startRef.current) {
      finishSession("abandoned");
    }
    if (m==="stats") {
      setStatsReady(false); setTimeout(()=>setStatsReady(true),20);
      setMode("stats"); clearTimer(); setIsRunning(false); setIsImmersive(false);
    } else {
      setMode(m); resetTimer(m); setStatsReady(false);
    }
  };

  // Progress
  const totalDur   = mode==="break"?BREAK_DUR:FOCUS_DUR;
  const progress   = 1-timeLeft/totalDur;
  const focusOff   = RING_C*(1-progress);
  const breakOff   = BREAK_C*(1-progress);

  const dimStyle = () => isImmersive
    ? { opacity:0.12, pointerEvents:"none" as const, transition:"opacity 0.7s ease" }
    : { opacity:1,    pointerEvents:"auto" as const,  transition:"opacity 0.7s ease" };

  // Analytics data
  const allSess = [
    ...localSess.map((s: any)=>({...s,src:"local"})),
    ...cloudSess.filter((c: any)=>!localSess.some((l: any)=>l.id===c.id)).map((s: any)=>({...s,src:"cloud"})),
  ].sort((a,b)=>new Date(b.completed_at).getTime()-new Date(a.completed_at).getTime());

  const completedN  = allSess.filter((s: any)=>s.status==="completed").length;
  const totalN      = allSess.length;
  const totalMins   = allSess.reduce((a: number,s: any)=>a+(s.duration_minutes||0),0);
  const compRate    = totalN>0 ? Math.round(completedN/totalN*100) : 0;
  const donutData   = totalN>0
    ? [{name:"c",value:compRate},{name:"a",value:100-compRate}]
    : [{name:"c",value:0},{name:"a",value:100}];

  const weeklyMap: Record<string, number> = {};
  allSess.forEach((s: any) => {
    const d = s.completed_at?.slice(0,10);
    if (!d) return;
    weeklyMap[d] = (weeklyMap[d]||0)+(s.duration_minutes||0);
  });
  const days_arr = DAYS[lang as keyof typeof DAYS];
  const chartData = days_arr.map((day: string, i: number) => {
    const d = new Date(); d.setDate(d.getDate()-6+i);
    const key = d.toISOString().slice(0,10);
    return { day, minutes: weeklyMap[key]||0 };
  });
  const chartHasData = chartData.some((c: any)=>c.minutes>0);

  // ── FIX #2 : couleurs du TaskInput adaptées au thème
  const taskInputTextColor = theme === "light"
    ? (task ? "#0f172a" : "#94a3b8")
    : (task ? "#fafafa" : "rgba(255,255,255,0.3)");
  const taskInputBorderColor = theme === "light" ? "#cbd5e1" : "rgba(255,255,255,0.1)";
  const taskInputFocusBorderColor = "rgba(249,115,22,0.55)";
  const taskInputErrorBorderColor = "#ef4444";

  return (
    <div style={{ minHeight:"100vh", width:"100%", background:tk.bg, fontFamily:"'Inter',sans-serif", display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>
      <style>{`
        @keyframes toastIn   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes modalIn   { from{opacity:0;transform:translateY(18px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
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
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15);border-radius:2px}
        .nav-pills{ display:none }
        .nav-right{ display:none }
        .nav-burger{ display:flex }
        @media(min-width:768px){
          .nav-pills{ display:flex }
          .nav-right{ display:flex }
          .nav-burger{ display:none !important }
        }
      `}</style>

      {/* Subtle grid — dark only */}
      {theme==="dark" && (
        <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", opacity:0.015,
          backgroundImage:"linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)",
          backgroundSize:"48px 48px" }}/>
      )}

      {/* ── NAV ── */}
      <nav style={{
        ...dimStyle(),
        position:"relative", zIndex:20,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"18px 24px", maxWidth:960, margin:"0 auto", width:"100%",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{
            width:8, height:8, borderRadius:"50%",
            background: isBreak?`radial-gradient(circle,${GREEN},rgba(16,185,129,0.3))`:`radial-gradient(circle,${ORANGE},rgba(249,115,22,0.3))`,
            boxShadow: isBreak?`0 0 8px rgba(16,185,129,0.8),0 0 18px rgba(16,185,129,0.2)`:`0 0 8px rgba(249,115,22,0.8),0 0 18px rgba(249,115,22,0.2)`,
            animation:"pulse 3s ease-in-out infinite",
          }}/>
          <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.24em", textTransform:"uppercase", color:tk.muted }}>{t.app}</span>
          {streak>0 && (
            <div style={{ display:"flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:20, background:"rgba(249,115,22,0.08)", border:"1px solid rgba(249,115,22,0.15)" }}>
              <Flame size={9} style={{ color:ORANGE }}/><span style={{ fontSize:10, fontWeight:600, color:ORANGE }}>{streak}</span>
            </div>
          )}
        </div>

        <div className="nav-pills" style={{ alignItems:"center", gap:4, borderRadius:99, padding:4, background:tk.pill, border:`1px solid ${tk.pillB}` }}>
          {[["focus",t.focus],["break",t.brk],["stats",t.stats]].map(([m,label])=>{
            const active=mode===m;
            return (
              <button key={m} onClick={() => switchMode(m)} style={{
                padding:"7px 16px", borderRadius:99, fontSize:11, fontWeight:500, letterSpacing:"0.1em", textTransform:"uppercase",
                background: active?(theme==="dark"?"rgba(255,255,255,0.09)":"rgba(255,255,255,0.9)"):"transparent",
                color: active?tk.text:tk.muted,
                border: active?`1px solid ${tk.border}`:"1px solid transparent",
                cursor:"pointer", transition:"all 0.2s",
                boxShadow: active&&theme==="light"?"0 1px 4px rgba(0,0,0,0.08)":"none",
              }}>
                {label}
              </button>
            );
          })}
        </div>

        <div className="nav-right" style={{ alignItems:"center", gap:8 }}>
          {user && (
            <button onClick={() => setShowCloud(true)} style={{
              display:"flex", alignItems:"center", gap:6, padding:"6px 10px", borderRadius:10,
              background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.2)",
              color:GREEN, fontSize:11, fontWeight:500, cursor:"pointer",
            }}>
              <Wifi size={11}/><span style={{ maxWidth:70, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.email.split("@")[0]}</span>
            </button>
          )}
          <button onClick={() => setLang((l: string)=>l==="en"?"fr":"en")} style={{
            display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:10,
            background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:11, fontWeight:600, cursor:"pointer",
          }}>
            <Globe size={11}/>{lang.toUpperCase()}
          </button>
          <button onClick={() => setTheme((x: string)=>x==="dark"?"light":"dark")} style={{
            width:32, height:32, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center",
            background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer",
          }}>
            {theme==="dark"?<Sun size={13}/>:<Moon size={13}/>}
          </button>
          {!user && (
            <button onClick={() => setShowCloud(true)} style={{
              display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:10,
              background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:11, fontWeight:500, cursor:"pointer",
            }}>
              <Cloud size={11}/>Cloud
            </button>
          )}
        </div>

        <button className="nav-burger" onClick={() => setMenuOpen(true)} style={{
          width:36, height:36, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center",
          background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer",
        }}>
          <Menu size={16}/>
        </button>
      </nav>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)}
        mode={mode} switchMode={switchMode} theme={theme} setTheme={setTheme}
        lang={lang} setLang={setLang} user={user} setShowCloud={setShowCloud} tk={tk} t={t}/>

      {isImmersive && (
        <div style={{
          position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", zIndex:30,
          display:"flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:99,
          background:"rgba(0,0,0,0.6)", border:"1px solid rgba(255,255,255,0.08)",
          backdropFilter:"blur(12px)", color:"rgba(255,255,255,0.4)", fontSize:11,
          animation:"fadeIn 0.5s ease",
        }}>
          <Minimize2 size={11}/>{t.escHint}
        </div>
      )}

      {/* ══════════ FOCUS ══════════ */}
      {mode==="focus" && (
        <main style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:32, padding:"0 24px 40px" }}>

          {/* FIX #2 — Task input mis en évidence */}
          <div style={{ ...dimStyle(), width:"100%", maxWidth:360, display:"flex", flexDirection:"column", gap:6 }}>
            {/* Label visible */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:4 }}>
              <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.25em", textTransform:"uppercase", color: ORANGE, opacity:0.8 }}>
                {lang === "fr" ? "Votre tâche" : "Your task"}
              </span>
            </div>
            {/* Conteneur mis en évidence */}
            <div style={{
              borderRadius:16,
              padding:"14px 18px",
              background: theme === "light" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.04)",
              border: `1.5px solid ${taskTouched && !taskValid ? "#ef4444" : theme === "light" ? "#e2e8f0" : "rgba(255,255,255,0.12)"}`,
              boxShadow: theme === "light"
                ? "0 2px 16px rgba(249,115,22,0.08), 0 1px 4px rgba(0,0,0,0.06)"
                : "0 0 0 1px rgba(249,115,22,0.08)",
              transition:"border-color 0.2s, box-shadow 0.2s",
            }}>
              <input
                ref={taskRef}
                type="text"
                value={task}
                onChange={e => { setTask(e.target.value); setTaskTouched(false); }}
                onBlur={() => setTaskTouched(true)}
                placeholder={t.placeholder}
                onFocus={e => {
                  (e.target.closest("div") as HTMLElement)!.style.borderColor = taskInputFocusBorderColor;
                  (e.target.closest("div") as HTMLElement)!.style.boxShadow = theme === "light"
                    ? "0 0 0 3px rgba(249,115,22,0.12), 0 2px 16px rgba(249,115,22,0.1)"
                    : "0 0 0 2px rgba(249,115,22,0.25)";
                }}
                onBlurCapture={e => {
                  setTaskTouched(true);
                  const c = taskTouched && !task.trim();
                  (e.target.closest("div") as HTMLElement)!.style.borderColor = c
                    ? "#ef4444"
                    : theme === "light" ? "#e2e8f0" : "rgba(255,255,255,0.12)";
                  (e.target.closest("div") as HTMLElement)!.style.boxShadow = theme === "light"
                    ? "0 2px 16px rgba(249,115,22,0.08), 0 1px 4px rgba(0,0,0,0.06)"
                    : "0 0 0 1px rgba(249,115,22,0.08)";
                }}
                style={{
                  width:"100%",
                  background:"transparent",
                  border:"none",
                  outline:"none",
                  textAlign:"center",
                  fontSize:14,
                  fontWeight:500,
                  color: taskInputTextColor,
                  fontFamily:"'Inter',sans-serif",
                  letterSpacing:"0.01em",
                  caretColor:ORANGE,
                }}
              />
            </div>
            {/* Message d'erreur */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:5, marginTop:2, opacity: taskTouched && !taskValid ? 1 : 0, height:16, transition:"opacity 0.2s" }}>
              <AlertCircle size={10} style={{ color:"#ef4444" }}/>
              <span style={{ fontSize:10, color:"#ef4444" }}>{t.hint}</span>
            </div>
          </div>

          {/* Timer ring */}
          <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center", userSelect:"none", cursor: isImmersive?"pointer":"default" }}
            onClick={() => isImmersive && setIsImmersive(false)}>
            <svg width="340" height="340" style={{ position:"absolute", transform:"rotate(-90deg)", opacity: isImmersive?0.3:0.5, transition:"opacity 0.7s" }}>
              <circle cx="170" cy="170" r="160" fill="none" stroke={theme==="dark"?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.04)"} strokeWidth="1" strokeDasharray="2 10"/>
            </svg>
            <svg width="300" height="300" style={{ transform:"rotate(-90deg)", animation: isRunning?"ringPulse 3s ease-in-out infinite":"none" }}>
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
            <div style={{ position:"absolute", display:"flex", flexDirection:"column", alignItems:"center", gap:8, animation: isRunning&&isImmersive?"breathe 4s ease-in-out infinite":"none" }}>
              <span style={{
                fontFamily:"'JetBrains Mono',monospace",
                fontSize: isImmersive?"clamp(3.8rem,14vw,5.5rem)":"clamp(3.2rem,11vw,4.6rem)",
                fontWeight:700, letterSpacing:"-0.03em", color:tk.text, lineHeight:1,
                textShadow: isRunning?"0 0 50px rgba(249,115,22,0.18)":"none",
                transition:"font-size 0.5s ease, text-shadow 0.5s",
              }}>{fmt(timeLeft)}</span>
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.38em", textTransform:"uppercase", color: isRunning?`rgba(249,115,22,0.7)`:tk.subtle, transition:"color 0.4s" }}>
                {isRunning?t.focusing:t.ready}
              </span>
              {isImmersive && <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)", marginTop:4 }}>{t.exitHint}</span>}
            </div>
          </div>

          {/* Controls */}
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <CtrlBtn onClick={()=>resetTimer("focus")} tk={tk}><RotateCcw size={15}/></CtrlBtn>
            <button onClick={handlePlay} style={{
              width:72, height:72, borderRadius:"50%",
              display:"flex", alignItems:"center", justifyContent:"center",
              background: taskValid||isRunning?`linear-gradient(140deg,${ORANGE},${RED})`:(theme==="dark"?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)"),
              border: !taskValid&&!isRunning?`1px solid ${tk.border}`:"none",
              boxShadow: taskValid||isRunning?"0 0 0 1px rgba(249,115,22,0.25),0 0 32px rgba(249,115,22,0.4),0 0 64px rgba(249,115,22,0.1)":"none",
              color: taskValid||isRunning?"#09090b":tk.subtle,
              cursor:"pointer", transition:"all 0.25s cubic-bezier(0.16,1,0.3,1)",
              position:"relative", flexShrink:0,
            }}>
              {isRunning
                ? <Pause  size={22} fill={taskValid||isRunning?"#09090b":tk.subtle}/>
                : <Play   size={22} fill={taskValid||isRunning?"#09090b":tk.subtle}/>
              }
              {isRunning && <span style={{ position:"absolute", inset:0, borderRadius:"50%", boxShadow:"0 0 0 8px rgba(249,115,22,0.08)", animation:"pulse 2s ease-in-out infinite" }}/>}
            </button>
            <CtrlBtn onClick={()=>switchMode("break")} tk={tk}>
              <span style={{ fontSize:10, fontWeight:600, fontFamily:"'JetBrains Mono',monospace" }}>5m</span>
            </CtrlBtn>
          </div>

          {/* Soundscape + Cloud nudge */}
          <div style={{ ...dimStyle(), width:"100%", maxWidth:360, display:"flex", flexDirection:"column", gap:10 }}>
            <SoundCard activeSound={activeSound} toggleSound={toggleSound} volume={volume} setVolume={setVolume} tk={tk} t={t}/>
            <button onClick={()=>setShowCloud(true)} style={{
              width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"12px 16px", borderRadius:14,
              background:tk.card, border:`1px solid ${tk.border}`,
              cursor:"pointer", transition:"all 0.2s",
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                {user?<Wifi size={13} style={{color:GREEN}}/>:<Cloud size={13} style={{color:ORANGE}}/>}
                <span style={{ fontSize:12, color:tk.muted }}>{user?`${t.loggedAs} ${user.email}`:t.cloudBanner}</span>
              </div>
              <ChevronRight size={13} style={{ color:tk.subtle, flexShrink:0 }}/>
            </button>
          </div>
        </main>
      )}

      {/* ══════════ BREAK ══════════ */}
      {mode==="break" && (
        <main style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:32, padding:"0 24px 48px" }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.4em", textTransform:"uppercase", color:"rgba(16,185,129,0.6)" }}>{t.breakLabel}</span>
          <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="260" height="260" style={{ transform:"rotate(-90deg)", animation: isRunning?"ringPulseG 3s ease-in-out infinite":"none" }}>
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
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.38em", textTransform:"uppercase", color: isRunning?"rgba(16,185,129,0.7)":tk.subtle }}>
                {isRunning?t.resting:t.paused}
              </span>
            </div>
          </div>
          <div style={{ width:"100%", maxWidth:340, borderRadius:20, padding:24, background: theme==="dark"?"rgba(16,185,129,0.04)":"rgba(16,185,129,0.03)", border:"1px solid rgba(16,185,129,0.15)", display:"flex", flexDirection:"column", gap:18 }}>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:GREEN, boxShadow:"0 0 8px rgba(16,185,129,0.8)" }}/>
                <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.3em", textTransform:"uppercase", color:"rgba(16,185,129,0.6)" }}>{t.breakTag}</span>
              </div>
              <p style={{ fontSize:13, color:tk.muted, lineHeight:1.8 }}>{t.breakCopy}</p>
            </div>
            <a href="#" style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"14px", borderRadius:14, textDecoration:"none", background:`linear-gradient(135deg,${GREEN},#059669)`, color:"#f0fdf4", fontSize:13, fontWeight:600, boxShadow:"0 0 0 1px rgba(16,185,129,0.25),0 0 28px rgba(16,185,129,0.25)", transition:"transform 0.2s" }}>
              {t.portfolio}<ExternalLink size={13}/>
            </a>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <CtrlBtn onClick={()=>resetTimer("break")} tk={tk}><RotateCcw size={15}/></CtrlBtn>
            <button onClick={()=>setIsRunning(r=>!r)} style={{ width:64, height:64, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:`linear-gradient(140deg,${GREEN},#059669)`, boxShadow:"0 0 0 1px rgba(16,185,129,0.25),0 0 28px rgba(16,185,129,0.3)", color:"#052e16", border:"none", cursor:"pointer", transition:"all 0.2s", flexShrink:0 }}>
              {isRunning?<Pause size={20} fill="#052e16"/>:<Play size={20} fill="#052e16"/>}
            </button>
            <CtrlBtn onClick={()=>switchMode("focus")} tk={tk}><ArrowLeft size={15}/></CtrlBtn>
          </div>
        </main>
      )}

      {/* ══════════ STATS ══════════ */}
      {mode==="stats" && (
        <main style={{ flex:1, display:"flex", flexDirection:"column", gap:20, padding:"8px 24px 48px", maxWidth:900, margin:"0 auto", width:"100%", overflowY:"auto", animation: statsReady?"statsIn 0.35s cubic-bezier(0.16,1,0.3,1) forwards":"none" }}>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between" }}>
            <div>
              <h1 style={{ fontSize:22, fontWeight:600, letterSpacing:"-0.02em", color:tk.text, margin:0 }}>{t.analytics}</h1>
              <p style={{ fontSize:11, color:tk.subtle, marginTop:4, display:"flex", alignItems:"center", gap:6 }}>
                {t.analyticsWk}
                {user && <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:GREEN }}><Wifi size={9}/>synced</span>}
              </p>
            </div>
            <button onClick={()=>switchMode("focus")} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 12px", borderRadius:10, background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, fontSize:11, fontWeight:500, cursor:"pointer" }}>
              <ArrowLeft size={11}/>{t.focus}
            </button>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10 }}>
            {[
              { label:t.hrs,    val: totalMins>0?(totalMins/60).toFixed(1):"—",  unit:"hrs", Icon:Clock,        c:ORANGE },
              { label:t.done_s, val: totalN>0?String(totalN):"—",                unit:"",    Icon:CheckCircle2, c:GREEN  },
              { label:t.best,   val: (() => { if (!chartHasData) return "—"; const best = chartData.reduce((a: any,b: any)=>b.minutes>a.minutes?b:a, chartData[0]); return best.minutes>0?best.day:"—"; })(), unit:"", Icon:TrendingUp, c:"#fb923c" },
              { label:t.avg,    val: totalN>0?(totalMins/totalN).toFixed(1):"—", unit:"min", Icon:Flame,        c:ORANGE },
            ].map(({ label, val, unit, Icon, c })=>(
              <div key={label} style={{ borderRadius:16, padding:"16px", display:"flex", flexDirection:"column", gap:12, background:tk.card, border:`1px solid ${tk.border}`, transition:"transform 0.2s" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <Icon size={12} style={{ color:c }}/><span style={{ fontSize:10, fontWeight:500, color:tk.muted }}>{label}</span>
                </div>
                <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:26, fontWeight:700, color:tk.text, letterSpacing:"-0.02em", lineHeight:1 }}>{val}</span>
                  {unit && <span style={{ fontSize:11, color:tk.muted }}>{unit}</span>}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:12 }}>
            <div style={{ display:"grid", gap:12, gridTemplateColumns:"minmax(0,1.6fr) minmax(0,1fr)" }}>
              <div style={{ borderRadius:16, padding:20, background:tk.card, border:`1px solid ${tk.border}` }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                  <span style={{ fontSize:10, fontWeight:600, letterSpacing:"0.18em", textTransform:"uppercase", color:tk.muted }}>{t.wkChart}</span>
                  {chartHasData && <span style={{ fontSize:10, color:tk.subtle, fontFamily:"'JetBrains Mono',monospace" }}>{totalMins} min</span>}
                </div>
                {chartHasData ? (
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={chartData} barSize={18} margin={{ top:4,right:4,left:-20,bottom:0 }}>
                      <XAxis dataKey="day" tick={{ fill:tk.subtle,fontSize:10,fontFamily:"'Inter',sans-serif" }} axisLine={false} tickLine={false}/>
                      <YAxis hide/>
                      <Tooltip contentStyle={{ background:theme==="dark"?"#18181b":"#fff", border:`1px solid ${tk.border}`, borderRadius:10, color:tk.text, fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}
                        formatter={(v: any)=>[`${v} min`,"Focus"]} cursor={{ fill:"rgba(255,255,255,0.02)" }}/>
                      <Bar dataKey="minutes" radius={[5,5,0,0]}>
                        {chartData.map((_: any,i: number)=>{
                          const mx=Math.max(...chartData.map((d: any)=>d.minutes));
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
                ) : <EmptyChart tk={tk} t={t}/>}
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
                        {[{c:ORANGE,l:t.completed},{c:theme==="dark"?"rgba(255,255,255,0.18)":"rgba(0,0,0,0.12)",l:t.abandoned}].map(({c,l})=>(
                          <div key={l} style={{ display:"flex", alignItems:"center", gap:5 }}>
                            <div style={{ width:6, height:6, borderRadius:"50%", background:c }}/>
                            <span style={{ fontSize:10, color:tk.muted }}>{l}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <EmptyChart tk={tk} t={t} small/>}
                </div>
              </div>
            </div>
          </div>

          <div style={{ borderRadius:16, padding:20, background:tk.card, border:`1px solid ${tk.border}` }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <span style={{ fontSize:10, fontWeight:600, letterSpacing:"0.18em", textTransform:"uppercase", color:tk.muted }}>{t.recent}</span>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                {localSess.length>0 && <span style={{ fontSize:10, color:tk.subtle, fontFamily:"'JetBrains Mono',monospace" }}>{localSess.length} {t.local}</span>}
                {cloudSess.length>0 && <span style={{ fontSize:10, color:GREEN, display:"flex", alignItems:"center", gap:4 }}><Wifi size={9}/>{cloudSess.length} {t.cloud}</span>}
              </div>
            </div>
            {allSess.length===0 ? (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:"32px 0" }}>
                <Clock size={22} style={{ color:tk.subtle }}/>
                <p style={{ fontSize:12, color:tk.subtle, textAlign:"center" }}>{t.empty}</p>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column" }}>
                {allSess.slice(0,12).map((s: any,i: number)=>(
                  <div key={s.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 4px", borderBottom: i<Math.min(allSess.length,12)-1?`1px solid ${tk.divider}`:"none", animation:`slideUp 0.3s ease ${i*0.04}s both` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
                      <div style={{ width:5, height:5, borderRadius:"50%", flexShrink:0, background: s.status==="completed"?ORANGE:(theme==="dark"?"rgba(255,255,255,0.15)":"rgba(0,0,0,0.12)") }}/>
                      <span style={{ fontSize:13, color: s.status==="completed"?tk.text:tk.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.task_title||s.task}</span>
                      {s.src==="cloud" && <Wifi size={8} style={{ color:GREEN, flexShrink:0 }}/>}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:16, flexShrink:0 }}>
                      <span style={{ fontSize:11, fontFamily:"'JetBrains Mono',monospace", color: s.status==="completed"?"rgba(249,115,22,0.7)":tk.subtle }}>
                        {String(s.duration_minutes||25).padStart(2,"0")}:00
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={()=>setShowCloud(true)} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px", borderRadius:16, background:tk.card, border:`1px solid ${tk.border}`, cursor:"pointer", transition:"transform 0.2s" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:32, height:32, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(249,115,22,0.08)", border:"1px solid rgba(249,115,22,0.15)" }}>
                {user?<Wifi size={13} style={{color:GREEN}}/>:<Cloud size={13} style={{color:ORANGE}}/>}
              </div>
              <span style={{ fontSize:13, color:tk.muted }}>{user?`${t.loggedAs} ${user.email}`:t.cloudBanner}</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:10, fontSize:11, fontWeight:600, color:"#fff", flexShrink:0, background: user?`linear-gradient(140deg,${GREEN},#059669)`:`linear-gradient(140deg,${ORANGE},${RED})` }}>
              {user?t.logout:t.saveCloud}<ChevronRight size={11}/>
            </div>
          </button>
        </main>
      )}

      {mode!=="stats" && (
        <div style={{ ...dimStyle(), textAlign:"center", paddingBottom:20, zIndex:10, position:"relative" }}>
          <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.2em", textTransform:"uppercase", color:tk.subtle }}>
            {mode==="focus"?t.cycle:t.breakCycle}
          </span>
        </div>
      )}

      {showCloud && (
        <CloudModal
          onClose={() => { setShowCloud(false); setResetToken(null); }}
          t={t} lang={lang} tk={tk} onAuth={handleAuth}
          user={user} token={token} recoveryToken={resetToken}
        />
      )}
      <Toasts list={toasts}/>
    </div>
  );
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────
function CtrlBtn({ onClick, children, tk }: any) {
  return (
    <button onClick={onClick} style={{ width:44, height:44, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:tk.card, border:`1px solid ${tk.border}`, color:tk.muted, cursor:"pointer", transition:"transform 0.15s, opacity 0.15s", flexShrink:0 }}>
      {children}
    </button>
  );
}

function SoundCard({ activeSound, toggleSound, volume, setVolume, tk, t }: any) {
  const isSilence = activeSound === null;
  return (
    <div style={{ borderRadius:18, padding:16, background:"rgba(249,115,22,0.04)", border:"1px solid rgba(249,115,22,0.12)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        {activeSound ? <Volume2 size={11} style={{color:ORANGE}}/> : <VolumeX size={11} style={{color:"rgba(249,115,22,0.45)"}}/>}
        <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.25em", textTransform:"uppercase", color:"rgba(249,115,22,0.5)" }}>{t.sound}</span>
        {activeSound && <span style={{ marginLeft:"auto", fontSize:9, color:"rgba(249,115,22,0.65)", fontFamily:"'JetBrains Mono',monospace" }}>{t.playing}</span>}
      </div>
      <div style={{ display:"flex", gap:6, marginBottom: activeSound ? 12 : 0 }}>
        <button onClick={() => toggleSound(null)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"12px 4px", borderRadius:12, fontSize:10, fontWeight:500, background: isSilence ? "rgba(249,115,22,0.12)" : "rgba(249,115,22,0.03)", border: isSilence ? "1px solid rgba(249,115,22,0.35)" : "1px solid rgba(249,115,22,0.1)", color: isSilence ? ORANGE : "rgba(249,115,22,0.38)", cursor:"pointer", transition:"all 0.2s" }}>
          <VolumeX size={14}/>{t.silence || "Off"}
        </button>
        {[
          { id:"rain",       label:t.rain,  Icon:CloudRain },
          { id:"whitenoise", label:t.noise, Icon:Wind      },
          { id:"lofi",       label:t.lofi,  Icon:Music2    },
        ].map(({ id, label, Icon }) => {
          const active = activeSound === id;
          return (
            <button key={id} onClick={() => toggleSound(id)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"12px 4px", borderRadius:12, fontSize:10, fontWeight:500, background: active ? "rgba(249,115,22,0.12)" : "rgba(249,115,22,0.03)", border: active ? "1px solid rgba(249,115,22,0.35)" : "1px solid rgba(249,115,22,0.1)", color: active ? ORANGE : "rgba(249,115,22,0.38)", cursor:"pointer", transition:"all 0.2s" }}>
              <Icon size={14}/>{label}
            </button>
          );
        })}
      </div>
      {activeSound && (
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <VolumeX size={10} style={{ color:"rgba(249,115,22,0.35)", flexShrink:0 }}/>
          <input type="range" min="0" max="1" step="0.02" value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            style={{ flex:1, background:`linear-gradient(to right,${ORANGE} ${volume*100}%,rgba(249,115,22,0.15) ${volume*100}%)` }}
          />
          <Volume2 size={10} style={{ color:"rgba(249,115,22,0.35)", flexShrink:0 }}/>
        </div>
      )}
    </div>
  );
}

function EmptyChart({ tk, t, small }: any) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, padding: small?"20px 0":"40px 0", opacity:0.5 }}>
      <TrendingUp size={small?18:22} style={{ color:tk.subtle }}/>
      <span style={{ fontSize:10, color:tk.subtle, textAlign:"center" }}>{t.empty}</span>
    </div>
  );
}
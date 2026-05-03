import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, Component } from "react";
import { supabase, dbToTask, taskToDb, dbToUser, dbToComment, commentToDb } from "./supabase.js";

/* ═══════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════ */

const UNDO_MS = 5000;

// Verze aplikace — odvozená z build timestampu (Vite define) nebo z env.
// Pokud není nastaveno v vite.config.js (define: { __BUILD_TIME__: ... }),
// fallback ukáže "dev". Zobrazuje se ve formátu "26-05-02 19:48".
function getAppVersion() {
  try {
    // eslint-disable-next-line no-undef
    if (typeof __BUILD_TIME__ !== "undefined" && __BUILD_TIME__) {
      const d = new Date(__BUILD_TIME__);
      if (!isNaN(d.getTime())) {
        const pad = (n) => String(n).padStart(2, "0");
        return `${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
  } catch (e) { /* ignore */ }
  // Fallback: pokus o env var
  try {
    const envBuild = import.meta.env?.VITE_BUILD_TIME;
    if (envBuild) {
      const d = new Date(envBuild);
      if (!isNaN(d.getTime())) {
        const pad = (n) => String(n).padStart(2, "0");
        return `${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
  } catch (e) { /* ignore */ }
  return "dev";
}
const APP_VERSION = getAppVersion();

const PRIORITIES = [
  { id: "urgent",    label: "Akutní",      sym: "‼",  weight: 0 },
  { id: "important", label: "Důležité",    sym: "!",  weight: 1 },
  { id: "low",       label: "Nedůležité",  sym: "—",  weight: 2 },
];

const CATEGORIES = [
  { id: "home",     label: "Domácnost", icon: "🏠", keywords: ["doma","byt","úklid","vysát","prát","umýt"] },
  { id: "garden",   label: "Zahrada",   icon: "🌿", keywords: ["zahrad","sekat","tráv","kompost","záhon"] },
  { id: "finance",  label: "Finance",   icon: "💰", keywords: ["faktur","platb","účet","daň","pojist","banka"] },
  { id: "kids",     label: "Děti",      icon: "👶", keywords: ["dět","škol","kroužk","školka"] },
  { id: "health",   label: "Zdraví",    icon: "❤️", keywords: ["lékař","doktor","zubar","očkov","lék"] },
  { id: "car",      label: "Auto",      icon: "🚗", keywords: ["auto","stk","servis","pneu","olej","mytí"] },
  { id: "shopping", label: "Nákupy",    icon: "🛒", keywords: ["nákup","koupit","obchod","albert","lidl","kaufl","tesco"] },
  { id: "work",     label: "Práce",     icon: "💼", keywords: ["práce","klient","schůz","meeting","projekt"] },
  { id: "other",    label: "Ostatní",   icon: "📌", keywords: [] },
];

const RECURRENCE_OPTIONS = [
  { value: 0,  label: "Jednorázový" },
  { value: 1,  label: "Každý den" },
  { value: 3,  label: "Každé 3 dny" },
  { value: 7,  label: "Každý týden" },
  { value: 14, label: "Každých 14 dní" },
  { value: 30, label: "Každý měsíc" },
  { value: 90, label: "Čtvrtletí" },
];

const MONTH_LABELS = ["Led","Úno","Bře","Dub","Kvě","Čvn","Čvc","Srp","Zář","Říj","Lis","Pro"];

const FONT = "'DM Sans', system-ui, sans-serif";

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */

const generateId = () => crypto.randomUUID();
const getPriority = (id) => PRIORITIES.find(p => p.id === id) || PRIORITIES[1];
const getCategory = (id) => CATEGORIES.find(c => c.id === id) || CATEGORIES[8];
const isDone = (task) => task.status === "done";
const isDeleted = (task) => task.status === "deleted";

// 2-letter label for assignee picker — "Michal" → "Mi", "Peťulka" → "Pe"
// Strips diacritics so label is always ASCII-friendly.
function getUserLabel(name) {
  if (!name) return "??";
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.slice(0, 2);
}

function daysDiff(dateStr) {
  if (!dateStr) return Infinity;
  // Normalize to local-midnight date to avoid timezone issues.
  // Input can be "YYYY-MM-DD" or full ISO string — strip the time portion.
  const datePart = typeof dateStr === "string" ? dateStr.slice(0, 10) : dateStr;
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return Infinity;
  const target = new Date(y, m - 1, d); // local midnight of target date
  const today = new Date();
  today.setHours(0, 0, 0, 0);           // local midnight of today
  return Math.round((target - today) / 86400000);
}

function formatDate(iso) {
  if (!iso) return "";
  const d = daysDiff(iso);
  if (d === 0) return "Dnes";
  if (d === 1) return "Zítra";
  if (d === -1) return "Včera";
  if (d < -1) return `${Math.abs(d)}d po`;
  if (d <= 7) return `Za ${d}d`;
  return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "short" });
}

function formatFullDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("cs-CZ", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function isForgotten(task) {
  return !isDone(task) && !task.dueDate && !task.showFrom &&
    (Date.now() - new Date(task.createdAt).getTime()) / 86400000 > 7;
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Posunout existing dueDate o N dní dopředu. Pokud nemá dueDate, vrátí null.
function shiftDueDate(currentDueDate, shiftDays) {
  if (!currentDueDate) return null;
  const datePart = typeof currentDueDate === "string" ? currentDueDate.slice(0, 10) : currentDueDate;
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + shiftDays);
  return date.toISOString().slice(0, 10);
}

// Format a timestamp as compact Czech time trace: "dnes 8:15", "včera 13:50", "3.4. 18:30"
function formatTimeTrace(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((today - that) / 86400000);
  const hm = d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  if (dayDiff === 0) return `dnes ${hm}`;
  if (dayDiff === 1) return `včera ${hm}`;
  if (dayDiff > 1 && dayDiff < 7) return `před ${dayDiff} dny ${hm}`;
  return `${d.getDate()}.${d.getMonth() + 1}. ${hm}`;
}

// Format duration in human-friendly way:
// <1min: "<1 min", 1-59min: "5 min", 1-23hod: "4 hod", 1-29 dní: "10 dní", 30+ dní: "měsíc+"
function formatDuration(fromIso) {
  if (!fromIso) return "";
  const ms = Date.now() - new Date(fromIso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hod`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "den" : (days < 5 ? "dny" : "dní")}`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? "měsíc" : (months < 5 ? "měsíce" : "měsíců")}`;
}

// Intensity level pro in_progress úkol — podle stáří
// 0 = čerstvý (<24h), 1 = den (24-48h), 2 = staré (48h-7d), 3 = velmi staré (>7d)
function inProgressIntensity(fromIso) {
  if (!fromIso) return 0;
  const hours = (Date.now() - new Date(fromIso).getTime()) / 3600000;
  if (hours < 24) return 0;
  if (hours < 48) return 1;
  if (hours < 168) return 2; // < 7 dní
  return 3;
}

// Resize image client-side using Canvas (max 1200px width)
async function resizeImage(file, maxWidth = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(resolve, "image/jpeg", 0.85);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Upload image to Supabase Storage 'task-images' bucket. Returns public URL or null on failure.
async function uploadTaskImage(file) {
  if (!file) return null;
  if (file.size > 5 * 1024 * 1024) {
    alert("Foto je větší než 5 MB. Použij menší.");
    return null;
  }
  try {
    const resized = await resizeImage(file);
    const filename = `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
    const { error } = await supabase.storage
      .from("task-images")
      .upload(filename, resized, { contentType: "image/jpeg" });
    if (error) throw error;
    const { data } = supabase.storage.from("task-images").getPublicUrl(filename);
    return data.publicUrl;
  } catch (e) {
    console.error("Upload failed:", e);
    alert("Nahrání fotky se nezdařilo.");
    return null;
  }
}

function autoDetectCategory(title) {
  const lower = title.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(kw => lower.includes(kw))) return cat.id;
  }
  return "other";
}

// ═══ TAGS — auto-detekce sloves v názvu úkolu ═══
const TAGS = [
  { id: "objednat",  label: "Objednat",   emoji: "📦", keywords: ["objednat", "objednám", "objednávka", "rezervovat", "rezervace"] },
  { id: "koupit",    label: "Koupit",     emoji: "🛒", keywords: ["koupit", "kup", "nákup", "nakoupit"] },
  { id: "zavolat",   label: "Zavolat",    emoji: "📞", keywords: ["zavolat", "volat", "telefon", "zavolám"] },
  { id: "napsat",    label: "Napsat",     emoji: "📧", keywords: ["napsat", "email", "mail", "sms", "zpráva"] },
  { id: "zaslat",    label: "Zaslat",     emoji: "📤", keywords: ["zaslat", "odeslat", "poslat"] },
  { id: "vyzvednout",label: "Vyzvednout", emoji: "📥", keywords: ["vyzvednout", "vyzvedni"] },
  { id: "zaridit",   label: "Vyřídit",    emoji: "⚙️", keywords: ["zařídit", "vyřídit", "vyřid", "zaridit"] },
  { id: "opravit",   label: "Opravit",    emoji: "🔧", keywords: ["opravit", "spravit", "oprava"] },
  { id: "pripravit", label: "Připravit",  emoji: "📋", keywords: ["připravit", "připrav"] },
  { id: "zaplatit",  label: "Zaplatit",   emoji: "💰", keywords: ["zaplatit", "platba", "uhrad", "převod"] },
  { id: "schuzka",   label: "Schůzka",    emoji: "📅", keywords: ["schůzka", "schuzka", "domluvit", "setkat", "domluva", "termín"] },
  { id: "informovat",label: "Informovat", emoji: "ℹ️", keywords: ["informace", "info", "informovat", "sdělit"] },
  { id: "uklid",     label: "Úklid",      emoji: "🧹", keywords: ["uklidit", "úklid", "uklid", "vyčistit", "umýt"] },
];

// Detekce tagů v názvu úkolu — vrací array tag IDs
function detectTags(title) {
  if (!title) return [];
  const lower = title.toLowerCase();
  const found = [];
  for (const tag of TAGS) {
    if (tag.keywords.some(kw => lower.includes(kw))) {
      found.push(tag.id);
    }
  }
  return found;
}

function getTagDef(tagId) {
  return TAGS.find(t => t.id === tagId);
}

// Filter úkolů podle data splnění (dueDate).
// filterValue: "all" | "today" | "week" | "next_week" | "month" | "range:YYYY-MM-DD,YYYY-MM-DD"
function matchesDueDateFilter(task, filterValue) {
  if (filterValue === "all" || !filterValue) return true;
  if (!task.dueDate) return false;
  const dueMs = new Date(task.dueDate).getTime();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

  if (filterValue === "today") {
    return dueMs >= todayStart.getTime() && dueMs <= todayEnd.getTime();
  }
  if (filterValue === "week") {
    const day = (todayStart.getDay() + 6) % 7;
    const monday = new Date(todayStart); monday.setDate(monday.getDate() - day);
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6); sunday.setHours(23, 59, 59, 999);
    return dueMs >= monday.getTime() && dueMs <= sunday.getTime();
  }
  if (filterValue === "next_week") {
    const day = (todayStart.getDay() + 6) % 7;
    const nextMon = new Date(todayStart); nextMon.setDate(nextMon.getDate() - day + 7);
    const nextSun = new Date(nextMon); nextSun.setDate(nextSun.getDate() + 6); nextSun.setHours(23, 59, 59, 999);
    return dueMs >= nextMon.getTime() && dueMs <= nextSun.getTime();
  }
  if (filterValue === "month") {
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const monthEnd = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0); monthEnd.setHours(23, 59, 59, 999);
    return dueMs >= monthStart.getTime() && dueMs <= monthEnd.getTime();
  }
  if (filterValue.startsWith("range:")) {
    const [from, to] = filterValue.slice(6).split(",");
    if (!from || !to) return true;
    const fromMs = new Date(from).getTime();
    const toEnd = new Date(to); toEnd.setHours(23, 59, 59, 999);
    return dueMs >= fromMs && dueMs <= toEnd.getTime();
  }
  return true;
}

// Normalizace stringu pro porovnávání (lowercase, trim, bez diakritiky)
function normalizeString(s) {
  if (!s) return "";
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Vrací predikce pro QuickAddBar:
// - topVerbs: nejčastější slovesa z tagů (řazeno podle frekvence)
// - topPhrases: opakované celé názvy úkolů (vyskytly se 2+) — TOP X
function getPredictions(tasks, currentUserName) {
  if (!tasks || tasks.length === 0) return { topVerbs: [], topPhrases: [] };
  // Pouze úkoly z TVÉ historie (vytvořené tebou nebo přiřazené tobě)
  // a ne smazané (status != deleted)
  const myTasks = tasks.filter(t =>
    t.status !== "deleted" &&
    (t.createdBy === currentUserName || t.assignedTo?.includes(currentUserName))
  );
  // Verbs — frekvence tagů
  const tagFreq = {};
  myTasks.forEach(t => {
    detectTags(t.title).forEach(tagId => {
      tagFreq[tagId] = (tagFreq[tagId] || 0) + 1;
    });
  });
  const topVerbs = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, count]) => ({ ...getTagDef(id), count }))
    .filter(t => t.label);

  // Phrases — opakované názvy (normalizované — bez diakritiky, lowercase)
  // Skupina podle normalizovaného klíče → ukázat varianta s nejnovějším createdAt.
  const phraseFreq = {};
  myTasks.forEach(t => {
    const norm = normalizeString(t.title);
    if (norm.length < 3) return;
    if (!phraseFreq[norm]) {
      phraseFreq[norm] = { title: t.title, count: 0, lastUsed: 0 };
    }
    phraseFreq[norm].count += 1;
    const ts = t.createdAt ? new Date(t.createdAt).getTime() : 0;
    if (ts > phraseFreq[norm].lastUsed) {
      phraseFreq[norm].lastUsed = ts;
      phraseFreq[norm].title = t.title; // zachovat nejnovější varianty (s diakritikou)
    }
  });
  const topPhrases = Object.values(phraseFreq)
    .filter(p => p.count >= 2)
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, 4);
  return { topVerbs, topPhrases };
}

// Smart search syntax:
//   priority:urgent | high | important | low      (a synonyma: !, !!)
//   due:today | tomorrow | week | month | overdue | none
//   assigned:<jméno>                              (kontrola assignTo + assignedTo, case-insensitive)
//   status:active | done | deleted | parked
//   list:<id|název>                               (custom list — porovnává s task.category)
//   category:<id|název>                           (alias k list:)
//   Plain text                                    (full-text v title/note/checklist)
//   Můžeš kombinovat: "!high due:today rozbitý"   (AND mezi tokeny, plain text se hledá ve zbytku)
function parseSearchQuery(query) {
  if (!query || !query.trim()) return { tokens: [], plainText: "" };
  const tokens = [];
  const plainParts = [];
  // Split na "slova" — operátor:hodnota nebo plain text. Hodnoty s mezerou nepodporujeme (zatím).
  const parts = query.trim().split(/\s+/);
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z]+):(.+)$/);
    if (m) {
      tokens.push({ key: m[1].toLowerCase(), value: m[2].toLowerCase() });
    } else if (part.startsWith("!")) {
      // Zkratka: !urgent => priority:urgent, !!:urgent
      const v = part.replace(/^!+/, "");
      tokens.push({ key: "priority", value: v ? v.toLowerCase() : "urgent" });
    } else if (part.startsWith("@")) {
      tokens.push({ key: "assigned", value: part.slice(1).toLowerCase() });
    } else if (part.startsWith("#")) {
      tokens.push({ key: "list", value: part.slice(1).toLowerCase() });
    } else {
      plainParts.push(part);
    }
  }
  return { tokens, plainText: plainParts.join(" ").toLowerCase() };
}

function matchesPriorityToken(taskPriority, value) {
  const p = (taskPriority || "").toLowerCase();
  // Synonyma
  if (value === "urgent" || value === "high" || value === "akutní" || value === "akutni") return p === "urgent";
  if (value === "important" || value === "med" || value === "důležité" || value === "dulezite") return p === "important";
  if (value === "low" || value === "nedůležité" || value === "nedulezite") return p === "low";
  return p === value;
}

function matchesDueToken(task, value, todayStr) {
  const due = task.dueDate;
  if (value === "none" || value === "žádný" || value === "zadny") return !due;
  if (!due) return false;
  const today = new Date(todayStr);
  const dueDate = new Date(due);
  const diffDays = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));
  if (value === "today" || value === "dnes") return diffDays === 0;
  if (value === "tomorrow" || value === "zítra" || value === "zitra") return diffDays === 1;
  if (value === "week" || value === "týden" || value === "tyden") return diffDays >= 0 && diffDays <= 7;
  if (value === "month" || value === "měsíc" || value === "mesic") return diffDays >= 0 && diffDays <= 31;
  if (value === "overdue" || value === "po" || value === "prošlé" || value === "prosle") {
    return diffDays < 0 && task.status === "active";
  }
  return false;
}

function searchMatch(task, query, customLists = []) {
  if (!query) return true;
  const { tokens, plainText } = parseSearchQuery(query);

  // todayStr pro due: token (lokální půlnoc)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();

  // Token AND check
  for (const { key, value } of tokens) {
    if (key === "priority" || key === "p" || key === "pri") {
      if (!matchesPriorityToken(task.priority, value)) return false;
    } else if (key === "due" || key === "d") {
      if (!matchesDueToken(task, value, todayStr)) return false;
    } else if (key === "assigned" || key === "for" || key === "to") {
      const v = value;
      const assignTo = (task.assignTo || "").toLowerCase();
      const assignedTo = Array.isArray(task.assignedTo) ? task.assignedTo : [];
      const matches = assignTo.includes(v)
        || assignedTo.some(name => (name || "").toLowerCase().includes(v));
      if (!matches) return false;
    } else if (key === "status" || key === "s") {
      const taskStatus = (task.status || "").toLowerCase();
      if (value === "parked") {
        if (!task.parkedReason) return false;
      } else if (taskStatus !== value) {
        return false;
      }
    } else if (key === "list" || key === "category" || key === "cat" || key === "l") {
      const cat = (task.category || "").toLowerCase();
      // Pokus o match dle ID nebo dle názvu custom listu
      const matchById = cat === value;
      const matchByName = customLists.some(l =>
        l.id?.toLowerCase() === cat && (l.name || "").toLowerCase().includes(value)
      );
      if (!matchById && !matchByName) return false;
    }
    // Neznámé tokeny ignoruj (mohou být plain text s ":" — fallback níže)
  }

  // Plain text full-text
  if (plainText) {
    const matches =
      task.title?.toLowerCase().includes(plainText) ||
      task.note?.toLowerCase().includes(plainText) ||
      task.checklist?.some(c => c.text?.toLowerCase().includes(plainText));
    if (!matches) return false;
  }

  return true;
}

function smartSort(a, b) {
  const aOverdue = daysDiff(a.dueDate) < 0 && !isDone(a);
  const bOverdue = daysDiff(b.dueDate) < 0 && !isDone(b);
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

  const aForgot = isForgotten(a);
  const bForgot = isForgotten(b);
  if (aForgot !== bForgot) return aForgot ? -1 : 1;

  const priDiff = getPriority(a.priority).weight - getPriority(b.priority).weight;
  if (priDiff) return priDiff;

  const daysA = daysDiff(a.dueDate);
  const daysB = daysDiff(b.dueDate);
  if (daysA !== daysB) return daysA - daysB;

  return new Date(b.createdAt) - new Date(a.createdAt);
}

// ═══════════════════════════════════════════════════════
// URGENCY SCORE — numerical priority for "Today" view
// Higher score = more urgent. Used to sort Today view sensibly.
// Unread-from-others gets BIG boost so new assignments stand out.
// ═══════════════════════════════════════════════════════
function urgencyScore(task, currentUserName) {
  if (isDone(task) || isDeleted(task)) return 0;
  let score = 0;

  // 1) Unread from others = highest priority (don't miss new assignments)
  const isUnread = task.seenBy && !task.seenBy.includes(currentUserName) && task.createdBy !== currentUserName;
  if (isUnread) score += 200;

  // 2) Overdue — strong boost per day
  const daysUntil = daysDiff(task.dueDate);
  if (task.dueDate && daysUntil < 0) {
    score += 100 + Math.min(Math.abs(daysUntil) * 5, 50); // cap at 150 for very overdue
  }

  // 3) Due today / tomorrow
  if (task.dueDate && daysUntil === 0) score += 60;
  else if (task.dueDate && daysUntil === 1) score += 35;
  else if (task.dueDate && daysUntil >= 2 && daysUntil <= 3) score += 15;

  // 4) Priority
  if (task.priority === "urgent") score += 30;
  else if (task.priority === "important") score += 15;

  // 5) Forgotten (7+ days untouched)
  if (isForgotten(task)) score += 20;

  // 6) In progress — slight boost (keep momentum)
  if (task.status === "in_progress") score += 10;

  // 7) Small boost for newer tasks (tiebreaker)
  const ageHours = (Date.now() - new Date(task.createdAt).getTime()) / 3600000;
  score += Math.max(0, 5 - ageHours / 24); // <1 day old = +5, fades after

  return score;
}

function notify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body, icon: "/icon-192.png" }); } catch (e) {}
  }
}

// Convert VAPID public key for push subscription
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Trigger push notification via Supabase Edge Function
async function triggerPushNotification(task) {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    await fetch(`${supabaseUrl}/functions/v1/super-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        task: { id: task.id, title: task.title },
        assignedTo: task.assignedTo,
        createdBy: task.createdBy,
      }),
    });
  } catch (e) {
    console.warn("Push trigger failed:", e);
  }
}

// Trigger push notification when a task is completed (notify the creator)
async function triggerCompletionNotification(task, completedByUser) {
  // Only notify if task was assigned by someone ELSE to the completer
  if (!task.createdBy || task.createdBy === completedByUser) return;
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    await fetch(`${supabaseUrl}/functions/v1/super-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        task: { id: task.id, title: `✓ ${completedByUser} splnil: ${task.title}` },
        assignedTo: [task.createdBy],
        createdBy: completedByUser,
      }),
    });
  } catch (e) {
    console.warn("Completion push trigger failed:", e);
  }
}

function processRecurring(tasks) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const updates = [];

  const processed = tasks.map(task => {
    if (task.recDays > 0 && task.status === "done" && task.completedAt) {
      const nextDue = new Date(task.completedAt);
      nextDue.setDate(nextDue.getDate() + task.recDays);

      const inSeason = !task.activeMo?.length || task.activeMo.includes(currentMonth);
      if (now >= nextDue && inSeason) {
        const renewed = {
          ...task,
          status: "active",
          doneBy: [],
          completedAt: null,
          completedByUser: null,
          dueDate: nextDue.toISOString().slice(0, 10),
          seenBy: [task.createdBy],
          checklist: task.checklist?.map(ci => ({
            ...ci, done: false, doneBy: null, doneAt: null
          })) || [],
        };
        updates.push(renewed);
        return renewed;
      }
    }
    return task;
  });

  return { tasks: processed, updates };
}

// Self-healing migration: if an active task has a fully-completed checklist,
// mark the task as done automatically. Fixes legacy state where auto-complete wasn't wired.
function sanitizeCompletedChecklists(tasks, users) {
  const updates = [];
  const now = new Date().toISOString();

  const processed = tasks.map(task => {
    // Only active tasks with checklist items
    if (task.status !== "active") return task;
    if (!task.checklist || task.checklist.length === 0) return task;
    // All items done?
    if (!task.checklist.every(i => i.done)) return task;

    // All items complete — mark the whole task as done
    const lastDoneAt = task.checklist
      .map(i => i.doneAt)
      .filter(Boolean)
      .sort()
      .pop();
    const lastDoneBy = task.checklist
      .slice()
      .reverse()
      .find(i => i.doneBy)?.doneBy;

    const updated = {
      ...task,
      status: "done",
      completedAt: lastDoneAt || now,
      completedByUser: lastDoneBy || task.createdBy,
      doneBy: users ? users.map(u => u.name) : [],
    };
    updates.push(updated);
    return updated;
  });

  return { tasks: processed, updates };
}

/* ═══════════════════════════════════════════════════════
   THEMES
   ═══════════════════════════════════════════════════════ */

const THEMES = {
  dark: {
    bg: "#0c1017",
    card: "#131a24",
    cardBorder: "#1a2233",
    headerBg: "rgba(12,16,23,0.92)",
    text: "#dbe4ed",
    textSub: "#506880",
    textDim: "#2a3a50",
    textMid: "#3a5060",
    inputBg: "#080c12",
    inputBorder: "#1a2438",
    accent: "#3b82f6",
    accentSoft: "#3b82f612",
    accentBorder: "#3b82f625",
    green: "#22c55e",
    red: "#ef4444",
    yellow: "#f59e0b",
    purple: "#a855f7",
    buttonBg: "#1e2e40",
    snackBg: "#1e293b",
    unreadBg: "#0d1f1a",
    unreadBorder: "#134e3a",
    priority: {
      urgent:    { bg: "#1a0f0f", border: "#ef444440", text: "#ef4444", cardBg: "#ef44440e" },
      important: { bg: "#1a1508", border: "#f59e0b35", text: "#f59e0b", cardBg: "#f59e0b0a" },
      low:       { bg: "#0f1218", border: "#64748b25", text: "#64748b", cardBg: "#64748b06" },
    },
  },
  light: {
    bg: "#f5f7fa",
    card: "#ffffff",
    cardBorder: "#e2e8f0",
    headerBg: "rgba(245,247,250,0.92)",
    text: "#1e293b",
    textSub: "#64748b",
    textDim: "#cbd5e1",
    textMid: "#94a3b8",
    inputBg: "#f1f5f9",
    inputBorder: "#e2e8f0",
    accent: "#2563eb",
    accentSoft: "#2563eb10",
    accentBorder: "#2563eb20",
    green: "#16a34a",
    red: "#dc2626",
    yellow: "#d97706",
    purple: "#7c3aed",
    buttonBg: "#e2e8f0",
    snackBg: "#ffffff",
    unreadBg: "#f0fdf4",
    unreadBorder: "#86efac",
    priority: {
      urgent:    { bg: "#fef2f2", border: "#fca5a5", text: "#dc2626", cardBg: "#fef2f2" },
      important: { bg: "#fffbeb", border: "#fcd34d", text: "#d97706", cardBg: "#fffbeb" },
      low:       { bg: "#f8fafc", border: "#e2e8f0", text: "#94a3b8", cardBg: "#f8fafc" },
    },
  },
};

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,700&display=swap');
@keyframes glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.3); }
  50% { box-shadow: 0 0 0 7px rgba(52,211,153,0); }
}
@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes snackIn {
  from { transform: translateY(80px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes completedFade {
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.98); }
  100% { opacity: 0.35; transform: scale(1); }
}
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.85; }
}
@keyframes newTaskHighlight {
  0% {
    transform: scale(0.97);
    opacity: 0.4;
    box-shadow: 0 0 0 0 rgba(52,211,153,0.6);
  }
  20% {
    transform: scale(1.02);
    opacity: 1;
    box-shadow: 0 0 0 8px rgba(52,211,153,0.3);
  }
  100% {
    transform: scale(1);
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(52,211,153,0);
  }
}
@keyframes completePulse {
  0% { transform: scale(1); }
  30% { transform: scale(1.25); }
  60% { transform: scale(1.12); }
  100% { transform: scale(1); }
}
@keyframes inProgressPulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.15), 0 2px 8px rgba(245, 158, 11, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.30), 0 2px 12px rgba(245, 158, 11, 0.6); }
}
@keyframes searchHighlight {
  0%   { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.0); }
  10%  { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0.45), 0 0 30px rgba(99, 102, 241, 0.7); }
  40%  { box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.30), 0 0 20px rgba(99, 102, 241, 0.5); }
  70%  { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0.40), 0 0 28px rgba(99, 102, 241, 0.6); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.0); }
}
@keyframes actionCardGlow {
  0% { box-shadow: 0 0 0 rgba(0, 0, 0, 0); }
  30% { box-shadow: 0 0 40px currentColor, 0 4px 20px currentColor; }
  100% { box-shadow: 0 0 30px currentColor, 0 4px 16px currentColor; }
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
select { appearance: auto; }
body { margin: 0; font-family: 'DM Sans', system-ui, sans-serif; }
`;

/* ═══ Style helpers ═══ */
const cardStyle = (th) => ({
  background: th.card,
  border: `1px solid ${th.cardBorder}`,
  borderRadius: "12px",
});

const inputStyle = (th) => ({
  background: th.inputBg,
  border: `1px solid ${th.inputBorder}`,
  borderRadius: "8px",
  color: th.text,
  padding: "10px 12px",
  fontSize: "14px",
  fontFamily: FONT,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
});

const buttonStyle = () => ({
  border: "none",
  borderRadius: "8px",
  fontFamily: FONT,
  fontWeight: 600,
  cursor: "pointer",
});

/* ═══════════════════════════════════════════════════════
   OFFLINE CACHE & QUEUE
   ═══════════════════════════════════════════════════════ */

const CACHE_TASKS = "ft_cache_tasks";
const CACHE_USERS = "ft_cache_users";
const OFFLINE_QUEUE = "ft_offline_queue";

function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function getOfflineQueue() {
  return cacheGet(OFFLINE_QUEUE) || [];
}

function addToOfflineQueue(action) {
  const queue = getOfflineQueue();
  queue.push({ ...action, timestamp: Date.now() });
  cacheSet(OFFLINE_QUEUE, queue);
}

function clearOfflineQueue() {
  cacheSet(OFFLINE_QUEUE, []);
}

async function flushOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  let flushed = 0;
  let dropped = 0;
  const remaining = [];

  for (const action of queue) {
    try {
      let result;
      if (action.type === "create_task") {
        result = await supabase.from("tasks").insert(taskToDb(action.task));
      } else if (action.type === "update_task") {
        result = await supabase.from("tasks").update(taskToDb(action.task)).eq("id", action.task.id);
      } else if (action.type === "create_user") {
        result = await supabase.from("users").insert({ name: action.user.name, pin: action.user.pin, is_admin: action.user.admin });
      } else if (action.type === "create_comment") {
        result = await supabase.from("task_comments").insert(commentToDb(action.comment));
      } else if (action.type === "update_comment") {
        result = await supabase.from("task_comments").update(commentToDb(action.comment)).eq("id", action.comment.id);
      }
      // Supabase vrací error v result.error, ne throw
      if (result?.error) throw result.error;
      flushed++;
    } catch (e) {
      if (isNetworkError(e)) {
        // Síťová chyba — zkusíme příště
        remaining.push(action);
      } else {
        // Server chyba (4xx/5xx, schema mismatch) — opětovný retry by selhal stejně.
        // Zahodit z queue + zalogovat, aby se nezaseklo navždy.
        logServerError(`flushOfflineQueue:${action.type}`, e, action);
        dropped++;
      }
    }
  }

  if (dropped > 0) {
    console.warn(`[flushOfflineQueue] dropped ${dropped} actions due to server errors`);
  }

  cacheSet(OFFLINE_QUEUE, remaining);
  return flushed;
}

/* ═══════════════════════════════════════════════════════
   ERROR CLASSIFICATION
   ═══════════════════════════════════════════════════════ */

// Rozliš síťovou chybu (offline, fetch failed) od server chyby (4xx/5xx).
// Síťová chyba → queue pro pozdější retry. Server chyba → log + alert pro vývojáře.
function isNetworkError(e) {
  if (!e) return false;
  // Browser je prokazatelně offline
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  // Supabase v JS error má někdy `message: "Failed to fetch"` při síťové chybě
  if (e.message && /failed to fetch|networkerror|load failed/i.test(e.message)) return true;
  // PostgREST/Supabase chyby mají `code` (např. PGRST204) nebo `status` (4xx/5xx) — server chyba
  if (e.code || e.status >= 400) return false;
  // TypeError z fetch je obvykle síťová chyba
  if (e.name === "TypeError") return true;
  // Default: pokud nevíme, považujeme za síťovou chybu (bezpečnější — ztráta nezpůsobí permanent loss)
  return true;
}

// Loguje server chybu prominentně, aby vývojář (Michal) hned viděl, že něco selhalo.
// Ukládá poslední errory do localStorage pro pozdější diagnostiku.
function logServerError(context, error, payload) {
  console.error(`[SERVER ERROR] ${context}:`, error?.code || error?.status, error?.message || error);
  if (error?.details) console.error("  details:", error.details);
  if (error?.hint) console.error("  hint:", error.hint);
  if (payload) console.error("  payload:", payload);
  // Zaznamenej do localStorage pro pozdější checkup
  try {
    const log = JSON.parse(localStorage.getItem("ft_server_errors") || "[]");
    log.unshift({
      ts: new Date().toISOString(),
      context,
      code: error?.code || error?.status || "unknown",
      message: error?.message || String(error),
      hint: error?.hint || null,
    });
    // Drž jen posledních 20 errorů
    localStorage.setItem("ft_server_errors", JSON.stringify(log.slice(0, 20)));
  } catch (e) { /* ignore */ }
}

/* ═══════════════════════════════════════════════════════
   SCHEMA HEALTH CHECK
   ═══════════════════════════════════════════════════════ */

// Při startu zkontroluj zda DB má všechny sloupce, které taskToDb posílá.
// Pokud ne, vyhoď prominentní warning do konzole — předejde tichým bugům typu PGRST204
// ("Could not find the 'X' column of 'tasks' in the schema cache").
async function checkDbSchema() {
  const expectedTaskColumns = [
    "id", "title", "note", "type", "priority", "category", "status",
    "due_date", "show_from", "rec_days", "recurrence_rule",
    "active_months", "assign_to", "assigned_to", "done_by", "seen_by",
    "checklist", "images", "created_by", "created_at",
    "completed_at", "completed_by_user", "deleted_at",
    "scratch_pad", "parked_reason", "parked_at", "parked_by", "time_spent_min",
  ];

  try {
    // Vytáhneme 1 řádek a podíváme se, jaké sloupce vrátí.
    // Pokud neexistují žádné úkoly, .select(*).limit(1) vrátí prázdné pole, ale schema check selže.
    // Proto preferujeme HEAD request s vlastním selectem.
    const { data, error } = await supabase.from("tasks").select("*").limit(1);
    if (error) {
      console.error("[schema check] cannot read tasks:", error);
      return;
    }
    if (!data || data.length === 0) {
      // Žádný úkol — nemůžeme zjistit sloupce. Skip silently.
      return;
    }
    const actualColumns = Object.keys(data[0]);
    const missing = expectedTaskColumns.filter(c => !actualColumns.includes(c));
    const extra = actualColumns.filter(c => !expectedTaskColumns.includes(c));

    if (missing.length > 0) {
      // Stylový prominentní warning v konzoli
      console.error(
        "%c⚠️ DB SCHEMA MISMATCH ⚠️",
        "background: #ef4444; color: white; font-size: 16px; padding: 4px 8px; border-radius: 4px;"
      );
      console.error(`Tabulka 'tasks' POSTRÁDÁ ${missing.length} sloupec/sloupců, které aplikace posílá:`);
      missing.forEach(c => console.error(`  ❌ ${c}`));
      console.error("Je třeba spustit ALTER TABLE migraci v Supabase. Bez toho UPDATE/INSERT operace selhávají s PGRST204.");
    }
    if (extra.length > 0) {
      console.warn(`[schema check] DB má extra sloupce, které aplikace neposílá: ${extra.join(", ")}`);
    }
    if (missing.length === 0 && extra.length === 0) {
      console.log("[schema check] ✅ tasks schema OK");
    }
  } catch (e) {
    console.warn("[schema check] failed:", e);
  }
}

/* ═══════════════════════════════════════════════════════
   API (with offline fallback)
   ═══════════════════════════════════════════════════════ */

async function apiLoadUsers() {
  try {
    const { data, error } = await supabase.from("users").select("*").order("created_at");
    if (error) throw error;
    const users = (data || []).map(dbToUser);
    cacheSet(CACHE_USERS, users); // Cache for offline
    return users;
  } catch (e) {
    console.warn("apiLoadUsers offline, using cache");
    return cacheGet(CACHE_USERS) || [];
  }
}

async function apiLoadTasks() {
  // Server je vždy zdroj pravdy. Cache se používá JEN když jsme offline (catch).
  // Předtím tu byla složitá merge logika, která způsobovala "úkoly se vrací po smazání"
  // — pokud jsi smazal úkol a refresh nebo focus event proběhl rychleji než dorazil
  // realtime DELETE event, lokální cache měla "deleted" status a server "active",
  // takže merge úkol vrátil zpět. Teď: server = pravda, vždy.
  try {
    const { data, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    const serverTasks = (data || []).map(dbToTask);
    cacheSet(CACHE_TASKS, serverTasks);
    return serverTasks;
  } catch (e) {
    console.warn("apiLoadTasks offline, using cache");
    return cacheGet(CACHE_TASKS) || [];
  }
}

async function apiCreateUser(user) {
  try {
    const { error } = await supabase.from("users").insert({ name: user.name, pin: user.pin, is_admin: user.admin });
    if (error) throw error;
  } catch (e) {
    if (isNetworkError(e)) {
      console.warn("apiCreateUser offline, queued");
      addToOfflineQueue({ type: "create_user", user });
    } else {
      logServerError("apiCreateUser", e, user);
    }
  }
}

async function apiDeleteUser(name) {
  try {
    const { error } = await supabase.from("users").delete().eq("name", name);
    if (error) throw error;
  } catch (e) {
    if (isNetworkError(e)) {
      console.warn("apiDeleteUser failed offline");
    } else {
      logServerError("apiDeleteUser", e, { name });
    }
  }
}

async function apiUpdateUserPin(name, newPin) {
  try {
    const { error } = await supabase.from("users").update({ pin: newPin }).eq("name", name);
    if (error) throw error;
    return true;
  } catch (e) {
    if (isNetworkError(e)) {
      console.warn("apiUpdateUserPin failed offline");
    } else {
      logServerError("apiUpdateUserPin", e, { name });
    }
    return false;
  }
}

async function apiCreateTask(task) {
  // Always update local cache
  const cached = cacheGet(CACHE_TASKS) || [];
  cacheSet(CACHE_TASKS, [task, ...cached]);

  try {
    const { error } = await supabase.from("tasks").insert(taskToDb(task));
    if (error) throw error;
  } catch (e) {
    if (isNetworkError(e)) {
      console.warn("apiCreateTask offline, queued");
      addToOfflineQueue({ type: "create_task", task });
    } else {
      // Server chyba (4xx/5xx) — queue by stejně selhal, jen logujeme.
      logServerError("apiCreateTask", e, taskToDb(task));
    }
  }
}

async function apiUpdateTask(task) {
  // Always update local cache
  const cached = cacheGet(CACHE_TASKS) || [];
  cacheSet(CACHE_TASKS, cached.map(t => t.id === task.id ? task : t));

  try {
    const { error } = await supabase.from("tasks").update(taskToDb(task)).eq("id", task.id);
    if (error) throw error;
  } catch (e) {
    if (isNetworkError(e)) {
      console.warn("apiUpdateTask offline, queued");
      addToOfflineQueue({ type: "update_task", task });
    } else {
      // Server chyba (4xx/5xx) — queue by stejně selhal, jen logujeme.
      logServerError("apiUpdateTask", e, taskToDb(task));
    }
  }
}

async function apiUpdateTasks(tasks) {
  for (const task of tasks) await apiUpdateTask(task);
}

/* ═══════════════════════════════════════════════════════
   COMMENTS API (with offline fallback via cache)
   ═══════════════════════════════════════════════════════ */

const CACHE_COMMENTS = "ft_cache_comments";
const REACTION_EMOJIS = ["👍", "❤️", "❓", "✅"];

async function apiLoadComments() {
  try {
    const { data, error } = await supabase.from("task_comments")
      .select("*").order("created_at", { ascending: true });
    if (error) throw error;
    const comments = (data || []).map(dbToComment);
    cacheSet(CACHE_COMMENTS, comments);
    return comments;
  } catch (e) {
    console.warn("apiLoadComments offline, using cache");
    return cacheGet(CACHE_COMMENTS) || [];
  }
}

async function apiCreateComment(comment) {
  const cached = cacheGet(CACHE_COMMENTS) || [];
  cacheSet(CACHE_COMMENTS, [...cached, comment]);
  try {
    const { error } = await supabase.from("task_comments").insert(commentToDb(comment));
    if (error) throw error;
  } catch (e) {
    if (isNetworkError(e)) {
      console.warn("apiCreateComment offline, queued");
      addToOfflineQueue({ type: "create_comment", comment });
    } else {
      logServerError("apiCreateComment", e, commentToDb(comment));
    }
  }
}

async function apiUpdateComment(comment) {
  const cached = cacheGet(CACHE_COMMENTS) || [];
  cacheSet(CACHE_COMMENTS, cached.map(c => c.id === comment.id ? comment : c));
  try {
    const { error } = await supabase.from("task_comments")
      .update(commentToDb(comment)).eq("id", comment.id);
    if (error) throw error;
  } catch (e) {
    if (isNetworkError(e)) {
      addToOfflineQueue({ type: "update_comment", comment });
    } else {
      logServerError("apiUpdateComment", e, commentToDb(comment));
    }
  }
}

async function apiDeleteComment(commentId) {
  try {
    const { error } = await supabase.from("task_comments").delete().eq("id", commentId);
    if (error) throw error;
    const cached = cacheGet(CACHE_COMMENTS) || [];
    cacheSet(CACHE_COMMENTS, cached.filter(c => c.id !== commentId));
  } catch (e) {
    if (isNetworkError(e)) {
      console.warn("apiDeleteComment failed offline");
    } else {
      logServerError("apiDeleteComment", e, { commentId });
    }
  }
}

/* ═══════════════════════════════════════════════════════
   COPY TASK BUTTON — copies task title + note to clipboard
   ═══════════════════════════════════════════════════════ */

function CopyTaskButton({ task, theme }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = task.note?.trim()
      ? `${task.title}\n\n${task.note}`
      : task.title;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Zkopírováno" : "Kopírovat název do schránky"}
      style={{
        ...buttonStyle(),
        width: "40px", height: "40px", padding: 0,
        background: copied ? `${theme.green}20` : theme.inputBg,
        color: copied ? theme.green : theme.textMid,
        border: `2px solid ${copied ? theme.green : theme.inputBorder}`,
        borderRadius: "8px",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: "18px",
        transition: "all 0.2s",
      }}>
      {copied ? "✓" : "📋"}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   SCRATCH PAD INLINE — pracovní deník, append-only
   Zobrazeno v TaskDetail View módu, funkčně stejné jako ve Focus
   ═══════════════════════════════════════════════════════ */

function ScratchPadInline({ task, currentUser, onUpdate, theme }) {
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const hasEntries = task.scratchPad && task.scratchPad.length > 0;

  const addEntry = () => {
    if (!input.trim()) return;
    const entry = {
      id: "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      text: input.trim(),
      createdAt: new Date().toISOString(),
      author: currentUser.name,
    };
    const newPad = [entry, ...(task.scratchPad || [])];
    // Pokud má úkol stav 'active' a přidávám zápis → rozpracovat
    const updates = { scratchPad: newPad };
    if (task.status === "active") {
      updates.status = "in_progress";
      updates.inProgressAt = new Date().toISOString();
    }
    onUpdate(task.id, updates);
    setInput("");
  };

  const deleteEntry = (entryId) => {
    if (!confirm("Smazat tento zápis?")) return;
    const newPad = (task.scratchPad || []).filter(e => e.id !== entryId);
    onUpdate(task.id, { scratchPad: newPad });
  };

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setEditText(entry.text);
  };

  const saveEdit = () => {
    if (!editText.trim() || !editingId) {
      setEditingId(null);
      setEditText("");
      return;
    }
    const newPad = (task.scratchPad || []).map(e =>
      e.id === editingId
        ? { ...e, text: editText.trim(), editedAt: new Date().toISOString() }
        : e
    );
    onUpdate(task.id, { scratchPad: newPad });
    setEditingId(null);
    setEditText("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  // Auto-expand pokud máme zápisy
  useEffect(() => {
    if (hasEntries && !expanded) setExpanded(true);
  }, [hasEntries]);

  return (
    <div style={{
      marginBottom: "12px",
      background: hasEntries ? `${theme.purple}10` : `${theme.cardBorder}30`,
      border: hasEntries ? `2px solid ${theme.purple}40` : `2px dashed ${theme.inputBorder}`,
      borderRadius: "10px",
      padding: "10px 12px",
      boxShadow: hasEntries ? `0 1px 4px ${theme.purple}15` : "none",
    }}>
      {/* Header with toggle */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", marginBottom: expanded ? "8px" : 0,
        }}>
        <span style={{
          fontSize: "11px", color: hasEntries ? theme.purple : theme.textMid, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: "0.5px",
        }}>
          📔 Pracovní deník {hasEntries && `(${task.scratchPad.length})`}
        </span>
        <span style={{ fontSize: "10px", color: theme.textMid }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {expanded && (
        <>
          {/* Input */}
          <div style={{ display: "flex", gap: "4px", marginBottom: hasEntries ? "8px" : 0 }}>
            <input
              type="text"
              placeholder="Co jsem zjistil / potřebuji..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addEntry(); }}
              style={{ ...inputStyle(theme), fontSize: "12px", padding: "6px 10px", flex: 1 }}
            />
            <button onClick={addEntry} disabled={!input.trim()} style={{
              ...buttonStyle(), padding: "6px 12px", fontSize: "12px",
              background: input.trim() ? theme.accent : theme.inputBg,
              color: input.trim() ? "#fff" : theme.textDim,
              border: "none",
            }}>
              +
            </button>
          </div>

          {/* Entries */}
          {hasEntries && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {task.scratchPad.map(entry => (
                <div key={entry.id} style={{
                  padding: "6px 8px",
                  background: theme.card,
                  border: `1px solid ${theme.inputBorder}`,
                  borderRadius: "6px",
                  fontSize: "12px",
                  display: "flex", gap: "6px", alignItems: "flex-start",
                }}>
                  <span style={{
                    fontSize: "9px", color: theme.textMid, fontWeight: 600,
                    whiteSpace: "nowrap", marginTop: "2px",
                  }}>
                    {formatTimeTrace(entry.createdAt)}
                    {entry.author !== currentUser.name && ` · ${entry.author}`}
                    {entry.editedAt && (
                      <span style={{ color: theme.textDim, fontStyle: "italic" }}> · upraveno</span>
                    )}
                  </span>
                  {editingId === entry.id ? (
                    <input
                      type="text"
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      onBlur={saveEdit}
                      autoFocus
                      style={{
                        flex: 1, padding: "2px 6px", fontSize: "12px",
                        border: `1px solid ${theme.accent}`,
                        background: theme.card, color: theme.text,
                        borderRadius: "4px", outline: "none",
                      }}
                    />
                  ) : (
                    <span style={{ flex: 1, color: theme.text, lineHeight: 1.3 }}>
                      {entry.text}
                    </span>
                  )}
                  {entry.author === currentUser.name && editingId !== entry.id && (
                    <>
                      <button onClick={() => startEdit(entry)}
                        title="Upravit"
                        style={{
                          background: "none", border: "none",
                          color: theme.textDim, cursor: "pointer", fontSize: "12px",
                          padding: "0 3px",
                        }}>
                        ✏️
                      </button>
                      <button onClick={() => deleteEntry(entry.id)}
                        title="Smazat"
                        style={{
                          background: "none", border: "none",
                          color: theme.textDim, cursor: "pointer", fontSize: "12px",
                          padding: "0 3px",
                        }}>
                        🗑
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CHECKLIST COMPONENT
   ═══════════════════════════════════════════════════════ */

function Checklist({ items = [], onChange, userName, theme, onAllCompleted, taskId, comments = [], onAddComment, onToggleReaction }) {
  const [newItemText, setNewItemText] = useState("");
  const [expandedItem, setExpandedItem] = useState(null);   // ID položky s otevřeným komentářovým panelem
  const [itemCommentInput, setItemCommentInput] = useState("");
  const [editingItem, setEditingItem] = useState(null);     // ID položky v editaci
  const [editText, setEditText] = useState("");
  // Track when edit was saved — used to prevent phantom delete click
  // (✓ Save button and 🗑 Delete button share same screen position)
  const lastSaveTimeRef = useRef(0);

  const addItem = () => {
    if (!newItemText.trim()) return;
    const newItem = {
      id: generateId(),
      text: newItemText.trim(),
      done: false,
      doneBy: null,
      doneAt: null,
    };
    onChange([...items, newItem]);
    setNewItemText("");
  };

  const startEdit = (item) => {
    setEditingItem(item.id);
    setEditText(item.text);
    setExpandedItem(null); // close comment panel if open
  };

  const saveEdit = () => {
    if (!editText.trim()) return;
    const updated = items.map(item =>
      item.id === editingItem ? { ...item, text: editText.trim() } : item
    );
    onChange(updated);
    setEditingItem(null);
    setEditText("");
    lastSaveTimeRef.current = Date.now();
  };

  const cancelEdit = () => {
    setEditingItem(null);
    setEditText("");
    lastSaveTimeRef.current = Date.now(); // also block phantom delete after cancel
  };

  const deleteItem = (itemId) => {
    // Ignore delete if we just saved an edit (<500ms ago) — phantom click
    if (Date.now() - lastSaveTimeRef.current < 500) return;
    if (!confirm("Smazat položku?")) return;
    onChange(items.filter(i => i.id !== itemId));
    if (expandedItem === itemId) setExpandedItem(null);
    if (editingItem === itemId) cancelEdit();
  };

  const toggleItem = (itemId) => {
    const updated = items.map(item => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        done: !item.done,
        doneBy: !item.done ? userName : null,
        doneAt: !item.done ? new Date().toISOString() : null,
      };
    });
    onChange(updated);

    // Check if all items are now complete
    if (updated.length > 0 && updated.every(item => item.done) && onAllCompleted) {
      setTimeout(onAllCompleted, 200);
    }
  };

  const sendItemComment = (itemId) => {
    if (!itemCommentInput.trim() || !onAddComment || !taskId) return;
    onAddComment(taskId, itemCommentInput.trim(), itemId);
    setItemCommentInput("");
  };

  const doneCount = items.filter(i => i.done).length;
  const totalCount = items.length;

  return (
    <div style={{ marginTop: "8px" }} onClick={e => e.stopPropagation()}>
      <div style={{
        fontSize: "10px", color: theme.textMid, fontWeight: 700,
        marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.3px"
      }}>
        Checklist ({doneCount}/{totalCount})
      </div>

      {items.map(item => {
        // Komentáře a reakce specifické pro tuto položku
        const itemComments = comments.filter(c => c.checklistItemId === item.id);
        const itemTextComments = itemComments.filter(c => c.type === "comment" || c.type === "system");
        const itemReactions = itemComments.filter(c => c.type === "reaction");
        const reactionsByEmoji = {};
        itemReactions.forEach(r => {
          if (!reactionsByEmoji[r.reaction]) reactionsByEmoji[r.reaction] = [];
          reactionsByEmoji[r.reaction].push(r);
        });
        const isExpanded = expandedItem === item.id;
        const hasActivity = itemComments.length > 0;

        return (
          <div key={item.id} style={{ marginBottom: "3px" }}>
            {/* Row — checkbox + text + expand button */}
            <div style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "6px 8px", borderRadius: "6px",
              background: item.done ? `${theme.green}08` : theme.inputBg,
              border: `1px solid ${item.done ? theme.green + "15" : theme.inputBorder}`,
            }}>
              <button onClick={() => toggleItem(item.id)} style={{
                width: "22px", height: "22px", minWidth: "22px",
                borderRadius: "5px",
                border: `2px solid ${item.done ? theme.green : theme.textDim}`,
                background: item.done ? theme.green : "transparent",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: "11px", fontWeight: 800,
              }}>
                {item.done && "✓"}
              </button>

              {/* Editable text — either input (editing) or span (viewing, dblclick/click opens edit) */}
              {editingItem === item.id ? (
                <input
                  type="text"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  onBlur={saveEdit}
                  autoFocus
                  style={{
                    ...inputStyle(theme),
                    flex: 1, fontSize: "13px", padding: "3px 6px",
                    background: theme.card,
                  }}
                />
              ) : (
                <span
                  onClick={() => !item.done && startEdit(item)}
                  title={item.done ? "" : "Klikni pro úpravu"}
                  style={{
                    flex: 1, fontSize: "13px",
                    color: item.done ? theme.textSub : theme.text,
                    textDecoration: item.done ? "line-through" : "none",
                    lineHeight: 1.3,
                    cursor: item.done ? "default" : "text",
                  }}>
                  {item.text}
                  {item.done && item.doneBy && (
                    <span style={{ fontSize: "10px", color: theme.textMid, marginLeft: "6px" }}>
                      — {item.doneBy}{item.doneAt ? `, ${formatTimeTrace(item.doneAt)}` : ""}
                    </span>
                  )}
                </span>
              )}

              {/* Action buttons */}
              {editingItem === item.id ? (
                <>
                  <button onMouseDown={(e) => { e.preventDefault(); saveEdit(); }} title="Uložit" style={{
                    ...buttonStyle(), width: "26px", height: "22px", padding: 0,
                    background: theme.green, color: "#fff", border: "none",
                    fontSize: "13px", fontWeight: 800,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>✓</button>
                  <button onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }} title="Zrušit" style={{
                    ...buttonStyle(), width: "24px", height: "22px", padding: 0,
                    background: "transparent", color: theme.textSub,
                    border: `1px solid ${theme.inputBorder}`, fontSize: "12px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>×</button>
                </>
              ) : (
                <>
                  {/* Delete button */}
                  <button
                    onClick={() => deleteItem(item.id)}
                    title="Smazat položku"
                    style={{
                      ...buttonStyle(), width: "24px", height: "22px", padding: 0,
                      background: "transparent", color: theme.red,
                      border: `1px solid ${theme.red}25`, borderRadius: "5px",
                      fontSize: "12px", opacity: 0.6,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>🗑</button>

                  {/* Comment/reaction indicator + toggle button */}
                  {taskId && onAddComment && (
                    <button
                      onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                      title={hasActivity ? `${itemComments.length} komentářů/reakcí` : "Přidat komentář"}
                      style={{
                        ...buttonStyle(),
                        minWidth: "28px", height: "22px", padding: "0 6px",
                        fontSize: "11px",
                        background: isExpanded ? theme.accentSoft : (hasActivity ? theme.accentSoft : "transparent"),
                        color: hasActivity ? theme.accent : theme.textDim,
                        border: `1px solid ${hasActivity ? theme.accentBorder : theme.inputBorder}`,
                        borderRadius: "10px",
                        display: "flex", alignItems: "center", gap: "3px",
                      }}>
                      💬
                      {itemComments.length > 0 && (
                        <span style={{ fontSize: "9px", fontWeight: 700 }}>{itemComments.length}</span>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Expanded comment panel */}
            {isExpanded && taskId && onAddComment && (
              <div style={{
                marginLeft: "30px", marginTop: "4px", padding: "8px 10px",
                background: theme.inputBg,
                border: `1px solid ${theme.accentBorder}`,
                borderLeft: `3px solid ${theme.accent}`,
                borderRadius: "0 6px 6px 0",
                animation: "slideUp 0.15s",
              }}>
                {/* Reaction bar */}
                {onToggleReaction && (
                  <div style={{ display: "flex", gap: "3px", marginBottom: "6px", flexWrap: "wrap" }}>
                    {REACTION_EMOJIS.map(emoji => {
                      const list = reactionsByEmoji[emoji] || [];
                      const mine = list.some(r => r.author === userName);
                      return (
                        <button key={emoji}
                          onClick={() => onToggleReaction(taskId, emoji, item.id)}
                          title={list.length > 0 ? list.map(r => r.author).join(", ") : "Reagovat"}
                          style={{
                            ...buttonStyle(),
                            padding: "2px 7px", fontSize: "12px",
                            background: mine ? theme.accentSoft : theme.card,
                            color: mine ? theme.accent : theme.textSub,
                            border: `1px solid ${mine ? theme.accentBorder : theme.inputBorder}`,
                            borderRadius: "10px",
                            display: "inline-flex", alignItems: "center", gap: "2px",
                          }}>
                          <span>{emoji}</span>
                          {list.length > 0 && (
                            <span style={{ fontSize: "9px", fontWeight: 700 }}>{list.length}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Comments */}
                {itemTextComments.length > 0 && (
                  <div style={{ marginBottom: "6px" }}>
                    {itemTextComments.map(c => {
                      const isMine = c.author === userName;
                      return (
                        <div key={c.id} style={{
                          padding: "4px 8px", marginBottom: "3px",
                          background: isMine ? `${theme.accent}10` : theme.card,
                          borderRadius: "6px", fontSize: "11px",
                          border: `1px solid ${isMine ? theme.accentBorder : theme.cardBorder}`,
                        }}>
                          <div style={{
                            display: "flex", alignItems: "center", gap: "5px",
                            marginBottom: "1px",
                          }}>
                            <span style={{ fontWeight: 700, color: theme.text, fontSize: "10px" }}>
                              {c.author}
                            </span>
                            <span style={{ fontSize: "9px", color: theme.textMid }}>
                              {new Date(c.createdAt).toLocaleString("cs-CZ", {
                                day: "numeric", month: "short",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div style={{ color: theme.text, lineHeight: 1.35 }}>
                            {c.content}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Input for new comment on this item */}
                <div style={{ display: "flex", gap: "4px" }}>
                  <input
                    type="text"
                    value={itemCommentInput}
                    onChange={e => setItemCommentInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendItemComment(item.id)}
                    placeholder={`Komentář k: ${item.text.slice(0, 24)}${item.text.length > 24 ? "…" : ""}`}
                    style={{ ...inputStyle(theme), fontSize: "11px", padding: "6px 8px", flex: 1 }}
                  />
                  <button
                    onClick={() => sendItemComment(item.id)}
                    disabled={!itemCommentInput.trim()}
                    style={{
                      ...buttonStyle(), padding: "6px 10px", fontSize: "12px",
                      background: itemCommentInput.trim() ? theme.accent : theme.buttonBg,
                      color: "#fff",
                      opacity: itemCommentInput.trim() ? 1 : 0.4,
                    }}>→</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: "5px", marginTop: "5px" }}>
        <input
          placeholder="Přidat položku..."
          value={newItemText}
          onChange={e => setNewItemText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addItem()}
          style={{ ...inputStyle(theme), fontSize: "13px", padding: "8px 10px", flex: 1 }}
        />
        <button onClick={addItem} style={{
          ...buttonStyle(), padding: "8px 14px",
          background: theme.accent, color: "#fff", fontSize: "14px"
        }}>+</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   IMAGES COMPONENT
   ═══════════════════════════════════════════════════════ */

function ImageAttachments({ images = [], onChange, theme }) {
  const fileInputRef = useRef();

  const addImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1048576) { alert("Max 1 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => onChange([...images, { id: generateId(), data: reader.result }]);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div style={{ marginTop: "8px" }} onClick={e => e.stopPropagation()}>
      {images.length > 0 && (
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "6px" }}>
          {images.map(img => (
            <div key={img.id} style={{
              position: "relative", width: "56px", height: "56px",
              borderRadius: "6px", overflow: "hidden",
              border: `1px solid ${theme.cardBorder}`
            }}>
              <img src={img.data} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button onClick={() => onChange(images.filter(i => i.id !== img.id))} style={{
                position: "absolute", top: "1px", right: "1px",
                background: "rgba(0,0,0,0.65)", border: "none", color: "#fff",
                borderRadius: "50%", width: "16px", height: "16px",
                fontSize: "10px", cursor: "pointer", lineHeight: "16px",
                textAlign: "center", padding: 0,
              }}>×</button>
            </div>
          ))}
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={addImage} style={{ display: "none" }} />
      <button onClick={() => fileInputRef.current?.click()} style={{
        ...buttonStyle(),
        background: theme.inputBg, border: `1px solid ${theme.inputBorder}`,
        color: theme.textSub, padding: "6px 12px", fontSize: "11px",
      }}>📷 Fotka</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ACTION BUTTON
   ═══════════════════════════════════════════════════════ */

function ActionButton({ label, onClick, theme, subtle, green, style: extraStyle }) {
  return (
    <button onClick={onClick} style={{
      ...buttonStyle(),
      padding: "6px 12px", fontSize: "12px",
      background: subtle ? "transparent" : green ? `${theme.green}15` : `${theme.accent}12`,
      color: subtle ? theme.textSub : green ? theme.green : theme.accent,
      border: `1px solid ${subtle ? theme.cardBorder : green ? theme.green + "30" : theme.accent + "25"}`,
      ...extraStyle,
    }}>{label}</button>
  );
}

/* ═══════════════════════════════════════════════════════
   DELETE BUTTON WITH CONFIRMATION
   ═══════════════════════════════════════════════════════ */

function DeleteButton({ taskId, taskTitle, onDelete, theme, permanent }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} style={{
        ...buttonStyle(),
        marginTop: permanent ? "0px" : "12px", padding: "6px 12px", fontSize: "11px",
        background: `${theme.red}10`, color: theme.red,
        border: `1px solid ${theme.red}30`,
        display: "flex", alignItems: "center", gap: "4px",
      }}>
        🗑 {permanent ? "Trvale smazat" : "Smazat úkol"}
      </button>
    );
  }

  const shortTitle = taskTitle.length > 25 ? taskTitle.slice(0, 25) + "…" : taskTitle;

  return (
    <div style={{
      marginTop: permanent ? "0px" : "12px", padding: "10px",
      background: `${theme.red}0a`, border: `1px solid ${theme.red}30`,
      borderRadius: "8px",
    }}>
      <div style={{ fontSize: "12px", color: theme.text, marginBottom: "8px" }}>
        {permanent
          ? <>Trvale smazat <strong>"{shortTitle}"</strong>? Nelze vrátit zpět.</>
          : <>Smazat <strong>"{shortTitle}"</strong>? Přesune se do koše (30 dní).</>
        }
      </div>
      <div style={{ display: "flex", gap: "6px" }}>
        <button onClick={() => { onDelete(taskId); setConfirming(false); }} style={{
          ...buttonStyle(), padding: "6px 14px", fontSize: "12px",
          background: theme.red, color: "#fff",
        }}>{permanent ? "Trvale smazat" : "Ano, do koše"}</button>
        <button onClick={() => setConfirming(false)} style={{
          ...buttonStyle(), padding: "6px 14px", fontSize: "12px",
          background: "transparent", color: theme.textSub,
          border: `1px solid ${theme.cardBorder}`,
        }}>Zrušit</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TASK COMMENTS — chat panel shown inside TaskDetail
   ═══════════════════════════════════════════════════════ */

function TaskComments({ task, comments, currentUser, onAdd, onToggleReaction, onMarkSeen, onEdit, onDelete, theme }) {
  const [input, setInput] = useState("");

  // Separate comments from reactions
  const textComments = comments.filter(c => c.type === "comment" || c.type === "system");
  const reactions = comments.filter(c => c.type === "reaction");

  // Group reactions by emoji
  const reactionsByEmoji = {};
  reactions.forEach(r => {
    if (!reactionsByEmoji[r.reaction]) reactionsByEmoji[r.reaction] = [];
    reactionsByEmoji[r.reaction].push(r);
  });

  // Auto mark as seen on mount/when comments change
  useEffect(() => {
    const unseen = comments.filter(c =>
      c.author !== currentUser.name && !c.seenBy?.includes(currentUser.name)
    );
    if (unseen.length > 0 && onMarkSeen) {
      onMarkSeen(unseen.map(c => c.id));
    }
  }, [comments, currentUser.name, onMarkSeen]);

  const submit = () => {
    if (input.trim()) {
      onAdd(input.trim());
      setInput("");
    }
  };

  return (
    <div style={{
      marginTop: "12px", paddingTop: "10px",
      borderTop: `1px solid ${theme.cardBorder}`,
    }} onClick={e => e.stopPropagation()}>
      <div style={{
        fontSize: "10px", color: theme.textMid, fontWeight: 700,
        marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.3px",
        display: "flex", alignItems: "center", gap: "6px",
      }}>
        💬 Komentáře {textComments.length > 0 && `(${textComments.length})`}
      </div>

      {/* Reaction bar + Edit/Delete buttons on the right */}
      <div style={{
        display: "flex", gap: "4px", flexWrap: "wrap",
        marginBottom: "8px", alignItems: "center",
      }}>
        {REACTION_EMOJIS.map(emoji => {
          const list = reactionsByEmoji[emoji] || [];
          const mine = list.some(r => r.author === currentUser.name);
          return (
            <button key={emoji}
              onClick={() => onToggleReaction(emoji)}
              title={list.length > 0 ? list.map(r => r.author).join(", ") : "Reagovat"}
              style={{
                ...buttonStyle(),
                padding: "3px 8px", fontSize: "13px",
                background: mine ? theme.accentSoft : theme.inputBg,
                color: mine ? theme.accent : theme.textSub,
                border: `1px solid ${mine ? theme.accentBorder : theme.inputBorder}`,
                borderRadius: "12px",
                display: "inline-flex", alignItems: "center", gap: "3px",
              }}>
              <span>{emoji}</span>
              {list.length > 0 && (
                <span style={{ fontSize: "10px", fontWeight: 700 }}>{list.length}</span>
              )}
            </button>
          );
        })}
        {/* Spacer pushes action buttons to the right */}
        <span style={{ flex: 1 }} />
        {/* Edit + Delete — compact, next to reactions */}
        {onEdit && task.status !== "deleted" && (
          <button onClick={onEdit} title="Upravit úkol" style={{
            ...buttonStyle(),
            padding: "3px 8px", fontSize: "12px",
            background: theme.accentSoft, color: theme.accent,
            border: `1px solid ${theme.accentBorder}`,
            borderRadius: "12px",
            display: "inline-flex", alignItems: "center", gap: "3px",
          }}>
            ✏️
          </button>
        )}
        {onDelete && task.status !== "deleted" && (
          <button onClick={onDelete} title="Smazat úkol" style={{
            ...buttonStyle(),
            padding: "3px 8px", fontSize: "12px",
            background: `${theme.red}08`, color: theme.red,
            border: `1px solid ${theme.red}25`,
            borderRadius: "12px",
            display: "inline-flex", alignItems: "center", gap: "3px",
          }}>
            🗑
          </button>
        )}
      </div>

      {/* Comments list */}
      {textComments.length > 0 && (
        <div style={{ marginBottom: "8px" }}>
          {textComments.map(c => {
            const isMine = c.author === currentUser.name;
            const isSystem = c.type === "system";
            return (
              <div key={c.id} style={{
                padding: "6px 10px", marginBottom: "4px",
                background: isSystem
                  ? `${theme.purple}08`
                  : (isMine ? theme.accentSoft : theme.inputBg),
                borderRadius: "8px", fontSize: "12px",
                border: `1px solid ${isSystem ? theme.purple + "25" : (isMine ? theme.accentBorder : theme.inputBorder)}`,
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  marginBottom: "2px",
                }}>
                  <span style={{
                    fontWeight: 700,
                    color: isSystem ? theme.purple : theme.text,
                    fontSize: "11px",
                  }}>
                    {isSystem ? "✏️ " : ""}{c.author}
                  </span>
                  <span style={{ fontSize: "10px", color: theme.textMid }}>
                    {new Date(c.createdAt).toLocaleString("cs-CZ", {
                      day: "numeric", month: "short",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>
                <div style={{
                  color: isSystem ? theme.purple : theme.text,
                  fontStyle: isSystem ? "italic" : "normal",
                  lineHeight: 1.4,
                }}>
                  {c.content}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Input */}
      <div style={{ display: "flex", gap: "5px" }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Napsat komentář..."
          style={{ ...inputStyle(theme), fontSize: "12px", padding: "7px 10px", flex: 1 }}
        />
        <button onClick={submit} disabled={!input.trim()} style={{
          ...buttonStyle(), padding: "7px 14px",
          background: input.trim() ? theme.accent : theme.buttonBg,
          color: "#fff", fontSize: "13px",
          opacity: input.trim() ? 1 : 0.4,
        }}>→</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TASK DETAIL (inline edit panel)
   ═══════════════════════════════════════════════════════ */

function TaskDetail({ task, currentUser, users, onUpdate, onStatusChange, onDelete, onRestore, onPermanentDelete, theme, showCompleteBanner, onClose, comments = [], onAddComment, onToggleReaction, onMarkCommentsSeen, onTriggerCompleteAnim }) {
  const otherUsers = users.filter(u => u.name !== currentUser.name);
  const canAct = task.assignTo === "both" || task.assignedTo?.includes(currentUser.name) || task.createdBy === currentUser.name;
  const taskIsDone = isDone(task);

  // ── VIEW MODE vs EDIT MODE ──
  // Default: view mode (read-only + action buttons + functional checklist checkboxes)
  // After clicking ✏️ Upravit: edit mode (all fields editable)
  const [isEditing, setIsEditing] = useState(false);

  // ── LOCAL STATE for ALL editable fields ──
  // Changes are stored locally and committed to the store only on 💾 Uložit změny.
  // This prevents the task from jumping around the list while editing.
  const [editTitle, setEditTitle]       = useState(task.title);
  const [editNote, setEditNote]         = useState(task.note || "");
  const [editPriority, setEditPriority] = useState(task.priority || "low");
  const [editCategory, setEditCategory] = useState(task.category || "other");
  const [editAssignTo, setEditAssignTo] = useState(task.assignTo || "self");
  const [editAssignedTo, setEditAssignedTo] = useState(task.assignedTo || [currentUser.name]);
  const [editRecDays, setEditRecDays]   = useState(task.recDays || 0);
  const [editActiveMo, setEditActiveMo] = useState(task.activeMo || []);
  const [editDueDate, setEditDueDate]   = useState(task.dueDate || "");
  const [editShowFrom, setEditShowFrom] = useState(task.showFrom || "");
  const [editType, setEditType]         = useState(task.type || "simple");

  // Detect if any field changed
  const arraysEqual = (a, b) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    const sa = [...a].sort(), sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
  };

  const hasPendingChanges =
    editTitle !== task.title ||
    editNote !== (task.note || "") ||
    editPriority !== (task.priority || "low") ||
    editCategory !== (task.category || "other") ||
    editAssignTo !== (task.assignTo || "self") ||
    !arraysEqual(editAssignedTo, task.assignedTo) ||
    editRecDays !== (task.recDays || 0) ||
    !arraysEqual(editActiveMo, task.activeMo) ||
    editDueDate !== (task.dueDate || "") ||
    editShowFrom !== (task.showFrom || "") ||
    editType !== (task.type || "simple");

  const saveAllChanges = () => {
    const changes = {};
    if (editTitle !== task.title) changes.title = editTitle;
    if (editNote !== (task.note || "")) changes.note = editNote.trim() || null;
    if (editPriority !== (task.priority || "low")) changes.priority = editPriority;
    if (editCategory !== (task.category || "other")) changes.category = editCategory;
    if (editAssignTo !== (task.assignTo || "self")) changes.assignTo = editAssignTo;
    if (!arraysEqual(editAssignedTo, task.assignedTo)) changes.assignedTo = editAssignedTo;
    if (editRecDays !== (task.recDays || 0)) changes.recDays = editRecDays;
    if (!arraysEqual(editActiveMo, task.activeMo)) changes.activeMo = editActiveMo;
    if (editDueDate !== (task.dueDate || "")) changes.dueDate = editDueDate || null;
    if (editShowFrom !== (task.showFrom || "")) changes.showFrom = editShowFrom || null;
    if (editType !== (task.type || "simple")) changes.type = editType;
    if (Object.keys(changes).length > 0) onUpdate(task.id, changes);
    // After save, return to view mode
    setIsEditing(false);
  };

  const labelStyle = {
    fontSize: "10px", color: theme.textMid, fontWeight: 700,
    marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.3px"
  };

  // For fields that MUST commit immediately (checklist items, images) we still use onUpdate.
  // For deferred fields, use local setters above.
  const commitImmediate = (key, value) => onUpdate(task.id, { [key]: value });

  const quickDates = [
    { label: "Ihned",  value: addDays(0) },
    { label: "1 den",  value: addDays(1) },
    { label: "3 dny",  value: addDays(3) },
    { label: "Týden",  value: addDays(7) },
    { label: "14 dní", value: addDays(14) },
    { label: "Měsíc",  value: addDays(30) },
  ];

  // ═══════════════════════════════════════════════════════
  // VIEW MODE — read-only overview with functional checklist + actions
  // Default until user clicks ✏️ Upravit
  // ═══════════════════════════════════════════════════════
  if (!isEditing) {
    const priObj = getPriority(task.priority || "low");
    const priTheme = theme.priority[task.priority || "low"] || theme.priority.low;
    const isForMe = task.createdBy && task.createdBy !== currentUser.name && task.assignedTo?.includes(currentUser.name);
    const cat = getCategory(task.category);
    const overdue = daysDiff(task.dueDate) < 0 && !taskIsDone;
    const allChecked = (task.checklist?.length || 0) > 0 && task.checklist.every(i => i.done);

    // Handler for checkbox toggle — immediately commits
    const toggleChecklistItem = (itemId) => {
      const updated = (task.checklist || []).map(item => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          done: !item.done,
          doneBy: !item.done ? currentUser.name : null,
          doneAt: !item.done ? new Date().toISOString() : null,
        };
      });
      const someDone = updated.some(item => item.done);
      const allDone = updated.length > 0 && updated.every(item => item.done);
      const updates = { checklist: updated };
      // Pokud zatrhnu alespoň 1 (ale ne všechny) a úkol je active → in_progress
      if (someDone && !allDone && task.status === "active") {
        updates.status = "in_progress";
        updates.inProgressAt = new Date().toISOString();
      }
      onUpdate(task.id, updates);

      // Auto-complete the whole task when all checklist items are done — with animation
      if (allDone) {
        if (onTriggerCompleteAnim) {
          // Parent card will show 550ms green pulse then fire the status change
          onTriggerCompleteAnim();
        } else {
          // Fallback: just fire the change
          setTimeout(() => {
            if (task.assignTo === "both") onStatusChange(task.id, "done_my");
            else onStatusChange(task.id, "done");
          }, 300);
        }
      }
    };

    return (
      <div style={{
        marginTop: "10px",
        animation: "fadeIn 0.12s",
        display: "flex", gap: "8px", alignItems: "flex-start",
      }}
           onClick={e => e.stopPropagation()}>
        {/* Levá kolonka — Copy button přesně pod kolečkem splnění */}
        <div style={{ width: "24px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
          <CopyTaskButton task={task} theme={theme} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
        {/* Compact time trace: when completed / deleted / due / deferred */}
        {(task.completedAt || task.deletedAt || task.dueDate || (task.showFrom && daysDiff(task.showFrom) > 0) || task.recDays > 0) && (
          <div style={{
            display: "flex", gap: "8px", flexWrap: "wrap",
            marginBottom: "8px", fontSize: "11px", color: theme.textSub,
          }}>
            {task.completedAt && (
              <span style={{ color: theme.green }}>
                ✓ Splněno {formatTimeTrace(task.completedAt)}{task.completedByUser ? ` — ${task.completedByUser}` : ""}
              </span>
            )}
            {task.deletedAt && (
              <span style={{ color: theme.red }}>
                🗑 Smazáno {formatTimeTrace(task.deletedAt)}
              </span>
            )}
            {/* dueDate je už zobrazený na kartě (vpravo nahoře) — neopakujeme */}
            {task.showFrom && daysDiff(task.showFrom) > 0 && (
              <span style={{ color: theme.purple }}>
                ⏰ Odloženo do {formatDate(task.showFrom)}
              </span>
            )}
            {task.recDays > 0 && (
              <span style={{ color: theme.purple }}>
                🔄 {RECURRENCE_OPTIONS.find(r => r.value === task.recDays)?.label || `${task.recDays}d`}
              </span>
            )}
          </div>
        )}

        {/* Note (if exists) — read-only */}
        {task.note && task.note.trim() && (
          <div style={{
            padding: "8px 10px", marginBottom: "10px",
            background: theme.inputBg,
            border: `1px solid ${theme.inputBorder}`,
            borderRadius: "6px",
            fontSize: "13px", color: theme.text, lineHeight: 1.4,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            userSelect: "text",
          }}>
            {task.note}
          </div>
        )}

        {/* ── Scratch pad (pracovní deník) — always visible in View mode ── */}
        <ScratchPadInline
          task={task}
          currentUser={currentUser}
          onUpdate={onUpdate}
          theme={theme}
        />

        {/* Checklist — FUNCTIONAL checkboxes (not edit mode!)  */}
        {task.checklist && task.checklist.length > 0 && (
          <div style={{ marginBottom: "10px" }}>
            <div style={{
              fontSize: "10px", color: theme.textMid, fontWeight: 700,
              marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.3px",
            }}>
              Seznam ({task.checklist.filter(i => i.done).length}/{task.checklist.length})
            </div>
            {task.checklist.map(item => {
              const itemComments = comments.filter(c => c.checklistItemId === item.id);
              const hasNotes = (item.notes || []).length > 0;
              return (
                <div key={item.id} style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto auto",
                  alignItems: "center", gap: "8px",
                  padding: "7px 10px", borderRadius: "6px", marginBottom: "3px",
                  background: item.done ? `${theme.green}08` : theme.inputBg,
                  border: `1px solid ${item.done ? theme.green + "15" : theme.inputBorder}`,
                }}>
                  <button
                    onClick={() => toggleChecklistItem(item.id)}
                    style={{
                      width: "24px", height: "24px", minWidth: "24px",
                      borderRadius: "5px",
                      border: `2px solid ${item.done ? theme.green : theme.textDim}`,
                      background: item.done ? theme.green : "transparent",
                      cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontSize: "12px", fontWeight: 800,
                    }}>
                    {item.done && "✓"}
                  </button>
                  <span style={{
                    fontSize: "13px",
                    color: item.done ? theme.textSub : theme.text,
                    textDecoration: item.done ? "line-through" : "none",
                    lineHeight: 1.3,
                  }}>
                    {item.text}
                    {item.done && item.doneBy && (
                      <span style={{ fontSize: "10px", color: theme.textMid, marginLeft: "6px" }}>
                        — {item.doneBy}{item.doneAt ? `, ${formatTimeTrace(item.doneAt)}` : ""}
                      </span>
                    )}
                  </span>
                  {itemComments.length > 0 && (
                    <span title={`${itemComments.length} komentářů`} style={{
                      fontSize: "10px", fontWeight: 700, color: theme.accent,
                      padding: "1px 6px", borderRadius: "8px",
                      background: theme.accentSoft,
                      border: `1px solid ${theme.accentBorder}`,
                    }}>
                      💬 {itemComments.length}
                    </span>
                  )}
                  <ChecklistItemNotes
                    item={item}
                    currentUser={currentUser}
                    theme={theme}
                    defaultExpanded={hasNotes}
                    onUpdateItem={(itemId, patch) => {
                      const updated = task.checklist.map(it =>
                        it.id === itemId ? { ...it, ...patch } : it
                      );
                      onUpdate(task.id, { checklist: updated });
                    }}
                  />
                </div>
              );
            })}
            {/* Splnit vše button — pod seznamem, jen když nejsou všechny splněné */}
            {!taskIsDone && canAct && !task.checklist.every(i => i.done) && (
              <button
                onClick={() => {
                  // Mark all items done
                  const updated = task.checklist.map(item => ({
                    ...item,
                    done: true,
                    doneBy: item.doneBy || currentUser.name,
                    doneAt: item.doneAt || new Date().toISOString(),
                  }));
                  onUpdate(task.id, { checklist: updated });
                  // Auto-complete the whole task (same as clicking "Hotovo")
                  setTimeout(() => onStatusChange(task.id, "complete"), 100);
                }}
                style={{
                  ...buttonStyle(),
                  width: "100%", padding: "8px",
                  marginTop: "4px",
                  background: `${theme.green}15`, color: theme.green,
                  border: `1px solid ${theme.green}30`,
                  fontSize: "12px", fontWeight: 600,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                }}>
                ✓ Splnit vše
              </button>
            )}
          </div>
        )}

        {/* Images — view only */}
        {task.images && task.images.length > 0 && (
          <div style={{ marginBottom: "10px" }}>
            <div style={{
              fontSize: "10px", color: theme.textMid, fontWeight: 700,
              marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.3px",
            }}>
              Fotky ({task.images.length})
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {task.images.map(img => (
                <img key={img.id} src={img.data} alt=""
                  style={{
                    width: "80px", height: "80px", objectFit: "cover",
                    borderRadius: "6px", border: `1px solid ${theme.inputBorder}`,
                    cursor: "pointer",
                  }}
                  onClick={() => window.open(img.data, "_blank")}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── ACTIONS — pouze pro speciální případy (splněno → vrátit, společné → odškrnout) ── */}
        {task.status !== "deleted" && (canAct && (
          (taskIsDone) ||
          (task.assignTo === "both" && task.doneBy?.includes(currentUser.name))
        )) && (
          <div style={{
            display: "flex", gap: "5px", flexWrap: "wrap",
            marginTop: "10px",
          }}>
            {/* U úkolů s checklistem — akce pro společné úkoly (pokud už jsem zaškrtl checkliste items ale chci potvrdit) */}
            {canAct && !taskIsDone && task.assignTo === "both" && task.doneBy?.includes(currentUser.name) && (
              <ActionButton label="↩ Odškrnout mě" onClick={() => onStatusChange(task.id, "unmark")} theme={theme} subtle />
            )}

            {taskIsDone && (
              <ActionButton label="↩ Vrátit zpět" onClick={() => onStatusChange(task.id, "reopen")} theme={theme} subtle />
            )}
          </div>
        )}

        {/* Trash-view only: Restore + Permanent delete */}
        {task.status === "deleted" && (
          <div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
            <button onClick={() => onRestore(task.id)} style={{
              ...buttonStyle(), padding: "6px 14px", fontSize: "12px",
              background: `${theme.green}15`, color: theme.green,
              border: `1px solid ${theme.green}30`,
            }}>↩ Obnovit</button>
            <DeleteButton taskId={task.id} taskTitle={task.title} onDelete={onPermanentDelete} theme={theme} permanent />
          </div>
        )}

        {/* Komentáře + Edit/Delete buttons — komentáře skryté u osobních úkolů (self-created + self-assigned) */}
        {(() => {
          const isPersonalMonolog =
            task.createdBy === currentUser.name &&
            task.assignTo === "self" &&
            (task.assignedTo || []).every(n => n === currentUser.name);
          if (isPersonalMonolog) {
            // Just show the Edit + Delete buttons, no comments/reactions
            return (
              <div style={{
                display: "flex", gap: "4px", marginTop: "12px",
                paddingTop: "10px", borderTop: `1px solid ${theme.cardBorder}`,
                justifyContent: "flex-end",
              }}>
                {task.status !== "deleted" && (
                  <button onClick={() => setIsEditing(true)} title="Upravit úkol" style={{
                    ...buttonStyle(),
                    padding: "3px 10px", fontSize: "12px",
                    background: theme.accentSoft, color: theme.accent,
                    border: `1px solid ${theme.accentBorder}`,
                    borderRadius: "12px",
                    display: "inline-flex", alignItems: "center", gap: "3px",
                  }}>
                    ✏️ Upravit
                  </button>
                )}
                {onDelete && task.status !== "deleted" && (
                  <button onClick={() => onDelete(task.id)} title="Smazat úkol" style={{
                    ...buttonStyle(),
                    padding: "3px 10px", fontSize: "12px",
                    background: `${theme.red}08`, color: theme.red,
                    border: `1px solid ${theme.red}25`,
                    borderRadius: "12px",
                    display: "inline-flex", alignItems: "center", gap: "3px",
                  }}>
                    🗑 Smazat
                  </button>
                )}
              </div>
            );
          }
          return (
            <TaskComments
              task={task}
              comments={comments.filter(c => c.taskId === task.id && !c.checklistItemId)}
              currentUser={currentUser}
              onAdd={(text) => onAddComment && onAddComment(task.id, text, null)}
              onToggleReaction={(emoji) => onToggleReaction && onToggleReaction(task.id, emoji, null)}
              onMarkSeen={onMarkCommentsSeen}
              onEdit={() => setIsEditing(true)}
              onDelete={onDelete ? () => onDelete(task.id) : null}
              theme={theme}
            />
          );
        })()}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // EDIT MODE — all fields editable, save via 💾 button
  // ═══════════════════════════════════════════════════════
  return (
    <div style={{ marginTop: "10px", paddingLeft: "32px", animation: "fadeIn 0.12s" }}
         onClick={e => e.stopPropagation()}>

      {/* ── Top bar: Back to view + cycling priority ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px",
      }}>
        <button
          onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}
          title="Zpět na detail (bez uložení)"
          style={{
            ...buttonStyle(),
            padding: "6px 10px", fontSize: "12px",
            background: theme.inputBg, color: theme.textSub,
            border: `1px solid ${theme.inputBorder}`,
            display: "flex", alignItems: "center", gap: "4px",
          }}>
          ← Zpět na detail
        </button>

        <span style={{ flex: 1 }} />

        {/* Save button in top bar — always visible in edit mode */}
        {hasPendingChanges && (
          <button onClick={saveAllChanges} style={{
            ...buttonStyle(),
            padding: "6px 14px", fontSize: "12px", fontWeight: 700,
            background: theme.accent, color: "#fff",
            border: "none",
            display: "flex", alignItems: "center", gap: "4px",
          }}>
            💾 Uložit
          </button>
        )}
      </div>

      {/* ── Complete banner ── */}
      {showCompleteBanner && !taskIsDone && canAct && (
        <div style={{
          background: `${theme.green}15`, border: `1px solid ${theme.green}30`,
          borderRadius: "8px", padding: "10px 12px", marginBottom: "10px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: "13px", color: theme.green, fontWeight: 600 }}>
            ✓ Checklist kompletní!
          </span>
          <button onClick={() => onStatusChange(task.id, task.assignTo === "both" ? "done_all" : "done")}
            style={{
              ...buttonStyle(), padding: "6px 14px",
              background: theme.green, color: "#fff", fontSize: "12px",
            }}>
            Uzavřít úkol
          </button>
        </div>
      )}

      {/* ── Editable title (local state) ── */}
      <input
        type="text"
        value={editTitle}
        onChange={e => setEditTitle(e.target.value)}
        style={{
          ...inputStyle(theme), fontSize: "15px", fontWeight: 600,
          marginBottom: "6px", padding: "8px 10px",
        }}
      />

      {/* ── Note (local state) ── */}
      <textarea
        placeholder="Přidat poznámku..."
        value={editNote}
        onChange={e => setEditNote(e.target.value)}
        rows={2}
        style={{
          ...inputStyle(theme), fontSize: "13px",
          marginBottom: "6px", resize: "vertical", lineHeight: 1.4,
        }}
      />

      {!taskIsDone && (
        <>
          {/* ── Typ + Priorita (řádek 1) ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px", marginBottom: "8px", alignItems: "start" }}>
            <div>
              <div style={labelStyle}>Typ</div>
              <div style={{
                display: "flex", gap: "0",
                border: `1px solid ${theme.cardBorder}`, borderRadius: "8px", overflow: "hidden",
              }}>
                <button
                  onClick={() => setEditType("simple")}
                  style={{
                    ...buttonStyle(), flex: 1, padding: "8px", fontSize: "12px",
                    background: editType === "simple" ? theme.accent : "transparent",
                    color: editType === "simple" ? "#fff" : theme.textSub,
                    border: "none",
                  }}>
                  ✓ Jednoduchý
                </button>
                <button
                  onClick={() => setEditType("complex")}
                  style={{
                    ...buttonStyle(), flex: 1, padding: "8px", fontSize: "12px",
                    background: editType === "complex" ? theme.accent : "transparent",
                    color: editType === "complex" ? "#fff" : theme.textSub,
                    border: "none",
                  }}>
                  ☰ S checklistem
                </button>
              </div>
            </div>
            {/* Priorita jako přepínatelná ikona: — → ! → ‼ → — */}
            <div>
              <div style={labelStyle}>Priorita</div>
              {(() => {
                const priObj = getPriority(editPriority);
                const priTheme = theme.priority[editPriority] || theme.priority.low;
                const isDefault = editPriority === "low";
                const cycleNext = () => {
                  const next = editPriority === "low" ? "important"
                             : editPriority === "important" ? "urgent"
                             : "low";
                  setEditPriority(next);
                };
                return (
                  <button
                    onClick={cycleNext}
                    title={`${priObj.label} (klikni pro změnu)`}
                    style={{
                      ...buttonStyle(),
                      padding: "8px 14px", fontSize: "16px", fontWeight: 900,
                      background: isDefault ? "transparent" : priTheme.cardBg,
                      color: isDefault ? theme.textDim : priTheme.text,
                      border: `2px solid ${isDefault ? theme.inputBorder : priTheme.border}`,
                      borderRadius: "8px",
                      minWidth: "70px",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                      transition: "all 0.2s",
                    }}>
                    <span style={{ fontSize: "18px" }}>{priObj.sym}</span>
                    <span style={{ fontSize: "11px", fontWeight: 700 }}>{priObj.label}</span>
                  </button>
                );
              })()}
            </div>
          </div>

          {/* ── Kategorie (dropdown) ── */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>Kategorie</div>
            <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
              style={{ ...inputStyle(theme), padding: "8px", fontSize: "13px", width: "100%" }}>
              {CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>

          {/* ── Pro koho (chipy) ── */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>Pro koho</div>
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              {users.map(u => {
                const isSelected = editAssignedTo?.includes(u.name);
                return (
                  <button
                    key={u.name}
                    onClick={() => {
                      let newList;
                      if (isSelected) {
                        // Odebrat (ale nesmíme nechat prázdné)
                        newList = editAssignedTo.filter(n => n !== u.name);
                        if (newList.length === 0) return; // neprázdněno
                      } else {
                        newList = [...(editAssignedTo || []), u.name];
                      }
                      setEditAssignedTo(newList);
                      // Dopočítáme assignTo
                      if (newList.length === 1 && newList[0] === currentUser.name) {
                        setEditAssignTo("self");
                      } else if (newList.length === users.length) {
                        setEditAssignTo("both");
                      } else {
                        setEditAssignTo("person");
                      }
                    }}
                    style={{
                      ...buttonStyle(),
                      padding: "6px 12px", fontSize: "12px", fontWeight: 600,
                      background: isSelected ? theme.accentSoft : theme.inputBg,
                      color: isSelected ? theme.accent : theme.textSub,
                      border: `1px solid ${isSelected ? theme.accentBorder : theme.inputBorder}`,
                      borderRadius: "14px",
                      display: "inline-flex", alignItems: "center", gap: "4px",
                    }}>
                    {isSelected ? "✓" : "○"} {u.name}
                  </button>
                );
              })}
              {/* Všichni shortcut */}
              {users.length > 1 && (
                <button
                  onClick={() => {
                    const all = users.map(u => u.name);
                    setEditAssignedTo(all);
                    setEditAssignTo("both");
                  }}
                  style={{
                    ...buttonStyle(),
                    padding: "6px 12px", fontSize: "12px", fontWeight: 600,
                    background: editAssignedTo?.length === users.length ? theme.accent : "transparent",
                    color: editAssignedTo?.length === users.length ? "#fff" : theme.textSub,
                    border: `1px dashed ${theme.inputBorder}`,
                    borderRadius: "14px",
                  }}>
                  👥 Všichni
                </button>
              )}
            </div>
          </div>

          {/* ── Checklist (PŘESUNUTO NAHORU - blíž ke jménu a poznámce) ── */}
          {(editType === "complex" || (task.checklist && task.checklist.length > 0)) && (
            <Checklist
              items={task.checklist || []}
              userName={currentUser.name}
              theme={theme}
              onChange={cl => commitImmediate("checklist", cl)}
              onAllCompleted={() => {
                if (onTriggerCompleteAnim) {
                  onTriggerCompleteAnim();
                } else {
                  if (task.assignTo === "both") onStatusChange(task.id, "done_my");
                  else onStatusChange(task.id, "done");
                }
              }}
              taskId={task.id}
              comments={comments}
              onAddComment={onAddComment}
              onToggleReaction={onToggleReaction}
            />
          )}

          {/* ── Recurrence (full width, standalone) ── */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>Opakování</div>
            <select value={editRecDays} onChange={e => setEditRecDays(Number(e.target.value))}
              style={{ ...inputStyle(theme), padding: "8px", fontSize: "12px" }}>
              {RECURRENCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {editRecDays > 0 && editRecDays !== 7 && editRecDays !== 30 && (
              <div style={{
                fontSize: "10px", color: theme.textSub,
                marginTop: "5px", padding: "5px 8px",
                background: theme.inputBg, borderRadius: "5px",
                lineHeight: 1.4,
              }}>
                💡 Datum prvního výskytu nastav v poli „Datum prvního výskytu" níže.
                Úkol se bude opakovat každých <strong>{editRecDays} dní</strong> od tohoto data.
              </div>
            )}
            {/* Den v týdnu pro týdenní opakování */}
            {editRecDays === 7 && (() => {
              const dayNames = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
              const currentDay = editDueDate ? ((new Date(editDueDate).getDay() + 6) % 7) : -1;
              return (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ ...labelStyle, fontSize: "10px", marginBottom: "5px" }}>
                    Den opakování
                  </div>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {dayNames.map((dayName, idx) => {
                      const isSel = currentDay === idx;
                      return (
                        <button key={idx} type="button"
                          onClick={() => {
                            const today = new Date();
                            const todayDay = (today.getDay() + 6) % 7;
                            let daysAhead = idx - todayDay;
                            if (daysAhead <= 0) daysAhead += 7;
                            const next = new Date(today);
                            next.setDate(next.getDate() + daysAhead);
                            next.setHours(12, 0, 0, 0);
                            setEditDueDate(next.toISOString().slice(0, 10));
                          }}
                          style={{
                            ...buttonStyle(),
                            padding: "6px 10px", fontSize: "11px", fontWeight: 700,
                            background: isSel ? theme.accent : theme.inputBg,
                            color: isSel ? "#fff" : theme.textSub,
                            border: `1px solid ${isSel ? theme.accent : theme.inputBorder}`,
                            borderRadius: "8px", minWidth: "36px",
                          }}>
                          {dayName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {/* Den v měsíci pro měsíční opakování */}
            {editRecDays === 30 && (() => {
              const selDay = editDueDate ? new Date(editDueDate).getDate() : -1;
              return (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ ...labelStyle, fontSize: "10px", marginBottom: "5px" }}>
                    Den v měsíci
                  </div>
                  <div style={{
                    display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "3px",
                    background: theme.inputBg, border: `1px solid ${theme.inputBorder}`,
                    borderRadius: "8px", padding: "6px",
                  }}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => {
                      const isSel = selDay === d;
                      return (
                        <button key={d} type="button"
                          onClick={() => {
                            const today = new Date();
                            const target = new Date(today.getFullYear(), today.getMonth(), d);
                            if (target < today) target.setMonth(target.getMonth() + 1);
                            target.setHours(12, 0, 0, 0);
                            setEditDueDate(target.toISOString().slice(0, 10));
                          }}
                          style={{
                            padding: "6px 0", fontSize: "11px", fontWeight: 600,
                            background: isSel ? theme.accent : "transparent",
                            color: isSel ? "#fff" : theme.text,
                            border: "none", borderRadius: "5px", cursor: "pointer",
                            fontFamily: FONT,
                          }}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  {selDay > 0 && (
                    <div style={{ fontSize: "10px", color: theme.textSub, marginTop: "5px" }}>
                      Bude se opakovat každého {selDay}. dne v měsíci
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* ── Due date with quick picks ── */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>
              {editRecDays > 0 ? "Datum prvního výskytu" : "Termín splnění"} {editDueDate && <span style={{ fontWeight: 400, textTransform: "none" }}>— {formatDate(editDueDate)}</span>}
            </div>
            <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginBottom: "4px" }}>
              {quickDates.map(qd => (
                <button key={qd.label} onClick={() => setEditDueDate(qd.value)} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: editDueDate === qd.value ? theme.accentSoft : theme.inputBg,
                  color: editDueDate === qd.value ? theme.accent : theme.textSub,
                  border: `1px solid ${editDueDate === qd.value ? theme.accentBorder : theme.inputBorder}`,
                }}>{qd.label}</button>
              ))}
              {editDueDate && (
                <button onClick={() => setEditDueDate("")} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: "transparent", color: theme.red,
                  border: `1px solid ${theme.red}25`,
                }}>✕</button>
              )}
            </div>
            <input type="date" value={editDueDate || ""}
              onChange={e => setEditDueDate(e.target.value)}
              style={{ ...inputStyle(theme), fontSize: "12px", padding: "6px 10px" }}
            />
          </div>

          {/* ── Show from — deferred tasks ── */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>
              Zobrazit od (odložit) {editShowFrom && <span style={{ fontWeight: 400, textTransform: "none" }}>— {formatDate(editShowFrom)}</span>}
            </div>
            <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginBottom: "4px" }}>
              {[
                { label: "Za týden", value: addDays(7), shiftDays: 7 },
                { label: "Za 14d", value: addDays(14), shiftDays: 14 },
                { label: "Za měsíc", value: addDays(30), shiftDays: 30 },
                { label: "Za 2 měsíce", value: addDays(60), shiftDays: 60 },
              ].map(sf => (
                <button key={sf.label} onClick={() => {
                  setEditShowFrom(sf.value);
                  // Pokud úkol má termín splnění, posunout ho o stejný počet dní
                  if (editDueDate) {
                    const shifted = shiftDueDate(editDueDate, sf.shiftDays);
                    if (shifted) setEditDueDate(shifted);
                  }
                }} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: editShowFrom === sf.value ? theme.accentSoft : theme.inputBg,
                  color: editShowFrom === sf.value ? theme.accent : theme.textSub,
                  border: `1px solid ${editShowFrom === sf.value ? theme.accentBorder : theme.inputBorder}`,
                }}>{sf.label}</button>
              ))}
              {editShowFrom && (
                <button onClick={() => setEditShowFrom("")} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: "transparent", color: theme.red,
                  border: `1px solid ${theme.red}25`,
                }}>✕ Zobrazit hned</button>
              )}
            </div>
            <input type="date" value={editShowFrom || ""}
              onChange={e => setEditShowFrom(e.target.value)}
              style={{ ...inputStyle(theme), fontSize: "12px", padding: "6px 10px" }}
            />
            {editShowFrom && (
              <div style={{ fontSize: "11px", color: theme.accent, marginTop: "3px" }}>
                📅 Úkol se zobrazí od {formatDate(editShowFrom)}{editDueDate ? `, termín ${formatDate(editDueDate)}` : ""}
              </div>
            )}
          </div>

          {/* ── Season months for recurring ── */}
          {editRecDays > 0 && (
            <div style={{ marginBottom: "8px" }}>
              <div style={labelStyle}>Aktivní měsíce (prázdné = celoročně)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                {MONTH_LABELS.map((m, i) => {
                  const monthNum = i + 1;
                  const isActive = editActiveMo.includes(monthNum);
                  return (
                    <button key={i} onClick={() => {
                      setEditActiveMo(isActive
                        ? editActiveMo.filter(x => x !== monthNum)
                        : [...editActiveMo, monthNum]
                      );
                    }} style={{
                      ...buttonStyle(), padding: "3px 6px", fontSize: "9px",
                      background: isActive ? theme.accentSoft : theme.inputBg,
                      color: isActive ? theme.accent : theme.textMid,
                      border: `1px solid ${isActive ? theme.accentBorder : theme.inputBorder}`,
                    }}>{m}</button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Images — commits immediately ── */}
      {(task.images?.length > 0 || !taskIsDone) && (
        <ImageAttachments
          images={task.images || []}
          theme={theme}
          onChange={imgs => commitImmediate("images", imgs)}
        />
      )}

      {/* ── Meta info ── */}
      <div style={{
        fontSize: "10px", color: theme.textDim, marginTop: "8px",
        display: "flex", flexDirection: "column", gap: "1px",
      }}>
        <span>Vytvořeno: {formatFullDate(task.createdAt)} ({task.createdBy})</span>
        {task.completedAt && (
          <span>Dokončeno: {formatFullDate(task.completedAt)}
            {task.completedByUser ? ` (${task.completedByUser})` : ""}
          </span>
        )}
        {task.recDays > 0 && (
          <span>🔄 {RECURRENCE_OPTIONS.find(r => r.value === task.recDays)?.label}
            {task.activeMo?.length > 0 && task.activeMo.length < 12
              ? ` (${task.activeMo.map(m => MONTH_LABELS[m - 1]).join(", ")})`
              : ""}
          </span>
        )}
      </div>

      {/* ── Action buttons ── */}
      {!taskIsDone && canAct && (
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "8px" }}>
          {task.assignTo === "both" ? (
            <>
              {!task.doneBy?.includes(currentUser.name) && (
                <ActionButton label="Moje hotovo ✓" onClick={() => onStatusChange(task.id, "done_my")} theme={theme} green />
              )}
              {task.createdBy === currentUser.name && (
                <ActionButton label="Všichni ✓" onClick={() => onStatusChange(task.id, "done_all")} theme={theme} green />
              )}
            </>
          ) : (
            <>
              {task.status !== "in_progress" && (
                <ActionButton label="◐ Rozpracováno" onClick={() => onStatusChange(task.id, "in_progress")} theme={theme} subtle />
              )}
              <ActionButton label="Splněno ✓" onClick={() => onStatusChange(task.id, "done")} theme={theme} green />
            </>
          )}
          <ActionButton label="⏰ Odlož" onClick={() => commitImmediate("showFrom", addDays(7))} theme={theme} subtle />
          {onDelete && <ActionButton label="🗑 Smazat" onClick={() => onDelete(task.id)} theme={theme} subtle />}
        </div>
      )}

      {taskIsDone && (
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "8px" }}>
          <ActionButton label="↩ Vrátit zpět" onClick={() => onStatusChange(task.id, "reopen")} theme={theme} subtle />
          {onDelete && <ActionButton label="🗑 Smazat" onClick={() => onDelete(task.id)} theme={theme} subtle />}
        </div>
      )}

      {/* Trash-view only: Restore + Permanent delete */}
      {task.status === "deleted" && (
        <div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
          <button onClick={() => onRestore(task.id)} style={{
            ...buttonStyle(), padding: "6px 14px", fontSize: "12px",
            background: `${theme.green}15`, color: theme.green,
            border: `1px solid ${theme.green}30`,
          }}>↩ Obnovit</button>
          <DeleteButton taskId={task.id} taskTitle={task.title} onDelete={onPermanentDelete} theme={theme} permanent />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   IMAGE LIGHTBOX — fullscreen view fotky
   ═══════════════════════════════════════════════════════ */

function ImageLightbox({ url, onClose }) {
  if (!url) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.92)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px", cursor: "pointer",
    }}>
      <img src={url} alt="" style={{
        maxWidth: "100%", maxHeight: "100%",
        objectFit: "contain", borderRadius: "8px",
      }} />
      <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{
        position: "absolute", top: 16, right: 16,
        width: 40, height: 40, borderRadius: "50%",
        background: "rgba(255,255,255,0.15)", color: "#fff",
        border: "none", fontSize: 20, cursor: "pointer",
      }}>×</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CHECKLIST ITEM NOTES — poznámky k jednotlivým položkám
   ═══════════════════════════════════════════════════════ */

function ChecklistItemNotes({ item, currentUser, theme, onUpdateItem, defaultExpanded = false }) {
  const notes = item.notes || [];
  const [expanded, setExpanded] = useState(defaultExpanded || notes.length > 0);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const fileInputRef = useRef(null);

  // Auto-mark unseen notes as seen po 2s expanded — uvidím = označím jako přečtené
  useEffect(() => {
    if (!expanded || notes.length === 0) return;
    const timer = setTimeout(() => {
      const hasUnseen = notes.some(n =>
        n.author !== currentUser.name && !n.seenBy?.includes(currentUser.name)
      );
      if (!hasUnseen) return;
      const updated = notes.map(n => {
        if (n.author === currentUser.name) return n;
        if (n.seenBy?.includes(currentUser.name)) return n;
        return { ...n, seenBy: [...(n.seenBy || []), currentUser.name] };
      });
      onUpdateItem(item.id, { notes: updated });
    }, 2000);
    return () => clearTimeout(timer);
  }, [expanded, notes, currentUser.name, item.id, onUpdateItem]);

  const addNote = async (imageUrl = null) => {
    if (!text.trim() && !imageUrl) return;
    const newNote = {
      id: "n_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      text: text.trim(),
      author: currentUser.name,
      createdAt: new Date().toISOString(),
      reactions: {},
      imageUrl: imageUrl || null,
      seenBy: [currentUser.name],
    };
    onUpdateItem(item.id, { notes: [...notes, newNote] });
    setText("");
  };

  const deleteNote = (noteId) => {
    if (!confirm("Smazat tuto poznámku?")) return;
    onUpdateItem(item.id, { notes: notes.filter(n => n.id !== noteId) });
  };

  const startEdit = (note) => {
    setEditingId(note.id);
    setEditText(note.text);
  };

  const saveEdit = () => {
    onUpdateItem(item.id, {
      notes: notes.map(n => n.id === editingId ? { ...n, text: editText.trim() } : n),
    });
    setEditingId(null);
    setEditText("");
  };

  const toggleReaction = (noteId, emoji) => {
    const updated = notes.map(n => {
      if (n.id !== noteId) return n;
      const reactions = { ...(n.reactions || {}) };
      const list = reactions[emoji] || [];
      if (list.includes(currentUser.name)) {
        reactions[emoji] = list.filter(u => u !== currentUser.name);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        reactions[emoji] = [...list, currentUser.name];
      }
      return { ...n, reactions };
    });
    onUpdateItem(item.id, { notes: updated });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await uploadTaskImage(file);
    setUploading(false);
    if (url) {
      await addNote(url);
    }
    e.target.value = ""; // reset input
  };

  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)} title="Přidat poznámku k položce" style={{
        width: "24px", height: "24px", minWidth: "24px",
        borderRadius: "5px", border: "none",
        background: "transparent", cursor: "pointer",
        color: theme.textDim, fontSize: "13px",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: 0.5, transition: "all 0.15s",
      }}
      onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
      onMouseLeave={(e) => e.currentTarget.style.opacity = 0.5}>
        📝
      </button>
    );
  }

  return (
    <>
      <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      <div style={{
        gridColumn: "1 / -1",
        marginTop: "6px",
        padding: "8px 10px",
        background: `${theme.purple}08`,
        border: `1px solid ${theme.purple}25`,
        borderRadius: "6px",
        display: "flex", flexDirection: "column", gap: "6px",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: "10px", fontWeight: 700, color: theme.purple,
          textTransform: "uppercase", letterSpacing: "0.4px",
        }}>
          <span>📝 Poznámky ({notes.length})</span>
          <button onClick={() => setExpanded(false)} style={{
            background: "transparent", border: "none", color: theme.textSub,
            fontSize: "12px", cursor: "pointer", padding: 0,
          }} title="Schovat">▲</button>
        </div>

        {/* List existing notes */}
        {notes.map(n => {
          const isUnseen = n.author !== currentUser.name && !n.seenBy?.includes(currentUser.name);
          return (
          <div key={n.id} style={{
            background: isUnseen ? `${theme.purple}12` : theme.card,
            border: `1px solid ${isUnseen ? theme.purple : theme.cardBorder}`,
            borderRadius: "5px",
            padding: "6px 8px",
            display: "flex", flexDirection: "column", gap: "4px",
            position: "relative",
          }}>
            {isUnseen && (
              <span style={{
                position: "absolute", top: "-4px", right: "6px",
                fontSize: "9px", fontWeight: 800, color: "#fff",
                background: theme.purple,
                padding: "1px 6px", borderRadius: "8px",
                textTransform: "uppercase", letterSpacing: "0.4px",
              }}>nové</span>
            )}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              fontSize: "10px", color: theme.textMid,
            }}>
              <span><strong style={{ color: theme.text }}>{n.author}</strong> · {formatTimeTrace(n.createdAt)}</span>
              {n.author === currentUser.name && editingId !== n.id && (
                <span style={{ display: "flex", gap: "4px" }}>
                  <button onClick={() => startEdit(n)} title="Upravit" style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    color: theme.textSub, fontSize: "11px", padding: "0 2px",
                  }}>✏️</button>
                  <button onClick={() => deleteNote(n.id)} title="Smazat" style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    color: theme.red, fontSize: "11px", padding: "0 2px",
                  }}>🗑</button>
                </span>
              )}
            </div>

            {editingId === n.id ? (
              <div style={{ display: "flex", gap: "4px" }}>
                <input
                  type="text" value={editText} onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                  autoFocus
                  style={{ ...inputStyle(theme), padding: "5px 8px", fontSize: "12px", flex: 1 }}
                />
                <button onClick={saveEdit} style={{
                  ...buttonStyle(), padding: "5px 8px", fontSize: "11px",
                  background: theme.green, color: "#fff", border: "none",
                }}>✓</button>
                <button onClick={() => setEditingId(null)} style={{
                  ...buttonStyle(), padding: "5px 8px", fontSize: "11px",
                  background: "transparent", color: theme.textSub,
                  border: `1px solid ${theme.cardBorder}`,
                }}>×</button>
              </div>
            ) : (
              <>
                {n.text && (
                  <div style={{ fontSize: "12px", color: theme.text, lineHeight: 1.4 }}>{n.text}</div>
                )}
                {n.imageUrl && (
                  <img
                    src={n.imageUrl}
                    alt=""
                    onClick={() => setLightboxUrl(n.imageUrl)}
                    style={{
                      maxWidth: "100%", maxHeight: "180px",
                      borderRadius: "5px", cursor: "pointer",
                      objectFit: "cover",
                    }}
                  />
                )}
                {/* Reactions */}
                <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", alignItems: "center" }}>
                  {REACTION_EMOJIS.map(emoji => {
                    const list = n.reactions?.[emoji] || [];
                    const active = list.includes(currentUser.name);
                    if (list.length === 0 && !active) {
                      return (
                        <button key={emoji} onClick={() => toggleReaction(n.id, emoji)} style={{
                          background: "transparent", border: "none",
                          opacity: 0.35, cursor: "pointer", fontSize: "12px", padding: "1px 4px",
                          transition: "opacity 0.15s",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = 0.35}>
                          {emoji}
                        </button>
                      );
                    }
                    return (
                      <button key={emoji} onClick={() => toggleReaction(n.id, emoji)} title={list.join(", ")} style={{
                        background: active ? `${theme.accent}20` : theme.inputBg,
                        border: `1px solid ${active ? theme.accent : theme.cardBorder}`,
                        borderRadius: "10px",
                        padding: "1px 6px",
                        cursor: "pointer", fontSize: "11px",
                        display: "inline-flex", gap: "3px", alignItems: "center",
                      }}>
                        <span>{emoji}</span>
                        <span style={{ fontWeight: 700, color: active ? theme.accent : theme.textSub }}>{list.length}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          );
        })}

        {/* Add new note */}
        <div style={{ display: "flex", gap: "4px", alignItems: "stretch" }}>
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addNote(); }}
            placeholder="Napiš poznámku..."
            style={{ ...inputStyle(theme), padding: "6px 10px", fontSize: "12px", flex: 1 }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            style={{ display: "none" }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Přidat foto"
            style={{
              ...buttonStyle(), padding: "6px 8px", fontSize: "13px",
              background: theme.inputBg, color: theme.textSub,
              border: `1px solid ${theme.inputBorder}`,
              cursor: uploading ? "wait" : "pointer",
            }}>
            {uploading ? "⌛" : "📎"}
          </button>
          <button
            onClick={() => addNote()}
            disabled={!text.trim()}
            style={{
              ...buttonStyle(), padding: "6px 10px", fontSize: "12px", fontWeight: 700,
              background: text.trim() ? theme.purple : theme.inputBg,
              color: text.trim() ? "#fff" : theme.textDim,
              border: `1px solid ${text.trim() ? theme.purple : theme.inputBorder}`,
              cursor: text.trim() ? "pointer" : "default",
            }}>▶</button>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   BULK SELECTABLE CARD WRAPPER
   Obaluje TaskCard. V bulk mode zachytává kliky pro toggle,
   v normálním režimu propouští interakci na TaskCard.
   Long-press (650ms) na kartě aktivuje bulk mode.
   ═══════════════════════════════════════════════════════ */

function BulkSelectableCard({ taskId, bulkMode, isSelected, onToggle, onLongPress, theme, children }) {
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  const handlePointerDown = (e) => {
    // Pravé tlačítko myši a touch s víc prsty ignoruj
    if (e.button === 2) return;
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      // Haptic feedback (jen na zařízeních co to podporují)
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) { /* ignore */ }
      onLongPress(taskId);
    }, 650);
  };

  const handlePointerUp = () => {
    clearTimeout(longPressTimerRef.current);
  };

  const handlePointerCancel = () => {
    clearTimeout(longPressTimerRef.current);
  };

  // V bulk mode: klik = toggle. Long-press uvnitř kartu nepropustíme dolů.
  const handleClick = (e) => {
    if (longPressTriggeredRef.current) {
      // Tento klik byl důsledek long-press → polkni ho, nepouštěj na kartu
      e.stopPropagation();
      e.preventDefault();
      longPressTriggeredRef.current = false;
      return;
    }
    if (bulkMode) {
      e.stopPropagation();
      e.preventDefault();
      onToggle(taskId);
    }
  };

  // Klávesnice / Ctrl+klik na desktopu jako alternativa long-pressu
  const handleMouseDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && !bulkMode) {
      e.stopPropagation();
      e.preventDefault();
      onLongPress(taskId);
    }
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onClickCapture={handleClick}
      onMouseDownCapture={handleMouseDown}
      style={{
        position: "relative",
        // V bulk mode zvýrazni vybrané karty
        outline: bulkMode && isSelected ? `2px solid #3b82f6` : "none",
        outlineOffset: bulkMode && isSelected ? -2 : 0,
        borderRadius: bulkMode && isSelected ? 12 : 0,
        transition: "outline-color 0.15s",
        // V bulk mode zakázat text-selection (long-press by jinak vybral text)
        userSelect: bulkMode ? "none" : "auto",
        WebkitUserSelect: bulkMode ? "none" : "auto",
      }}
    >
      {bulkMode && (
        <div style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 5,
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: isSelected ? "#3b82f6" : theme.cardBg,
          border: `2px solid ${isSelected ? "#3b82f6" : theme.cardBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 14,
          fontWeight: 700,
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          pointerEvents: "none",
        }}>
          {isSelected ? "✓" : ""}
        </div>
      )}
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TASK CARD
   ═══════════════════════════════════════════════════════ */

function TaskCard({ task, currentUser, users, onStatusChange, onMarkSeen, onUpdate, onDelete, onRestore, onPermanentDelete, theme, comments, onAddComment, onToggleReaction, onMarkCommentsSeen, autoOpen, isHighlighted, progressItem, onStartFocus, recentlyAdded, fadeProgress = 0, customLists = [], isToday = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const cardRef = useRef(null);

  // Auto-close detail/snooze when user clicks outside the card
  useEffect(() => {
    if (!isOpen && !snoozeMenuOpen) return;
    const handleClickOutside = (e) => {
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        // Ignore clicks on portals/modals (e.g., confirm dialogs) that live outside card
        // Simple: any click outside the card closes the detail
        if (snoozeMenuOpen) setSnoozeMenuOpen(false);
        if (isOpen) setIsOpen(false);
      }
    };
    // Use "click" (bubbling) with timeout 0 so current click event finishes first
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen, snoozeMenuOpen]);

  // ── SWIPE state & handlers ──
  // Swipe left = delete, swipe right = complete
  const [swipeX, setSwipeX] = useState(0);           // current drag offset in pixels
  const [isSwiping, setIsSwiping] = useState(false); // finger is down
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const SWIPE_THRESHOLD = 60; // px — need this much to trigger action
  const SWIPE_MAX = 180;      // px — max visible drag
  const taskIsDone = isDone(task);
  const taskIsDeleted = task.status === "deleted";

  const handleTouchStart = (e) => {
    // Don't swipe if interacting with interactive elements inside card
    const tag = e.target.tagName?.toLowerCase();
    if (tag === "button" || tag === "input" || tag === "select" || tag === "textarea") return;
    if (isOpen) return;          // no swiping when detail is open
    if (taskIsDeleted) return;   // no swiping on deleted cards
    if (progressItem) return;    // no swiping on progress cards (they redirect to main)
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    setIsSwiping(true);
  };

  const handleTouchMove = (e) => {
    if (!isSwiping) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    // Only horizontal swipe — if vertical drag is bigger, bail out
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      setIsSwiping(false);
      setSwipeX(0);
      return;
    }
    // Clamp the drag to SWIPE_MAX
    const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx));
    setSwipeX(clamped);
  };

  const handleTouchEnd = () => {
    if (!isSwiping) return;
    setIsSwiping(false);
    if (swipeX <= -SWIPE_THRESHOLD && onDelete) {
      // Swipe left = delete — slide out, then trigger delete animation
      setSwipeX(-300);
      touchStartRef.current.time = Date.now();
      setTimeout(() => {
        setSwipeX(0);
        runWithAnimation("delete", () => onDelete(task.id));
      }, 200);
    } else if (swipeX >= SWIPE_THRESHOLD && !taskIsDone) {
      // Swipe right = complete — slide out, then trigger complete animation
      setSwipeX(300);
      touchStartRef.current.time = Date.now();
      setTimeout(() => {
        setSwipeX(0);
        // Use smart complete for consistency
        const hasChecklist = task.checklist && task.checklist.length > 0;
        const hasUnchecked = hasChecklist && task.checklist.some(i => !i.done);
        runWithAnimation("complete", () => {
          if (hasUnchecked) {
            const now = new Date().toISOString();
            const allDone = task.checklist.map(item => ({
              ...item,
              done: true,
              doneBy: item.doneBy || currentUser.name,
              doneAt: item.doneAt || now,
            }));
            onUpdate(task.id, { checklist: allDone });
          }
          if (task.assignTo === "both") onStatusChange(task.id, "done_my");
          else onStatusChange(task.id, "done");
        });
      }, 200);
    } else {
      // Not enough swipe — snap back
      setSwipeX(0);
    }
  };

  // Block accidental click after swipe (touch → click fires even after touchend)
  const clickGuard = (e) => {
    if (Math.abs(swipeX) > 5) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    handleClick();
  };

  // Auto-open when user navigated from UpdatesPanel
  useEffect(() => {
    if (autoOpen) {
      setIsOpen(true);
      // Scroll into view
      setTimeout(() => {
        const el = document.getElementById(`task-${task.id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [autoOpen, task.id]);

  // Scroll to task when highlighted (z search) — i bez auto-open
  useEffect(() => {
    if (isHighlighted) {
      setTimeout(() => {
        const el = document.getElementById(`task-${task.id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [isHighlighted, task.id]);

  // isNew: úkol je nový pokud:
  //   - autor není currentUser (porovnáno case-insensitive + trimmed kvůli přípaným chybám v datech)
  //   - currentUser není v seenBy
  // Defenzivní porovnání zajišťuje že "Pavla" === "pavla " === " Pavla"
  const userNameLc = (currentUser.name || "").trim().toLowerCase();
  const createdByLc = (task.createdBy || "").trim().toLowerCase();
  const seenByLc = (task.seenBy || []).map(n => (n || "").trim().toLowerCase());
  const isNew = createdByLc !== userNameLc && !seenByLc.includes(userNameLc);
  const overdue = daysDiff(task.dueDate) < 0 && !isDone(task);
  const soon = !overdue && daysDiff(task.dueDate) >= 0 && daysDiff(task.dueDate) <= 3 && !isDone(task);
  const forgotten = isForgotten(task);
  const inProgress = task.status === "in_progress" ||
    (task.assignTo === "both" && (task.doneBy?.length || 0) > 0 && task.status !== "done");

  const priority = getPriority(task.priority);
  const priorityTheme = theme.priority[priority.id];
  const isMine = task.assignTo === "both" || task.assignedTo?.includes(currentUser.name) || task.createdBy === currentUser.name;
  const canAct = isMine || currentUser.admin;
  // Admin manipuluje s cizím úkolem → potřebujeme potvrzení
  const actAsProxy = !isMine && currentUser.admin;
  // Jméno koho zastupujeme (pro confirm popup)
  const proxyName = actAsProxy
    ? (task.assignedTo?.[0] || task.createdBy || "jiného uživatele")
    : null;

  const checklistDone = task.checklist?.filter(c => c.done).length || 0;
  const checklistTotal = task.checklist?.length || 0;
  const allChecked = checklistTotal > 0 && checklistDone === checklistTotal;
  const totalItemNotes = (task.checklist || []).reduce((sum, item) => sum + (item.notes?.length || 0), 0);
  const unseenItemNotes = (task.checklist || []).reduce((sum, item) =>
    sum + (item.notes || []).filter(n =>
      n.author !== currentUser.name && !n.seenBy?.includes(currentUser.name)
    ).length
  , 0);

  const handleClick = () => {
    // If this is a progress card, scroll to the main active card and open it there
    if (progressItem) {
      const mainCard = document.getElementById(`task-${task.id}`);
      if (mainCard) {
        mainCard.scrollIntoView({ behavior: "smooth", block: "center" });
        // Simulate click on main card by triggering its handleClick
        setTimeout(() => mainCard.click(), 300);
      }
      return;
    }
    // Don't toggle if task was just reopened (status change closes detail)
    const opening = !isOpen;
    setIsOpen(opening);
    // Note: markSeen is now called on CLOSE (see useEffect below) instead of OPEN,
    // so the task doesn't reorder while user is reading it.
  };

  // Mark as seen when detail CLOSES (not opens) — keeps task in place while user reads it
  const wasOpenedRef = useRef(false);
  useEffect(() => {
    if (isOpen) {
      wasOpenedRef.current = true;
    } else if (wasOpenedRef.current && isNew && onMarkSeen) {
      // Detail just closed and task was unread — now mark it as seen
      onMarkSeen(task.id);
      wasOpenedRef.current = false;
    }
  }, [isOpen, isNew, task.id, onMarkSeen]);

  // Action animation state — shows a colored pulse before an irreversible action fires
  // Types: "complete" (green), "delete" (red), "restore" (blue/accent), "reopen" (blue/accent)
  const [actionAnim, setActionAnim] = useState(null); // null | {type, color}

  // Triggers animation then fires the action after 550ms
  const runWithAnimation = (type, onFire) => {
    if (actionAnim) return; // prevent double-click during animation
    setIsOpen(false); // close detail if open
    setActionAnim(type);
    setTimeout(() => {
      onFire();
      setTimeout(() => setActionAnim(null), 100);
    }, 550);
  };

  const handleQuickComplete = (e) => {
    e.stopPropagation();
    if (actionAnim) return;

    // Admin manipuluje s cizím úkolem → confirmation
    if (actAsProxy) {
      const ok = confirm(`Splnit úkol "${task.title}" za ${proxyName}?`);
      if (!ok) return;
    }

    // Smart: if task has checklist items, mark them all as done first
    const hasChecklist = task.checklist && task.checklist.length > 0;
    const hasUnchecked = hasChecklist && task.checklist.some(i => !i.done);

    runWithAnimation("complete", () => {
      if (hasUnchecked) {
        // Pre-update local task with checklist all done — atomicky před status change.
        // Aby se předešlo race condition: nejprve nastavíme checklist (jeden update),
        // pak status v separátním kroku kdy už checklist je v DB.
        const now = new Date().toISOString();
        const allDone = task.checklist.map(item => ({
          ...item,
          done: true,
          doneBy: item.doneBy || currentUser.name,
          doneAt: item.doneAt || now,
        }));
        onUpdate(task.id, { checklist: allDone });
      }
      // setTimeout 0 — ensure checklist update commits first, then status changes
      setTimeout(() => {
        if (task.assignTo === "both") onStatusChange(task.id, "done_my");
        else onStatusChange(task.id, "done");
      }, 0);
    });
  };

  // Derived animation properties — used by card + circle
  const animColor = actionAnim === "delete" ? theme.red
    : actionAnim === "complete" ? theme.green
    : actionAnim === "restore" || actionAnim === "reopen" ? theme.accent
    : null;
  const completing = actionAnim === "complete"; // legacy alias

  // Assignment label
  // "Všichni" zobrazíme JEN pokud je assignedTo skutečně rovno všem uživatelům.
  // Pokud `assign_to === "both"` ale assignedTo má jen 2 ze 4 lidí, zobrazíme jména.
  let assignLabel = "";
  const assignees = Array.isArray(task.assignedTo) ? task.assignedTo : [];
  const totalUsers = (users || []).length;
  const isReallyAll = totalUsers > 0 && assignees.length === totalUsers;
  if (isReallyAll) {
    assignLabel = "Všichni";
  } else if (assignees.length > 1) {
    // Více lidí, ale ne všichni — zobraz jména oddělené plusem
    assignLabel = `→ ${assignees.join(" + ")}`;
  } else if (assignees.length === 1 && task.createdBy !== assignees[0]) {
    assignLabel = `→ ${assignees[0]}`;
  }

  // Card background — WHITE by default, color only for special states
  let cardBackground = theme.card; // White/neutral default
  let cardBorderColor = theme.cardBorder;

  // Special states override background
  if (forgotten && !taskIsDone) { cardBackground = `${theme.purple}0a`; cardBorderColor = `${theme.purple}40`; }
  if (isNew) { cardBackground = theme.unreadBg; cardBorderColor = theme.unreadBorder; }
  if (overdue && !taskIsDone) { cardBackground = `${theme.red}0c`; cardBorderColor = theme.red; }
  if (taskIsDone) { cardBackground = theme.card; cardBorderColor = theme.cardBorder; }
  // Progress card — lighter accent tint
  if (progressItem) { cardBackground = theme.accentSoft; cardBorderColor = theme.accentBorder; }
  // Deleted (trash) — muted gray look
  if (taskIsDeleted) { cardBackground = theme.inputBg; cardBorderColor = theme.inputBorder; }

  // Left border color — priority color by default, overridden by state
  let leftBorderColor = priorityTheme.text;
  if (forgotten) leftBorderColor = theme.purple;
  if (soon) leftBorderColor = theme.yellow;
  if (overdue) leftBorderColor = theme.red;
  if (isNew) leftBorderColor = theme.green;
  if (progressItem) leftBorderColor = theme.accent;
  if (taskIsDeleted) leftBorderColor = theme.textDim; // muted gray left border

  return (
    <div ref={cardRef} id={progressItem ? `progress-${task.id}-${progressItem.id}` : `task-${task.id}`} style={{
      position: "relative",
      borderRadius: "12px",
      // Elevate this card above siblings when a dropdown or detail is open,
      // so popouts aren't hidden behind the next card in the list.
      zIndex: snoozeMenuOpen || isOpen ? 30 : 1,
      // Overflow: only clip during swipe (to hide red/green backgrounds)
      // Otherwise visible, so dropdowns (snooze menu) can extend beyond card edges
      overflow: isSwiping || swipeX !== 0 ? "hidden" : "visible",
      // Red for delete (left) / green for complete (right) backgrounds
      background: swipeX < 0 ? theme.red : swipeX > 0 ? theme.green : "transparent",
      transition: isSwiping ? "none" : "background 0.15s",
    }}>
      {/* Swipe action icons (visible when user drags) */}
      {swipeX < -10 && (
        <div style={{
          position: "absolute", top: 0, bottom: 0, right: 0,
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          paddingRight: "20px", color: "#fff", fontWeight: 700, fontSize: "14px",
          pointerEvents: "none",
        }}>
          🗑 Smazat
        </div>
      )}
      {swipeX > 10 && (
        <div style={{
          position: "absolute", top: 0, bottom: 0, left: 0,
          display: "flex", alignItems: "center", justifyContent: "flex-start",
          paddingLeft: "20px", color: "#fff", fontWeight: 700, fontSize: "14px",
          pointerEvents: "none",
        }}>
          ✓ Hotovo
        </div>
      )}

    <div
      onClick={clickGuard}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
      background: actionAnim ? `${animColor}15`
        : recentlyAdded ? `${theme.green}${Math.round((1 - fadeProgress) * 0x14).toString(16).padStart(2, "0")}`
        : isToday && !taskIsDone && !taskIsDeleted ? `${theme.accent}05`
        : cardBackground,
      border: `1px solid ${actionAnim ? animColor : (isToday && !taskIsDone && !taskIsDeleted ? theme.accent + "60" : cardBorderColor)}`,
      borderRadius: "12px",
      borderLeft: `5px solid ${
        actionAnim ? animColor
        : recentlyAdded ? theme.green
        : (inProgress && !taskIsDone && !taskIsDeleted) ? (() => {
            const i = inProgressIntensity(task.inProgressAt);
            return i === 0 ? theme.yellow : i === 1 ? "#f59e0b" : i === 2 ? "#ea580c" : theme.red;
          })()
        : leftBorderColor
      }`,
      padding: "8px 11px",
      opacity: actionAnim ? 1
        : (taskIsDone ? 0.35 : taskIsDeleted ? 0.55 : (recentlyAdded ? 1 - fadeProgress * 0.4 : 1)),
      cursor: "pointer",
      position: "relative",
      animation: actionAnim ? "actionCardGlow 0.55s ease-out"
        : isHighlighted ? "searchHighlight 2.4s ease-out"
        : recentlyAdded ? "newTaskHighlight 1.5s ease-out"
        : isNew ? "glow 2s ease 3, slideUp 0.3s ease"
        : taskIsDone ? "completedFade 0.5s ease forwards"
        : "slideUp 0.3s ease",
      transform: `translateX(${swipeX}px) ${actionAnim ? "scale(1.02)" : ""}`,
      transition: isSwiping ? "none" : "transform 0.25s ease, all 0.2s",
      boxShadow: actionAnim ? `0 0 30px ${animColor}60, 0 4px 16px ${animColor}45`
        : recentlyAdded ? `0 2px 8px ${theme.green}${Math.round((1 - fadeProgress) * 0x40).toString(16).padStart(2, "0")}`
        : "none",
      touchAction: "pan-y",
      userSelect: "none",
      WebkitUserSelect: "none",
    }}>
      {/* Badges */}
      {isNew && (
        <span style={{
          position: "absolute", top: "7px", right: "9px",
          background: theme.green, color: "#fff",
          fontSize: "8px", fontWeight: 800, padding: "2px 6px",
          borderRadius: "4px", textTransform: "uppercase",
        }}>Nové</span>
      )}
      {forgotten && !taskIsDone && (
        <span style={{
          position: "absolute", top: "7px", right: isNew ? "50px" : "9px",
          background: theme.purple, color: "#fff",
          fontSize: "8px", fontWeight: 800, padding: "2px 6px", borderRadius: "4px",
        }}>⚠ 7+d</span>
      )}
      {allChecked && !taskIsDone && (
        <span style={{
          position: "absolute", top: "7px",
          right: (isNew || forgotten) ? (isNew && forgotten ? "90px" : "50px") : "9px",
          background: theme.green, color: "#fff",
          fontSize: "8px", fontWeight: 800, padding: "2px 6px", borderRadius: "4px",
        }}>Vše ✓</span>
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        {/* Quick complete checkbox / Reopen / Restore depending on state */}
        {taskIsDeleted ? (
          /* DELETED → Restore button with accent color */
          <button onClick={(e) => {
            e.stopPropagation();
            if (onRestore) {
              runWithAnimation("restore", () => onRestore(task.id));
            }
          }} style={{
            width: actionAnim === "restore" ? "40px" : "32px",
            height: actionAnim === "restore" ? "40px" : "32px",
            minWidth: actionAnim === "restore" ? "40px" : "32px",
            borderRadius: "8px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: actionAnim === "restore" ? "22px" : "15px",
            fontWeight: 700,
            background: actionAnim === "restore" ? theme.accent : theme.accentSoft,
            color: actionAnim === "restore" ? "#fff" : theme.accent,
            border: `2.5px solid ${actionAnim === "restore" ? theme.accent : theme.accentBorder}`,
            cursor: actionAnim ? "default" : "pointer",
            transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
            boxShadow: actionAnim === "restore" ? `0 0 0 10px ${theme.accent}25, 0 4px 20px ${theme.accent}60` : "none",
            animation: actionAnim === "restore" ? "completePulse 0.55s ease-out" : "none",
          }} title="Obnovit z koše">
            ↩
          </button>
        ) : !taskIsDone && canAct ? (
          <>
            {/* ─── SPLNIT — prázdný kruh, animace na ✓ ─── */}
            <button onClick={handleQuickComplete} style={{
              width: completing ? "40px" : "32px",
              height: completing ? "40px" : "32px",
              minWidth: completing ? "40px" : "32px",
              borderRadius: "50%",
              border: actAsProxy && !completing
                ? `2.5px dashed ${priorityTheme.text}`
                : `2.5px solid ${completing ? theme.green : priorityTheme.text}`,
              background: completing ? theme.green : "transparent",
              cursor: completing ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: completing ? "#fff" : priorityTheme.text,
              fontSize: completing ? "22px" : "16px",
              fontWeight: 700,
              transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
              boxShadow: completing ? `0 0 0 10px ${theme.green}25, 0 4px 20px ${theme.green}60` : "none",
              animation: completing ? "completePulse 0.55s ease-out" : "none",
              opacity: actAsProxy && !completing ? 0.6 : 1,
            }} title={actAsProxy ? `Splnit za ${proxyName}` : "Splnit"}>
              {completing ? "✓" : ""}
            </button>

            {/* ─── ROZPRACOVAT ↔ AKTIVNÍ — částečný kruh ─── */}
            {!completing && (
              <button onClick={(e) => {
                e.stopPropagation();
                if (actAsProxy) {
                  const action = inProgress ? "vrátit do aktivních" : "rozpracovat";
                  const ok = confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} úkol "${task.title}" za ${proxyName}?`);
                  if (!ok) return;
                }
                if (inProgress) {
                  onStatusChange(task.id, "reopen");
                } else {
                  onStatusChange(task.id, "in_progress");
                }
              }} title={inProgress ? "Pozastavit (vrátit do aktivních)" : "Rozpracovat"} style={{
                width: "28px", height: "28px", minWidth: "28px",
                borderRadius: "50%",
                border: `2px solid ${inProgress ? theme.yellow : theme.yellow + "70"}`,
                background: inProgress
                  ? `conic-gradient(${theme.yellow} 0deg 270deg, transparent 270deg 360deg)`
                  : `conic-gradient(${theme.yellow}50 0deg 90deg, transparent 90deg 360deg)`,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginLeft: "-2px", marginTop: "2px",
                transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                opacity: inProgress ? 1 : 0.65,
                boxShadow: inProgress ? `0 0 0 4px ${theme.yellow}25, 0 2px 8px ${theme.yellow}60` : "none",
                animation: inProgress ? "inProgressPulse 2s ease-in-out infinite" : "none",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = inProgress ? 1 : 0.65; }} />
            )}
          </>
        ) : (
          <button onClick={(e) => {
            e.stopPropagation();
            runWithAnimation("reopen", () => onStatusChange(task.id, "reopen"));
          }} style={{
            width: actionAnim === "reopen" ? "40px" : "32px",
            height: actionAnim === "reopen" ? "40px" : "32px",
            minWidth: actionAnim === "reopen" ? "40px" : "32px",
            borderRadius: "8px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: actionAnim === "reopen" ? "22px" : "16px",
            fontWeight: 700,
            background: actionAnim === "reopen" ? theme.accent : `${theme.green}20`,
            color: actionAnim === "reopen" ? "#fff" : theme.green,
            border: `2.5px solid ${actionAnim === "reopen" ? theme.accent : theme.green + "50"}`,
            cursor: actionAnim ? "default" : "pointer",
            transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
            boxShadow: actionAnim === "reopen" ? `0 0 0 10px ${theme.accent}25, 0 4px 20px ${theme.accent}60` : "none",
            animation: actionAnim === "reopen" ? "completePulse 0.55s ease-out" : "none",
          }} title="Vrátit zpět do aktivních">
            ↩
          </button>
        )}

        {/* Task content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: "14px", fontWeight: 500,
            color: taskIsDone ? theme.textSub : theme.text,
            textDecoration: taskIsDone ? "line-through" : "none",
            opacity: taskIsDone ? 0.7 : 1,
            lineHeight: 1.4, wordBreak: "break-word",
            // When closed: show max 2 lines + ellipsis. When open: show all.
            ...(!isOpen ? {
              display: "-webkit-box",
              WebkitLineClamp: "2",
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            } : {}),
          }}>
            {/* Priority symbol inline — only for important/urgent, no text. Hidden on progress cards. */}
            {!progressItem && task.priority && task.priority !== "low" && (
              <span style={{
                fontWeight: 900, marginRight: "6px",
                color: priorityTheme.text,
                fontSize: "15px",
              }}>
                {priority.sym}
              </span>
            )}
            {progressItem ? (
              <>
                <span style={{ color: theme.accent, fontWeight: 700, marginRight: "4px" }}>✓</span>
                {progressItem.text}
                <span style={{ color: theme.textMid, fontWeight: 400, fontSize: "12px" }}>
                  {" "}z úkolu "{task.title}"
                </span>
              </>
            ) : (
              task.title
            )}
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            marginTop: "4px", flexWrap: "wrap",
          }}>
            {/* "Od koho" indicator — task created by someone else and assigned to me */}
            {task.createdBy &&
             task.createdBy !== currentUser.name &&
             task.assignedTo?.includes(currentUser.name) && (
              <span title={`Zadal(a) ti: ${task.createdBy}`} style={{
                fontSize: "10px", fontWeight: 700,
                color: theme.accent,
                background: theme.accentSoft,
                padding: "1px 6px", borderRadius: "10px",
                border: `1px solid ${theme.accentBorder}`,
                display: "inline-flex", alignItems: "center", gap: "3px",
              }}>
                📥 od {task.createdBy}
              </span>
            )}

            {/* Category */}
            {task.category && task.category !== "other" && !task.category.startsWith("list:") && (
              <span style={{ fontSize: "10px", color: theme.textMid }}>
                {getCategory(task.category).icon}
              </span>
            )}

            {/* Custom list badge */}
            {task.category && task.category.startsWith("list:") && (() => {
              const listId = task.category.slice(5);
              const list = customLists.find(l => l.id === listId);
              if (!list) return null;
              return (
                <span title={list.name} style={{
                  fontSize: "10px", fontWeight: 700,
                  color: list.color,
                  padding: "1px 6px", borderRadius: "8px",
                  background: `${list.color}15`,
                  border: `1px solid ${list.color}40`,
                  display: "inline-flex", alignItems: "center", gap: "3px",
                }}>
                  <span>{list.emoji || "📁"}</span>
                  <span>{list.name}</span>
                </span>
              );
            })()}

            {/* Checklist progress */}
            {checklistTotal > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                <span style={{
                  width: "32px", height: "4px", borderRadius: "2px",
                  background: theme.inputBorder, overflow: "hidden",
                  display: "inline-block",
                }}>
                  <span style={{
                    display: "block", height: "100%",
                    width: `${checklistTotal > 0 ? checklistDone / checklistTotal * 100 : 0}%`,
                    background: allChecked ? theme.green : theme.accent,
                    borderRadius: "2px", transition: "width 0.3s",
                  }} />
                </span>
                <span style={{ fontSize: "10px", color: theme.textSub, fontWeight: 600 }}>
                  {checklistDone}/{checklistTotal}
                </span>
              </span>
            )}

            {/* Notes badge — počet poznámek k položkám (nepřečtené výrazně) */}
            {totalItemNotes > 0 && (
              <span title={unseenItemNotes > 0
                ? `${unseenItemNotes} nepřečtených z ${totalItemNotes} poznámek k položkám`
                : `${totalItemNotes} poznámek k položkám`} style={{
                fontSize: "10px", fontWeight: 700,
                color: unseenItemNotes > 0 ? "#fff" : theme.purple,
                padding: "1px 6px", borderRadius: "8px",
                background: unseenItemNotes > 0 ? theme.purple : `${theme.purple}15`,
                border: `1px solid ${unseenItemNotes > 0 ? theme.purple : theme.purple + "30"}`,
                animation: unseenItemNotes > 0 ? "newTaskHighlight 1.5s ease-out" : "none",
              }}>
                📝 {unseenItemNotes > 0 ? `${unseenItemNotes} nové` : totalItemNotes}
              </span>
            )}

            {/* Auto-tagy (Objednat/Koupit/Volat...) */}
            {detectTags(task.title).slice(0, 2).map(tagId => {
              const def = getTagDef(tagId);
              if (!def) return null;
              return (
                <span key={tagId} title={def.label} style={{
                  fontSize: "10px", fontWeight: 600, color: theme.textSub,
                  padding: "1px 6px", borderRadius: "8px",
                  background: theme.inputBg,
                  border: `1px solid ${theme.cardBorder}`,
                }}>
                  {def.emoji} {def.label}
                </span>
              );
            })}

            {/* Both users dots */}
            {task.assignTo === "both" && (
              <span style={{ display: "inline-flex", gap: "2px" }}>
                {users.map(u => (
                  <span key={u.name} title={u.name} style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: task.doneBy?.includes(u.name) ? theme.green : theme.inputBorder,
                    border: `1px solid ${task.doneBy?.includes(u.name) ? theme.green : theme.textDim}`,
                  }} />
                ))}
              </span>
            )}

            {assignLabel && <span style={{ fontSize: "10px", color: theme.textMid }}>{assignLabel}</span>}
            {task.recDays > 0 && <span style={{ fontSize: "10px", color: theme.textSub }}>🔄</span>}
            {task.images?.length > 0 && <span style={{ fontSize: "10px", color: theme.textSub }}>📷</span>}
            {task.scratchPad?.length > 0 && (
              <span style={{ fontSize: "10px", color: theme.accent, fontWeight: 600 }}>
                📝 {task.scratchPad.length}
              </span>
            )}
            {/* Created at + by badge */}
            {task.createdAt && (
              <span style={{
                fontSize: "10px", color: theme.textMid,
                display: "inline-flex", alignItems: "center", gap: "3px",
              }}>
                📅 {formatTimeTrace(task.createdAt)}
                {task.createdBy && task.createdBy !== currentUser.name && (
                  <span> — {task.createdBy}</span>
                )}
              </span>
            )}
            {task.showFrom && daysDiff(task.showFrom) > 0 && (
              <span style={{ fontSize: "10px", fontWeight: 600, color: theme.purple }}>
                ⏰ od {formatDate(task.showFrom)}
              </span>
            )}
            {/* In-progress duration indicator — barva podle stáří */}
            {inProgress && task.inProgressAt && !taskIsDone && !taskIsDeleted && (() => {
              const intensity = inProgressIntensity(task.inProgressAt);
              const colors = [
                { fg: theme.yellow, bg: `${theme.yellow}15`, prefix: "◐" },        // 0: <24h
                { fg: "#f59e0b",   bg: "#f59e0b1f",         prefix: "◐!" },         // 1: 24-48h (orange light)
                { fg: "#ea580c",   bg: "#ea580c20",         prefix: "◐!" },         // 2: 48h-7d (orange)
                { fg: theme.red,   bg: `${theme.red}1a`,    prefix: "◐!!" },        // 3: >7d (red)
              ];
              const c = colors[intensity];
              return (
                <span style={{
                  fontSize: "10px", fontWeight: 700, color: c.fg,
                  background: c.bg,
                  padding: "1px 6px", borderRadius: "4px",
                  border: intensity >= 2 ? `1px solid ${c.fg}40` : "none",
                }} title={intensity >= 1 ? "Tento úkol je rozpracovaný déle než 24h — zvaž dokončení nebo odložení" : ""}>
                  {c.prefix} {formatDuration(task.inProgressAt)}
                </span>
              );
            })()}
            {task.dueDate && !taskIsDone && !isDeleted(task) && (() => {
              const daysOverdue = overdue ? Math.abs(Math.floor(daysDiff(task.dueDate))) : 0;
              return (
                <span style={{
                  fontSize: "10px", fontWeight: 600,
                  color: overdue ? theme.red : soon ? theme.yellow : theme.textMid,
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                  {formatDate(task.dueDate)}
                  {overdue && (
                    <span style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: "white",
                      background: theme.red,
                      padding: "1px 6px",
                      borderRadius: 8,
                      letterSpacing: "0.2px",
                    }}>
                      ⚠ {daysOverdue === 1 ? "1 den" : daysOverdue < 5 ? `${daysOverdue} dny` : `${daysOverdue} dní`} po termínu
                    </span>
                  )}
                </span>
              );
            })()}
            {/* Time trace for completed */}
            {taskIsDone && task.completedAt && (
              <span style={{ fontSize: "10px", color: theme.green, fontWeight: 600 }}>
                ✓ {formatTimeTrace(task.completedAt)}{task.completedByUser ? ` — ${task.completedByUser}` : ""}
              </span>
            )}
            {/* Time trace for deleted + countdown to permanent deletion */}
            {isDeleted(task) && task.deletedAt && (() => {
              const ageDays = (Date.now() - new Date(task.deletedAt).getTime()) / (1000 * 60 * 60 * 24);
              const daysLeft = Math.max(0, Math.ceil(30 - ageDays));
              const isUrgent = daysLeft <= 7;
              return (
                <span style={{ fontSize: "10px", color: theme.red, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  🗑 {formatTimeTrace(task.deletedAt)}
                  {daysLeft > 0 ? (
                    <span style={{
                      fontSize: "10px",
                      color: isUrgent ? theme.red : theme.textMid,
                      background: isUrgent ? "rgba(239,68,68,0.1)" : theme.inputBg,
                      padding: "1px 6px",
                      borderRadius: 8,
                      fontWeight: 600,
                    }}>
                      {isUrgent ? "⏰ " : ""}smaže se za {daysLeft}{daysLeft === 1 ? " den" : daysLeft < 5 ? " dny" : " dní"}
                    </span>
                  ) : (
                    <span style={{
                      fontSize: "10px",
                      color: theme.red,
                      background: "rgba(239,68,68,0.15)",
                      padding: "1px 6px",
                      borderRadius: 8,
                      fontWeight: 700,
                    }}>
                      ⚠ smaže se brzy
                    </span>
                  )}
                </span>
              );
            })()}
            {/* Progress indicator — this card shows a completed checklist item */}
            {progressItem && (
              <span style={{
                fontSize: "10px", fontWeight: 700,
                color: theme.accent,
                background: theme.accentSoft,
                padding: "2px 8px", borderRadius: "10px",
                border: `1px solid ${theme.accentBorder}`,
                display: "inline-flex", alignItems: "center", gap: "4px",
              }}>
                ⏰ {progressItem.doneAt ? formatTimeTrace(progressItem.doneAt) : ""}
                {progressItem.doneBy && ` — ${progressItem.doneBy}`}
              </span>
            )}
          </div>
        </div>

        {/* Right side: quick snooze + chevron */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", marginTop: "3px", marginLeft: "4px", position: "relative" }}>
          {/* Focus button — jump straight into Focus mode with this task */}
          {!taskIsDone && !taskIsDeleted && !progressItem && canAct && onStartFocus && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartFocus(task.id);
              }}
              title="Soustředit se na tento úkol (Focus mode)"
              style={{
                ...buttonStyle(),
                width: "34px", height: "34px", padding: "0",
                background: "transparent",
                color: theme.accent, fontSize: "16px",
                border: `1px solid transparent`,
                borderRadius: "6px",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = theme.accentSoft;
                e.currentTarget.style.borderColor = theme.accentBorder;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "transparent";
              }}>
              🎯
            </button>
          )}
          {/* Quick snooze icon — visible only for active non-deferred tasks */}
          {!taskIsDone && canAct && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSnoozeMenuOpen(!snoozeMenuOpen);
              }}
              title="Odložit úkol"
              style={{
                ...buttonStyle(),
                width: "34px", height: "34px", padding: "0",
                background: snoozeMenuOpen ? theme.accentSoft : "transparent",
                color: theme.textSub, fontSize: "17px",
                border: `1px solid ${snoozeMenuOpen ? theme.accentBorder : "transparent"}`,
                borderRadius: "6px",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}>
              ⏰
            </button>
          )}
          <span style={{ fontSize: "10px", color: theme.textDim, marginTop: "5px" }}>
            {isOpen ? "▲" : "▼"}
          </span>

          {/* Snooze menu popup — absolute positioned */}
          {snoozeMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute", top: "32px", right: "0",
                background: theme.card, border: `1px solid ${theme.cardBorder}`,
                borderRadius: "10px", padding: "6px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                zIndex: 50,
                display: "flex", flexDirection: "column", gap: "2px",
                minWidth: "120px",
                animation: "slideUp 0.15s",
              }}>
              <div style={{
                fontSize: "9px", color: theme.textMid, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.3px",
                padding: "4px 8px 2px",
              }}>
                Odložit do
              </div>
              {[
                { label: "1 den",  value: addDays(1),  shiftDays: 1 },
                { label: "3 dny",  value: addDays(3),  shiftDays: 3 },
                { label: "Týden",  value: addDays(7),  shiftDays: 7 },
                { label: "Měsíc", value: addDays(30), shiftDays: 30 },
              ].map(opt => (
                <button key={opt.label}
                  onClick={() => {
                    const patch = { showFrom: opt.value };
                    // Pokud má úkol termín splnění, posunout ho o stejný počet dní
                    if (task.dueDate) {
                      patch.dueDate = shiftDueDate(task.dueDate, opt.shiftDays);
                    }
                    onUpdate(task.id, patch);
                    setSnoozeMenuOpen(false);
                    setIsOpen(false);
                  }}
                  style={{
                    ...buttonStyle(),
                    padding: "7px 10px", fontSize: "12px",
                    background: "transparent", color: theme.text,
                    border: "none", textAlign: "left",
                    borderRadius: "6px",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = theme.inputBg}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expanded detail — never on progress cards (they redirect to main) */}
      {isOpen && !progressItem && (
        <TaskDetail
          task={task}
          currentUser={currentUser}
          users={users}
          onUpdate={onUpdate}
          onStatusChange={(taskId, action) => {
            // Wrap reopen so it shows animation on the card
            if (action === "reopen") {
              runWithAnimation("reopen", () => onStatusChange(taskId, action));
            } else {
              onStatusChange(taskId, action);
            }
          }}
          onDelete={onDelete ? (taskId) => runWithAnimation("delete", () => onDelete(taskId)) : null}
          onRestore={onRestore}
          onPermanentDelete={onPermanentDelete}
          theme={theme}
          showCompleteBanner={allChecked}
          onClose={() => setIsOpen(false)}
          comments={comments}
          onAddComment={onAddComment}
          onToggleReaction={onToggleReaction}
          onMarkCommentsSeen={onMarkCommentsSeen}
          onTriggerCompleteAnim={() => {
            // Close detail so user sees the card animation, then run the complete action
            setIsOpen(false);
            setTimeout(() => {
              runWithAnimation("complete", () => {
                if (task.assignTo === "both") onStatusChange(task.id, "done_my");
                else onStatusChange(task.id, "done");
              });
            }, 50);
          }}
        />
      )}
    </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   QUICK ADD BAR
   ═══════════════════════════════════════════════════════ */

function QuickAddBar({ currentUser, users, onAdd, theme, categoryFilter, onCategoryFilterChange, categoryCounts, priorityFilter, onPriorityFilterChange, scopeFilter, onScopeFilterChange, showDeferred, onShowDeferredChange, tagFilter, onTagFilterChange, tagCounts, allTasks, customLists = [], onCreateList, onEditList, dueDateFilter = "all", onDueDateFilterChange, viewStatus = "active", onTypingChange }) {
  const [text, setText] = useState("");
  const [showFull, setShowFull] = useState(false);
  // Persistent typing mode — zůstává otevřený dokud uživatel explicitně nezavře (×)
  // i když input ztratí focus (klik na ikony popoverů)
  const [isTypingPersist, setIsTypingPersist] = useState(false);
  const [note, setNote] = useState("");
  const [type, setType] = useState("simple");
  // Smart default termín — podle aktivního filtru.
  // Filter Datum/ViewStatus ovlivňuje co dostane nový úkol.
  const smartDefaultDueDate = () => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const day = (today.getDay() + 6) % 7; // 0=Po, 6=Ne

    // Filter Dnes nebo viewStatus today → dnes
    if (dueDateFilter === "today" || viewStatus === "today") {
      return today.toISOString().slice(0, 10);
    }
    // Filter Tento týden → konec týdne (sobota)
    if (dueDateFilter === "week") {
      const sat = new Date(today); sat.setDate(sat.getDate() + (5 - day));
      if (sat.getTime() < today.getTime()) sat.setDate(sat.getDate() + 7);
      return sat.toISOString().slice(0, 10);
    }
    // Filter Příští týden → příští neděle
    if (dueDateFilter === "next_week") {
      const nextSun = new Date(today); nextSun.setDate(nextSun.getDate() + (6 - day) + 7);
      return nextSun.toISOString().slice(0, 10);
    }
    // Filter Tento měsíc → konec měsíce
    if (dueDateFilter === "month") {
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12, 0, 0);
      return endOfMonth.toISOString().slice(0, 10);
    }
    // Filter Vlastní rozsah → 'od' datum
    if (dueDateFilter && dueDateFilter.startsWith("range:")) {
      const [from] = dueDateFilter.slice(6).split(",");
      if (from) return from;
    }
    // Default = za týden
    const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(12, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  };
  const [dueDate, setDueDate] = useState(smartDefaultDueDate);
  const [recurrence, setRecurrence] = useState(0);
  const [category, setCategory] = useState("other");
  const [initialChecklist, setInitialChecklist] = useState([]);
  const [checklistInput, setChecklistInput] = useState("");
  const [editingChecklistId, setEditingChecklistId] = useState(null); // ID of item being edited inline
  const [editingChecklistText, setEditingChecklistText] = useState("");
  const [quickCategory, setQuickCategory] = useState(null);
  const [quickPriority, setQuickPriority] = useState(null); // null = default "low"
  // quickAssignees is an array of user names. Empty = default "for me".
  const [quickAssignees, setQuickAssignees] = useState([]);
  const [showFrom, setShowFrom] = useState("");
  // Bottom sheet for compact filter/picker UI
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which segment dropdown is open ("cat" | "pri" | "per" | null)
  const [openSegment, setOpenSegment] = useState(null);
  const inputRef = useRef();
  const segmentBarRef = useRef();
  const containerRef = useRef();
  const otherUsers = users.filter(u => u.name !== currentUser.name);

  // Click outside QuickAddBar — pokud je typing mode aktivní a uživatel klikne mimo
  // formulář (= ne na input, ne na ikonu, ne na popover), vystoupit z typing mode.
  // Předpoklad: pokud uživatel nic nenapsal, vystoupíme. Pokud má rozepsaný text, ponecháme.
  useEffect(() => {
    if (!isTypingPersist) return;
    const onDocClick = (e) => {
      if (!containerRef.current) return;
      // Klik dovnitř formuláře — neukončit
      if (containerRef.current.contains(e.target)) return;
      // Klik na popover (mimo container, ale uvnitř popoveru)
      if (e.target.closest("[data-typing-popover]")) return;
      // Pokud má text, neukončit (uživatel zatím není hotov)
      if (text.trim().length > 0) return;
      // Klik mimo + prázdný input → ukončit typing mode
      setIsTypingPersist(false);
      setOpenSegment(null);
      if (onTypingChange) onTypingChange(false);
    };
    // Delay aby se nezavřelo hned při focusu
    const t = setTimeout(() => {
      document.addEventListener("click", onDocClick);
    }, 100);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  }, [isTypingPersist, text, onTypingChange]);

  // Auto-update default termín při změně filtru — jen když není text/uživatel nepíše a není showFull
  useEffect(() => {
    if (!text.trim() && !showFull) {
      setDueDate(smartDefaultDueDate());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueDateFilter, viewStatus]);

  // Close open segment dropdown when clicking outside the segment bar
  useEffect(() => {
    if (!openSegment) return;
    const onDocClick = (e) => {
      if (segmentBarRef.current && !segmentBarRef.current.contains(e.target)) {
        setOpenSegment(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openSegment]);

  // Compute final assignment from quickAssignees array.
  // Plus filter propagace: pokud filtruji "person:Pavla" a nezvolil jsem nikoho explicitně,
  // úkol jde Pavle (kontext = pracovní mód).
  const computeAssignment = () => {
    // Filter propagace: pokud filter = scope na konkrétní osobu a uživatel nezvolil
    if (quickAssignees.length === 0 && scopeFilter && scopeFilter.startsWith("person:")) {
      const personName = scopeFilter.slice(7);
      return { assignTo: "person", assignedTo: [personName] };
    }
    if (quickAssignees.length === 0 && scopeFilter === "shared") {
      return { assignTo: "both", assignedTo: users.map(u => u.name) };
    }
    // No picks → default: for me
    if (quickAssignees.length === 0) {
      return { assignTo: "self", assignedTo: [currentUser.name] };
    }
    // All users picked → "both"
    if (quickAssignees.length === users.length) {
      return { assignTo: "both", assignedTo: users.map(u => u.name) };
    }
    // Only self picked
    if (quickAssignees.length === 1 && quickAssignees[0] === currentUser.name) {
      return { assignTo: "self", assignedTo: [currentUser.name] };
    }
    // Otherwise → "person" with explicit list
    return { assignTo: "person", assignedTo: [...quickAssignees] };
  };

  const createTaskObject = (title) => {
    const { assignTo, assignedTo } = computeAssignment();
    // Filter propagace: pokud user explicitně nevybral, použij aktivní filter
    const effectivePriority = quickPriority || (priorityFilter !== "all" ? priorityFilter : "low");
    const effectiveCategory = quickCategory
      || (categoryFilter !== "all" ? categoryFilter : null)
      || (category === "other" ? autoDetectCategory(title) : category);
    return {
      id: generateId(),
      title,
      note: note.trim() || null,
      type,
      createdBy: currentUser.name,
      assignTo,
      assignedTo,
      priority: effectivePriority,
      dueDate: dueDate || null,
      showFrom: showFrom || null,
      recDays: recurrence,
      category: effectiveCategory,
      activeMo: [],
      status: "active",
      doneBy: [],
      seenBy: [currentUser.name],
      createdAt: new Date().toISOString(),
      completedAt: null,
      completedByUser: null,
      checklist: type === "complex" ? initialChecklist : [],
      images: [],
    };
  };

  const quickSubmit = () => {
    if (!text.trim()) return;
    onAdd(createTaskObject(text.trim()));
    setText("");
    setQuickCategory(null);
    setQuickPriority(null);
    setQuickAssignees([]);
    inputRef.current?.focus();
  };

  const fullSubmit = () => {
    if (!text.trim()) return;
    onAdd(createTaskObject(text.trim()));
    resetForm();
  };

  const resetForm = () => {
    setText(""); setNote(""); setDueDate(smartDefaultDueDate()); setRecurrence(0);
    setIsTypingPersist(false);
    if (onTypingChange) onTypingChange(false);
    setCategory("other");
    setType("simple"); setShowFull(false); setShowFrom("");
    setInitialChecklist([]); setChecklistInput(""); setQuickCategory(null);
    setQuickPriority(null); setQuickAssignees([]);
  };

  const labelStyle = {
    fontSize: "10px", color: theme.textMid, fontWeight: 700,
    marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.3px"
  };

  const quickDates = [
    { label: "Ihned", value: addDays(0) },
    { label: "1 den", value: addDays(1) },
    { label: "3 dny", value: addDays(3) },
    { label: "Týden", value: addDays(7) },
    { label: "14 dní", value: addDays(14) },
    { label: "Měsíc", value: addDays(30) },
  ];

  return (
    <div ref={containerRef} style={{ marginBottom: "4px" }}>
      {/* Always visible quick input. V complex módu se pole stane "hint" - uživatel zadá název dole.  */}
      <div style={{
        ...cardStyle(theme), padding: "6px 8px",
        display: "flex", gap: "6px", alignItems: "center",
        opacity: (showFull && type === "complex") ? 0.55 : 1,
      }}>
        <span style={{ fontSize: "16px", color: theme.accent, paddingLeft: "4px" }}>+</span>
        <input
          ref={inputRef}
          type="text"
          placeholder={(showFull && type === "complex") ? "↓ Zadej název dole" : "Napiš úkol a stiskni Enter..."}
          value={text}
          onChange={e => {
            setText(e.target.value);
            // Když text > 0, jsme v typing mode
            if (onTypingChange) onTypingChange(true);
          }}
          onFocus={() => {
            // Klik do inputu = typing mode (i když je prázdné, klávesnice se otevře)
            setIsTypingPersist(true);
            if (onTypingChange) onTypingChange(true);
            // Scroll input do viditelné oblasti — JEN pokud je input zcela mimo viewport.
            // Pokud user už vidí input (běžný klidový stav nahoře), žádný scroll = žádný optický skok.
            setTimeout(() => {
              if (inputRef.current) {
                const rect = inputRef.current.getBoundingClientRect();
                const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
                if (!isVisible) {
                  inputRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }
            }, 300);
          }}
          // onBlur záměrně neukončuje typing mode — uživatel může klikat na ikony popoverů.
          // Zavře se jen vědomě (✕ tlačítko), nebo po vytvoření úkolu.
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              if (showFull) fullSubmit(); else quickSubmit();
            } else if (e.key === "Escape") {
              // Esc = stejná funkce jako křížek (zavřít typing mode)
              e.preventDefault();
              setText("");
              setIsTypingPersist(false);
              if (onTypingChange) onTypingChange(false);
              setQuickAssignees([]); setQuickPriority(null); setQuickCategory(null);
              setOpenSegment(null);
              setShowFull(false);
              inputRef.current?.blur();
            }
          }}
          disabled={showFull && type === "complex"}
          style={{
            background: "transparent", border: "none", color: theme.text,
            padding: "8px 4px", fontSize: "14px", fontFamily: FONT,
            outline: "none", flex: 1, width: "100%",
            cursor: (showFull && type === "complex") ? "not-allowed" : "text",
          }}
        />
        {/* Confirm button — visible only when text is entered.
            Needed because clicking category/priority/assignee icons
            takes focus away from the input, so Enter no longer submits. */}
        {text.trim() && (
          <button
            onClick={() => { if (showFull) fullSubmit(); else quickSubmit(); }}
            title="Přidat úkol"
            style={{
              ...buttonStyle(), width: "32px", height: "32px",
              background: theme.green, color: "#fff",
              border: `1px solid ${theme.green}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "15px", fontWeight: 800, flexShrink: 0,
              animation: "fadeIn 0.15s",
            }}>
            ✓
          </button>
        )}
        {/* Cancel typing mode — vždy v typing mode (s textem i bez).
            Bez ohledu na to, jestli uživatel napsal pár písmen nebo ne, musí mít možnost
            zrušit a vrátit se do filter modu jednoznačným ✕ tlačítkem. */}
        {isTypingPersist && (
          <button
            onClick={() => {
              setText("");
              setIsTypingPersist(false);
              if (onTypingChange) onTypingChange(false);
              setQuickAssignees([]); setQuickPriority(null); setQuickCategory(null);
              setOpenSegment(null);
              setShowFull(false);
            }}
            title="Zavřít — vrátit zpět k filtrům"
            style={{
              ...buttonStyle(), width: "32px", height: "32px",
              background: theme.inputBg, color: theme.textSub,
              border: `1px solid ${theme.inputBorder}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "16px", flexShrink: 0,
            }}>
            ×
          </button>
        )}
        <button onClick={() => {
          const next = !showFull;
          setShowFull(next);
          // Když user klikne na ⚙ poprvé (bez kliknutí do input pole), aktivuj i typing mode —
          // jinak se nezobrazí TypingFilterRow s parametry úkolu.
          if (next && !isTypingPersist) {
            setIsTypingPersist(true);
            if (onTypingChange) onTypingChange(true);
          }
        }} title={showFull ? "Skrýt podrobnosti" : "Podrobnosti"} style={{
          ...buttonStyle(), width: "32px", height: "32px",
          background: showFull ? theme.accent : theme.inputBg,
          color: showFull ? "#fff" : theme.textSub,
          border: `1px solid ${showFull ? theme.accent : theme.inputBorder}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "14px", flexShrink: 0,
        }}>
          {/* Vždy ozubené kolečko — modrá výplň indikuje aktivní stav.
              Předtím se měnilo na "×", ale to bylo matoucí: vedle už je šedé × pro cancel typing modu. */}
          ⚙
        </button>
      </div>

      {/* ═══ PREDICTIONS CHIPS — pod inputem, JEN když uživatel píše ═══ */}
      {(() => {
        const trimmed = text.trim();
        // Predikce zobrazujeme JEN když uživatel něco píše (krátký text, 1 slovo)
        // Když nic nepíše = nic doplňovat → schované, šetří místo
        // Predikce zobrazujeme když uživatel něco píše (krátký text, 1 slovo).
        // Funguje i v showFull modu (podrobnosti) — uživatel může napsat název a vidí návrhy.
        const showPredictions = trimmed.length > 0 && trimmed.length <= 15 && !trimmed.includes(" ");
        if (!showPredictions) return null;
        const predictions = getPredictions(allTasks || [], currentUser.name);

        // Normalize search input
        const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const qNorm = norm(trimmed);

        let verbsToShow, phrasesToShow;

        if (trimmed.length === 0) {
          // Empty input — show TOP from history
          verbsToShow = predictions.topVerbs;
          phrasesToShow = predictions.topPhrases;
        } else {
          // ─── LIVE FILTER ───
          // Verbs: vezmi CELÝ slovník TAGS a vyfiltruj ty co matchují
          // Klíčové slovo nebo label začíná na "za"
          verbsToShow = TAGS.filter(tag => {
            if (norm(tag.label).startsWith(qNorm)) return true;
            return tag.keywords.some(kw => norm(kw).startsWith(qNorm));
          }).map(tag => ({ ...tag, count: 0 }));
          // Phrases: jakákoli fráze co OBSAHUJE substring (ne jen začíná)
          phrasesToShow = predictions.topPhrases.filter(p => norm(p.title).includes(qNorm));
          // Plus přidej i jednou-použité úkoly (pro live search to dává smysl)
          if (phrasesToShow.length < 4 && allTasks) {
            const already = new Set(phrasesToShow.map(p => norm(p.title)));
            const onceUsed = (allTasks || [])
              .filter(t =>
                t.status !== "deleted" &&
                (t.createdBy === currentUser.name || t.assignedTo?.includes(currentUser.name)) &&
                norm(t.title).includes(qNorm) &&
                !already.has(norm(t.title))
              )
              .slice(0, 4 - phrasesToShow.length)
              .map(t => ({ title: t.title, count: 1, lastUsed: t.createdAt ? new Date(t.createdAt).getTime() : 0 }));
            phrasesToShow = [...phrasesToShow, ...onceUsed];
          }
        }

        if (verbsToShow.length === 0 && phrasesToShow.length === 0) return null;

        return (
          <div style={{
            marginTop: "8px",
            padding: "6px 0",
          }}>
            <div style={{
              fontSize: "9px", fontWeight: 800, color: theme.textMid,
              textTransform: "uppercase", letterSpacing: "0.4px",
              marginBottom: "5px", padding: "0 2px",
              display: "flex", alignItems: "center", gap: "5px",
            }}>
              <span>✨</span>
              <span>Nápovědy</span>
            </div>
            <div style={{
              display: "flex", flexWrap: "wrap", gap: "5px",
            }}>
            {verbsToShow.slice(0, 4).map(v => (
              <button key={"v_" + v.id} onClick={() => {
                // Vloží sloveso na začátek + mezeru, focus na input
                const newText = trimmed
                  ? (v.label + " " + trimmed.slice(0, 0))
                  : (v.label + " ");
                setText(newText);
                if (inputRef.current) inputRef.current.focus();
              }} style={{
                ...buttonStyle(), padding: "4px 10px", fontSize: "11px",
                background: theme.inputBg, color: theme.textSub,
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: "12px", fontWeight: 600,
                display: "inline-flex", gap: "4px", alignItems: "center",
              }}>
                <span>{v.emoji}</span>
                <span>{v.label}</span>
              </button>
            ))}
            {phrasesToShow.slice(0, 4).map((p, i) => (
              <button key={"p_" + i} onClick={() => {
                setText(p.title);
                if (inputRef.current) inputRef.current.focus();
              }} title={`Použito ${p.count}× — klik vyplní celý název`} style={{
                ...buttonStyle(), padding: "4px 10px", fontSize: "11px",
                background: theme.inputBg, color: theme.textSub,
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: "12px", fontWeight: 600,
                display: "inline-flex", gap: "4px", alignItems: "center",
                maxWidth: "200px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                <span>🔁</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</span>
              </button>
            ))}
            </div>
          </div>
        );
      })()}

      {/* ═══ TypingFilterRow — ikony pro nastavení parametrů úkolu (typing mode) ═══ */}
      {(() => {
        // Parametry úkolu (Datum/Osoba/Seznam/Priorita) zůstávají viditelné v celém typing modu —
        // i když je otevřený full panel s podrobnostmi. Důvod: tyto rychlé parametry jsou
        // nezávislé na podrobnostech (typ úkolu, opakování...) a uživatel je má pohodlně po ruce.
        if (!isTypingPersist) return null;

        // Helper na popover pozicování
        const popoverWrap = {
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          minWidth: "200px", maxWidth: "280px",
          background: theme.bg,
          border: `1px solid ${theme.cardBorder}`,
          borderRadius: "10px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          padding: "10px",
          zIndex: 50,
          animation: "slideUp 0.15s",
        };
        const popoverHeader = {
          fontSize: "10px", fontWeight: 800, color: theme.textMid,
          textTransform: "uppercase", letterSpacing: "0.4px",
          marginBottom: "8px",
          paddingBottom: "6px",
          borderBottom: `1px solid ${theme.cardBorder}`,
        };

        // Date helpers
        const today = new Date(); today.setHours(12, 0, 0, 0);
        const todayStr = today.toISOString().slice(0, 10);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().slice(0, 10);
        const day = (today.getDay() + 6) % 7;
        const sat = new Date(today); sat.setDate(sat.getDate() + (5 - day));
        if (sat.getTime() < today.getTime()) sat.setDate(sat.getDate() + 7);
        const satStr = sat.toISOString().slice(0, 10);
        const weekFromNow = new Date(today); weekFromNow.setDate(weekFromNow.getDate() + 7);
        const weekStr = weekFromNow.toISOString().slice(0, 10);

        // Rozhodni co je aktuální termín
        const dateOptions = [
          { value: todayStr,    icon: "🎯", label: "Dnes" },
          { value: tomorrowStr, icon: "📅", label: "Zítra" },
          { value: satStr,      icon: "📅", label: "Sobota" },
          { value: weekStr,     icon: "📅", label: "Týden" },
        ];
        const curDate = dateOptions.find(o => o.value === dueDate);
        const dateIcon = curDate?.icon || "📅";
        const dateLabel = curDate?.label || (dueDate ? formatDate(dueDate) : "Termín");

        // Aktuální assignees
        const assigneesIsAll = quickAssignees.length === users.length && users.length > 1;
        const assigneesIsMe = quickAssignees.length === 0
          || (quickAssignees.length === 1 && quickAssignees[0] === currentUser.name);

        // Seznam ikona
        const visibleLists = (customLists || []).filter(l => l.is_shared || l.created_by_user === currentUser.name);
        const curList = quickCategory && quickCategory.startsWith("list:")
          ? visibleLists.find(l => `list:${l.id}` === quickCategory)
          : null;
        const listIcon = curList?.emoji || "📁";

        // Priority ikona
        const priColor = quickPriority === "urgent" ? "#ef4444"
                       : quickPriority === "important" ? "#f59e0b"
                       : theme.textMid;
        const priIcon = quickPriority === "urgent" ? "‼"
                      : quickPriority === "important" ? "!"
                      : "!";

        // Helper button
        const IconButton = ({ active, color, children, onClick, segmentKey, title }) => (
          <div style={{ position: "relative", flex: 1 }}>
            <button type="button" onClick={onClick}
              title={title}
              style={{
                width: "100%", height: "35px",
                background: active ? `${color}15` : theme.inputBg,
                color: active ? color : theme.textMid,
                border: `1.5px solid ${active ? color : theme.inputBorder}`,
                borderRadius: "10px",
                fontSize: "16px", fontWeight: 700,
                cursor: "pointer", fontFamily: FONT,
                boxShadow: active ? `0 1px 4px ${color}25` : "none",
                transition: "all 0.15s",
              }}>
              {children}
            </button>
          </div>
        );

        return (
          <div style={{
            marginTop: "4px",
            position: "relative",
          }}>
            <div style={{
              fontSize: "9px", fontWeight: 800, color: theme.textMid,
              textTransform: "uppercase", letterSpacing: "0.4px",
              marginBottom: "3px", padding: "0 2px",
              display: "flex", alignItems: "center", gap: "5px",
            }}>
              <span>⚡</span>
              <span>Parametry úkolu</span>
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>

              {/* Datum */}
              <IconButton active={!!dueDate}
                color={theme.accent}
                title={`Termín: ${dateLabel}`}
                onClick={(e) => { e.stopPropagation(); setOpenSegment(openSegment === "t_date" ? null : "t_date"); }}>
                <span>{dateIcon}</span>
              </IconButton>

              {/* Pro koho */}
              <IconButton active={!assigneesIsMe}
                color={theme.accent}
                title="Komu úkol zadávám"
                onClick={(e) => { e.stopPropagation(); setOpenSegment(openSegment === "t_who" ? null : "t_who"); }}>
                {assigneesIsAll ? "👥" : assigneesIsMe ? "👤" : "👤"}
              </IconButton>

              {/* Seznam */}
              <IconButton active={!!quickCategory}
                color={curList?.color || theme.accent}
                title="Seznam"
                onClick={(e) => { e.stopPropagation(); setOpenSegment(openSegment === "t_list" ? null : "t_list"); }}>
                <span>{listIcon}</span>
              </IconButton>

              {/* Priorita — přepínací */}
              <IconButton active={!!quickPriority && quickPriority !== "low"}
                color={priColor}
                title={`Priorita: ${quickPriority === "urgent" ? "Urgent" : quickPriority === "important" ? "Důležité" : "žádná"}`}
                onClick={() => {
                  if (!quickPriority || quickPriority === "low") setQuickPriority("important");
                  else if (quickPriority === "important") setQuickPriority("urgent");
                  else setQuickPriority(null);
                }}>
                <span>{priIcon}</span>
              </IconButton>

            </div>

            {/* Datum popover */}
            {openSegment === "t_date" && (
              <div style={popoverWrap} data-filter-popover onClick={e => e.stopPropagation()}>
                <div style={popoverHeader}>📅 Termín splnění</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {dateOptions.map(opt => {
                    const isSel = dueDate === opt.value;
                    return (
                      <button key={opt.value} type="button"
                        onClick={() => { setDueDate(opt.value); setOpenSegment(null); }}
                        style={{
                          ...buttonStyle(),
                          padding: "8px 10px", fontSize: "12px", fontWeight: 600,
                          background: isSel ? theme.accentSoft : "transparent",
                          color: isSel ? theme.accent : theme.text,
                          border: "none", textAlign: "left", borderRadius: "6px",
                          display: "flex", alignItems: "center", gap: "8px",
                        }}>
                        <span style={{ width: "20px" }}>{opt.icon}</span>
                        <span style={{ flex: 1 }}>{opt.label}</span>
                        {isSel && <span style={{ color: theme.accent }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
                <div style={{
                  marginTop: "8px", paddingTop: "8px",
                  borderTop: `1px solid ${theme.cardBorder}`,
                }}>
                  <input type="date" value={dueDate || ""}
                    onChange={e => setDueDate(e.target.value)}
                    style={{ ...inputStyle(theme), padding: "6px 8px", fontSize: "12px", width: "100%" }} />
                </div>
              </div>
            )}

            {/* Pro koho popover */}
            {openSegment === "t_who" && (
              <div style={popoverWrap} data-filter-popover onClick={e => e.stopPropagation()}>
                <div style={popoverHeader}>👤 Komu úkol zadávám</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {users.map(u => {
                    const isSel = quickAssignees.includes(u.name);
                    const isMe = u.name === currentUser.name;
                    return (
                      <button key={u.name} type="button"
                        onClick={() => {
                          if (isSel) {
                            setQuickAssignees(prev => prev.filter(n => n !== u.name));
                          } else {
                            setQuickAssignees(prev => [...prev, u.name]);
                          }
                        }}
                        style={{
                          ...buttonStyle(),
                          padding: "8px 10px", fontSize: "12px", fontWeight: 600,
                          background: isSel ? theme.accentSoft : "transparent",
                          color: isSel ? theme.accent : theme.text,
                          border: "none", textAlign: "left", borderRadius: "6px",
                          display: "flex", alignItems: "center", gap: "8px",
                        }}>
                        <span style={{ width: "20px" }}>{isSel ? "☑" : "☐"}</span>
                        <span style={{ flex: 1 }}>{isMe ? "Já" : u.name}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{
                  fontSize: "10px", color: theme.textSub,
                  marginTop: "6px", padding: "4px 8px",
                }}>
                  {quickAssignees.length === 0 ? "Bez výběru = úkol je pro mě"
                    : quickAssignees.length === users.length ? "Pro všechny v rodině"
                    : `Pro: ${quickAssignees.join(", ")}`}
                </div>
                <button type="button" onClick={() => setOpenSegment(null)}
                  style={{
                    ...buttonStyle(), width: "100%",
                    padding: "8px", fontSize: "12px", fontWeight: 600,
                    background: theme.accent, color: "#fff",
                    border: "none", borderRadius: "6px", marginTop: "6px",
                  }}>Hotovo</button>
              </div>
            )}

            {/* Seznam popover */}
            {openSegment === "t_list" && (
              <div style={popoverWrap} data-filter-popover onClick={e => e.stopPropagation()}>
                <div style={popoverHeader}>📁 Seznam</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  <button type="button"
                    onClick={() => { setQuickCategory(null); setOpenSegment(null); }}
                    style={{
                      ...buttonStyle(),
                      padding: "8px 10px", fontSize: "12px", fontWeight: 600,
                      background: !quickCategory ? theme.accentSoft : "transparent",
                      color: !quickCategory ? theme.accent : theme.text,
                      border: "none", textAlign: "left", borderRadius: "6px",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                    <span style={{ width: "20px" }}>—</span>
                    <span style={{ flex: 1 }}>Žádný seznam</span>
                  </button>
                  {/* Předdefinované kategorie */}
                  {CATEGORIES.map(cat => {
                    const isSel = quickCategory === cat.id;
                    return (
                      <button key={cat.id} type="button"
                        onClick={() => { setQuickCategory(cat.id); setOpenSegment(null); }}
                        style={{
                          ...buttonStyle(),
                          padding: "8px 10px", fontSize: "12px", fontWeight: 600,
                          background: isSel ? theme.accentSoft : "transparent",
                          color: isSel ? theme.accent : theme.text,
                          border: "none", textAlign: "left", borderRadius: "6px",
                          display: "flex", alignItems: "center", gap: "8px",
                        }}>
                        <span style={{ width: "20px" }}>{cat.icon}</span>
                        <span style={{ flex: 1 }}>{cat.label}</span>
                        {isSel && <span style={{ color: theme.accent }}>✓</span>}
                      </button>
                    );
                  })}
                  {/* Sekce pro vlastní seznamy — jen pokud existují */}
                  {visibleLists.length > 0 && (
                    <div style={{
                      margin: "6px 0 4px", paddingTop: "6px",
                      borderTop: `1px solid ${theme.cardBorder}`,
                      fontSize: "9px", fontWeight: 800, color: theme.textMid,
                      textTransform: "uppercase", letterSpacing: "0.4px",
                      paddingLeft: "8px",
                    }}>Vlastní seznamy</div>
                  )}
                  {visibleLists.map(list => {
                    const v = `list:${list.id}`;
                    const isSel = quickCategory === v;
                    return (
                      <button key={list.id} type="button"
                        onClick={() => { setQuickCategory(v); setOpenSegment(null); }}
                        style={{
                          ...buttonStyle(),
                          padding: "8px 10px", fontSize: "12px", fontWeight: 600,
                          background: isSel ? `${list.color}20` : "transparent",
                          color: isSel ? list.color : theme.text,
                          border: "none", textAlign: "left", borderRadius: "6px",
                          display: "flex", alignItems: "center", gap: "8px",
                        }}>
                        <span style={{ width: "20px" }}>{list.emoji || "📁"}</span>
                        <span style={{ flex: 1 }}>{list.name}</span>
                        {isSel && <span style={{ color: list.color }}>✓</span>}
                      </button>
                    );
                  })}
                  <button type="button"
                    onClick={() => { onCreateList && onCreateList(); setOpenSegment(null); }}
                    style={{
                      ...buttonStyle(),
                      padding: "8px 10px", fontSize: "11px", fontWeight: 600,
                      background: "transparent", color: theme.accent,
                      border: `1px dashed ${theme.accent}50`,
                      borderRadius: "6px", textAlign: "left",
                      marginTop: "4px",
                    }}>+ Vytvořit nový seznam</button>
                </div>
              </div>
            )}

          </div>
        );
      })()}

      {/* Stará Segmented filter bar a picker modal odstraněn — nahrazeno App-level kompaktní lištou + ⋯ Více sheetem */}

      {/* Extended form */}
      {showFull && (
        <div style={{
          ...cardStyle(theme), padding: "12px", marginTop: "6px",
          animation: "slideUp 0.2s",
        }}>
          {/* Type toggle */}
          <div style={{
            display: "flex", gap: "0", marginBottom: "10px",
            border: `1px solid ${theme.cardBorder}`, borderRadius: "8px", overflow: "hidden",
          }}>
            {[{ id: "simple", label: "✓ Jednoduchý" }, { id: "complex", label: "☰ S checklistem" }].map(tp => (
              <button key={tp.id} onClick={() => setType(tp.id)} style={{
                ...buttonStyle(), flex: 1, padding: "8px", fontSize: "11px",
                borderRadius: 0,
                background: type === tp.id ? theme.accent : "transparent",
                color: type === tp.id ? "#fff" : theme.textSub,
                border: "none",
              }}>{tp.label}</button>
            ))}
          </div>

          {/* Title section — visible jen v complex mode (jednoduchý používá top input) */}
          {type === "complex" && (
            <div style={{
              marginBottom: "10px", padding: "10px",
              background: `${theme.accent}08`,
              borderRadius: "8px",
              border: `2px solid ${theme.accent}30`,
            }}>
              <div style={{
                ...labelStyle, fontSize: "10px", fontWeight: 800,
                color: theme.accent, textTransform: "uppercase",
                letterSpacing: "0.5px", marginBottom: "5px",
                display: "flex", alignItems: "center", gap: "4px",
              }}>
                📝 Název úkolu
              </div>
              <input
                type="text"
                placeholder="Např. Nákup potravin"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) fullSubmit(); }}
                autoFocus
                style={{
                  ...inputStyle(theme),
                  fontSize: "15px", fontWeight: 600,
                  background: theme.card,
                  border: `1px solid ${theme.accent}40`,
                  padding: "10px 12px",
                }}
              />
            </div>
          )}

          {/* Pro simple — poznámka nahoře. Pro complex (s checklistem) — pod checklistem */}
          {type !== "complex" && (
            <textarea placeholder="Poznámka..." value={note} onChange={e => setNote(e.target.value)}
              rows={2} style={{
                ...inputStyle(theme), fontSize: "13px", marginBottom: "8px",
                resize: "vertical", lineHeight: 1.4,
              }}
            />
          )}

          {/* Checklist builder for complex type */}
          {type === "complex" && (
            <div style={{
              marginBottom: "10px", padding: "10px",
              background: `${theme.purple}08`,
              borderRadius: "8px",
              border: `2px solid ${theme.purple}40`,
            }}>
              <div style={{
                ...labelStyle, fontSize: "10px", fontWeight: 800,
                color: theme.purple, textTransform: "uppercase",
                letterSpacing: "0.5px", marginBottom: "8px",
                display: "flex", alignItems: "center", gap: "4px",
              }}>
                ☐ Položky checklistu
              </div>
              {initialChecklist.map(item => (
                <div key={item.id} style={{
                  display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px",
                }}>
                  <span style={{ fontSize: "12px", color: theme.textSub }}>○</span>
                  {editingChecklistId === item.id ? (
                    <input
                      type="text"
                      value={editingChecklistText}
                      autoFocus
                      onChange={e => setEditingChecklistText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const newText = editingChecklistText.trim();
                          if (newText) {
                            setInitialChecklist(prev => prev.map(x =>
                              x.id === item.id ? { ...x, text: newText } : x
                            ));
                          }
                          setEditingChecklistId(null);
                          setEditingChecklistText("");
                        }
                        if (e.key === "Escape") {
                          setEditingChecklistId(null);
                          setEditingChecklistText("");
                        }
                      }}
                      onBlur={() => {
                        const newText = editingChecklistText.trim();
                        if (newText) {
                          setInitialChecklist(prev => prev.map(x =>
                            x.id === item.id ? { ...x, text: newText } : x
                          ));
                        }
                        setEditingChecklistId(null);
                        setEditingChecklistText("");
                      }}
                      style={{ ...inputStyle(theme), flex: 1, fontSize: "13px", padding: "3px 6px" }}
                    />
                  ) : (
                    <span
                      onClick={() => {
                        setEditingChecklistId(item.id);
                        setEditingChecklistText(item.text);
                      }}
                      title="Klikni pro úpravu"
                      style={{ flex: 1, fontSize: "13px", color: theme.text, cursor: "text" }}>
                      {item.text}
                    </span>
                  )}
                  <button onClick={() => setInitialChecklist(prev => prev.filter(x => x.id !== item.id))}
                    style={{ background: "none", border: "none", color: theme.textDim, cursor: "pointer", fontSize: "14px" }}>
                    ×
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: "5px", marginTop: "4px" }}>
                <input
                  placeholder="Přidat položku..."
                  value={checklistInput}
                  onChange={e => setChecklistInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (checklistInput.trim()) {
                        setInitialChecklist(prev => [...prev, {
                          id: generateId(), text: checklistInput.trim(),
                          done: false, doneBy: null, doneAt: null,
                        }]);
                        setChecklistInput("");
                      }
                    }
                  }}
                  style={{ ...inputStyle(theme), fontSize: "12px", padding: "7px 10px", flex: 1 }}
                />
                <button onClick={() => {
                  if (checklistInput.trim()) {
                    setInitialChecklist(prev => [...prev, {
                      id: generateId(), text: checklistInput.trim(),
                      done: false, doneBy: null, doneAt: null,
                    }]);
                    setChecklistInput("");
                  }
                }} style={{
                  ...buttonStyle(),
                  padding: "7px 16px",
                  background: checklistInput.trim() ? theme.purple : theme.inputBg,
                  color: checklistInput.trim() ? "#fff" : theme.textDim,
                  border: `1px solid ${checklistInput.trim() ? theme.purple : theme.inputBorder}`,
                  fontSize: "14px", fontWeight: 700,
                  cursor: checklistInput.trim() ? "pointer" : "default",
                  transition: "all 0.15s",
                }}>+ Přidat</button>
              </div>
            </div>
          )}

          {/* Pro complex — poznámka pod checklistem (sekundární info) */}
          {type === "complex" && (
            <textarea placeholder="Poznámka k úkolu (volitelné)..." value={note} onChange={e => setNote(e.target.value)}
              rows={2} style={{
                ...inputStyle(theme), fontSize: "13px", marginBottom: "8px",
                resize: "vertical", lineHeight: 1.4,
              }}
            />
          )}

          {/* Pro koho / Priorita / Seznam jsou v ikonové liště nahoře (TypingFilterRow) — neopakujeme */}
          {/* Opakování — řádek tlačítek */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>Opakování</div>
            <div style={{
              display: "flex", gap: "4px", flexWrap: "wrap",
            }}>
              {RECURRENCE_OPTIONS.map(r => {
                const isSel = recurrence === r.value;
                return (
                  <button key={r.value}
                    type="button"
                    onClick={() => setRecurrence(r.value)}
                    style={{
                      ...buttonStyle(),
                      padding: "5px 10px", fontSize: "11px", fontWeight: 600,
                      background: isSel ? theme.accent : theme.inputBg,
                      color: isSel ? "#fff" : theme.textSub,
                      border: `1px solid ${isSel ? theme.accent : theme.inputBorder}`,
                      borderRadius: "12px",
                    }}>
                    {r.label}
                  </button>
                );
              })}
            </div>
            {/* Hint pro intervaly bez specifického day-pickeru (1/3/14/90) */}
            {recurrence > 0 && recurrence !== 7 && recurrence !== 30 && (
              <div style={{
                fontSize: "10px", color: theme.textSub,
                marginTop: "5px", padding: "5px 8px",
                background: theme.inputBg, borderRadius: "5px",
                lineHeight: 1.4,
              }}>
                💡 V poli „Termín splnění" níže nastav <strong>datum prvního výskytu</strong>.
                Úkol se bude opakovat každých <strong>{recurrence} {recurrence === 1 ? "den" : recurrence < 5 ? "dny" : "dní"}</strong> od tohoto data.
              </div>
            )}
            {/* Day-of-week picker pro "Každý týden" */}
            {recurrence === 7 && (() => {
              const dayNames = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
              const currentDay = dueDate ? ((new Date(dueDate).getDay() + 6) % 7) : -1;
              return (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ ...labelStyle, fontSize: "10px", marginBottom: "5px" }}>
                    Den opakování
                  </div>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {dayNames.map((dayName, idx) => {
                      const isSel = currentDay === idx;
                      return (
                        <button key={idx} type="button"
                          onClick={() => {
                            // Najdi nejbližší termín pro daný den (od zítra dál)
                            const today = new Date();
                            const todayDay = (today.getDay() + 6) % 7;
                            let daysAhead = idx - todayDay;
                            if (daysAhead <= 0) daysAhead += 7;
                            const next = new Date(today);
                            next.setDate(next.getDate() + daysAhead);
                            next.setHours(12, 0, 0, 0);
                            setDueDate(next.toISOString().slice(0, 10));
                          }}
                          style={{
                            ...buttonStyle(),
                            padding: "6px 10px", fontSize: "11px", fontWeight: 700,
                            background: isSel ? theme.accent : theme.inputBg,
                            color: isSel ? "#fff" : theme.textSub,
                            border: `1px solid ${isSel ? theme.accent : theme.inputBorder}`,
                            borderRadius: "8px",
                            minWidth: "36px",
                          }}>
                          {dayName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Mini-kalendář pro měsíční opakování */}
            {recurrence === 30 && (() => {
              const today = new Date();
              const yyyy = today.getFullYear();
              const mm = today.getMonth();
              const monthNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
                                   "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
              const dayNamesShort = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
              // Aktuální měsíc - pro výběr dne
              const firstOfMonth = new Date(yyyy, mm, 1);
              const lastOfMonth = new Date(yyyy, mm + 1, 0);
              const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
              const daysInMonth = lastOfMonth.getDate();

              const cells = [];
              for (let i = 0; i < firstWeekday; i++) cells.push(null);
              for (let d = 1; d <= daysInMonth; d++) cells.push(d);

              const selDay = dueDate ? new Date(dueDate).getDate() : -1;
              const todayDay = today.getDate();

              return (
                <div style={{ marginTop: "10px" }}>
                  <div style={{ ...labelStyle, fontSize: "10px", marginBottom: "6px" }}>
                    Den v měsíci pro opakování
                  </div>
                  <div style={{
                    background: theme.inputBg,
                    border: `1px solid ${theme.inputBorder}`,
                    borderRadius: "8px", padding: "8px",
                  }}>
                    <div style={{
                      fontSize: "11px", fontWeight: 700, color: theme.text,
                      textAlign: "center", marginBottom: "6px",
                    }}>
                      {monthNames[mm]} {yyyy}
                    </div>
                    {/* Day name header */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px",
                      marginBottom: "3px",
                    }}>
                      {dayNamesShort.map(d => (
                        <div key={d} style={{
                          textAlign: "center", fontSize: "9px", fontWeight: 700,
                          color: theme.textMid,
                        }}>{d}</div>
                      ))}
                    </div>
                    {/* Days grid */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px",
                    }}>
                      {cells.map((d, idx) => {
                        if (d === null) return <div key={"e_" + idx} />;
                        const isSel = d === selDay;
                        const isTodayCell = d === todayDay;
                        return (
                          <button key={d} type="button"
                            onClick={() => {
                              // Najdi datum: pokud je den >= dnešní, nastav v aktuálním měsíci, jinak příští měsíc
                              const next = new Date(yyyy, mm, d, 12, 0, 0);
                              if (next.getTime() < today.getTime()) {
                                next.setMonth(next.getMonth() + 1);
                              }
                              setDueDate(next.toISOString().slice(0, 10));
                            }}
                            style={{
                              ...buttonStyle(),
                              aspectRatio: "1",
                              padding: 0,
                              background: isSel ? theme.accent : "transparent",
                              color: isSel ? "#fff" : theme.text,
                              border: isTodayCell && !isSel ? `1px solid ${theme.accent}` : `1px solid transparent`,
                              borderRadius: "6px",
                              fontSize: "11px", fontWeight: isSel ? 800 : 600,
                              cursor: "pointer",
                            }}>
                            {d}
                          </button>
                        );
                      })}
                    </div>
                    {selDay > 0 && (
                      <div style={{
                        marginTop: "8px", fontSize: "10px",
                        color: theme.textSub, textAlign: "center",
                      }}>
                        Opakovat každý {selDay}. den v měsíci
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Quick dates */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>Termín splnění</div>
            <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginBottom: "4px" }}>
              {quickDates.map(qd => (
                <button key={qd.label} onClick={() => setDueDate(qd.value)} style={{
                  ...buttonStyle(), padding: "5px 10px", fontSize: "11px", fontWeight: 600,
                  background: dueDate === qd.value ? theme.accent : theme.inputBg,
                  color: dueDate === qd.value ? "#fff" : theme.textSub,
                  border: `1px solid ${dueDate === qd.value ? theme.accent : theme.inputBorder}`,
                  borderRadius: "12px",
                }}>{qd.label}</button>
              ))}
              {dueDate && (
                <button onClick={() => setDueDate("")} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: "transparent", color: theme.red,
                  border: `1px solid ${theme.red}25`,
                }}>✕</button>
              )}
            </div>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              style={{ ...inputStyle(theme), fontSize: "12px", padding: "6px 10px" }}
            />
          </div>

          {/* Show from — deferred tasks */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>Zobrazit od (odložit úkol)</div>
            <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginBottom: "4px" }}>
              {[
                { label: "Za týden", value: addDays(7), shiftDays: 7 },
                { label: "Za 14d", value: addDays(14), shiftDays: 14 },
                { label: "Za měsíc", value: addDays(30), shiftDays: 30 },
                { label: "Za 2 měsíce", value: addDays(60), shiftDays: 60 },
              ].map(sf => (
                <button key={sf.label} onClick={() => {
                  setShowFrom(sf.value);
                  // Pokud máme termín splnění, posunout ho
                  if (dueDate) {
                    const shifted = shiftDueDate(dueDate, sf.shiftDays);
                    if (shifted) setDueDate(shifted);
                  }
                }} style={{
                  ...buttonStyle(), padding: "5px 10px", fontSize: "11px", fontWeight: 600,
                  background: showFrom === sf.value ? theme.accent : theme.inputBg,
                  color: showFrom === sf.value ? "#fff" : theme.textSub,
                  border: `1px solid ${showFrom === sf.value ? theme.accent : theme.inputBorder}`,
                  borderRadius: "12px",
                }}>{sf.label}</button>
              ))}
              {showFrom && (
                <button onClick={() => setShowFrom("")} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: "transparent", color: theme.red,
                  border: `1px solid ${theme.red}25`,
                }}>✕</button>
              )}
            </div>
            <input type="date" value={showFrom} onChange={e => setShowFrom(e.target.value)}
              style={{ ...inputStyle(theme), fontSize: "12px", padding: "6px 10px" }}
            />
            {showFrom && (
              <div style={{ fontSize: "11px", color: theme.accent, marginTop: "3px" }}>
                📅 Úkol se zobrazí od {formatDate(showFrom)}{dueDate ? `, termín ${formatDate(dueDate)}` : ""}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={fullSubmit} style={{
              ...buttonStyle(), flex: 1, padding: "13px",
              background: theme.green, color: "#fff",
              fontSize: "15px", fontWeight: 700,
              border: `2px solid ${theme.green}`,
              boxShadow: `0 2px 8px ${theme.green}40`,
            }}>✓ Vytvořit úkol</button>
            <button onClick={resetForm} style={{
              ...buttonStyle(), padding: "13px 16px",
              background: "transparent", color: theme.textSub,
              border: `1px solid ${theme.cardBorder}`, fontSize: "14px",
            }}>Storno</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   STATISTICS
   ═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   CREATE LIST MODAL — modal pro vytvoření vlastního seznamu
   ═══════════════════════════════════════════════════════ */

function CreateListModal({ theme, currentUser, onClose, onCreate, onUpdate, onDelete, editingList = null, tasksInList = 0, allLists = [], onDeleteListAndTasks, onMoveTasksToList }) {
  const isEditing = !!editingList;
  const [name, setName] = useState(editingList?.name || "");
  const [emoji, setEmoji] = useState(editingList?.emoji || "📁");
  const [color, setColor] = useState(editingList?.color || "#3b82f6");
  const [isShared, setIsShared] = useState(editingList?.is_shared !== false);
  const [saving, setSaving] = useState(false);
  // Delete dialog stav: null = zavřený, "ask" = ptáme se, "moving" = přesouváme do jiného seznamu
  const [deleteDialog, setDeleteDialog] = useState(null);

  const EMOJIS = ["📁", "🏗", "🌴", "🏠", "💼", "🎓", "🎨", "🚗", "💪", "🍽", "🎁", "📚"];
  const COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#6366f1"];

  // Pouze vlastník může editovat / mazat
  const canEdit = isEditing && editingList?.created_by_user === currentUser.name;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isEditing) {
        if (!canEdit) {
          alert("Můžeš editovat jen vlastní seznamy.");
          setSaving(false);
          return;
        }
        const updates = {
          name: name.trim(), emoji, color, is_shared: isShared,
        };
        const { data, error } = await supabase.from("custom_lists")
          .update(updates).eq("id", editingList.id).select().single();
        if (error) throw error;
        onUpdate && onUpdate(data);
        onClose();
      } else {
        const newList = {
          name: name.trim(), emoji, color, is_shared: isShared,
          created_by_user: currentUser.name,
        };
        const { data, error } = await supabase.from("custom_lists")
          .insert([newList]).select().single();
        if (error) throw error;
        onCreate && onCreate(data);
        onClose();
      }
    } catch (e) {
      console.error("Uložení seznamu selhalo:", e);
      alert("Nepodařilo se uložit: " + (e.message || "neznámá chyba"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit || !editingList) return;
    // Pokud má seznam úkoly, ukaž dialog s volbami
    if (tasksInList > 0) {
      setDeleteDialog("ask");
      return;
    }
    // Žádné úkoly → smaž rovnou
    if (!confirm(`Smazat seznam "${editingList.name}"?`)) return;
    await performDelete("keep");
  };

  // mode: "keep" = úkoly zůstanou bez kategorie | "delete_tasks" = smaž i úkoly | "move:<listId>" = přesuň
  const performDelete = async (mode) => {
    setSaving(true);
    try {
      // Krok 1: vyřeš úkoly (delete / keep / move)
      if (mode === "delete_tasks" && onDeleteListAndTasks) {
        await onDeleteListAndTasks(editingList.id);
      } else if (mode.startsWith("move:") && onMoveTasksToList) {
        const targetListId = mode.slice(5);
        await onMoveTasksToList(editingList.id, targetListId);
      }
      // Krok 2: smaž samotný seznam
      const { error } = await supabase.from("custom_lists")
        .delete().eq("id", editingList.id);
      if (error) throw error;
      onDelete && onDelete(editingList.id);
      onClose();
    } catch (e) {
      console.error("Smazání selhalo:", e);
      alert("Nepodařilo se smazat: " + (e.message || "neznámá chyba"));
    } finally {
      setSaving(false);
      setDeleteDialog(null);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1100, display: "flex", justifyContent: "center", alignItems: "center",
      animation: "slideUp 0.2s",
      padding: "16px",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: "400px",
        background: theme.bg, borderRadius: "12px",
        padding: "20px",
        boxShadow: "0 12px 32px rgba(0,0,0,0.3)",
        display: "flex", flexDirection: "column", gap: "14px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
            {emoji} {isEditing ? "Upravit seznam" : "Nový seznam"}
          </h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: "20px",
            cursor: "pointer", color: theme.textSub, padding: "0 4px",
          }}>×</button>
        </div>

        {isEditing && !canEdit && (
          <div style={{
            padding: "10px", borderRadius: "6px",
            background: `${theme.yellow}15`, color: theme.yellow,
            fontSize: "11px", fontWeight: 600, border: `1px solid ${theme.yellow}40`,
          }}>
            🔒 Tento seznam vytvořil/a {editingList.created_by_user}, můžeš ho jen vidět.
          </div>
        )}

        {/* Název */}
        <div>
          <label style={{ fontSize: "11px", fontWeight: 700, color: theme.textMid, textTransform: "uppercase" }}>
            Název
          </label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Např. Stavba, Dovolená..."
            disabled={isEditing && !canEdit}
            autoFocus={!isEditing}
            style={{ ...inputStyle(theme), marginTop: "4px", padding: "8px 12px", fontSize: "13px" }} />
        </div>

        {/* Emoji */}
        <div>
          <label style={{ fontSize: "11px", fontWeight: 700, color: theme.textMid, textTransform: "uppercase" }}>
            Ikona
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
            {EMOJIS.map(emo => (
              <button key={emo} type="button"
                onClick={() => {
                  if (isEditing && !canEdit) return;
                  setEmoji(emo);
                }}
                disabled={isEditing && !canEdit}
                style={{
                  width: "34px", height: "34px",
                  border: `2px solid ${emoji === emo ? color : theme.cardBorder}`,
                  background: emoji === emo ? `${color}15` : theme.inputBg,
                  borderRadius: "8px", cursor: (isEditing && !canEdit) ? "not-allowed" : "pointer",
                  fontSize: "16px", opacity: (isEditing && !canEdit) ? 0.5 : 1,
                }}>{emo}</button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div>
          <label style={{ fontSize: "11px", fontWeight: 700, color: theme.textMid, textTransform: "uppercase" }}>
            Barva
          </label>
          <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
            {COLORS.map(c => (
              <button key={c} type="button"
                onClick={() => {
                  if (isEditing && !canEdit) return;
                  setColor(c);
                }}
                disabled={isEditing && !canEdit}
                style={{
                  width: "28px", height: "28px",
                  background: c, borderRadius: "50%",
                  border: color === c ? `3px solid ${theme.text}` : `1px solid ${theme.cardBorder}`,
                  cursor: (isEditing && !canEdit) ? "not-allowed" : "pointer",
                  opacity: (isEditing && !canEdit) ? 0.5 : 1,
                }} />
            ))}
          </div>
        </div>

        {/* Sdílení */}
        <div>
          <label style={{ fontSize: "11px", fontWeight: 700, color: theme.textMid, textTransform: "uppercase" }}>
            Sdílení
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
            <button type="button" onClick={() => {
              if (isEditing && !canEdit) return;
              setIsShared(true);
            }}
              disabled={isEditing && !canEdit}
              style={{
                ...buttonStyle(),
                padding: "8px 12px", fontSize: "12px", textAlign: "left",
                background: isShared ? `${color}15` : theme.inputBg,
                color: isShared ? color : theme.text,
                border: `1px solid ${isShared ? color : theme.cardBorder}`,
                fontWeight: 600, opacity: (isEditing && !canEdit) ? 0.5 : 1,
              }}>👥 Sdílený — vidí všichni v rodině</button>
            <button type="button" onClick={() => {
              if (isEditing && !canEdit) return;
              setIsShared(false);
            }}
              disabled={isEditing && !canEdit}
              style={{
                ...buttonStyle(),
                padding: "8px 12px", fontSize: "12px", textAlign: "left",
                background: !isShared ? `${color}15` : theme.inputBg,
                color: !isShared ? color : theme.text,
                border: `1px solid ${!isShared ? color : theme.cardBorder}`,
                fontWeight: 600, opacity: (isEditing && !canEdit) ? 0.5 : 1,
              }}>🔒 Soukromý — jen já</button>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
          {isEditing && canEdit && (
            <button onClick={handleDelete} disabled={saving} style={{
              ...buttonStyle(),
              padding: "10px 14px", fontSize: "13px", fontWeight: 700,
              background: "transparent", color: theme.red,
              border: `1px solid ${theme.red}50`,
              cursor: saving ? "default" : "pointer",
            }}>
              🗑 Smazat
            </button>
          )}
          <button onClick={handleSave}
            disabled={!name.trim() || saving || (isEditing && !canEdit)}
            style={{
              ...buttonStyle(),
              flex: 1,
              padding: "10px", fontSize: "13px", fontWeight: 700,
              background: name.trim() && (!isEditing || canEdit) ? color : theme.inputBg,
              color: name.trim() && (!isEditing || canEdit) ? "#fff" : theme.textDim,
              border: "none",
              cursor: name.trim() && !saving && (!isEditing || canEdit) ? "pointer" : "default",
            }}>
            {saving ? "Ukládám..." : isEditing ? "Uložit změny" : "Vytvořit seznam"}
          </button>
        </div>

        {/* Delete dialog — co s úkoly v seznamu */}
        {deleteDialog === "ask" && editingList && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            zIndex: 1200, display: "flex", justifyContent: "center", alignItems: "center",
            padding: "16px", animation: "fadeIn 0.15s",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              width: "100%", maxWidth: "380px",
              background: theme.bg, borderRadius: "12px",
              padding: "20px", display: "flex", flexDirection: "column", gap: "12px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
            }}>
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>
                  Smazat seznam "{editingList.name}"?
                </div>
                <div style={{ fontSize: "12px", color: theme.textSub }}>
                  V seznamu je <strong>{tasksInList} úkol{tasksInList === 1 ? "" : tasksInList < 5 ? "y" : "ů"}</strong>.
                  Co s nimi udělat?
                </div>
              </div>

              {/* Volba 1: Ponechat */}
              <button type="button" onClick={() => performDelete("keep")}
                disabled={saving}
                style={{
                  ...buttonStyle(),
                  padding: "12px", fontSize: "12px", fontWeight: 600,
                  background: theme.inputBg, color: theme.text,
                  border: `1px solid ${theme.inputBorder}`, borderRadius: "8px",
                  textAlign: "left",
                }}>
                <div style={{ fontWeight: 700, marginBottom: "2px" }}>📁 Ponechat úkoly</div>
                <div style={{ fontSize: "10px", color: theme.textSub }}>
                  Zůstanou bez kategorie, ale jinak nezměněné
                </div>
              </button>

              {/* Volba 2: Přesunout do jiného seznamu */}
              {(() => {
                const otherLists = (allLists || []).filter(l =>
                  l.id !== editingList.id && (l.is_shared || l.created_by_user === currentUser.name)
                );
                if (otherLists.length === 0) return null;
                return (
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: theme.textMid, marginBottom: "5px" }}>
                      ↪ Přesunout do jiného seznamu:
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                      {otherLists.map(list => (
                        <button key={list.id} type="button"
                          onClick={() => performDelete(`move:${list.id}`)}
                          disabled={saving}
                          style={{
                            ...buttonStyle(),
                            padding: "6px 10px", fontSize: "11px", fontWeight: 600,
                            background: `${list.color}15`, color: list.color,
                            border: `1px solid ${list.color}40`, borderRadius: "10px",
                          }}>
                          {list.emoji || "📁"} {list.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Volba 3: Smazat i úkoly */}
              <button type="button" onClick={() => {
                  if (confirm(`Opravdu smazat ${tasksInList} úkol(ů) navždy? Tato akce nelze vrátit zpět.`)) {
                    performDelete("delete_tasks");
                  }
                }}
                disabled={saving}
                style={{
                  ...buttonStyle(),
                  padding: "12px", fontSize: "12px", fontWeight: 600,
                  background: `${theme.red}10`, color: theme.red,
                  border: `1px solid ${theme.red}40`, borderRadius: "8px",
                  textAlign: "left",
                }}>
                <div style={{ fontWeight: 700, marginBottom: "2px" }}>🗑 Smazat seznam i úkoly</div>
                <div style={{ fontSize: "10px", opacity: 0.85 }}>
                  Trvale odstranit všech {tasksInList} úkol{tasksInList === 1 ? "" : tasksInList < 5 ? "y" : "ů"}
                </div>
              </button>

              <button type="button" onClick={() => setDeleteDialog(null)}
                disabled={saving}
                style={{
                  background: "none", border: "none",
                  color: theme.textSub, fontSize: "12px",
                  cursor: "pointer", fontFamily: FONT, padding: "8px",
                }}>
                Zrušit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MORE FILTERS SHEET — full-screen pro méně používané filtry
   ═══════════════════════════════════════════════════════ */

function MoreFiltersSheet({
  theme, onClose, users, currentUser, customLists = [],
  categoryFilter, onCategoryFilterChange,
  priorityFilter, onPriorityFilterChange,
  tagFilter, onTagFilterChange, tagCounts = {},
  dueDateFilter, onDueDateFilterChange,
  createdWhenFilter, onCreatedWhenFilterChange,
  createdByFilter, onCreatedByFilterChange,
  onCreateList, onEditList,
}) {
  const visibleLists = (customLists || []).filter(l => l.is_shared || l.created_by_user === currentUser.name);
  const whenOptions = [
    { value: "all", label: "Všechny" },
    { value: "today", label: "🆕 Dnes přidáno" },
    { value: "yesterday", label: "Včera přidáno" },
    { value: "week", label: "Tento týden" },
    { value: "month", label: "Tento měsíc" },
    { value: "older", label: "Starší" },
  ];
  const datePresets = [
    { value: "all", label: "Všechna data" },
    { value: "today", label: "🎯 Dnes" },
    { value: "week", label: "Tento týden" },
    { value: "next_week", label: "Příští týden" },
    { value: "month", label: "Tento měsíc" },
  ];
  const isRange = dueDateFilter && dueDateFilter.startsWith("range:");
  const [rangeFrom, rangeTo] = isRange ? dueDateFilter.slice(6).split(",") : ["", ""];

  const chipStyle = (active, color) => ({
    ...buttonStyle(),
    padding: "6px 12px", fontSize: "12px", fontWeight: 600,
    background: active ? `${color}15` : "transparent",
    color: active ? color : theme.text,
    border: `1px solid ${active ? color : theme.inputBorder}`,
    borderRadius: "12px",
  });

  const sectionLabel = {
    fontSize: "11px", fontWeight: 800, color: theme.accent,
    textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px",
  };
  const sectionStyle = {
    padding: "12px",
    background: theme.card,
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: "10px",
  };

  const hasAny = categoryFilter !== "all" || priorityFilter !== "all" ||
    tagFilter !== "all" || dueDateFilter !== "all" ||
    createdWhenFilter !== "all" || createdByFilter !== "all";

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-end",
      animation: "slideUp 0.25s",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: "560px", maxHeight: "92vh",
        background: theme.bg, borderTopLeftRadius: "16px", borderTopRightRadius: "16px",
        overflow: "auto",
      }}>
        <div style={{
          position: "sticky", top: 0, zIndex: 2, background: theme.bg,
          padding: "14px 16px", borderBottom: `1px solid ${theme.cardBorder}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>⋯ Více filtrů</h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: "20px",
            cursor: "pointer", color: theme.textSub, padding: "4px 8px",
          }}>×</button>
        </div>
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Správa seznamů — pouze edit/create vlastních seznamů. Filter Seznam je v hlavní liště. */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>📋 Správa seznamů</div>
            <div style={{ fontSize: "10px", color: theme.textSub, marginBottom: "8px" }}>
              Filter podle seznamu najdeš v hlavní liště nahoře. Tady spravuješ vlastní seznamy.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {visibleLists.length === 0 && (
                <div style={{ fontSize: "11px", color: theme.textSub, fontStyle: "italic" }}>
                  Zatím nemáš vlastní seznamy.
                </div>
              )}
              {visibleLists.map(list => {
                const isOwner = list.created_by_user === currentUser.name;
                return (
                  <div key={list.id} style={{
                    display: "inline-flex", alignItems: "stretch", gap: 0,
                  }}>
                    <div style={{
                      ...buttonStyle(),
                      padding: "6px 12px", fontSize: "12px", fontWeight: 600,
                      background: `${list.color}15`, color: list.color,
                      border: `1px solid ${list.color}40`,
                      borderRadius: isOwner ? "12px 0 0 12px" : "12px",
                      cursor: "default",
                    }}>
                      {list.emoji || "📁"} {list.name}
                      {!isOwner && <span style={{ fontSize: "9px", opacity: 0.7, marginLeft: "4px" }}>(cizí)</span>}
                    </div>
                    {isOwner && (
                      <button onClick={(e) => { e.stopPropagation(); onClose(); onEditList && onEditList(list); }}
                        title="Upravit seznam"
                        style={{
                          ...buttonStyle(),
                          padding: "6px 10px", fontSize: "11px",
                          background: "transparent",
                          color: list.color,
                          border: `1px solid ${list.color}40`,
                          borderLeft: "none",
                          borderRadius: "0 12px 12px 0",
                        }}>✏️</button>
                    )}
                  </div>
                );
              })}
              <button onClick={() => { onClose(); onCreateList && onCreateList(); }}
                style={{
                  ...buttonStyle(),
                  padding: "6px 12px", fontSize: "12px", fontWeight: 600,
                  background: theme.inputBg, color: theme.accent,
                  border: `1px dashed ${theme.accent}50`, borderRadius: "12px",
                }}>+ Vytvořit nový</button>
            </div>
          </div>

          {/* Tag */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>🏷 Tag (auto-detekce)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <button onClick={() => onTagFilterChange("all")}
                style={chipStyle(tagFilter === "all", theme.purple)}>Všechny</button>
              {TAGS.map(tag => {
                const count = tagCounts?.[tag.id] || 0;
                if (count === 0 && tagFilter !== tag.id) return null;
                return (
                  <button key={tag.id}
                    onClick={() => onTagFilterChange(tag.id)}
                    style={chipStyle(tagFilter === tag.id, theme.purple)}>
                    {tag.emoji} {tag.label}{count > 0 ? ` (${count})` : ""}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Datum — vlastní rozsah (presety jsou v hlavní liště) */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>📆 Vlastní rozsah dat</div>
            <div style={{ fontSize: "10px", color: theme.textSub, marginBottom: "6px" }}>
              Presety (Dnes/Týden/Měsíc) najdeš v hlavním filtru 📅 nahoře.
            </div>
            <div style={{
              padding: "10px", borderRadius: "8px",
              background: isRange ? `${theme.accent}10` : theme.inputBg,
              border: `1px solid ${isRange ? theme.accent : theme.inputBorder}`,
            }}>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input type="date" value={rangeFrom || ""}
                  onChange={(e) => {
                    const newFrom = e.target.value;
                    if (newFrom && rangeTo) onDueDateFilterChange(`range:${newFrom},${rangeTo}`);
                    else if (newFrom) onDueDateFilterChange(`range:${newFrom},${newFrom}`);
                  }}
                  style={{ ...inputStyle(theme), padding: "6px 8px", fontSize: "11px", flex: 1 }} />
                <span style={{ fontSize: "11px", color: theme.textMid }}>→</span>
                <input type="date" value={rangeTo || ""}
                  onChange={(e) => {
                    const newTo = e.target.value;
                    const fromVal = rangeFrom || newTo;
                    if (newTo) onDueDateFilterChange(`range:${fromVal},${newTo}`);
                  }}
                  style={{ ...inputStyle(theme), padding: "6px 8px", fontSize: "11px", flex: 1 }} />
              </div>
            </div>
          </div>

          {/* Přidáno kdy */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>📅 Přidáno kdy</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {whenOptions.map(opt => (
                <button key={opt.value}
                  onClick={() => onCreatedWhenFilterChange(opt.value)}
                  style={chipStyle(createdWhenFilter === opt.value, theme.accent)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Kdo úkol vytvořil (zadavatel) */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>✏️ Zadavatel úkolu</div>
            <div style={{ fontSize: "10px", color: theme.textSub, marginBottom: "6px" }}>
              Kdo úkol vytvořil. Pro koho je úkol — najdeš v hlavním filtru 👤 nahoře.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <button onClick={() => onCreatedByFilterChange("all")}
                style={chipStyle(createdByFilter === "all", theme.accent)}>Všichni</button>
              {users.map(u => (
                <button key={u.name}
                  onClick={() => onCreatedByFilterChange(u.name)}
                  style={chipStyle(createdByFilter === u.name, theme.accent)}>
                  {u.name === currentUser.name ? "Já" : u.name}
                </button>
              ))}
            </div>
          </div>

          {/* Reset all */}
          {hasAny && (
            <button onClick={() => {
              onCategoryFilterChange("all");
              onPriorityFilterChange("all");
              onTagFilterChange("all");
              onDueDateFilterChange("all");
              onCreatedWhenFilterChange("all");
              onCreatedByFilterChange("all");
            }} style={{
              ...buttonStyle(),
              padding: "10px", fontSize: "12px", fontWeight: 600,
              background: `${theme.red}10`, color: theme.red,
              border: `1px solid ${theme.red}40`, borderRadius: "8px",
              marginTop: "4px",
            }}>✕ Resetovat všechny filtry</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CALENDAR SHEET — měsíční kalendář s úkoly
   ═══════════════════════════════════════════════════════ */

function CalendarSheet({ tasks, currentUser, theme, onClose, onNavigate }) {
  // Aktuální zobrazený měsíc
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() }; // month 0-11
  });
  const [selectedDay, setSelectedDay] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });

  // Mapa: "YYYY-MM-DD" → array tasků
  const tasksByDay = useMemo(() => {
    const map = {};
    const userNameLc = (currentUser.name || "").trim().toLowerCase();
    tasks.forEach(t => {
      // Privacy filter
      if (!currentUser.admin) {
        const createdByLc = (t.createdBy || "").trim().toLowerCase();
        const assignedToLc = (t.assignedTo || []).map(n => (n || "").trim().toLowerCase());
        if (createdByLc !== userNameLc && !assignedToLc.includes(userNameLc)) return;
      }
      // Skip deleted
      if (isDeleted(t)) return;
      // Use dueDate
      if (!t.dueDate) return;
      const key = t.dueDate.slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return map;
  }, [tasks, currentUser]);

  const monthNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
                       "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
  const dayNames = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

  // Generovat dny pro měsíc
  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(viewMonth.year, viewMonth.month, 1);
    const lastOfMonth = new Date(viewMonth.year, viewMonth.month + 1, 0);
    // Po-pondělní start (0 = Po, 6 = Ne)
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = lastOfMonth.getDate();

    const days = [];
    // Předchozí měsíc — vyplnit prázdná místa
    for (let i = 0; i < firstWeekday; i++) {
      days.push(null);
    }
    // Aktuální měsíc
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewMonth.year, viewMonth.month, d, 12, 0, 0);
      days.push(date);
    }
    return days;
  }, [viewMonth]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const goPrev = () => {
    const m = viewMonth.month - 1;
    if (m < 0) setViewMonth({ year: viewMonth.year - 1, month: 11 });
    else setViewMonth({ ...viewMonth, month: m });
  };
  const goNext = () => {
    const m = viewMonth.month + 1;
    if (m > 11) setViewMonth({ year: viewMonth.year + 1, month: 0 });
    else setViewMonth({ ...viewMonth, month: m });
  };
  const goToday = () => {
    const d = new Date();
    setViewMonth({ year: d.getFullYear(), month: d.getMonth() });
    setSelectedDay(d.toISOString().slice(0, 10));
  };

  const selectedTasks = tasksByDay[selectedDay] || [];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-end",
      animation: "slideUp 0.25s",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: "560px", maxHeight: "92vh",
        background: theme.bg, borderTopLeftRadius: "16px", borderTopRightRadius: "16px",
        overflow: "auto",
        boxShadow: "0 -8px 24px rgba(0,0,0,0.2)",
      }}>
        {/* Header */}
        <div style={{
          position: "sticky", top: 0, zIndex: 2, background: theme.bg,
          padding: "14px 16px", borderBottom: `1px solid ${theme.cardBorder}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: theme.text }}>
            📅 Kalendář
          </h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: "20px",
            cursor: "pointer", color: theme.textSub, padding: "4px 8px",
          }}>×</button>
        </div>

        {/* Month navigation */}
        <div style={{
          padding: "10px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "8px",
        }}>
          <button onClick={goPrev} style={{
            ...buttonStyle(), padding: "6px 12px", fontSize: "13px",
            background: theme.inputBg, color: theme.text,
            border: `1px solid ${theme.inputBorder}`,
          }}>‹</button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: "15px", fontWeight: 700 }}>
              {monthNames[viewMonth.month]} {viewMonth.year}
            </div>
          </div>
          <button onClick={goNext} style={{
            ...buttonStyle(), padding: "6px 12px", fontSize: "13px",
            background: theme.inputBg, color: theme.text,
            border: `1px solid ${theme.inputBorder}`,
          }}>›</button>
          <button onClick={goToday} style={{
            ...buttonStyle(), padding: "6px 10px", fontSize: "11px", fontWeight: 600,
            background: theme.accentSoft, color: theme.accent,
            border: `1px solid ${theme.accentBorder}`,
          }}>Dnes</button>
        </div>

        {/* Day name header */}
        <div style={{
          padding: "0 16px",
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px",
          marginBottom: "4px",
        }}>
          {dayNames.map(d => (
            <div key={d} style={{
              textAlign: "center", fontSize: "10px", fontWeight: 700,
              color: theme.textMid, textTransform: "uppercase",
            }}>{d}</div>
          ))}
        </div>

        {/* Days grid */}
        <div style={{
          padding: "0 16px",
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px",
        }}>
          {calendarDays.map((date, idx) => {
            if (!date) {
              return <div key={"empty_" + idx} style={{ aspectRatio: "1" }} />;
            }
            const dStr = date.toISOString().slice(0, 10);
            const dayTasks = tasksByDay[dStr] || [];
            const isToday = dStr === todayStr;
            const isSelected = dStr === selectedDay;
            const undoneCount = dayTasks.filter(t => !isDone(t)).length;
            const doneCount = dayTasks.filter(t => isDone(t)).length;
            const hasUrgent = dayTasks.some(t => !isDone(t) && t.priority === "urgent");

            return (
              <button
                key={dStr}
                onClick={() => setSelectedDay(dStr)}
                style={{
                  ...buttonStyle(),
                  aspectRatio: "1",
                  padding: "2px 0",
                  background: isSelected ? theme.accent
                    : isToday ? theme.accentSoft
                    : "transparent",
                  color: isSelected ? "#fff"
                    : isToday ? theme.accent
                    : theme.text,
                  border: isToday && !isSelected ? `2px solid ${theme.accent}` : `1px solid ${isSelected ? theme.accent : theme.inputBorder}`,
                  borderRadius: "8px",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "flex-start",
                  fontSize: "13px", fontWeight: isToday ? 800 : 600,
                  cursor: "pointer",
                  position: "relative",
                  paddingTop: "4px",
                }}>
                <span>{date.getDate()}</span>
                {dayTasks.length > 0 && (
                  <div style={{
                    display: "flex", gap: "2px", marginTop: "2px",
                    flexWrap: "wrap", justifyContent: "center",
                  }}>
                    {/* Tečky podle počtu úkolů (max 3 + číslo) */}
                    {undoneCount > 0 && (
                      <span style={{
                        width: "5px", height: "5px", borderRadius: "50%",
                        background: hasUrgent
                          ? (isSelected ? "#fff" : theme.red)
                          : (isSelected ? "#fff" : theme.accent),
                      }} />
                    )}
                    {doneCount > 0 && (
                      <span style={{
                        width: "5px", height: "5px", borderRadius: "50%",
                        background: isSelected ? "#fff" : theme.green,
                      }} />
                    )}
                  </div>
                )}
                {dayTasks.length > 0 && (
                  <span style={{
                    fontSize: "9px", fontWeight: 700,
                    color: isSelected ? "#fff" : theme.textMid,
                    marginTop: "1px",
                  }}>
                    {dayTasks.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected day's tasks */}
        <div style={{
          padding: "16px",
          marginTop: "8px",
          borderTop: `1px solid ${theme.cardBorder}`,
        }}>
          <div style={{
            fontSize: "12px", fontWeight: 700, color: theme.textMid,
            textTransform: "uppercase", letterSpacing: "0.4px",
            marginBottom: "10px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span>📋 {(() => {
              const d = new Date(selectedDay);
              return `${d.getDate()}. ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
            })()}</span>
            <span style={{ fontSize: "11px", color: theme.textSub }}>
              {selectedTasks.length} {selectedTasks.length === 1 ? "úkol" : selectedTasks.length < 5 ? "úkoly" : "úkolů"}
            </span>
          </div>

          {selectedTasks.length === 0 ? (
            <div style={{ textAlign: "center", color: theme.textMid, fontSize: "12px", padding: "20px" }}>
              Žádné úkoly s termínem na tento den
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {selectedTasks.map(t => (
                <button key={t.id}
                  onClick={() => { onNavigate(t.id); onClose(); }}
                  style={{
                    ...buttonStyle(),
                    textAlign: "left", padding: "9px 12px",
                    background: theme.card,
                    border: `1px solid ${theme.cardBorder}`,
                    borderRadius: "8px",
                    display: "flex", flexDirection: "column", gap: "3px",
                    cursor: "pointer",
                    opacity: isDone(t) ? 0.55 : 1,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = theme.inputBg}
                  onMouseLeave={(e) => e.currentTarget.style.background = theme.card}>
                  <div style={{
                    fontSize: "13px", fontWeight: 600, color: theme.text,
                    textDecoration: isDone(t) ? "line-through" : "none",
                  }}>
                    {isDone(t) && "✓ "}
                    {t.priority === "urgent" && "‼ "}
                    {t.priority === "important" && "! "}
                    {t.title}
                  </div>
                  <div style={{ fontSize: "10px", color: theme.textMid }}>
                    {t.assignedTo?.join(", ") || "—"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   STATS SHEET — full-screen modal s detailními statistikami
   ═══════════════════════════════════════════════════════ */

function StatsSheet({ tasks, currentUser, users, theme, onClose }) {
  if (!currentUser) return null;
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  // ─── Day-of-week aktivita za poslední 4 týdny ───
  const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]; // Po, Út, St, Čt, Pá, So, Ne
  const fourWeeksAgo = new Date(); fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  tasks.forEach(t => {
    if (t.status !== "done" || !t.completedAt) return;
    if (t.completedByUser !== currentUser.name) return;
    const d = new Date(t.completedAt);
    if (d < fourWeeksAgo) return;
    const dayIdx = (d.getDay() + 6) % 7; // přemap: 0=Po, 6=Ne
    dayOfWeekCounts[dayIdx]++;
  });
  const dayNames = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
  const maxDayCount = Math.max(...dayOfWeekCounts, 1);
  const bestDayIdx = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));

  // ─── Týdenní data ───
  const doneThisWeek = tasks.filter(t =>
    t.status === "done" && t.completedAt &&
    t.completedByUser === currentUser.name &&
    new Date(t.completedAt) >= weekAgo
  ).length;
  // 4 minulé týdny pro průměr
  const weekDates = [];
  for (let w = 1; w <= 4; w++) {
    const start = new Date(); start.setDate(start.getDate() - 7 * (w + 1));
    const end = new Date(); end.setDate(end.getDate() - 7 * w);
    weekDates.push({ start, end });
  }
  const pastWeekCounts = weekDates.map(({ start, end }) =>
    tasks.filter(t =>
      t.status === "done" && t.completedAt &&
      t.completedByUser === currentUser.name &&
      new Date(t.completedAt) >= start && new Date(t.completedAt) < end
    ).length
  );
  const validWeeks = pastWeekCounts.filter(c => c > 0);
  const weekAvg = validWeeks.length > 0
    ? Math.round(pastWeekCounts.reduce((a, b) => a + b, 0) / 4)
    : null;
  const trendDelta = weekAvg !== null ? doneThisWeek - pastWeekCounts[0] : null;

  // ─── Dnes ───
  const isDueToday = (t) => {
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate);
    return due.getFullYear() === todayStart.getFullYear() &&
           due.getMonth() === todayStart.getMonth() &&
           due.getDate() === todayStart.getDate();
  };
  const myDueToday = tasks.filter(t =>
    !isDeleted(t) &&
    t.assignedTo?.includes(currentUser.name) &&
    isDueToday(t)
  );
  const dayDone = myDueToday.filter(t => t.status === "done").length;
  const dayTotal = myDueToday.length;

  // ─── Tag mix ───
  const tagFreq = {};
  tasks.forEach(t => {
    if (t.status !== "done" || !t.completedAt) return;
    if (t.completedByUser !== currentUser.name) return;
    if (new Date(t.completedAt) < weekAgo) return;
    detectTags(t.title).forEach(tagId => {
      tagFreq[tagId] = (tagFreq[tagId] || 0) + 1;
    });
  });
  const topTags = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ ...getTagDef(id), count }))
    .filter(t => t.label);

  // ─── Per-user (admin) ───
  const perUserWeek = users.map(u => ({
    name: u.name,
    count: tasks.filter(t =>
      t.status === "done" && t.completedAt &&
      new Date(t.completedAt) >= weekAgo &&
      t.completedByUser === u.name
    ).length,
  }));

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-end",
      animation: "slideUp 0.25s",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: "560px", maxHeight: "92vh",
        background: theme.bg, borderTopLeftRadius: "16px", borderTopRightRadius: "16px",
        overflow: "auto",
        boxShadow: "0 -8px 24px rgba(0,0,0,0.2)",
      }}>
        {/* Header */}
        <div style={{
          position: "sticky", top: 0, zIndex: 2, background: theme.bg,
          padding: "14px 16px", borderBottom: `1px solid ${theme.cardBorder}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: theme.text }}>
            📊 Statistiky
          </h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: "20px",
            cursor: "pointer", color: theme.textSub, padding: "4px 8px",
          }}>×</button>
        </div>

        {/* Content */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* DNES */}
          <div style={{ ...cardStyle(theme), padding: "12px 14px" }}>
            <div style={{
              fontSize: "10px", fontWeight: 800, color: theme.textMid,
              textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px",
            }}>🎯 Dnes</div>
            {dayTotal > 0 ? (
              <>
                <div style={{
                  width: "100%", height: "8px", borderRadius: "4px",
                  background: theme.inputBorder, overflow: "hidden", marginBottom: "6px",
                }}>
                  <div style={{
                    height: "100%", width: `${dayTotal > 0 ? dayDone / dayTotal * 100 : 0}%`,
                    background: dayDone === dayTotal ? theme.green : theme.accent,
                    transition: "width 0.4s",
                  }} />
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: theme.text }}>
                  {dayDone}/{dayTotal}
                  <span style={{ fontSize: "14px", fontWeight: 500, color: theme.textSub, marginLeft: "8px" }}>
                    ({Math.round(dayDone / dayTotal * 100)}%)
                  </span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: "13px", color: theme.textMid }}>
                Žádné úkoly s termínem dnes
              </div>
            )}
          </div>

          {/* TÝDEN */}
          <div style={{ ...cardStyle(theme), padding: "12px 14px" }}>
            <div style={{
              fontSize: "10px", fontWeight: 800, color: theme.textMid,
              textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px",
            }}>📊 Tento týden</div>
            <div style={{ fontSize: "28px", fontWeight: 800, color: theme.green, lineHeight: 1 }}>
              {doneThisWeek}
              {weekAvg !== null && (
                <span style={{ fontSize: "16px", fontWeight: 500, color: theme.textSub }}>
                  {" / "}{weekAvg}
                </span>
              )}
            </div>
            <div style={{ fontSize: "12px", color: theme.textMid, marginTop: "4px" }}>
              {trendDelta === null ? "splněno" :
                trendDelta > 0 ? <span style={{ color: theme.green, fontWeight: 700 }}>↑ +{trendDelta} oproti minulému týdnu 🎉</span> :
                trendDelta < 0 ? <span style={{ color: theme.textSub }}>↓ {trendDelta} oproti minulému</span> :
                <span>= jako minulý týden</span>
              }
            </div>
            {weekAvg !== null && (
              <div style={{ fontSize: "11px", color: theme.textDim, marginTop: "2px" }}>
                Cíl = průměr 4 minulých týdnů
              </div>
            )}
          </div>

          {/* DAY OF WEEK */}
          {dayOfWeekCounts.some(c => c > 0) && (
            <div style={{ ...cardStyle(theme), padding: "12px 14px" }}>
              <div style={{
                fontSize: "10px", fontWeight: 800, color: theme.textMid,
                textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px",
              }}>📅 Aktivita per den (4 týdny)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {dayNames.map((day, idx) => {
                  const count = dayOfWeekCounts[idx];
                  const widthPercent = count > 0 ? (count / maxDayCount) * 100 : 0;
                  const isBest = idx === bestDayIdx && count > 0;
                  return (
                    <div key={day} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{
                        width: "24px", fontSize: "11px", fontWeight: 600,
                        color: isBest ? theme.green : theme.text,
                      }}>{day}</span>
                      <div style={{
                        flex: 1, height: "16px", borderRadius: "3px",
                        background: theme.inputBorder, position: "relative", overflow: "hidden",
                      }}>
                        <div style={{
                          height: "100%", width: `${widthPercent}%`,
                          background: isBest ? theme.green : theme.accent,
                          borderRadius: "3px", transition: "width 0.4s",
                        }} />
                      </div>
                      <span style={{
                        width: "30px", fontSize: "11px", fontWeight: 700,
                        color: isBest ? theme.green : theme.textSub,
                        textAlign: "right",
                      }}>{count}{isBest && " 🏆"}</span>
                    </div>
                  );
                })}
              </div>
              {bestDayIdx >= 0 && dayOfWeekCounts[bestDayIdx] > 0 && (
                <div style={{
                  fontSize: "11px", color: theme.textMid, marginTop: "8px",
                  textAlign: "center",
                }}>
                  Nejvíc plníš v <strong style={{ color: theme.green }}>{["pondělí", "úterý", "středu", "čtvrtek", "pátek", "sobotu", "neděli"][bestDayIdx]}</strong>
                </div>
              )}
            </div>
          )}

          {/* TAG MIX */}
          {topTags.length > 0 && (
            <div style={{ ...cardStyle(theme), padding: "12px 14px" }}>
              <div style={{
                fontSize: "10px", fontWeight: 800, color: theme.textMid,
                textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px",
              }}>🏷 Tvůj mix (tento týden)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {topTags.map(tag => (
                  <div key={tag.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    fontSize: "12px",
                  }}>
                    <span>{tag.emoji} {tag.label}</span>
                    <span style={{ fontWeight: 700, color: theme.text }}>{tag.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PER USER (admin) */}
          {currentUser.admin && perUserWeek.length > 1 && (
            <div style={{ ...cardStyle(theme), padding: "12px 14px" }}>
              <div style={{
                fontSize: "10px", fontWeight: 800, color: theme.textMid,
                textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px",
              }}>👥 Per osoba (tento týden)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {perUserWeek.map(u => (
                  <div key={u.name} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    fontSize: "12px",
                  }}>
                    <span>{u.name}</span>
                    <span style={{ fontWeight: 700, color: theme.green }}>{u.count} úkolů</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SEARCH SHEET — full-screen vyhledávání
   ═══════════════════════════════════════════════════════ */

function SearchSheet({ tasks, comments, currentUser, customLists = [], theme, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Detekce smart search syntax — pokud query obsahuje operátor (klíč:hodnota),
  // zkratky (!high, @pavla, #nákup) nebo je delší kombinace tokenů,
  // delegujeme na shared `searchMatch` funkci. Jinak použijeme původní fuzzy search
  // (s diakritikou-insensitive normalizací).
  const isSmartQuery = useMemo(() => {
    const q = (query || "").trim();
    if (!q) return false;
    return /(\b[a-zA-Z]+:[\S]+)|(^!)|(\s!)|(^@)|(\s@)|(^#)|(\s#)/.test(q);
  }, [query]);

  const results = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (q.length < 2) return [];
    const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const qNorm = norm(q);
    const userNameLc = (currentUser.name || "").trim().toLowerCase();
    return tasks
      .filter(t => {
        // Privacy filter — search vždy ukazuje jen úkoly relevantní pro currentUser
        // (autor nebo přiřazen), bez ohledu na admin flag
        const createdByLc = (t.createdBy || "").trim().toLowerCase();
        const assignedToLc = (t.assignedTo || []).map(n => (n || "").trim().toLowerCase());
        const isMine = createdByLc === userNameLc || assignedToLc.includes(userNameLc);
        if (!isMine) return false;

        // Smart query — operátorová syntaxe (priority:high, due:today, ...)
        if (isSmartQuery) {
          return searchMatch(t, query, customLists);
        }

        // Fallback: fuzzy plain text search s diakritikou
        if (norm(t.title).includes(qNorm)) return true;
        if (t.note && norm(t.note).includes(qNorm)) return true;
        if ((t.checklist || []).some(item => norm(item.text).includes(qNorm))) return true;
        const taskComments = comments.filter(c => c.taskId === t.id);
        if (taskComments.some(c => c.content && norm(c.content).includes(qNorm))) return true;
        return false;
      })
      .slice(0, 30);
  }, [tasks, comments, query, currentUser, isSmartQuery, customLists]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start",
      animation: "slideUp 0.25s",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: "560px", maxHeight: "92vh",
        marginTop: "20px",
        background: theme.bg, borderRadius: "16px",
        overflow: "auto",
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
      }}>
        {/* Header */}
        <div style={{
          position: "sticky", top: 0, zIndex: 2, background: theme.bg,
          padding: "14px 16px", borderBottom: `1px solid ${theme.cardBorder}`,
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          <span style={{ fontSize: "16px" }}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat… nebo zkus !urgent, due:today, @pavla"
            style={{
              flex: 1, fontSize: "14px", padding: "8px 10px",
              background: theme.inputBg, color: theme.text,
              border: `1px solid ${theme.inputBorder}`,
              borderRadius: "6px", outline: "none",
            }}
          />
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: "20px",
            cursor: "pointer", color: theme.textSub, padding: "0 4px",
          }}>×</button>
        </div>

        {/* Smart search hint — zobrazí se jen pokud je input prázdný */}
        {!query.trim() && (
          <div style={{
            padding: "10px 16px",
            borderBottom: `1px solid ${theme.cardBorder}`,
            fontSize: "11px",
            color: theme.textMid,
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: theme.textSub }}>💡 Tipy pro hledání:</div>
            <div><code style={{ background: theme.inputBg, padding: "1px 4px", borderRadius: 3 }}>!urgent</code> nebo <code style={{ background: theme.inputBg, padding: "1px 4px", borderRadius: 3 }}>priority:high</code> — priorita</div>
            <div><code style={{ background: theme.inputBg, padding: "1px 4px", borderRadius: 3 }}>due:today</code> · <code style={{ background: theme.inputBg, padding: "1px 4px", borderRadius: 3 }}>due:overdue</code> · <code style={{ background: theme.inputBg, padding: "1px 4px", borderRadius: 3 }}>due:week</code> — termín</div>
            <div><code style={{ background: theme.inputBg, padding: "1px 4px", borderRadius: 3 }}>@pavla</code> — komu je úkol přiřazen</div>
            <div><code style={{ background: theme.inputBg, padding: "1px 4px", borderRadius: 3 }}>status:done</code> — stav (active, done, deleted, parked)</div>
            <div style={{ marginTop: 4, opacity: 0.7 }}>Můžeš kombinovat: <code style={{ background: theme.inputBg, padding: "1px 4px", borderRadius: 3 }}>!urgent due:today</code></div>
          </div>
        )}

        {/* Results */}
        <div style={{ padding: "12px 14px" }}>
          {query.trim().length < 2 ? (
            <div style={{ textAlign: "center", color: theme.textMid, fontSize: "13px", padding: "40px 0" }}>
              Začni psát pro vyhledávání...
            </div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: "center", color: theme.textMid, fontSize: "13px", padding: "40px 0" }}>
              Žádné výsledky pro „{query}"
            </div>
          ) : (
            <>
              <div style={{ fontSize: "11px", color: theme.textMid, marginBottom: "8px", fontWeight: 600 }}>
                {results.length} {results.length === 1 ? "výsledek" : results.length < 5 ? "výsledky" : "výsledků"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {results.map(t => (
                  <button key={t.id}
                    onClick={() => { onNavigate(t.id); onClose(); }}
                    style={{
                      ...buttonStyle(),
                      textAlign: "left", padding: "10px 12px",
                      background: theme.card,
                      border: `1px solid ${theme.cardBorder}`,
                      borderRadius: "8px",
                      display: "flex", flexDirection: "column", gap: "4px",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = theme.inputBg}
                    onMouseLeave={(e) => e.currentTarget.style.background = theme.card}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: theme.text,
                      textDecoration: isDeleted(t) ? "line-through" : "none",
                      opacity: isDeleted(t) ? 0.6 : isDone(t) ? 0.75 : 1,
                    }}>
                      {isDeleted(t) && "🗑 "}
                      {!isDeleted(t) && isDone(t) && "✓ "}
                      {t.title}
                    </div>
                    <div style={{ fontSize: "10px", color: theme.textMid, display: "flex", gap: "6px", alignItems: "center" }}>
                      {isDeleted(t) && (
                        <span style={{
                          fontSize: "9px", fontWeight: 800, color: theme.red,
                          background: `${theme.red}15`, padding: "1px 5px", borderRadius: "4px",
                          textTransform: "uppercase", letterSpacing: "0.3px",
                        }}>Koš</span>
                      )}
                      {!isDeleted(t) && isDone(t) && (
                        <span style={{
                          fontSize: "9px", fontWeight: 800, color: theme.green,
                          background: `${theme.green}15`, padding: "1px 5px", borderRadius: "4px",
                          textTransform: "uppercase", letterSpacing: "0.3px",
                        }}>Splněné</span>
                      )}
                      {!isDeleted(t) && !isDone(t) && t.status === "in_progress" && (
                        <span style={{
                          fontSize: "9px", fontWeight: 800, color: "#ea580c",
                          background: "#ea580c15", padding: "1px 5px", borderRadius: "4px",
                          textTransform: "uppercase", letterSpacing: "0.3px",
                        }}>Rozprac.</span>
                      )}
                      <span>{t.assignedTo?.join(", ") || "—"} · {t.createdAt && formatTimeTrace(t.createdAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsBar({ tasks, currentUser, users, theme, onStatClick, activeStatId }) {
  const [showPerUser, setShowPerUser] = useState(false);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const isVisiblyActive = (t) =>
    !isDone(t) && !isDeleted(t) &&
    !(t.showFrom && daysDiff(t.showFrom) > 0);

  // ─── DNES ─── úkoly s due date dnes (a moje)
  const isDueToday = (t) => {
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate);
    return due.getFullYear() === todayStart.getFullYear() &&
           due.getMonth() === todayStart.getMonth() &&
           due.getDate() === todayStart.getDate();
  };
  const myDueToday = tasks.filter(t =>
    !isDeleted(t) &&
    t.assignedTo?.includes(currentUser.name) &&
    isDueToday(t)
  );
  const dayTotal = myDueToday.length;
  const dayDone = myDueToday.filter(t => t.status === "done").length;
  const dayPercent = dayTotal > 0 ? Math.round(dayDone / dayTotal * 100) : 0;
  const dayActive = myDueToday.filter(t => !isDone(t)).length;
  const dayHighPrio = myDueToday.filter(t =>
    !isDone(t) && (t.priority === "urgent" || t.priority === "important")
  ).length;

  // ─── TÝDEN ─── splněné mnou tento týden
  const doneThisWeekByMe = tasks.filter(t =>
    t.status === "done" && t.completedAt && new Date(t.completedAt) >= weekAgo &&
    t.completedByUser === currentUser.name
  ).length;

  // ─── TÝDENNÍ CÍL ─── průměr z minulých 4 týdnů
  // Ignoruje aktuální týden (ten teprve probíhá)
  let weekTarget = null;
  let trendDelta = null;
  const weekDates = [];
  for (let w = 1; w <= 4; w++) {
    const start = new Date(); start.setDate(start.getDate() - 7 * (w + 1));
    const end = new Date(); end.setDate(end.getDate() - 7 * w);
    weekDates.push({ start, end });
  }
  const pastWeekCounts = weekDates.map(({ start, end }) =>
    tasks.filter(t =>
      t.status === "done" && t.completedAt &&
      t.completedByUser === currentUser.name &&
      new Date(t.completedAt) >= start && new Date(t.completedAt) < end
    ).length
  );
  // Cíl ze průměru, jen pokud máme alespoň 1 týden historie s daty
  const validWeeks = pastWeekCounts.filter(c => c > 0);
  if (validWeeks.length > 0) {
    weekTarget = Math.round(pastWeekCounts.reduce((a, b) => a + b, 0) / 4) || null;
    if (weekTarget) {
      // Trend = aktuální vs. minulý týden (pastWeekCounts[0])
      trendDelta = doneThisWeekByMe - pastWeekCounts[0];
    }
  }

  // ─── 4 SMART CARDS ───
  const myActive = tasks.filter(t =>
    isVisiblyActive(t) && t.assignedTo?.includes(currentUser.name)
  );
  const inProgressCount = myActive.filter(t => t.status === "in_progress").length;
  const overdueCount = myActive.filter(t => daysDiff(t.dueDate) < 0).length;
  const assignedByMeToOthers = tasks.filter(t =>
    isVisiblyActive(t) &&
    t.createdBy === currentUser.name &&
    !t.assignedTo?.every(a => a === currentUser.name)
  );

  const cards = [
    { id: "my",         value: myActive.length,             label: "Pro mě",      icon: "⚡", color: theme.accent },
    { id: "in_progress", value: inProgressCount,            label: "Rozpracov.",  icon: "🔥", color: theme.yellow },
    { id: "overdue",    value: overdueCount,                label: "Po termínu",  icon: "⚠️", color: theme.red },
    { id: "assigned",   value: assignedByMeToOthers.length, label: "Druhým",      icon: "📤", color: theme.purple },
  ];

  // Per-user týdenní dokončené
  const perUserWeek = users.map(u => ({
    name: u.name,
    count: tasks.filter(t =>
      t.status === "done" && t.completedAt && new Date(t.completedAt) >= weekAgo &&
      t.completedByUser === u.name
    ).length,
  }));

  return (
    <div style={{ ...cardStyle(theme), padding: "10px 12px", marginBottom: "12px" }}>
      {/* ═══ TOP: DNES (vlevo) + TÝDEN (vpravo) ═══ */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px",
        marginBottom: "10px", paddingBottom: "8px",
        borderBottom: `1px solid ${theme.cardBorder}`,
      }}>
        {/* DNES */}
        <div>
          <div style={{
            fontSize: "9px", fontWeight: 800, color: theme.textMid,
            textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px",
          }}>🎯 Dnes</div>
          {dayTotal > 0 ? (
            <>
              <div style={{
                width: "100%", height: "6px", borderRadius: "3px",
                background: theme.inputBorder, overflow: "hidden",
                marginBottom: "4px",
              }}>
                <div style={{
                  height: "100%", width: `${dayPercent}%`,
                  background: dayPercent === 100 ? theme.green : theme.accent,
                  borderRadius: "3px",
                  transition: "width 0.4s ease",
                }} />
              </div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>
                {dayDone}/{dayTotal}
                <span style={{ fontSize: "11px", fontWeight: 500, color: theme.textSub, marginLeft: "6px" }}>
                  ({dayPercent}%)
                </span>
              </div>
              <div style={{ fontSize: "10px", color: theme.textMid, marginTop: "1px" }}>
                {dayActive > 0 ? `${dayActive} zbývá` : "Vše hotovo! 🎉"}
                {dayHighPrio > 0 && (
                  <span style={{ color: theme.priority.urgent.text, fontWeight: 700 }}>
                    {" · "}{dayHighPrio} prio
                  </span>
                )}
              </div>
            </>
          ) : (
            <div style={{ fontSize: "11px", color: theme.textMid, paddingTop: "4px" }}>
              Žádné úkoly s termínem dnes
            </div>
          )}
        </div>

        {/* TÝDEN */}
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontSize: "9px", fontWeight: 800, color: theme.textMid,
            textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px",
          }}>📊 Tento týden</div>
          <div style={{ fontSize: "18px", fontWeight: 800, color: theme.green, lineHeight: 1 }}>
            {doneThisWeekByMe}
            {weekTarget && (
              <span style={{ fontSize: "12px", fontWeight: 500, color: theme.textSub }}>
                {" / "}{weekTarget}
              </span>
            )}
          </div>
          <div style={{ fontSize: "10px", color: theme.textMid, marginTop: "2px" }}>
            {trendDelta === null ? "splněno" :
              trendDelta > 0 ? <span style={{ color: theme.green, fontWeight: 700 }}>↑ +{trendDelta} vs minulý 🎉</span> :
              trendDelta < 0 ? <span style={{ color: theme.textSub }}>↓ {trendDelta} vs minulý</span> :
              <span>= jako minulý</span>
            }
          </div>
        </div>
      </div>

      {/* ═══ 4 SMART CARDS ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
        {cards.map(card => {
          // Schovej "Po termínu" když je 0
          if (card.id === "overdue" && card.value === 0) {
            return <div key={card.id} />;
          }
          const isActive = activeStatId === card.id;
          return (
            <button key={card.id}
              onClick={() => onStatClick && onStatClick(card.id)}
              title={`Filtrovat: ${card.label}`}
              style={{
                ...buttonStyle(),
                background: isActive ? `${card.color}15` : theme.inputBg,
                border: `1px solid ${isActive ? card.color : theme.cardBorder}`,
                borderRadius: "8px",
                padding: "6px 4px",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = `${card.color}08`;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = theme.inputBg;
              }}>
              <div style={{
                fontSize: "10px", color: theme.textMid,
                display: "flex", alignItems: "center", justifyContent: "center", gap: "3px",
              }}>
                <span>{card.icon}</span>
                <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.2px" }}>
                  {card.label}
                </span>
              </div>
              <div style={{
                fontSize: "16px", fontWeight: 800, color: card.color, marginTop: "2px",
              }}>{card.value}</div>
            </button>
          );
        })}
      </div>

      {/* ═══ Per-user (admin only, collapsed) ═══ */}
      {currentUser.admin && perUserWeek.length > 1 && (
        <div style={{ marginTop: "8px", paddingTop: "6px", borderTop: `1px solid ${theme.cardBorder}` }}>
          <button onClick={() => setShowPerUser(s => !s)} style={{
            ...buttonStyle(), padding: "2px 0", fontSize: "10px",
            background: "transparent", color: theme.textSub,
            border: "none", display: "flex", alignItems: "center", gap: "4px",
            cursor: "pointer",
          }}>
            <span>{showPerUser ? "▼" : "▶"}</span>
            <span>Detail per osoba</span>
          </button>
          {showPerUser && (
            <div style={{
              display: "flex", gap: "12px", flexWrap: "wrap",
              paddingTop: "4px",
            }}>
              {perUserWeek.map(u => (
                <span key={u.name} style={{ fontSize: "10px", color: theme.textSub }}>
                  {u.name}: <strong style={{ color: theme.green }}>{u.count}</strong> /týden
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   LEGEND
   ═══════════════════════════════════════════════════════ */

function Legend({ theme }) {
  return (
    <div style={{ ...cardStyle(theme), padding: "10px 14px", marginTop: "20px", opacity: 0.6 }}>
      <div style={{
        fontSize: "10px", color: theme.textMid, fontWeight: 700,
        marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.3px",
      }}>Legenda</div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "11px" }}>
        {PRIORITIES.map(p => (
          <span key={p.id} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{
              width: "14px", height: "14px", borderRadius: "3px",
              background: theme.priority[p.id].cardBg,
              border: `2px solid ${theme.priority[p.id].border}`,
            }} />
            <span style={{ color: theme.priority[p.id].text, fontWeight: 700 }}>{p.sym} {p.label}</span>
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "14px", height: "3px", borderRadius: "2px", background: theme.green }} />
          <span style={{ color: theme.textSub }}>Nové</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "14px", height: "3px", borderRadius: "2px", background: theme.red }} />
          <span style={{ color: theme.textSub }}>Po termínu</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "14px", height: "3px", borderRadius: "2px", background: theme.purple }} />
          <span style={{ color: theme.textSub }}>Zapomenuté ⚠ 7+d</span>
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SETUP / LOGIN / ADMIN / SNACKBAR
   ═══════════════════════════════════════════════════════ */

function SetupScreen({ onDone }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const theme = THEMES.dark;

  return (
    <div style={{
      minHeight: "100vh", background: theme.bg, fontFamily: FONT,
      color: theme.text, display: "flex", alignItems: "center",
      justifyContent: "center", padding: "20px",
    }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ width: "300px", textAlign: "center", animation: "fadeIn 0.4s" }}>
        <div style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Rodinné úkoly</div>
        <div style={{ fontSize: "12px", color: theme.textSub, marginBottom: "28px" }}>
          Vytvoř hlavního uživatele
        </div>
        <input placeholder="Jméno" value={name} onChange={e => setName(e.target.value)}
          style={{ ...inputStyle(theme), padding: "12px", fontSize: "15px", marginBottom: "10px", textAlign: "center" }} />
        <input placeholder="4místný PIN" value={pin}
          onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) setPin(e.target.value); }}
          type="tel" inputMode="numeric" maxLength={4}
          style={{ ...inputStyle(theme), padding: "12px", fontSize: "20px", marginBottom: "16px", textAlign: "center", letterSpacing: "8px" }} />
        <button
          onClick={async () => { if (name.trim() && pin.length === 4) { setBusy(true); await onDone({ name: name.trim(), pin, admin: true }); } }}
          disabled={!name.trim() || pin.length !== 4 || busy}
          style={{
            ...buttonStyle(), width: "100%", padding: "12px",
            background: name.trim() && pin.length === 4 ? theme.accent : theme.buttonBg,
            color: "#fff", fontSize: "14px",
            opacity: !name.trim() || pin.length !== 4 || busy ? 0.4 : 1,
          }}>
          {busy ? "Vytvářím..." : "Vytvořit účet"}
        </button>
      </div>
    </div>
  );
}

function LoginScreen({ users, onLogin, themeName }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const theme = THEMES[themeName];

  const tryLogin = () => {
    const user = users.find(u => u.name === selected);
    if (user && user.pin === pin) { setError(false); onLogin(user); }
    else { setError(true); setPin(""); }
  };

  return (
    <div style={{
      minHeight: "100vh", background: theme.bg, fontFamily: FONT,
      color: theme.text, display: "flex", alignItems: "center",
      justifyContent: "center", padding: "20px",
    }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ width: "320px", textAlign: "center", animation: "fadeIn 0.4s" }}>
        <div style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Rodinné úkoly</div>
        <div style={{ fontSize: "12px", color: theme.textSub, marginBottom: "28px" }}>Vyber se a zadej PIN</div>

        {!selected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {users.map(u => (
              <button key={u.name} onClick={() => setSelected(u.name)} style={{
                ...cardStyle(theme), padding: "16px", fontSize: "16px", fontWeight: 600,
                color: theme.text, cursor: "pointer", fontFamily: FONT, textAlign: "left",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span>{u.name}</span>
                {u.admin && <span style={{ fontSize: "10px", color: theme.textSub, background: theme.accentSoft, padding: "2px 6px", borderRadius: "4px" }}>admin</span>}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ animation: "slideUp 0.2s" }}>
            <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>{selected}</div>
            <input placeholder="PIN" value={pin}
              onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) { setPin(e.target.value); setError(false); } }}
              onKeyDown={e => e.key === "Enter" && pin.length === 4 && tryLogin()}
              type="tel" inputMode="numeric" maxLength={4} autoFocus
              style={{
                ...inputStyle(theme), padding: "12px", fontSize: "22px",
                marginBottom: "8px", textAlign: "center", letterSpacing: "10px",
                borderColor: error ? theme.red : theme.inputBorder,
              }} />
            {error && <div style={{ fontSize: "12px", color: theme.red, marginBottom: "8px" }}>Špatný PIN</div>}
            <button onClick={tryLogin} disabled={pin.length !== 4} style={{
              ...buttonStyle(), width: "100%", padding: "11px",
              background: pin.length === 4 ? theme.accent : theme.buttonBg,
              color: "#fff", fontSize: "14px",
              opacity: pin.length === 4 ? 1 : 0.4, marginBottom: "8px",
            }}>Přihlásit</button>
            <button onClick={() => { setSelected(null); setPin(""); setError(false); }}
              style={{ background: "none", border: "none", color: theme.textSub, fontSize: "12px", cursor: "pointer", fontFamily: FONT }}>
              ← Zpět
            </button>
          </div>
        )}
      </div>
      {/* Footer s licencí */}
      <div style={{
        position: "fixed", bottom: "16px", left: 0, right: 0,
        textAlign: "center",
        fontSize: "12px", color: theme.textSub,
        fontFamily: FONT,
        userSelect: "none",
        fontWeight: 500,
      }}>
        © Michal Bělohlav · Rodinné úkoly · v{APP_VERSION}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FOCUS MODE — fullscreen single-task workflow
// Features:
//   - Stopwatch (optional, configurable)
//   - Scratch pad (append-only work log with timestamps)
//   - Checklist (big, tappable)
//   - Park task with reason (blocker templates)
//   - Complete → auto-advance to next by urgency
//   - Settings panel (timer on/off, auto-next on/off)
// ═══════════════════════════════════════════════════════════════════════════

const PARK_TEMPLATES = [
  { id: "waiting", label: "⏳ Čekám na někoho", template: "Čekám na " },
  { id: "material", label: "📦 Chybí materiál", template: "Potřebuji koupit/zajistit: " },
  { id: "info", label: "❓ Chybí informace", template: "Potřebuji zjistit: " },
  { id: "time", label: "🕐 Vyhradit čas", template: "Udělám až budu mít čas na: " },
  { id: "custom", label: "✏️ Vlastní důvod", template: "" },
];

function FocusMode({ tasks, currentUser, users, comments, theme, onClose, onUpdate, onStatusChange, onAddComment, onToggleReaction, initialTaskId }) {
  // Load settings from localStorage
  const [timerEnabled, setTimerEnabled] = useState(() => {
    const saved = localStorage.getItem("ft_focus_timer_enabled");
    return saved === null ? true : saved === "true";
  });
  const [autoNext, setAutoNext] = useState(() => {
    const saved = localStorage.getItem("ft_focus_auto_next");
    return saved === null ? true : saved === "true";
  });
  useEffect(() => localStorage.setItem("ft_focus_timer_enabled", String(timerEnabled)), [timerEnabled]);
  useEffect(() => localStorage.setItem("ft_focus_auto_next", String(autoNext)), [autoNext]);

  const [showSettings, setShowSettings] = useState(false);
  const [showParkModal, setShowParkModal] = useState(false);
  const [parkTemplate, setParkTemplate] = useState(null);
  const [parkReason, setParkReason] = useState("");

  // Compute today's task list sorted by urgency
  const todaysTasks = useMemo(() => {
    return tasks
      .filter(t =>
        !isDone(t) && !isDeleted(t) &&
        t.assignedTo?.includes(currentUser.name) &&
        !(t.showFrom && daysDiff(t.showFrom) > 0) // not deferred
      )
      .sort((a, b) => urgencyScore(b, currentUser.name) - urgencyScore(a, currentUser.name));
  }, [tasks, currentUser.name]);

  // Current task — track BY ID, not by index, abychom zachovali stejný úkol i když se změní řazení
  const [currentTaskId, setCurrentTaskId] = useState(() => {
    if (initialTaskId && todaysTasks.find(t => t.id === initialTaskId)) {
      return initialTaskId;
    }
    return todaysTasks[0]?.id || null;
  });

  // Computed currentTask + currentIdx (derived from currentTaskId)
  const currentIdx = useMemo(() => {
    if (!currentTaskId) return 0;
    const idx = todaysTasks.findIndex(t => t.id === currentTaskId);
    return idx >= 0 ? idx : 0;
  }, [currentTaskId, todaysTasks]);
  const currentTask = todaysTasks[currentIdx] || null;

  // Wrap setCurrentIdx to keep API compatible — convert idx → id
  const setCurrentIdx = useCallback((newIdx) => {
    const target = todaysTasks[newIdx];
    if (target) setCurrentTaskId(target.id);
  }, [todaysTasks]);

  // Timer state (per current task, resets when switching)
  const [seconds, setSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    // Reset timer when switching task — ALE NESPOUŠTÍME automaticky.
    // Uživatel preferuje ruční start (změna v Balíčku B).
    setSeconds(0);
    setTimerRunning(false);
  }, [currentTask?.id]);

  useEffect(() => {
    if (timerRunning && timerEnabled) {
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [timerRunning, timerEnabled]);

  // Auto-rozpracovat úkol po 10s ve Focus mode (znamená že jsem na něm pracoval)
  useEffect(() => {
    if (seconds >= 10 && currentTask && currentTask.status === "active") {
      onUpdate(currentTask.id, { status: "in_progress", inProgressAt: new Date().toISOString() });
    }
  }, [seconds, currentTask, onUpdate]);

  // Save accumulated time when leaving task
  const saveTimeSpent = () => {
    if (!currentTask || seconds < 30) return; // skip micro-sessions
    const addedMin = Math.floor(seconds / 60);
    if (addedMin === 0) return;
    const newTotal = (currentTask.timeSpentMin || 0) + addedMin;
    onUpdate(currentTask.id, { timeSpentMin: newTotal });
  };

  const formatTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  // Add scratch pad entry
  const [scratchInput, setScratchInput] = useState("");
  const addScratchEntry = () => {
    if (!currentTask || !scratchInput.trim()) return;
    const entry = {
      id: "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      text: scratchInput.trim(),
      createdAt: new Date().toISOString(),
      author: currentUser.name,
    };
    const newPad = [entry, ...(currentTask.scratchPad || [])];
    onUpdate(currentTask.id, { scratchPad: newPad });
    setScratchInput("");
  };

  const deleteScratchEntry = (entryId) => {
    if (!currentTask) return;
    const newPad = (currentTask.scratchPad || []).filter(e => e.id !== entryId);
    onUpdate(currentTask.id, { scratchPad: newPad });
  };

  // Toggle checklist item
  const toggleChecklistItem = (itemId) => {
    if (!currentTask) return;
    const updated = (currentTask.checklist || []).map(item => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        done: !item.done,
        doneBy: !item.done ? currentUser.name : null,
        doneAt: !item.done ? new Date().toISOString() : null,
      };
    });
    const someDone = updated.some(item => item.done);
    const allDone = updated.length > 0 && updated.every(item => item.done);
    const updates = { checklist: updated };
    if (someDone && !allDone && currentTask.status === "active") {
      updates.status = "in_progress";
      updates.inProgressAt = new Date().toISOString();
    }
    onUpdate(currentTask.id, updates);
  };

  // Actions
  const goNext = () => {
    saveTimeSpent();
    if (currentIdx + 1 < todaysTasks.length) {
      setCurrentIdx(currentIdx + 1);
    } else {
      // No more tasks → close focus mode
      onClose(true); // true = all done, show summary
    }
  };

  const goPrevious = () => {
    saveTimeSpent();
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  const completeTask = () => {
    if (!currentTask) return;
    saveTimeSpent();
    // Smart complete — if checklist, mark all done
    if (currentTask.checklist && currentTask.checklist.length > 0) {
      const now = new Date().toISOString();
      const allDone = currentTask.checklist.map(item => ({
        ...item,
        done: true,
        doneBy: item.doneBy || currentUser.name,
        doneAt: item.doneAt || now,
      }));
      onUpdate(currentTask.id, { checklist: allDone });
    }
    if (currentTask.assignTo === "both") onStatusChange(currentTask.id, "done_my");
    else onStatusChange(currentTask.id, "done");
    // Auto-advance or close
    if (autoNext) {
      setTimeout(goNext, 300);
    } else {
      onClose(false);
    }
  };

  const parkTask = () => {
    if (!currentTask || !parkReason.trim()) return;
    saveTimeSpent();
    // Přidej parking jako entry do scratch padu
    const newEntry = {
      id: "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      text: "⏸ " + parkReason.trim(),
      createdAt: new Date().toISOString(),
      author: currentUser.name,
    };
    const newPad = [newEntry, ...(currentTask.scratchPad || [])];
    onUpdate(currentTask.id, {
      scratchPad: newPad,
      status: "in_progress",
      inProgressAt: currentTask.inProgressAt || new Date().toISOString(),
    });
    // System comment (for activity log)
    if (onAddComment) {
      onAddComment(currentTask.id, `⏸ Zaparkováno: ${parkReason.trim()}`, null, "system");
    }
    setShowParkModal(false);
    setParkTemplate(null);
    setParkReason("");
    if (autoNext) setTimeout(goNext, 300);
    else onClose(false);
  };

  // Empty state — no tasks for today
  if (!currentTask) {
    return (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: theme.bg, zIndex: 100,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "40px 20px", textAlign: "center",
      }}>
        <div style={{ fontSize: "72px", marginBottom: "16px" }}>🎉</div>
        <div style={{ fontSize: "22px", fontWeight: 800, color: theme.text, marginBottom: "8px" }}>
          Všechno hotovo na dnes!
        </div>
        <div style={{ fontSize: "14px", color: theme.textSub, marginBottom: "24px" }}>
          Nic aktivního není k dokončení.
        </div>
        <button onClick={() => onClose(false)} style={{
          ...buttonStyle(), padding: "12px 24px", fontSize: "14px", fontWeight: 700,
          background: theme.accent, color: "#fff", border: "none",
        }}>
          Zavřít
        </button>
      </div>
    );
  }

  const priObj = getPriority(currentTask.priority || "low");
  const priTheme = theme.priority[currentTask.priority || "low"] || theme.priority.low;
  const overdue = daysDiff(currentTask.dueDate) < 0;
  const taskComments = comments.filter(c => c.taskId === currentTask.id && !c.checklistItemId);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: theme.bg, zIndex: 100,
      display: "flex", flexDirection: "column",
      overflow: "auto",
    }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        padding: "12px 16px",
        background: theme.card,
        borderBottom: `1px solid ${theme.cardBorder}`,
        display: "flex", alignItems: "center", gap: "8px",
      }}>
        <button onClick={() => { saveTimeSpent(); onClose(false); }}
          title="Zavřít Focus"
          style={{
            ...buttonStyle(), padding: "6px 10px", fontSize: "13px",
            background: theme.inputBg, color: theme.textSub,
            border: `1px solid ${theme.inputBorder}`,
          }}>
          ← Zavřít
        </button>
        <span style={{ flex: 1, fontSize: "12px", color: theme.textSub, textAlign: "center" }}>
          🎯 Fokus — úkol {currentIdx + 1} / {todaysTasks.length}
        </span>
        <button onClick={() => setShowSettings(!showSettings)} title="Nastavení"
          style={{
            ...buttonStyle(), padding: "6px 10px", fontSize: "14px",
            background: showSettings ? theme.accentSoft : "transparent",
            color: theme.textSub, border: "none",
          }}>
          ⚙
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{
          padding: "12px 16px",
          background: theme.inputBg,
          borderBottom: `1px solid ${theme.cardBorder}`,
          display: "flex", flexDirection: "column", gap: "8px",
        }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
            <input type="checkbox" checked={timerEnabled} onChange={e => setTimerEnabled(e.target.checked)} />
            <span>⏱ Zobrazit stopky</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
            <input type="checkbox" checked={autoNext} onChange={e => setAutoNext(e.target.checked)} />
            <span>→ Automaticky na další po Hotovo / Parknutí</span>
          </label>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, padding: "16px", maxWidth: "700px", margin: "0 auto", width: "100%" }}>
        {/* Timer — maličký v rohu, ručně spouštím */}
        {timerEnabled && (
          <button
            onClick={() => setTimerRunning(r => !r)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSeconds(0);
              setTimerRunning(false);
            }}
            title={timerRunning ? "Klik = pauza, pravé tlačítko = reset" : "Klik = start, pravé tlačítko = reset"}
            style={{
              position: "fixed", top: "10px", right: "12px", zIndex: 100,
              ...buttonStyle(),
              padding: "5px 10px", fontSize: "12px", fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              background: timerRunning ? `${theme.green}15` : theme.inputBg,
              color: timerRunning ? theme.green : theme.textSub,
              border: `1px solid ${timerRunning ? theme.green : theme.inputBorder}`,
              borderRadius: "16px",
              cursor: "pointer", letterSpacing: "0.5px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
            }}>
            {timerRunning ? "⏱" : "▶"} {formatTime(seconds)}
          </button>
        )}

        {/* Task card */}
        <div style={{
          background: theme.card,
          border: `1px solid ${theme.cardBorder}`,
          borderLeft: `6px solid ${priTheme.text}`,
          borderRadius: "12px",
          padding: "20px",
          marginBottom: "12px",
        }}>
          {/* Priority + Due date badges */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
            {(currentTask.priority === "urgent" || currentTask.priority === "important") && (
              <span style={{
                fontSize: "11px", fontWeight: 800,
                color: priTheme.text, background: priTheme.bg,
                padding: "3px 10px", borderRadius: "12px",
                border: `1px solid ${priTheme.border}`,
              }}>
                {priObj.sym} {priObj.label}
              </span>
            )}
            {currentTask.dueDate && (
              <span style={{
                fontSize: "11px", fontWeight: 600,
                color: overdue ? theme.red : theme.textSub,
                background: overdue ? `${theme.red}10` : theme.inputBg,
                padding: "3px 10px", borderRadius: "12px",
                border: `1px solid ${overdue ? theme.red + "30" : theme.inputBorder}`,
              }}>
                📅 {formatDate(currentTask.dueDate)} {overdue && "(po termínu)"}
              </span>
            )}
            {currentTask.createdBy !== currentUser.name && (
              <span style={{
                fontSize: "11px", fontWeight: 700,
                color: theme.accent, background: theme.accentSoft,
                padding: "3px 10px", borderRadius: "12px",
              }}>
                📥 od {currentTask.createdBy}
              </span>
            )}
            {currentTask.timeSpentMin > 0 && (
              <span style={{
                fontSize: "11px", color: theme.textSub,
                padding: "3px 10px", borderRadius: "12px",
                background: theme.inputBg,
                border: `1px solid ${theme.inputBorder}`,
              }}>
                ⏱ celkem {Math.floor(currentTask.timeSpentMin / 60)}h {currentTask.timeSpentMin % 60}min
              </span>
            )}
          </div>

          {/* Title */}
          <div style={{
            fontSize: "22px", fontWeight: 800, color: theme.text,
            lineHeight: 1.3, marginBottom: "10px",
          }}>
            {currentTask.title}
          </div>

          {/* Note (read-only) */}
          {currentTask.note && (
            <div style={{
              padding: "10px", marginBottom: "10px",
              background: theme.inputBg,
              border: `1px solid ${theme.inputBorder}`,
              borderRadius: "8px",
              fontSize: "13px", color: theme.text, lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}>
              {currentTask.note}
            </div>
          )}

          {/* Checklist */}
          {currentTask.checklist && currentTask.checklist.length > 0 && (
            <div>
              <div style={{
                fontSize: "11px", color: theme.textMid, fontWeight: 700,
                marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.3px",
              }}>
                Seznam ({currentTask.checklist.filter(i => i.done).length}/{currentTask.checklist.length})
              </div>
              {currentTask.checklist.map(item => {
                const hasNotes = (item.notes || []).length > 0;
                return (
                  <div key={item.id} style={{
                    marginBottom: "6px",
                    background: item.done ? `${theme.green}08` : theme.inputBg,
                    border: `1px solid ${item.done ? theme.green + "15" : theme.inputBorder}`,
                    borderRadius: "8px",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      alignItems: "center", gap: "10px",
                      padding: "10px 12px",
                    }}>
                      <button
                        onClick={() => toggleChecklistItem(item.id)}
                        style={{
                          width: "28px", height: "28px", minWidth: "28px",
                          borderRadius: "6px",
                          border: `2px solid ${item.done ? theme.green : theme.textDim}`,
                          background: item.done ? theme.green : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontSize: "14px", fontWeight: 800,
                          cursor: "pointer",
                        }}>
                        {item.done && "✓"}
                      </button>
                      <span
                        onClick={() => toggleChecklistItem(item.id)}
                        style={{
                          fontSize: "14px",
                          color: item.done ? theme.textSub : theme.text,
                          textDecoration: item.done ? "line-through" : "none",
                          cursor: "pointer",
                        }}>
                        {item.text}
                      </span>
                      <ChecklistItemNotes
                        item={item}
                        currentUser={currentUser}
                        theme={theme}
                        defaultExpanded={hasNotes}
                        onUpdateItem={(itemId, patch) => {
                          const updated = currentTask.checklist.map(it =>
                            it.id === itemId ? { ...it, ...patch } : it
                          );
                          onUpdate(currentTask.id, { checklist: updated });
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Scratch Pad */}
        <div style={{
          background: theme.card,
          border: `1px solid ${theme.cardBorder}`,
          borderRadius: "12px",
          padding: "14px",
          marginBottom: "12px",
        }}>
          <div style={{
            fontSize: "11px", color: theme.textMid, fontWeight: 700,
            marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.3px",
          }}>
            📝 Pracovní deník {currentTask.scratchPad?.length > 0 && `(${currentTask.scratchPad.length})`}
          </div>

          {/* Input */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            <input
              type="text"
              placeholder="Co jsem právě zjistil, co potřebuji..."
              value={scratchInput}
              onChange={e => setScratchInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addScratchEntry(); }}
              style={{ ...inputStyle(theme), fontSize: "13px", padding: "8px 12px", flex: 1 }}
            />
            <button onClick={addScratchEntry} disabled={!scratchInput.trim()} style={{
              ...buttonStyle(), padding: "8px 14px", fontSize: "13px",
              background: scratchInput.trim() ? theme.accent : theme.inputBg,
              color: scratchInput.trim() ? "#fff" : theme.textDim,
              border: "none",
            }}>
              Přidat
            </button>
          </div>

          {/* Entries */}
          {currentTask.scratchPad && currentTask.scratchPad.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {currentTask.scratchPad.map(entry => (
                <div key={entry.id} style={{
                  padding: "8px 10px",
                  background: theme.inputBg,
                  border: `1px solid ${theme.inputBorder}`,
                  borderRadius: "8px",
                  fontSize: "13px",
                  display: "flex", gap: "8px", alignItems: "flex-start",
                }}>
                  <span style={{
                    fontSize: "10px", color: theme.textMid, fontWeight: 600,
                    whiteSpace: "nowrap", marginTop: "2px",
                  }}>
                    {formatTimeTrace(entry.createdAt)}
                    {entry.author !== currentUser.name && ` · ${entry.author}`}
                  </span>
                  <span style={{ flex: 1, color: theme.text, lineHeight: 1.4 }}>
                    {entry.text}
                  </span>
                  {entry.author === currentUser.name && (
                    <button onClick={() => deleteScratchEntry(entry.id)}
                      title="Smazat"
                      style={{
                        background: "none", border: "none",
                        color: theme.textDim, cursor: "pointer", fontSize: "12px",
                      }}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comments inline — quick access */}
        {taskComments.length > 0 && (
          <div style={{
            background: theme.card,
            border: `1px solid ${theme.cardBorder}`,
            borderRadius: "12px",
            padding: "14px", marginBottom: "12px",
          }}>
            <div style={{
              fontSize: "11px", color: theme.textMid, fontWeight: 700,
              marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.3px",
            }}>
              💬 Komentáře ({taskComments.filter(c => c.type !== "reaction").length})
            </div>
            {taskComments.filter(c => c.type !== "reaction").slice(-3).map(c => (
              <div key={c.id} style={{
                padding: "6px 10px", marginBottom: "3px",
                background: theme.inputBg, borderRadius: "6px",
                fontSize: "12px",
              }}>
                <strong style={{ color: theme.accent }}>{c.author}:</strong> {c.content}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom action bar — sticky */}
      <div style={{
        position: "sticky", bottom: 0, zIndex: 10,
        background: theme.card,
        borderTop: `1px solid ${theme.cardBorder}`,
        padding: "12px 16px",
        display: "flex", gap: "6px", flexWrap: "wrap",
      }}>
        {currentIdx > 0 && (
          <button onClick={goPrevious} style={{
            ...buttonStyle(), padding: "10px 14px", fontSize: "13px",
            background: "transparent", color: theme.textSub,
            border: `1px solid ${theme.inputBorder}`,
          }}>
            ←
          </button>
        )}
        <button onClick={completeTask} style={{
          ...buttonStyle(), flex: 1, padding: "12px", fontSize: "14px", fontWeight: 700,
          background: theme.green, color: "#fff", border: "none",
        }}>
          ✓ Hotovo
        </button>
        <button onClick={() => setShowParkModal(true)} style={{
          ...buttonStyle(), padding: "12px 14px", fontSize: "13px", fontWeight: 600,
          background: `${theme.yellow}20`, color: theme.yellow,
          border: `1px solid ${theme.yellow}40`,
        }}>
          ⏸ Parknout
        </button>
        {currentIdx + 1 < todaysTasks.length && (
          <button onClick={goNext} style={{
            ...buttonStyle(), padding: "10px 14px", fontSize: "13px",
            background: "transparent", color: theme.textSub,
            border: `1px solid ${theme.inputBorder}`,
          }}>
            →
          </button>
        )}
      </div>

      {/* Park modal */}
      {showParkModal && (
        <div
          onClick={() => setShowParkModal(false)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)", zIndex: 200,
            display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: theme.card, width: "100%", maxWidth: "500px",
              borderRadius: "16px 16px 0 0",
              padding: "20px",
              animation: "slideUp 0.2s",
            }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: theme.text, marginBottom: "12px" }}>
              ⏸ Proč parkuješ úkol?
            </div>
            <div style={{ fontSize: "12px", color: theme.textSub, marginBottom: "12px" }}>
              Úkol se přesune do sekce "Čekám na..." a vrátí se, až zrušíš blocker.
            </div>

            {/* Templates */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "12px" }}>
              {PARK_TEMPLATES.map(t => (
                <button key={t.id}
                  onClick={() => {
                    setParkTemplate(t.id);
                    setParkReason(t.template);
                  }}
                  style={{
                    ...buttonStyle(), padding: "10px", fontSize: "13px",
                    background: parkTemplate === t.id ? theme.accentSoft : theme.inputBg,
                    color: parkTemplate === t.id ? theme.accent : theme.text,
                    border: `1px solid ${parkTemplate === t.id ? theme.accentBorder : theme.inputBorder}`,
                    textAlign: "left",
                  }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Reason input */}
            <input
              type="text"
              placeholder="Důvod (povinný)..."
              value={parkReason}
              autoFocus={parkTemplate !== null}
              onChange={e => setParkReason(e.target.value)}
              style={{ ...inputStyle(theme), fontSize: "14px", padding: "10px", marginBottom: "12px" }}
            />

            <div style={{ display: "flex", gap: "6px" }}>
              <button onClick={() => { setShowParkModal(false); setParkTemplate(null); setParkReason(""); }}
                style={{
                  ...buttonStyle(), flex: 1, padding: "10px", fontSize: "13px",
                  background: theme.inputBg, color: theme.textSub,
                  border: `1px solid ${theme.inputBorder}`,
                }}>
                Zrušit
              </button>
              <button onClick={parkTask} disabled={!parkReason.trim()}
                style={{
                  ...buttonStyle(), flex: 2, padding: "10px", fontSize: "13px", fontWeight: 700,
                  background: parkReason.trim() ? theme.yellow : theme.inputBg,
                  color: parkReason.trim() ? "#fff" : theme.textDim,
                  border: "none",
                }}>
                ⏸ Zaparkovat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationPanel({ currentUser, onClose, theme }) {
  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [swStatus, setSwStatus] = useState("checking...");
  const [subStatus, setSubStatus] = useState("checking...");
  const [dbSubs, setDbSubs] = useState([]);
  const [vapidKey, setVapidKey] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [log, setLog] = useState([]);

  const addLog = (msg) => {
    const ts = new Date().toLocaleTimeString("cs-CZ");
    setLog(prev => [...prev, `[${ts}] ${msg}`]);
  };

  // Initial checks
  useEffect(() => {
    (async () => {
      // Service worker
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        setSwStatus(reg ? `✅ Registrován (${reg.scope})` : "❌ Není registrován");

        if (reg && "PushManager" in window) {
          const sub = await reg.pushManager.getSubscription();
          setSubStatus(sub ? "✅ Subscription existuje" : "❌ Žádná subscription");
        }
      } else {
        setSwStatus("❌ Service Worker nepodporován");
      }

      // VAPID key
      const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      setVapidKey(key ? `✅ ${key.slice(0, 20)}...` : "❌ CHYBÍ (env var VITE_VAPID_PUBLIC_KEY)");

      // DB subscriptions for this user
      try {
        const { data, error } = await supabase
          .from("push_subscriptions")
          .select("*")
          .eq("user_name", currentUser.name);
        if (error) {
          setDbSubs([{ error: error.message }]);
        } else {
          setDbSubs(data || []);
        }
      } catch (e) {
        setDbSubs([{ error: e.message }]);
      }
    })();
  }, [currentUser.name]);

  const requestPermission = async () => {
    addLog("Žádám o povolení notifikací...");
    if (!("Notification" in window)) {
      addLog("❌ Notification API není podporováno");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      addLog(`Výsledek: ${result}`);
      if (result === "granted") {
        addLog("✅ Povolení uděleno — pokouším se o push subscription");
        await setupSubscription();
      }
    } catch (e) {
      addLog(`❌ Chyba: ${e.message}`);
    }
  };

  const setupSubscription = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      addLog("❌ Browser nepodporuje Push API");
      return;
    }
    const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!key) {
      addLog("❌ VITE_VAPID_PUBLIC_KEY není nastaven v env");
      return;
    }
    try {
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        addLog("Registruji Service Worker...");
        reg = await navigator.serviceWorker.register("/sw-polling.js", { scope: "/" });
        addLog("✅ Service Worker registrován");
      }
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        addLog("Vytvářím push subscription...");
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        addLog("✅ Subscription vytvořena");
      } else {
        addLog("✅ Subscription již existuje");
      }
      // Save to DB
      addLog("Ukládám do DB (push_subscriptions)...");
      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          { user_name: currentUser.name, subscription: sub.toJSON() },
          { onConflict: "user_name,subscription" }
        );
      if (error) {
        addLog(`❌ DB upsert chyba: ${error.message}`);
      } else {
        addLog("✅ Uloženo do DB");
        localStorage.setItem("ft_push_sub", JSON.stringify(sub.toJSON()));
        // Reload subs
        const { data } = await supabase
          .from("push_subscriptions")
          .select("*")
          .eq("user_name", currentUser.name);
        setDbSubs(data || []);
        setSubStatus("✅ Subscription existuje");
      }
    } catch (e) {
      addLog(`❌ Chyba: ${e.message}`);
    }
  };

  const sendTestNotification = async () => {
    setTestResult("sending");
    addLog("📤 Posílám testovací notifikaci...");
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl) {
        addLog("❌ VITE_SUPABASE_URL není nastaven v env!");
        setTestResult("error");
        return;
      }
      const url = `${supabaseUrl}/functions/v1/super-api`;
      addLog(`🌐 URL: ${url}`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          task: { id: "test", title: `🔔 Testovací notifikace (${new Date().toLocaleTimeString("cs-CZ")})` },
          assignedTo: [currentUser.name],
          createdBy: "system",
        }),
      });
      const text = await res.text();
      addLog(`📬 Response ${res.status}: ${text.slice(0, 300)}`);
      setTestResult(res.ok ? "ok" : "error");
    } catch (e) {
      addLog(`❌ Fetch selhal: ${e.message}`);
      addLog(`💡 Funkce super-api možná neexistuje v Supabase, nebo má CORS problém`);
      setTestResult("error");
    }
  };

  const showLocalNotification = async () => {
    addLog("🔔 Zobrazuji lokální notifikaci...");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        addLog("❌ Service Worker není registrován");
        return;
      }
      await reg.showNotification("Test lokální notifikace", {
        body: "Pokud tohle vidíš, notifikace fungují ✓",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "test-local",
      });
      addLog("✅ Lokální notifikace odeslána přes SW");
    } catch (e) {
      addLog(`❌ Chyba: ${e.message}`);
    }
  };

  const clearSubscription = async () => {
    addLog("🗑 Mažu subscription...");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        addLog("✅ Subscription zrušena v browseru");
      }
      localStorage.removeItem("ft_push_sub");
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("user_name", currentUser.name);
      addLog("✅ Subscription smazána z DB");
      setSubStatus("❌ Žádná subscription");
      setDbSubs([]);
    } catch (e) {
      addLog(`❌ Chyba: ${e.message}`);
    }
  };

  const statusColor = (val) => val?.startsWith("✅") ? theme.green : theme.red;

  return (
    <div style={{ ...cardStyle(theme), padding: "16px", marginBottom: "14px", animation: "slideUp 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "14px", fontWeight: 700 }}>🔔 Diagnostika notifikací</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textSub, cursor: "pointer", fontSize: "18px" }}>×</button>
      </div>

      {/* Status */}
      <div style={{
        background: theme.inputBg, border: `1px solid ${theme.inputBorder}`,
        borderRadius: "8px", padding: "10px", marginBottom: "10px",
        fontSize: "12px", lineHeight: 1.7,
      }}>
        <div>Uživatel: <strong>{currentUser.name}</strong></div>
        <div style={{ color: statusColor(permission === "granted" ? "✅" : "❌") }}>
          Browser permission: <strong>{permission}</strong>
        </div>
        <div style={{ color: statusColor(swStatus) }}>Service Worker: {swStatus}</div>
        <div style={{ color: statusColor(subStatus) }}>Push Subscription: {subStatus}</div>
        <div style={{ color: statusColor(vapidKey) }}>VAPID klíč: {vapidKey}</div>
        <div>DB záznamy: <strong>{dbSubs.length}</strong> {dbSubs[0]?.error ? `(chyba: ${dbSubs[0].error})` : ""}</div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px" }}>
        {permission !== "granted" && (
          <button onClick={requestPermission} style={{
            ...buttonStyle(), padding: "8px 14px", fontSize: "12px", fontWeight: 700,
            background: theme.accent, color: "#fff", border: "none",
          }}>
            🔔 Povolit notifikace
          </button>
        )}
        {permission === "granted" && (
          <>
            <button onClick={setupSubscription} style={{
              ...buttonStyle(), padding: "8px 14px", fontSize: "12px",
              background: theme.accentSoft, color: theme.accent,
              border: `1px solid ${theme.accentBorder}`,
            }}>
              🔄 Znovu registrovat
            </button>
            <button onClick={showLocalNotification} style={{
              ...buttonStyle(), padding: "8px 14px", fontSize: "12px",
              background: `${theme.green}15`, color: theme.green,
              border: `1px solid ${theme.green}30`,
            }}>
              📣 Test lokální
            </button>
            <button onClick={sendTestNotification} style={{
              ...buttonStyle(), padding: "8px 14px", fontSize: "12px",
              background: `${theme.green}15`, color: theme.green,
              border: `1px solid ${theme.green}30`,
            }}>
              📤 Test push (přes server)
            </button>
            <button onClick={clearSubscription} style={{
              ...buttonStyle(), padding: "8px 14px", fontSize: "12px",
              background: `${theme.red}10`, color: theme.red,
              border: `1px solid ${theme.red}30`,
            }}>
              🗑 Reset subscription
            </button>
          </>
        )}
      </div>

      {/* Help text */}
      {permission === "denied" && (
        <div style={{
          padding: "10px", background: `${theme.red}0a`,
          border: `1px solid ${theme.red}30`, borderRadius: "8px",
          fontSize: "11px", color: theme.red, lineHeight: 1.5, marginBottom: "10px",
        }}>
          ⚠ Notifikace byly zablokovány. Musíš je povolit v nastavení prohlížeče:
          <br />• <strong>Chrome/Edge</strong>: klik na 🔒 vedle URL → Notifications → Allow
          <br />• <strong>Safari iOS</strong>: Nastavení → Safari → Web notifications
        </div>
      )}

      {permission === "default" && (
        <div style={{
          padding: "10px", background: `${theme.accent}0a`,
          border: `1px solid ${theme.accentBorder}`, borderRadius: "8px",
          fontSize: "11px", color: theme.accent, lineHeight: 1.5, marginBottom: "10px",
        }}>
          💡 Klikni na <strong>🔔 Povolit notifikace</strong>. Browser zobrazí výzvu — povol "Allow".
          <br /><strong>iOS</strong>: aplikace musí být přidaná na Home Screen jako PWA + iOS 16.4+.
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div style={{
          background: "#0a0e14", color: "#a0c4e8",
          border: `1px solid ${theme.inputBorder}`, borderRadius: "8px",
          padding: "8px", fontSize: "10px", fontFamily: "monospace",
          maxHeight: "180px", overflowY: "auto",
        }}>
          {log.map((line, i) => (
            <div key={i} style={{ marginBottom: "2px" }}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminPanel({ users, onAdd, onRemove, onResetPin, onClose, theme, tasks = [], comments = [], currentUser }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  // Per-user state pro reset PIN dialog
  const [showPinFor, setShowPinFor] = useState(null); // user name který má zobrazený PIN
  const [editingPinFor, setEditingPinFor] = useState(null); // user name který se právě edituje
  const [newPinInput, setNewPinInput] = useState("");
  const [resetMessage, setResetMessage] = useState(null); // { name, pin } po úspěšném resetu
  const [savingFor, setSavingFor] = useState(null);
  // Delete user dialog state
  const [deletingUser, setDeletingUser] = useState(null); // string: jméno uživatele co se právě maže
  const [deleteAction, setDeleteAction] = useState("transfer_me"); // transfer_me | transfer_other | delete
  const [deleteTransferTo, setDeleteTransferTo] = useState("");

  const generateRandomPin = () => {
    return String(Math.floor(1000 + Math.random() * 9000));
  };

  const handleResetPin = async (userName, pinValue) => {
    if (!/^\d{4}$/.test(pinValue)) {
      alert("PIN musí být 4 číslice");
      return;
    }
    setSavingFor(userName);
    const ok = await onResetPin(userName, pinValue);
    setSavingFor(null);
    if (ok) {
      setResetMessage({ name: userName, pin: pinValue });
      setEditingPinFor(null);
      setNewPinInput("");
      setShowPinFor(null);
      // Auto-clear po 30s
      setTimeout(() => {
        setResetMessage(prev => prev?.name === userName ? null : prev);
      }, 30000);
    } else {
      alert("Reset PINu selhal. Zkus to znovu.");
    }
  };

  return (
    <div style={{ ...cardStyle(theme), padding: "16px", marginBottom: "14px", animation: "slideUp 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "14px", fontWeight: 700 }}>Správa uživatelů</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textSub, cursor: "pointer", fontSize: "18px" }}>×</button>
      </div>

      {/* Reset confirmation message */}
      {resetMessage && (
        <div style={{
          padding: "10px 12px", marginBottom: "12px",
          background: `${theme.green}15`,
          border: `2px solid ${theme.green}`, borderRadius: "8px",
          fontSize: "12px",
        }}>
          <div style={{ fontWeight: 700, color: theme.green, marginBottom: "4px" }}>
            ✓ PIN pro {resetMessage.name} byl změněn
          </div>
          <div style={{ color: theme.text, marginBottom: "6px" }}>
            Nový PIN: <span style={{
              fontFamily: "monospace", fontSize: "18px", fontWeight: 800,
              letterSpacing: "4px", color: theme.green,
              background: `${theme.green}20`, padding: "2px 10px", borderRadius: "4px",
            }}>{resetMessage.pin}</span>
          </div>
          <div style={{ fontSize: "10px", color: theme.textSub }}>
            Předej tento PIN uživateli ústně. Tato zpráva zmizí za 30 sekund.
          </div>
          <button onClick={() => setResetMessage(null)} style={{
            background: "none", border: "none", color: theme.textSub,
            fontSize: "10px", cursor: "pointer", marginTop: "4px",
            fontFamily: FONT, textDecoration: "underline",
          }}>Skrýt</button>
        </div>
      )}

      {users.map(u => {
        const isShowingPin = showPinFor === u.name;
        const isEditing = editingPinFor === u.name;
        return (
          <div key={u.name} style={{
            padding: "10px 0", borderBottom: `1px solid ${theme.cardBorder}`,
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: "8px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>{u.name}</span>
                {u.admin && (
                  <span style={{
                    fontSize: "9px", color: theme.accent,
                    background: theme.accentSoft, padding: "1px 6px", borderRadius: "4px",
                    fontWeight: 700, textTransform: "uppercase",
                  }}>admin</span>
                )}
                {/* PIN display + eye toggle */}
                {!isEditing && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginLeft: "8px" }}>
                    <span style={{
                      fontFamily: "monospace", fontSize: "12px",
                      letterSpacing: "3px", color: theme.textMid,
                    }}>
                      {isShowingPin ? u.pin : "••••"}
                    </span>
                    <button onClick={() => setShowPinFor(isShowingPin ? null : u.name)}
                      title={isShowingPin ? "Skrýt PIN" : "Zobrazit PIN"}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: "11px", padding: "2px",
                        color: theme.textSub,
                      }}>
                      {isShowingPin ? "🙈" : "👁"}
                    </button>
                  </span>
                )}
              </div>
              {!isEditing && (
                <div style={{ display: "flex", gap: "4px" }}>
                  <button onClick={() => {
                    setEditingPinFor(u.name);
                    setNewPinInput("");
                  }} title="Resetovat PIN" style={{
                    ...buttonStyle(), padding: "5px 10px", fontSize: "11px",
                    background: theme.accentSoft, color: theme.accent,
                    border: `1px solid ${theme.accentBorder}`, fontWeight: 600,
                  }}>🔑 Reset</button>
                  {!u.admin && (
                    <button onClick={() => {
                      setDeletingUser(u.name);
                      setDeleteAction("transfer_me");
                      setDeleteTransferTo("");
                    }} style={{
                      background: "none", border: "none", color: theme.red,
                      fontSize: "11px", cursor: "pointer", fontFamily: FONT, fontWeight: 600,
                      padding: "5px 8px",
                    }}>Odebrat</button>
                  )}
                </div>
              )}
            </div>
            {/* Edit PIN form */}
            {isEditing && (
              <div style={{
                marginTop: "8px", padding: "10px",
                background: theme.inputBg, borderRadius: "6px",
                display: "flex", flexDirection: "column", gap: "8px",
              }}>
                <div style={{ fontSize: "11px", color: theme.textMid, fontWeight: 600 }}>
                  Nový PIN pro {u.name}:
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <input
                    type="tel" inputMode="numeric" maxLength={4}
                    placeholder="••••"
                    value={newPinInput}
                    onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) setNewPinInput(e.target.value); }}
                    onKeyDown={e => e.key === "Enter" && newPinInput.length === 4 && handleResetPin(u.name, newPinInput)}
                    autoFocus
                    style={{
                      ...inputStyle(theme), width: "80px", textAlign: "center",
                      letterSpacing: "4px", fontSize: "16px", padding: "6px",
                    }} />
                  <button
                    onClick={() => setNewPinInput(generateRandomPin())}
                    title="Vygenerovat náhodný PIN"
                    style={{
                      ...buttonStyle(), padding: "6px 10px", fontSize: "11px",
                      background: theme.inputBg, color: theme.text,
                      border: `1px solid ${theme.inputBorder}`, fontWeight: 600,
                    }}>🎲 Náhodný</button>
                  <span style={{ flex: 1 }} />
                  <button
                    onClick={() => { setEditingPinFor(null); setNewPinInput(""); }}
                    style={{
                      background: "none", border: "none", color: theme.textSub,
                      fontSize: "11px", cursor: "pointer", fontFamily: FONT,
                      padding: "6px 8px",
                    }}>Zrušit</button>
                  <button
                    onClick={() => handleResetPin(u.name, newPinInput)}
                    disabled={newPinInput.length !== 4 || savingFor === u.name}
                    style={{
                      ...buttonStyle(), padding: "6px 12px", fontSize: "11px",
                      background: newPinInput.length === 4 ? theme.green : theme.inputBorder,
                      color: "#fff", fontWeight: 700,
                      cursor: newPinInput.length === 4 ? "pointer" : "default",
                    }}>
                    {savingFor === u.name ? "Ukládám..." : "Uložit"}
                  </button>
                </div>
                <div style={{ fontSize: "10px", color: theme.textSub }}>
                  💡 Po nastavení uvidíš nový PIN nahoře — předej ho uživateli ústně.
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
        <input placeholder="Jméno" value={name} onChange={e => setName(e.target.value)}
          style={{ ...inputStyle(theme), flex: 1 }} />
        <input placeholder="PIN" value={pin}
          onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) setPin(e.target.value); }}
          type="tel" inputMode="numeric" maxLength={4}
          style={{ ...inputStyle(theme), width: "70px", textAlign: "center", letterSpacing: "4px" }} />
        <button onClick={() => {
          if (name.trim() && pin.length === 4 && !users.find(u => u.name === name.trim())) {
            onAdd({ name: name.trim(), pin, admin: false });
            setName(""); setPin("");
          }
        }} style={{
          ...buttonStyle(), padding: "8px 14px",
          background: theme.accent, color: "#fff", fontSize: "14px",
        }}>+</button>
      </div>

      {/* Delete user confirmation dialog */}
      {deletingUser && (() => {
        const user = users.find(u => u.name === deletingUser);
        if (!user) return null;
        // Spočítat dopad
        const tasksCreated = tasks.filter(t => t.createdBy === deletingUser).length;
        const tasksAssigned = tasks.filter(t => t.assignedTo?.includes(deletingUser)).length;
        const userComments = comments.filter(c => c.author === deletingUser).length;
        const otherUsers = users.filter(u => u.name !== deletingUser);
        const close = () => { setDeletingUser(null); setDeleteAction("transfer_me"); setDeleteTransferTo(""); };
        const confirm = () => {
          let transferTo = null;
          if (deleteAction === "transfer_me") transferTo = currentUser?.name;
          else if (deleteAction === "transfer_other") transferTo = deleteTransferTo;
          // deleteAction === "delete" → transferTo zůstává null
          onRemove(deletingUser, { action: deleteAction, transferTo });
          close();
        };
        return (
          <div onClick={close} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 200, padding: 16,
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: theme.cardBg, borderRadius: 12,
              border: `1px solid ${theme.cardBorder}`,
              maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto",
              boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
            }}>
              <div style={{
                padding: "14px 16px", borderBottom: `1px solid ${theme.cardBorder}`,
                fontSize: 15, fontWeight: 700, color: theme.text,
              }}>
                Smazat uživatele „{deletingUser}"
              </div>

              <div style={{ padding: 16, color: theme.text, fontSize: 13 }}>
                {(tasksCreated + tasksAssigned + userComments) > 0 ? (
                  <>
                    <div style={{ marginBottom: 12, color: theme.textMid }}>
                      Tento uživatel má v systému:
                    </div>
                    <ul style={{ margin: "0 0 16px", paddingLeft: 22, lineHeight: 1.6 }}>
                      {tasksCreated > 0 && <li><strong>{tasksCreated}</strong> úkolů, které vytvořil</li>}
                      {tasksAssigned > 0 && <li><strong>{tasksAssigned}</strong> úkolů, které mu byly přiřazeny</li>}
                      {userComments > 0 && <li><strong>{userComments}</strong> komentářů</li>}
                    </ul>
                    <div style={{ marginBottom: 10, fontWeight: 600 }}>
                      Co s nimi chceš udělat?
                    </div>
                    <label style={{
                      display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px",
                      borderRadius: 8, cursor: "pointer",
                      background: deleteAction === "transfer_me" ? `${theme.accent}15` : "transparent",
                      border: `1px solid ${deleteAction === "transfer_me" ? theme.accent : theme.cardBorder}`,
                      marginBottom: 6,
                    }}>
                      <input type="radio" name="del-action" checked={deleteAction === "transfer_me"}
                        onChange={() => setDeleteAction("transfer_me")} style={{ marginTop: 3 }} />
                      <div>
                        <div style={{ fontWeight: 600 }}>Převést na mě ({currentUser?.name})</div>
                        <div style={{ fontSize: 11, color: theme.textMid, marginTop: 2 }}>
                          Úkoly + komentáře se přepíšou tak, že tě budou označovat jako autora/vlastníka.
                        </div>
                      </div>
                    </label>

                    {otherUsers.length > 1 && (
                      <label style={{
                        display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px",
                        borderRadius: 8, cursor: "pointer",
                        background: deleteAction === "transfer_other" ? `${theme.accent}15` : "transparent",
                        border: `1px solid ${deleteAction === "transfer_other" ? theme.accent : theme.cardBorder}`,
                        marginBottom: 6,
                      }}>
                        <input type="radio" name="del-action" checked={deleteAction === "transfer_other"}
                          onChange={() => setDeleteAction("transfer_other")} style={{ marginTop: 3 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600 }}>Převést na jiného uživatele</div>
                          {deleteAction === "transfer_other" && (
                            <select value={deleteTransferTo}
                              onChange={e => setDeleteTransferTo(e.target.value)}
                              style={{
                                marginTop: 6, padding: "6px 10px", fontSize: 13,
                                border: `1px solid ${theme.inputBorder}`, borderRadius: 6,
                                background: theme.inputBg, color: theme.text, width: "100%",
                              }}>
                              <option value="">— vyber uživatele —</option>
                              {otherUsers.filter(u => u.name !== deletingUser).map(u =>
                                <option key={u.name} value={u.name}>{u.name}</option>
                              )}
                            </select>
                          )}
                        </div>
                      </label>
                    )}

                    <label style={{
                      display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px",
                      borderRadius: 8, cursor: "pointer",
                      background: deleteAction === "delete" ? `${theme.red}15` : "transparent",
                      border: `1px solid ${deleteAction === "delete" ? theme.red : theme.cardBorder}`,
                    }}>
                      <input type="radio" name="del-action" checked={deleteAction === "delete"}
                        onChange={() => setDeleteAction("delete")} style={{ marginTop: 3 }} />
                      <div>
                        <div style={{ fontWeight: 600, color: theme.red }}>Smazat všechny úkoly a komentáře</div>
                        <div style={{ fontSize: 11, color: theme.textMid, marginTop: 2 }}>
                          ⚠️ Nevratné! Všechno smažeme z databáze, ne jen do koše.
                        </div>
                      </div>
                    </label>
                  </>
                ) : (
                  <div style={{ color: theme.textMid }}>
                    Tento uživatel nemá žádné úkoly ani komentáře. Po odebrání zmizí beze stopy.
                  </div>
                )}
              </div>

              <div style={{
                padding: 12, borderTop: `1px solid ${theme.cardBorder}`,
                display: "flex", gap: 8, justifyContent: "flex-end",
              }}>
                <button onClick={close} style={{
                  ...buttonStyle(), padding: "8px 14px", fontSize: 13,
                  background: "transparent", color: theme.text,
                  border: `1px solid ${theme.cardBorder}`,
                }}>Zrušit</button>
                <button
                  onClick={confirm}
                  disabled={deleteAction === "transfer_other" && !deleteTransferTo}
                  style={{
                    ...buttonStyle(), padding: "8px 14px", fontSize: 13, fontWeight: 700,
                    background: deleteAction === "delete" ? theme.red : theme.accent,
                    color: "#fff",
                    opacity: (deleteAction === "transfer_other" && !deleteTransferTo) ? 0.5 : 1,
                    cursor: (deleteAction === "transfer_other" && !deleteTransferTo) ? "not-allowed" : "pointer",
                  }}>
                  {deleteAction === "delete" ? "Smazat vše" : "Převést a odebrat"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   UPDATES PANEL — inline expandable section showing
   comments and task changes the user hasn't seen yet
   ═══════════════════════════════════════════════════════ */

function UpdatesPanel({ comments, tasks, currentUser, users, open, onToggle, onNavigate, onMarkSeen, onMarkItemNoteSeen, onQuickReply, theme }) {
  // Get unseen comments — the user hasn't seen them AND they're not by this user
  const unseenComments = comments.filter(c =>
    c.author !== currentUser.name &&
    !c.seenBy?.includes(currentUser.name)
  );

  // Only comments relevant to me: task is assigned to me, or created by me
  const relevantComments = unseenComments.filter(c => {
    const task = tasks.find(t => t.id === c.taskId);
    if (!task) return false;
    return (
      task.createdBy === currentUser.name ||
      task.assignedTo?.includes(currentUser.name)
    );
  });

  // Group by task
  const byTask = {};
  relevantComments.forEach(c => {
    if (!byTask[c.taskId]) byTask[c.taskId] = [];
    byTask[c.taskId].push(c);
  });

  // ═══ Per-item notes detection ═══
  // Pro každý úkol najdi nepřečtené poznámky k položkám.
  // unseenItemNotesByTask = { taskId: [{itemId, itemText, note}, ...] }
  const unseenItemNotesByTask = {};
  tasks.forEach(task => {
    if (isDone(task) || isDeleted(task)) return;
    const isRelevant =
      task.createdBy === currentUser.name ||
      task.assignedTo?.includes(currentUser.name);
    if (!isRelevant) return;
    (task.checklist || []).forEach(item => {
      (item.notes || []).forEach(note => {
        if (note.author === currentUser.name) return;
        if (note.seenBy?.includes(currentUser.name)) return;
        if (!unseenItemNotesByTask[task.id]) unseenItemNotesByTask[task.id] = [];
        unseenItemNotesByTask[task.id].push({
          itemId: item.id,
          itemText: item.text,
          note,
        });
      });
    });
  });

  const totalNoteCount = Object.values(unseenItemNotesByTask).reduce((sum, arr) => sum + arr.length, 0);
  const taskIdsWithUpdates = new Set([
    ...Object.keys(byTask),
    ...Object.keys(unseenItemNotesByTask),
  ]);

  const totalCount = relevantComments.length + totalNoteCount;
  const taskCount = taskIdsWithUpdates.size;
  const hasUpdates = totalCount > 0;

  // Quick reply state — single text field when user decides to reply
  const [replyTo, setReplyTo] = useState(null); // taskId or null
  const [replyText, setReplyText] = useState("");
  const [justSent, setJustSent] = useState(null); // taskId — show "Odesláno ✓" briefly

  const sendReply = () => {
    if (replyTo && replyText.trim() && onQuickReply) {
      const taskId = replyTo;
      onQuickReply(taskId, replyText.trim());
      // Auto-mark all comments on this task as seen (because we replied)
      const taskComments = byTask[taskId] || [];
      if (taskComments.length > 0 && onMarkSeen) {
        onMarkSeen(taskComments.map(c => c.id));
      }
      // Show "Odesláno ✓" feedback briefly
      setJustSent(taskId);
      setTimeout(() => setJustSent(null), 1500);
      setReplyText("");
      setReplyTo(null);
    }
  };

  const formatRelativeTime = (iso) => {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    const hr = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    if (min < 1) return "teď";
    if (min < 60) return `před ${min} min`;
    if (hr < 24) return `před ${hr} h`;
    if (day < 7) return `před ${day}d`;
    return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "short" });
  };

  // Sheet UI — full-screen modal
  // Pokud zavřený nebo žádné zprávy, nezobrazujeme nic v hlavní obrazovce.
  if (!open) return null;

  return (
    <div onClick={onToggle} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-end",
      animation: "slideUp 0.25s",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: "560px", maxHeight: "92vh",
        background: theme.bg, borderTopLeftRadius: "16px", borderTopRightRadius: "16px",
        overflow: "auto",
        boxShadow: "0 -8px 24px rgba(0,0,0,0.2)",
      }}>
        {/* Header */}
        <div style={{
          position: "sticky", top: 0, zIndex: 2, background: theme.bg,
          padding: "14px 16px", borderBottom: `1px solid ${theme.cardBorder}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: theme.text }}>
            🔔 Zprávy {hasUpdates && `(${totalCount})`}
          </h2>
          <button onClick={onToggle} style={{
            background: "none", border: "none", fontSize: "20px",
            cursor: "pointer", color: theme.textSub, padding: "4px 8px",
          }}>×</button>
        </div>

        {!hasUpdates && (
          <div style={{
            textAlign: "center", color: theme.textMid,
            padding: "60px 20px", fontSize: "14px",
          }}>
            Žádné nové zprávy 🎉
          </div>
        )}

        {hasUpdates && (
        <div>
          {Array.from(taskIdsWithUpdates).map(taskId => {
            const task = tasks.find(t => t.id === taskId);
            if (!task) return null;
            const taskComments = byTask[taskId] || [];
            const itemNotes = unseenItemNotesByTask[taskId] || [];
            return (
              <div key={taskId} style={{
                padding: "10px 14px",
                borderBottom: `1px solid ${theme.cardBorder}`,
              }}>
                {/* Task title + count */}
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: "8px",
                  marginBottom: "6px",
                }}>
                  <button
                    onClick={() => {
                      onNavigate(taskId);
                      onMarkSeen(taskComments.map(c => c.id));
                    }}
                    style={{
                      ...buttonStyle(),
                      background: "transparent", color: theme.accent,
                      border: "none", padding: 0, fontSize: "13px", fontWeight: 700,
                      textAlign: "left", cursor: "pointer", flex: 1,
                    }}>
                    → {task.title}
                  </button>
                </div>

                {/* Comments list */}
                {taskComments.map(c => {
                  const contextLabel = c.checklistItemId
                    ? (task.checklist?.find(i => i.id === c.checklistItemId)?.text || "")
                    : "";
                  return (
                    <div key={c.id} style={{
                      padding: "6px 10px", marginBottom: "4px",
                      background: c.type === "system" ? `${theme.purple}08` : theme.inputBg,
                      borderRadius: "6px", fontSize: "12px",
                      borderLeft: `3px solid ${c.type === "system" ? theme.purple : theme.accent}`,
                    }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        marginBottom: "2px",
                      }}>
                        <span style={{ fontWeight: 700, color: theme.text }}>
                          {c.type === "system" ? "✏️ " : c.type === "reaction" ? `${c.reaction} ` : ""}{c.author}
                        </span>
                        <span style={{ fontSize: "10px", color: theme.textMid }}>
                          {formatRelativeTime(c.createdAt)}
                        </span>
                      </div>
                      {contextLabel && (
                        <div style={{
                          fontSize: "10px", color: theme.textMid,
                          fontStyle: "italic", marginBottom: "3px",
                        }}>
                          na položku: {contextLabel}
                        </div>
                      )}
                      {c.type === "comment" && (
                        <div style={{ color: theme.text, lineHeight: 1.4 }}>
                          {c.content}
                        </div>
                      )}
                      {c.type === "system" && (
                        <div style={{ color: theme.purple, fontStyle: "italic", lineHeight: 1.4 }}>
                          {c.content}
                        </div>
                      )}
                      {c.type === "reaction" && (
                        <div style={{ color: theme.textSub, fontSize: "11px" }}>
                          reagoval(a) emoji
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Quick reply — pouze pokud existují komentáře k odpovědi */}
                {taskComments.length > 0 && (replyTo === taskId ? (
                  <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
                    <input
                      type="text"
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && sendReply()}
                      placeholder="Odpovědět..."
                      autoFocus
                      style={{ ...inputStyle(theme), padding: "6px 10px", fontSize: "12px" }}
                    />
                    <button onClick={sendReply} style={{
                      ...buttonStyle(), padding: "6px 12px", fontSize: "12px",
                      background: theme.accent, color: "#fff",
                    }}>Odeslat</button>
                    <button onClick={() => { setReplyTo(null); setReplyText(""); }} style={{
                      ...buttonStyle(), padding: "6px 10px", fontSize: "12px",
                      background: "transparent", color: theme.textSub,
                      border: `1px solid ${theme.cardBorder}`,
                    }}>×</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    <button onClick={() => setReplyTo(taskId)} style={{
                      ...buttonStyle(), padding: "4px 10px", fontSize: "11px",
                      background: `${theme.accent}12`, color: theme.accent,
                      border: `1px solid ${theme.accent}25`,
                    }}>💬 Odpovědět</button>
                    <button
                      onClick={() => onMarkSeen(taskComments.map(c => c.id))}
                      style={{
                        ...buttonStyle(), padding: "4px 10px", fontSize: "11px",
                        background: "transparent", color: theme.textSub,
                        border: `1px solid ${theme.cardBorder}`,
                      }}>✓ Přečteno</button>
                  </div>
                ))}

                {/* "Odesláno ✓" feedback */}
                {justSent === taskId && (
                  <div style={{
                    marginTop: "6px",
                    padding: "6px 10px",
                    background: `${theme.green}15`,
                    border: `1px solid ${theme.green}40`,
                    borderRadius: "6px",
                    fontSize: "11px", fontWeight: 600,
                    color: theme.green,
                    display: "flex", alignItems: "center", gap: "4px",
                    animation: "slideUp 0.2s",
                  }}>
                    ✓ Odesláno a označeno jako přečtené
                  </div>
                )}

                {/* ═══ Per-item notes section ═══ */}
                {itemNotes.length > 0 && (
                  <div style={{ marginTop: taskComments.length > 0 ? "8px" : "0" }}>
                    <div style={{
                      fontSize: "10px", fontWeight: 700, color: theme.purple,
                      textTransform: "uppercase", letterSpacing: "0.4px",
                      marginBottom: "4px",
                    }}>
                      📝 Poznámky k položkám ({itemNotes.length})
                    </div>
                    {itemNotes.map(({ itemId, itemText, note }) => (
                      <div key={note.id} style={{
                        padding: "6px 10px", marginBottom: "4px",
                        background: `${theme.purple}08`,
                        borderRadius: "6px", fontSize: "12px",
                        borderLeft: `3px solid ${theme.purple}`,
                      }}>
                        <div style={{
                          display: "flex", alignItems: "center", gap: "6px",
                          marginBottom: "2px",
                        }}>
                          <span style={{ fontWeight: 700, color: theme.text }}>{note.author}</span>
                          <span style={{ fontSize: "10px", color: theme.textMid }}>
                            {formatRelativeTime(note.createdAt)}
                          </span>
                        </div>
                        <div style={{
                          fontSize: "10px", color: theme.textMid, marginBottom: "3px",
                          fontStyle: "italic",
                        }}>
                          k položce: {itemText}
                        </div>
                        {note.text && (
                          <div style={{ color: theme.text, lineHeight: 1.4 }}>{note.text}</div>
                        )}
                        {note.imageUrl && (
                          <div style={{ fontSize: "11px", color: theme.purple, marginTop: "2px" }}>
                            📎 Foto
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        onNavigate(taskId);
                        if (onMarkItemNoteSeen) {
                          onMarkItemNoteSeen(taskId, itemNotes.map(n => ({ itemId: n.itemId, noteId: n.note.id })));
                        }
                      }}
                      style={{
                        ...buttonStyle(), padding: "4px 10px", fontSize: "11px",
                        background: `${theme.purple}12`, color: theme.purple,
                        border: `1px solid ${theme.purple}25`, fontWeight: 600,
                      }}>
                      → Otevřít úkol
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Mark all as seen */}
          {relevantComments.length > 0 && (
            <button
              onClick={() => onMarkSeen(relevantComments.map(c => c.id))}
              style={{
                ...buttonStyle(),
                width: "100%", padding: "10px",
                background: theme.inputBg, color: theme.textSub,
                border: "none", borderTop: `1px solid ${theme.cardBorder}`,
                fontSize: "12px", fontWeight: 600,
              }}>
              ✓ Označit komentáře jako přečtené
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function Snackbar({ message, onUndo, visible, theme }) {
  if (!visible) return null;
  return (
    <div style={{
      position: "fixed", bottom: "24px", left: "50%",
      transform: "translateX(-50%)",
      background: theme.snackBg, border: `1px solid ${theme.cardBorder}`,
      borderRadius: "12px", padding: "12px 16px",
      display: "flex", alignItems: "center", gap: "12px",
      zIndex: 100, animation: "snackIn 0.25s ease",
      fontFamily: FONT, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      maxWidth: "90vw",
    }}>
      <span style={{ fontSize: "13px", color: theme.text }}>{message}</span>
      <button onClick={onUndo} style={{
        ...buttonStyle(), background: theme.accent, color: "#fff",
        padding: "6px 14px", fontSize: "12px",
      }}>VRÁTIT</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════ */

function App() {
  const [tasks, setTasks] = useState([]);
  const [customLists, setCustomLists] = useState([]);
  // Echo prevention — sleduje časy posledních lokálních editů taskID
  // Realtime UPDATE events do 1.5s od vlastní editace ignorujeme,
  // aby nepřepisovaly náš čerstvý lokální stav.
  const localEditsRef = useRef({}); // { [taskId]: timestamp }
  const localCommentEditsRef = useRef({}); // { [commentId]: timestamp }
  const [comments, setComments] = useState([]);
  const [users, setUsers] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  // PWA install prompt — drží `beforeinstallprompt` event do doby, než user klikne na banner.
  // Po instalaci nebo dismiss se nastaví na null. Stav `installDismissed` v localStorage
  // brání opětovnému zobrazení po dismiss.
  const [pwaInstallEvent, setPwaInstallEvent] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [filter, setFilter] = useState("my");
  const [viewStatus, setViewStatus] = useState("active");
  const [sortMode, setSortMode] = useState("created");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all"); // "all" | "low" | "important" | "urgent"
  const [tagFilter, setTagFilter] = useState("all"); // "all" or tag id
  const [createdWhenFilter, setCreatedWhenFilter] = useState("all"); // "all" | "today" | "yesterday" | "week" | "month"
  // Filtr podle data splnění (dueDate): "all", "today", "week", "next_week", "month", "range:YYYY-MM-DD,YYYY-MM-DD"
  const [dueDateFilter, setDueDateFilter] = useState("all");
  const [createdByFilter, setCreatedByFilter] = useState("all"); // "all" | "<user.name>"
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeferred, setShowDeferred] = useState(false); // Show deferred tasks in active view
  const [updatesPanelOpen, setUpdatesPanelOpen] = useState(false);
  const [scrollToTaskId, setScrollToTaskId] = useState(null);
  // highlightedTaskId — úkol který právě navigoval (např. ze search) → flash glow na 2s
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);
  // Recently added tasks — mapa { taskId: addedAtTimestamp }
  // Tyto úkoly se zobrazí v sekci "✨ Právě přidáno" nahoře po dobu 5 minut.
  // Vizuálně postupně blednou (fade-out 5 minut).
  const [recentlyAdded, setRecentlyAdded] = useState({});
  const [, setRecentTick] = useState(0); // Force re-render every 30s for fade animation

  // Clear scrollToTaskId after a short delay so autoOpen doesn't re-trigger
  useEffect(() => {
    if (scrollToTaskId) {
      const t = setTimeout(() => setScrollToTaskId(null), 500);
      return () => clearTimeout(t);
    }
  }, [scrollToTaskId]);
  // Filter popover open state — pro filter row ikony (status/scope/sort/date/list)
  // MUSÍ být deklarováno PŘED useEffect který ho používá (TDZ)
  const [filterPopover, setFilterPopover] = useState(null);
  // Click outside zavírá filter popover
  useEffect(() => {
    if (!filterPopover) return;
    const onDocClick = (e) => {
      // Ne-zavřít pokud klik je uvnitř popoveru nebo ikonového řádku
      const popoverEl = e.target.closest("[data-filter-popover]");
      const iconBtn = e.target.closest("[data-filter-icon-row]");
      if (!popoverEl && !iconBtn) {
        setFilterPopover(null);
      }
    };
    // Delay 1ms aby se nezavřel hned po kliknutí na ikonu
    const t = setTimeout(() => {
      document.addEventListener("click", onDocClick);
    }, 50);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  }, [filterPopover]);
  // Clear highlight po 2.5s
  useEffect(() => {
    if (highlightedTaskId) {
      const t = setTimeout(() => setHighlightedTaskId(null), 2500);
      return () => clearTimeout(t);
    }
  }, [highlightedTaskId]);

  // Auto-hide header byl odstraněn — header je nyní vždy viditelný (kompaktní výška).
  const [undoState, setUndoState] = useState(null);
  // Bulk selection — když je `bulkMode` true, klikání na úkoly přidává/odebírá do `bulkSelection`.
  // Aktivace: long-press na kartě úkolu (mobile) nebo Ctrl+klik (PC).
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelection, setBulkSelection] = useState(() => new Set());
  // Stránkování — defaultně zobrazit prvních 50 úkolů, tlačítko "Načíst další" odhalí dalších 50.
  // Cíl: motivovat uživatele organizovat úkoly do kategorií / vlastních seznamů, místo aby měl 200 úkolů v jedné hromadě.
  const PAGE_SIZE = 50;
  const [renderLimit, setRenderLimit] = useState(PAGE_SIZE);
  // Reset render limitu při každé změně filtru/view/řazení — uživatel chce vidět začátek seznamu
  useEffect(() => {
    setRenderLimit(PAGE_SIZE);
  }, [viewStatus, filter, categoryFilter, priorityFilter, sortMode, searchQuery, dueDateFilter]);

  // Sticky wrapper ref — drží referenci pro případné budoucí měření výšky.
  // Aktuálně používán pasivně (žádný auto-scroll při změně výšky), protože layout flow
  // už správně push obsah dolů, když se sticky wrapper rozroste.
  const stickyWrapperRef = useRef(null);
  // Header ref + dynamicky měřená výška — sticky wrapper potřebuje vědět,
  // jak vysoký je header, aby se mohl přilepit přesně pod ním (top: headerHeight).
  // useLayoutEffect zajistí synchronní měření před paintem.
  // Závislost `currentUser` — header existuje v DOM až po loginu, jinak `headerRef.current` je null.
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    if (!headerRef.current) return;
    const measure = () => {
      const h = headerRef.current?.offsetHeight || 0;
      if (h > 0) setHeaderHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, [currentUser]);
  const [themeName, setThemeName] = useState(() => {
    try { return localStorage.getItem("ft_theme") || "dark"; } catch (e) { return "dark"; }
  });
  const [showAdmin, setShowAdmin] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showStatsSheet, setShowStatsSheet] = useState(false);
  const [showSearchSheet, setShowSearchSheet] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [editingList, setEditingList] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showFocus, setShowFocus] = useState(false);
  // isTyping — když uživatel zrovna zadává úkol (klikl do inputu).
  // Pokud true, header + filtry jsou schované, aby se vešly chips nad klávesnici.
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [focusInitialTask, setFocusInitialTask] = useState(null); // taskId to start Focus at, or null for default (first by urgency)
  const [focusSummaryAfter, setFocusSummaryAfter] = useState(null); // timestamp when focus closed with "all done"
  const [pendingCount, setPendingCount] = useState(() => getOfflineQueue().length);
  const undoTimerRef = useRef();

  const theme = THEMES[themeName];

  // Online/offline detection + flush queue when back online
  useEffect(() => {
    const goOnline = async () => {
      setOnline(true);
      const flushed = await flushOfflineQueue();
      if (flushed > 0) {
        setPendingCount(getOfflineQueue().length);
        // Reload fresh data from server
        const [freshUsers, freshTasks, freshComments] = await Promise.all([
          apiLoadUsers(), apiLoadTasks(), apiLoadComments()
        ]);
        setUsers(freshUsers);
        setTasks(freshTasks);
        setComments(freshComments);
      }
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  // PWA install prompt — Chrome/Edge/Brave triggernou `beforeinstallprompt`,
  // pokud uživatel ještě nemá appku nainstalovanou jako PWA. Zachytíme event,
  // a později ho použijeme, když uživatel klikne na install banner.
  useEffect(() => {
    // Pokud user už dismissoval banner, nikdy ho znovu neukaž (až do clear cache)
    let dismissed = false;
    try { dismissed = localStorage.getItem("ft_install_dismissed") === "1"; } catch (e) { /* ignore */ }
    if (dismissed) return;

    // Pokud appka už běží jako PWA (standalone mode), banner nemá smysl
    const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches
      || window.navigator.standalone === true; // iOS Safari
    if (isStandalone) return;

    const onBeforeInstall = (e) => {
      e.preventDefault(); // zabrání default minibar v Chromu
      setPwaInstallEvent(e);
      // Banner ukaž až po malé prodlevě, aby uživatel nedostal okamžitě reklamu
      setTimeout(() => setShowInstallBanner(true), 3000);
    };
    const onInstalled = () => {
      setPwaInstallEvent(null);
      setShowInstallBanner(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handlePwaInstall = useCallback(async () => {
    if (!pwaInstallEvent) return;
    try {
      pwaInstallEvent.prompt();
      const { outcome } = await pwaInstallEvent.userChoice;
      if (outcome === "accepted") {
        setShowInstallBanner(false);
        setPwaInstallEvent(null);
      } else {
        // User dismissed v native dialogu — schovej banner, ale neulož "navždy dismissed"
        setShowInstallBanner(false);
      }
    } catch (e) {
      console.warn("PWA install prompt failed:", e);
    }
  }, [pwaInstallEvent]);

  const handlePwaDismiss = useCallback(() => {
    setShowInstallBanner(false);
    try { localStorage.setItem("ft_install_dismissed", "1"); } catch (e) { /* ignore */ }
  }, []);

  // Session restore
  useEffect(() => {
    try { const saved = localStorage.getItem("ft_user"); if (saved) setCurrentUser(JSON.parse(saved)); } catch (e) {}
  }, []);
  useEffect(() => {
    try {
      if (currentUser) localStorage.setItem("ft_user", JSON.stringify(currentUser));
      else localStorage.removeItem("ft_user");
    } catch (e) {}
  }, [currentUser]);
  useEffect(() => {
    try { localStorage.setItem("ft_theme", themeName); } catch (e) {}
  }, [themeName]);

  // Initial data load
  useEffect(() => {
    (async () => {
      // Při startu ověř DB schéma — předejde tichým chybám typu PGRST204
      // (chybějící sloupec → INSERT/UPDATE selhává → změny se neuloží)
      checkDbSchema();

      // Flush any pending offline changes first
      if (navigator.onLine) {
        await flushOfflineQueue();
        setPendingCount(0);
      }

      const [loadedUsers, loadedTasks, loadedComments] = await Promise.all([
        apiLoadUsers(), apiLoadTasks(), apiLoadComments()
      ]);
      setUsers(loadedUsers);
      setComments(loadedComments);
      const { tasks: processed, updates } = processRecurring(loadedTasks);
      // Self-healing: auto-complete tasks whose checklists are fully done (legacy state)
      const { tasks: sanitized, updates: sanUpdates } = sanitizeCompletedChecklists(processed, loadedUsers);
      setTasks(sanitized);
      const allUpdates = [...updates, ...sanUpdates];
      if (allUpdates.length > 0) apiUpdateTasks(allUpdates);

      // Load custom lists
      try {
        const { data: lists, error: listsError } = await supabase.from("custom_lists").select("*").order("created_at");
        if (listsError) {
          console.error("[custom_lists] SELECT error:", listsError);
        } else if (lists) {
          console.log("[custom_lists] Loaded", lists.length, "lists:", lists);
          setCustomLists(lists);
        }
      } catch (e) {
        console.warn("Custom lists tabulka možná neexistuje, spusť migration_custom_lists.sql:", e);
      }

      setLoading(false);
    })();

    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Register custom polling service worker + push subscription
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw-polling.js", { scope: "/" })
        .then(async (reg) => {
          console.log("✅ SW registered");

          // Subscribe to push notifications
          if ("PushManager" in window && Notification.permission === "granted") {
            const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
            if (!vapidKey || vapidKey.length < 20) {
              // Bez VAPID klíče nemá smysl pokoušet se subscribe — selhalo by to s nejasnou chybou.
              // (Push notifikace vyžadují backend setup, tohle je zatím nedokončená feature.)
              console.info("ℹ️ Push notifications skipped (VITE_VAPID_PUBLIC_KEY not configured)");
              return;
            }
            try {
              const existingSub = await reg.pushManager.getSubscription();
              if (!existingSub) {
                const subscription = await reg.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: urlBase64ToUint8Array(vapidKey),
                });
                console.log("✅ Push subscription created");
                // Save subscription to Supabase (will be linked to user on login)
                try {
                  localStorage.setItem("ft_push_sub", JSON.stringify(subscription.toJSON()));
                } catch (e) { /* ignore */ }
              }
            } catch (err) {
              console.warn("Push subscription failed:", err?.message || err);
            }
          }
        })
        .catch(err => console.warn("SW registration failed:", err));
    }
  }, []);

  // Sync user session to service worker + save push subscription for user
  useEffect(() => {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      if (currentUser) {
        navigator.serviceWorker.controller.postMessage({
          type: "SET_USER",
          user: currentUser,
        });

        // Link push subscription to user in Supabase
        try {
          const subJson = localStorage.getItem("ft_push_sub");
          if (subJson) {
            const subscription = JSON.parse(subJson);
            supabase.from("push_subscriptions")
              .upsert(
                { user_name: currentUser.name, subscription },
                { onConflict: "user_name,subscription" }
              )
              .then(() => console.log("✅ Push sub linked to", currentUser.name));
          }
        } catch (e) {}
      } else {
        navigator.serviceWorker.controller.postMessage({ type: "CLEAR_USER" });
      }
    }
  }, [currentUser]);

  // Tell SW that tasks have been seen (reset notification count)
  useEffect(() => {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller && currentUser) {
      const myUnread = tasks.filter(t =>
        !t.seenBy?.includes(currentUser.name) &&
        t.createdBy !== currentUser.name &&
        !isDone(t) &&
        !isDeleted(t) &&
        t.assignedTo?.includes(currentUser.name)  // only tasks assigned to me
      ).length;
      if (myUnread === 0) {
        navigator.serviceWorker.controller.postMessage({ type: "TASKS_SEEN" });
      }
    }
  }, [tasks, currentUser]);

  // Realtime subscriptions
  const realtimeChannelsRef = useRef({ tasks: null, users: null, comments: null, lists: null });

  useEffect(() => {
    if (loading) return;

    const tasksChannel = supabase.channel("tasks-realtime-v12")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
        try {
          if (payload.eventType === "INSERT") {
            if (!payload.new?.id) return;
            const newTask = dbToTask(payload.new);
            setTasks(prev => prev.find(t => t.id === newTask.id) ? prev : [newTask, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            if (!payload.new?.id) return;
            // Echo prevention — pokud jsme task editovali v posledních 1500ms,
            // ignoruj realtime UPDATE (může nás vrátit do předchozího stavu).
            const lastEdit = localEditsRef.current[payload.new.id] || 0;
            if (Date.now() - lastEdit < 1500) return;
            const updatedTask = dbToTask(payload.new);
            setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
          } else if (payload.eventType === "DELETE") {
            if (!payload.old?.id) return;
            setTasks(prev => prev.filter(t => t.id !== payload.old.id));
          }
        } catch (e) {
          console.error("[realtime tasks] handler error:", e, payload);
        }
      }).subscribe((status) => {
        console.log("[realtime tasks]", status);
      });
    realtimeChannelsRef.current.tasks = tasksChannel;

    const usersChannel = supabase.channel("users-realtime-v11")
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => {
        apiLoadUsers().then(setUsers).catch(e => console.warn("[realtime users] reload failed:", e));
      }).subscribe((status) => {
        console.log("[realtime users]", status);
      });
    realtimeChannelsRef.current.users = usersChannel;

    const commentsChannel = supabase.channel("comments-realtime-v12")
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, (payload) => {
        try {
          if (payload.eventType === "INSERT") {
            if (!payload.new?.id) return;
            const newComment = dbToComment(payload.new);
            setComments(prev => prev.find(c => c.id === newComment.id) ? prev : [...prev, newComment]);
          } else if (payload.eventType === "UPDATE") {
            if (!payload.new?.id) return;
            // Echo prevention — pokud jsme tento komentář editovali v posledních 1500ms, ignoruj
            const lastEdit = localCommentEditsRef.current[payload.new.id] || 0;
            if (Date.now() - lastEdit < 1500) return;
            const updatedComment = dbToComment(payload.new);
            setComments(prev => prev.map(c => c.id === updatedComment.id ? updatedComment : c));
          } else if (payload.eventType === "DELETE") {
            if (!payload.old?.id) return;
            setComments(prev => prev.filter(c => c.id !== payload.old.id));
          }
        } catch (e) {
          console.error("[realtime comments] handler error:", e, payload);
        }
      }).subscribe((status) => {
        console.log("[realtime comments]", status);
      });
    realtimeChannelsRef.current.comments = commentsChannel;

    // Custom lists realtime
    const listsChannel = supabase.channel("custom-lists-realtime-v1")
      .on("postgres_changes", { event: "*", schema: "public", table: "custom_lists" }, (payload) => {
        try {
          if (payload.eventType === "INSERT") {
            if (!payload.new?.id) return;
            setCustomLists(prev => prev.find(l => l.id === payload.new.id) ? prev : [...prev, payload.new]);
          } else if (payload.eventType === "UPDATE") {
            if (!payload.new?.id) return;
            setCustomLists(prev => prev.map(l => l.id === payload.new.id ? payload.new : l));
          } else if (payload.eventType === "DELETE") {
            if (!payload.old?.id) return;
            setCustomLists(prev => prev.filter(l => l.id !== payload.old.id));
          }
        } catch (e) {
          console.error("[realtime lists] handler error:", e, payload);
        }
      }).subscribe((status) => {
        console.log("[realtime lists]", status);
      });
    realtimeChannelsRef.current.lists = listsChannel;

    return () => {
      supabase.removeChannel(tasksChannel);
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(commentsChannel);
      supabase.removeChannel(listsChannel);
      realtimeChannelsRef.current = { tasks: null, users: null, comments: null, lists: null };
    };
  }, [loading]);

  // Diagnostic helper — vystavený na window jako `window.appDiagnostics()`.
  // V konzoli ti vypíše souhrn stavu aplikace: počty úkolů, stav realtime kanálů,
  // nedávné errory, pending offline akce. Užitečné při ladění "něco se chová divně".
  useEffect(() => {
    if (loading) return;
    window.appDiagnostics = () => {
      const channels = realtimeChannelsRef.current || {};
      const channelStates = {
        tasks: channels.tasks?.state || "n/a",
        users: channels.users?.state || "n/a",
        comments: channels.comments?.state || "n/a",
        lists: channels.lists?.state || "n/a",
      };
      let serverErrors = [];
      let renderErrors = [];
      let offlineQueue = [];
      let pushSub = null;
      try { serverErrors = JSON.parse(localStorage.getItem("ft_server_errors") || "[]"); } catch (e) { /* ignore */ }
      try { renderErrors = JSON.parse(localStorage.getItem("ft_render_errors") || "[]"); } catch (e) { /* ignore */ }
      try { offlineQueue = JSON.parse(localStorage.getItem("ft_offline_queue") || "[]"); } catch (e) { /* ignore */ }
      try { pushSub = !!localStorage.getItem("ft_push_sub"); } catch (e) { /* ignore */ }

      const summary = {
        version: APP_VERSION,
        currentUser: currentUser?.name || "(není přihlášen)",
        online: navigator.onLine,
        counts: {
          tasks: tasks.length,
          tasksActive: tasks.filter(t => t.status === "active").length,
          tasksDone: tasks.filter(t => t.status === "done").length,
          tasksDeleted: tasks.filter(t => t.status === "deleted").length,
          users: (users || []).length,
          comments: comments.length,
          customLists: customLists.length,
        },
        realtime: channelStates,
        offlineQueueSize: offlineQueue.length,
        recentServerErrors: serverErrors.slice(0, 3),
        recentRenderErrors: renderErrors.slice(0, 3),
        pushSubscriptionCached: pushSub,
        rendered: new Date().toISOString(),
      };
      console.log("%c📊 APP DIAGNOSTICS", "background:#3b82f6;color:white;padding:2px 6px;border-radius:3px;font-weight:600;");
      console.table(summary.counts);
      console.log("Realtime channels:", channelStates);
      if (serverErrors.length > 0) {
        console.log(`%c⚠ ${serverErrors.length} server errors logged`, "color:#dc2626;font-weight:600;");
        console.log(serverErrors.slice(0, 3));
      }
      if (renderErrors.length > 0) {
        console.log(`%c⚠ ${renderErrors.length} render errors logged`, "color:#dc2626;font-weight:600;");
        console.log(renderErrors.slice(0, 3));
      }
      console.log("Full state:", summary);
      return summary;
    };
    return () => {
      try { delete window.appDiagnostics; } catch (e) { /* ignore */ }
    };
  }, [loading, tasks, users, comments, customLists, currentUser]);

  // Refresh on focus — fallback pokud realtime selže (slabá síť, websocket timeout).
  // Server je vždy zdroj pravdy; lokální cache se používá jen v offline režimu.
  // Navíc: zkontroluj stav Realtime kanálů a pokud nejsou joined, donuť je k reconnectu.
  useEffect(() => {
    if (loading) return;
    let lastRefreshAt = 0;
    let inFlight = false;

    // Pomocná: zkontroluj stav Realtime kanálu a pokud není OK, zkus reconnect.
    // Supabase v2 channel.state je 'closed' | 'errored' | 'joined' | 'joining' | 'leaving'.
    const ensureChannelHealthy = (channel, label) => {
      if (!channel) return;
      const state = channel.state;
      if (state !== "joined" && state !== "joining") {
        console.warn(`[realtime ${label}] state="${state}" — attempting reconnect`);
        try {
          // Subscribe znovu — pokud kanál spadl, nahodí se znovu
          channel.subscribe((status) => {
            console.log(`[realtime ${label}] reconnect →`, status);
          });
        } catch (e) {
          console.warn(`[realtime ${label}] reconnect failed:`, e);
        }
      }
    };

    const onFocus = async () => {
      // Debounce: pokud jsme refreshovali v posledních 2s, skip.
      // Brání tomu, aby se focus + visibilitychange + click vyvolaly multiple načtení.
      const now = Date.now();
      if (now - lastRefreshAt < 2000) return;
      if (inFlight) return;
      lastRefreshAt = now;
      inFlight = true;

      // 1) Zkontroluj zdraví Realtime kanálů (mohly spadnout během sleep / slabé sítě)
      const channels = realtimeChannelsRef.current;
      ensureChannelHealthy(channels.tasks, "tasks");
      ensureChannelHealthy(channels.users, "users");
      ensureChannelHealthy(channels.comments, "comments");
      ensureChannelHealthy(channels.lists, "lists");

      // 2) Force refresh ze serveru — chytne změny zmeškané během odpojení
      try {
        const [freshTasks, freshComments] = await Promise.all([
          apiLoadTasks(),
          apiLoadComments(),
        ]);
        setTasks(freshTasks);
        setComments(freshComments);
        // custom_lists raw fetch
        const { data } = await supabase.from("custom_lists").select("*").order("created_at", { ascending: true });
        if (data) setCustomLists(data);
      } catch (e) {
        console.warn("Focus refresh failed:", e);
      } finally {
        inFlight = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loading]);

  // Recurring check + keepalive
  useEffect(() => {
    const interval = setInterval(() => {
      setTasks(prev => {
        const { tasks: processed, updates } = processRecurring(prev);
        if (updates.length > 0) apiUpdateTasks(updates);
        return updates.length > 0 ? processed : prev;
      });
      // Keep Supabase project alive
      supabase.from("tasks").select("id", { count: "exact", head: true });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // ── Actions ──

  const performUndo = useCallback(async () => {
    if (!undoState) return;
    setTasks(undoState.previousTasks);
    const task = undoState.previousTasks.find(t => t.id === undoState.taskId);
    if (task) apiUpdateTask(task);
    clearTimeout(undoTimerRef.current);
    setUndoState(null);
  }, [undoState]);

  const withUndo = useCallback((message, taskId, updater) => {
    // Echo prevention pro Realtime listener — když naše vlastní změna
    // přijde zpět přes websocket, nepřepíšeme jí lokální stav.
    // 1500ms okno pokrývá round-trip + Supabase Realtime broadcast latency.
    // (in-memory ref stačí — echo přijde okamžitě po vlastní akci, ne po reload)
    localEditsRef.current[taskId] = Date.now();

    // Optimistický UI update
    let updatedTask = null;
    setTasks(prev => {
      const next = updater(prev);
      updatedTask = next.find(t => t.id === taskId);
      setUndoState({ previousTasks: prev, message, taskId });
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setUndoState(null), UNDO_MS);
      return next;
    });

    // Asynchronní zápis na server (fire-and-forget — apiUpdateTask má offline queue fallback)
    if (updatedTask) {
      apiUpdateTask(updatedTask).then(() => {
        // Obnov echo prevention timestamp po dokončení — chrání před pozdním echem
        localEditsRef.current[taskId] = Date.now();
      });
    }
  }, []);

  const addTask = useCallback(async (task) => {
    setTasks(prev => [task, ...prev]);
    await apiCreateTask(task);
    setPendingCount(getOfflineQueue().length);
    // Označ úkol jako "právě přidaný" — bude v sekci ✨ Právě přidáno po 5 minut
    setRecentlyAdded(prev => ({ ...prev, [task.id]: Date.now() }));
    if (task.assignTo !== "self") {
      notify(`📋 Nový od ${task.createdBy}`, task.title);
      // Trigger push notification to other users
      triggerPushNotification(task);
    }
  }, []);

  const changeStatus = useCallback((taskId, action) => {
    // Find task name for the snackbar message
    const taskTitle = tasks.find(t => t.id === taskId)?.title || "";
    const shortTitle = taskTitle.length > 30 ? taskTitle.slice(0, 30) + "…" : taskTitle;
    const actionLabels = {
      done: "Splněno", done_all: "Splněno", done_my: "Moje část hotová",
      reopen: "Vráceno", in_progress: "Rozpracováno",
    };
    const message = `${actionLabels[action] || "Změněno"}: ${shortTitle}`;

    // Track completion so we can push-notify the creator AFTER state update
    let completedTaskForNotify = null;

    withUndo(message, taskId, prev => prev.map(task => {
      if (task.id !== taskId) return task;
      const now = new Date().toISOString();

      switch (action) {
        case "in_progress":
          return { ...task, status: "in_progress", inProgressAt: task.inProgressAt || now };
        case "complete":
        case "done": {
          const updated = { ...task, status: "done", completedAt: now, completedByUser: currentUser.name, doneBy: users.map(u => u.name) };
          if (task.createdBy && task.createdBy !== currentUser.name) completedTaskForNotify = updated;
          return updated;
        }
        case "unmark": {
          // Remove current user from doneBy (for shared tasks)
          const newDoneBy = (task.doneBy || []).filter(n => n !== currentUser.name);
          return { ...task, doneBy: newDoneBy, status: task.status === "done" ? "active" : task.status };
        }
        case "done_my": {
          const newDoneBy = [...new Set([...(task.doneBy || []), currentUser.name])];
          const allDone = users.every(u => newDoneBy.includes(u.name));
          const updated = {
            ...task, doneBy: newDoneBy,
            status: allDone ? "done" : task.status,
            completedAt: allDone ? now : task.completedAt,
            completedByUser: allDone ? currentUser.name : task.completedByUser,
          };
          // Notify creator only when task is FULLY done and creator is someone else
          if (allDone && task.createdBy && task.createdBy !== currentUser.name) {
            completedTaskForNotify = updated;
          }
          return updated;
        }
        case "done_all": {
          const updated = { ...task, status: "done", completedAt: now, completedByUser: currentUser.name, doneBy: users.map(u => u.name) };
          if (task.createdBy && task.createdBy !== currentUser.name) completedTaskForNotify = updated;
          return updated;
        }
        case "reopen":
          return { ...task, status: "active", completedAt: null, completedByUser: null, doneBy: [], inProgressAt: null };
        default:
          return task;
      }
    }));

    // Fire completion notification (push to creator) outside of setState updater
    if (completedTaskForNotify) {
      triggerCompletionNotification(completedTaskForNotify, currentUser.name);
    }
  }, [currentUser, users, withUndo, tasks]);

  const markSeen = useCallback(async (taskId) => {
    let updatedTask = null;
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId || t.seenBy?.includes(currentUser.name)) return t;
      updatedTask = { ...t, seenBy: [...(t.seenBy || []), currentUser.name] };
      return updatedTask;
    }));
    setTimeout(async () => {
      if (updatedTask) await apiUpdateTask(updatedTask);
    }, 50);
  }, [currentUser]);

  const updateTask = useCallback(async (taskId, patch) => {
    // Echo prevention — označ tento task jako právě upravený
    localEditsRef.current[taskId] = Date.now();
    let updatedTask = null;
    let originalTask = null;
    setTasks(prev => {
      return prev.map(t => {
        if (t.id !== taskId) return t;
        originalTask = t;
        updatedTask = { ...t, ...patch };
        return updatedTask;
      });
    });
    // Wait for state to settle, then persist
    setTimeout(async () => {
      if (updatedTask) await apiUpdateTask(updatedTask);

      // Generate system comments for significant changes (only if task is being edited by non-creator or shared)
      if (originalTask && updatedTask && currentUser) {
        const changes = [];

        if (patch.title !== undefined && patch.title !== originalTask.title) {
          changes.push("upravil(a) název");
        }
        if (patch.note !== undefined && (patch.note || "") !== (originalTask.note || "")) {
          const hadNote = (originalTask.note || "").trim().length > 0;
          const hasNote = (patch.note || "").trim().length > 0;
          if (!hadNote && hasNote) changes.push("přidal(a) poznámku");
          else if (hadNote && !hasNote) changes.push("odstranil(a) poznámku");
          else changes.push("upravil(a) poznámku");
        }
        if (patch.category !== undefined && patch.category !== originalTask.category) {
          const newCat = getCategory(patch.category);
          changes.push(`změnil(a) kategorii na ${newCat.icon} ${newCat.label}`);
        }
        if (patch.priority !== undefined && patch.priority !== originalTask.priority) {
          const newPri = getPriority(patch.priority);
          changes.push(`změnil(a) prioritu na ${newPri.sym} ${newPri.label}`);
        }
        if (patch.dueDate !== undefined && patch.dueDate !== originalTask.dueDate) {
          if (!patch.dueDate) changes.push("odstranil(a) termín");
          else changes.push(`nastavil(a) termín ${patch.dueDate}`);
        }
        if (patch.assignedTo !== undefined) {
          const oldAssigned = (originalTask.assignedTo || []).slice().sort().join(",");
          const newAssigned = (patch.assignedTo || []).slice().sort().join(",");
          if (oldAssigned !== newAssigned) {
            const newList = (patch.assignedTo || []).join(", ");
            changes.push(`změnil(a) přiřazení na ${newList || "nikoho"}`);
          }
        }
        // Checklist item additions (new items added)
        if (patch.checklist !== undefined && Array.isArray(patch.checklist)) {
          const oldIds = new Set((originalTask.checklist || []).map(i => i.id));
          const addedItems = patch.checklist.filter(i => !oldIds.has(i.id));
          addedItems.forEach(item => {
            changes.push(`přidal(a) položku: „${item.text}"`);
          });
        }

        // Create system comments — only if there's something to note and the task is not just my own
        // Avoid spam: only comment for tasks shared with others (not for purely personal tasks)
        const hasOtherPeople =
          updatedTask.assignTo === "both" ||
          (updatedTask.assignedTo || []).some(n => n !== currentUser.name) ||
          (updatedTask.createdBy && updatedTask.createdBy !== currentUser.name);

        if (hasOtherPeople && changes.length > 0) {
          for (const changeText of changes) {
            const sysComment = {
              id: generateId(),
              taskId,
              checklistItemId: null,
              author: currentUser.name,
              content: changeText,
              type: "system",
              reaction: null,
              seenBy: [currentUser.name],
              createdAt: new Date().toISOString(),
            };
            setComments(prev => [...prev, sysComment]);
            await apiCreateComment(sysComment);
          }
        }
      }
    }, 50);
  }, [currentUser]);

  // ── Bulk selection handlers ──

  const toggleBulkSelection = useCallback((taskId) => {
    setBulkSelection(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const enterBulkMode = useCallback((taskId) => {
    setBulkMode(true);
    setBulkSelection(new Set(taskId ? [taskId] : []));
  }, []);

  const exitBulkMode = useCallback(() => {
    setBulkMode(false);
    setBulkSelection(new Set());
  }, []);

  // Bulk akce — všechny optimistické, s undo pro každý úkol jednotlivě (zachován history).
  const bulkComplete = useCallback(() => {
    const ids = Array.from(bulkSelection);
    if (ids.length === 0 || !currentUser || !users) return;
    const now = new Date().toISOString();
    const updates = [];
    setTasks(prev => prev.map(task => {
      if (!bulkSelection.has(task.id)) return task;
      if (task.status === "done" || task.status === "deleted") return task;
      const newDoneBy = [...new Set([...(task.doneBy || []), currentUser.name])];
      const allDone = users.every(u => newDoneBy.includes(u.name));
      const updated = allDone
        ? { ...task, doneBy: newDoneBy, status: "done", completedAt: now, completedByUser: currentUser.name }
        : { ...task, doneBy: newDoneBy };
      localEditsRef.current[task.id] = Date.now();
      updates.push(updated);
      return updated;
    }));
    // Sync do DB (paralelně)
    updates.forEach(t => apiUpdateTask(t));
    exitBulkMode();
  }, [bulkSelection, currentUser, users, exitBulkMode]);

  const bulkDelete = useCallback(() => {
    const ids = Array.from(bulkSelection);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const updates = [];
    setTasks(prev => prev.map(task => {
      if (!bulkSelection.has(task.id)) return task;
      if (task.status === "deleted") return task;
      const updated = { ...task, status: "deleted", deletedAt: now };
      localEditsRef.current[task.id] = Date.now();
      updates.push(updated);
      return updated;
    }));
    updates.forEach(t => apiUpdateTask(t));
    // Snackbar zpráva pro celou bulk akci (bez per-task undo)
    setUndoState({ previousTasks: null, message: `Smazáno ${updates.length} úkolů`, taskId: null });
    clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoState(null), UNDO_MS);
    exitBulkMode();
  }, [bulkSelection, exitBulkMode]);

  const bulkSetPriority = useCallback((priority) => {
    const ids = Array.from(bulkSelection);
    if (ids.length === 0) return;
    const updates = [];
    setTasks(prev => prev.map(task => {
      if (!bulkSelection.has(task.id)) return task;
      const updated = { ...task, priority };
      localEditsRef.current[task.id] = Date.now();
      updates.push(updated);
      return updated;
    }));
    updates.forEach(t => apiUpdateTask(t));
    exitBulkMode();
  }, [bulkSelection, exitBulkMode]);

  const bulkAssign = useCallback((userName) => {
    const ids = Array.from(bulkSelection);
    if (ids.length === 0) return;
    const updates = [];
    setTasks(prev => prev.map(task => {
      if (!bulkSelection.has(task.id)) return task;
      const updated = { ...task, assignTo: userName, assignedTo: [userName] };
      localEditsRef.current[task.id] = Date.now();
      updates.push(updated);
      return updated;
    }));
    updates.forEach(t => apiUpdateTask(t));
    exitBulkMode();
  }, [bulkSelection, exitBulkMode]);

  const deleteTask = useCallback((taskId) => {
    const taskTitle = tasks.find(t => t.id === taskId)?.title || "";
    const shortTitle = taskTitle.length > 30 ? taskTitle.slice(0, 30) + "…" : taskTitle;

    withUndo(`Smazáno: ${shortTitle}`, taskId, prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return { ...task, status: "deleted", deletedAt: new Date().toISOString() };
    }));
  }, [tasks, withUndo]);

  // Permanently remove tasks in trash older than 30 days.
  // Používáme ref pro aktuální tasks, aby se interval vytvořil jen jednou
  // (původní `[tasks]` dep způsobil, že interval se restartoval při každé změně,
  // takže 1h timer fakticky nikdy nedoběhl a cleanup neprobíhal).
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => {
    const cleanup = setInterval(async () => {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const toDelete = tasksRef.current.filter(t =>
        t.status === "deleted" && t.deletedAt && new Date(t.deletedAt).getTime() < cutoff
      );
      for (const task of toDelete) {
        try {
          const { error } = await supabase.from("tasks").delete().eq("id", task.id);
          if (error) throw error;
          setTasks(prev => prev.filter(t => t.id !== task.id));
        } catch (e) {
          if (!isNetworkError(e)) {
            logServerError("permanentDelete (30d cleanup)", e, { id: task.id });
          }
        }
      }
    }, 3600000); // Check every hour
    return () => clearInterval(cleanup);
  }, []);

  // Tick každých 30s — pro fade animaci recently added úkolů (5 min retention)
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      const fiveMinAgo = now - 5 * 60 * 1000;
      // Vyřaď úkoly starší než 5 min
      setRecentlyAdded(prev => {
        const next = {};
        let changed = false;
        for (const [id, ts] of Object.entries(prev)) {
          if (ts > fiveMinAgo) next[id] = ts;
          else changed = true;
        }
        return changed ? next : prev;
      });
      // Force re-render pro fade opacity
      setRecentTick(t => t + 1);

      // Cleanup echo prevention timestamps starší než 30s — prevence memory leaku
      // při dlouhých sessions s mnoha úpravami.
      const thirtySecAgo = now - 30000;
      for (const id of Object.keys(localEditsRef.current)) {
        if (localEditsRef.current[id] < thirtySecAgo) delete localEditsRef.current[id];
      }
      for (const id of Object.keys(localCommentEditsRef.current)) {
        if (localCommentEditsRef.current[id] < thirtySecAgo) delete localCommentEditsRef.current[id];
      }
    }, 30000); // 30s
    return () => clearInterval(tick);
  }, []);

  const permanentlyDeleteTask = useCallback(async (taskId) => {
    // Optimistický update — drž zálohu pro případ rollback při server chybě
    let backup = null;
    setTasks(prev => {
      backup = prev.find(t => t.id === taskId) || null;
      return prev.filter(t => t.id !== taskId);
    });
    try {
      const { error } = await supabase.from("tasks").delete().eq("id", taskId);
      if (error) throw error;
    } catch (e) {
      if (isNetworkError(e)) {
        console.warn("permanentlyDeleteTask offline — aplikováno lokálně, server se posune při příštím flush");
      } else {
        logServerError("permanentlyDeleteTask", e, { taskId });
        // Server odmítl — vrať úkol zpět do UI
        if (backup) setTasks(prev => prev.find(t => t.id === taskId) ? prev : [backup, ...prev]);
      }
    }
  }, []);

  const restoreTask = useCallback((taskId) => {
    withUndo("Obnoveno", taskId, prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return { ...task, status: "active", deletedAt: null };
    }));
  }, [withUndo]);

  // ── Comments ──

  const addComment = useCallback(async (taskId, content, checklistItemId = null) => {
    if (!content || !content.trim()) return;
    const comment = {
      id: generateId(),
      taskId,
      checklistItemId,
      author: currentUser.name,
      content: content.trim(),
      type: "comment",
      reaction: null,
      seenBy: [currentUser.name],
      createdAt: new Date().toISOString(),
    };
    setComments(prev => [...prev, comment]);
    await apiCreateComment(comment);
    setPendingCount(getOfflineQueue().length);
    // Push notification to others via Edge Function
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      const others = [...new Set([...(task.assignedTo || []), task.createdBy])]
        .filter(n => n && n !== currentUser.name);
      if (others.length > 0) {
        try {
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
          fetch(`${supabaseUrl}/functions/v1/super-api`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
            body: JSON.stringify({
              task: { id: taskId, title: `💬 ${currentUser.name}: ${content.slice(0, 60)}` },
              assignedTo: others, createdBy: currentUser.name,
            }),
          });
        } catch (e) { console.warn("Comment push failed:", e); }
      }
    }
  }, [currentUser, tasks]);

  const toggleReaction = useCallback(async (taskId, emoji, checklistItemId = null) => {
    // Find existing reaction by current user
    const existing = comments.find(c =>
      c.taskId === taskId &&
      c.checklistItemId === checklistItemId &&
      c.type === "reaction" &&
      c.reaction === emoji &&
      c.author === currentUser.name
    );
    if (existing) {
      // Remove
      setComments(prev => prev.filter(c => c.id !== existing.id));
      await apiDeleteComment(existing.id);
    } else {
      // Add
      const reaction = {
        id: generateId(),
        taskId,
        checklistItemId,
        author: currentUser.name,
        content: null,
        type: "reaction",
        reaction: emoji,
        seenBy: [currentUser.name],
        createdAt: new Date().toISOString(),
      };
      setComments(prev => [...prev, reaction]);
      await apiCreateComment(reaction);
    }
  }, [comments, currentUser]);

  const markCommentsSeen = useCallback(async (commentIds) => {
    if (!commentIds || commentIds.length === 0) return;
    const now = Date.now();
    // Echo prevention — označ tyto komentáře jako právě upravené
    commentIds.forEach(id => { localCommentEditsRef.current[id] = now; });
    const updates = [];
    setComments(prev => prev.map(c => {
      if (!commentIds.includes(c.id)) return c;
      if (c.seenBy?.includes(currentUser.name)) return c;
      const updated = { ...c, seenBy: [...(c.seenBy || []), currentUser.name] };
      updates.push(updated);
      return updated;
    }));
    for (const u of updates) await apiUpdateComment(u);
  }, [currentUser]);

  // Mark per-item notes as seen — entries: [{itemId, noteId}, ...]
  const markItemNoteSeen = useCallback(async (taskId, entries) => {
    if (!entries || entries.length === 0) return;
    localEditsRef.current[taskId] = Date.now();
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const updatedChecklist = (t.checklist || []).map(item => {
        const matching = entries.filter(e => e.itemId === item.id);
        if (matching.length === 0) return item;
        const noteIds = new Set(matching.map(m => m.noteId));
        const updatedNotes = (item.notes || []).map(n => {
          if (!noteIds.has(n.id)) return n;
          if (n.seenBy?.includes(currentUser.name)) return n;
          return { ...n, seenBy: [...(n.seenBy || []), currentUser.name] };
        });
        return { ...item, notes: updatedNotes };
      });
      const updated = { ...t, checklist: updatedChecklist };
      apiUpdateTask(updated);
      return updated;
    }));
  }, [currentUser]);

  // ── Computed values ──

  const unreadCounts = useMemo(() => {
    if (!currentUser || !users) return {};
    const counts = {};
    users.forEach(u => {
      counts[u.name] = tasks.filter(t =>
        !t.seenBy?.includes(u.name) &&     // user hasn't seen it
        t.createdBy !== u.name &&          // user didn't create it
        !isDone(t) &&                      // task is active
        !isDeleted(t) &&                   // not deleted
        t.assignedTo?.includes(u.name)     // ← BUG FIX: task is actually assigned to this user
      ).length;
    });
    return counts;
  }, [tasks, currentUser, users]);

  const filteredTasks = useMemo(() => {
    if (!currentUser) return [];
    let result = tasks;

    // ═══ VISIBILITY FILTER (per-user privacy) ═══
    // Admin vidí vše. Ostatní uživatelé vidí pouze:
    //   - úkoly které sami vytvořili
    //   - úkoly kde jsou v assignedTo[]
    if (!currentUser.admin) {
      result = result.filter(t =>
        t.createdBy === currentUser.name ||
        (t.assignedTo && t.assignedTo.includes(currentUser.name))
      );
    }

    // Status filter
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    if (viewStatus === "today") {
      // Dnes = úkoly s dueDate=dnes + dnes splněné/smazané
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      result = result.filter(t => {
        // Recently completed/deleted dnes
        if (t.status === "done" && t.completedAt) {
          const cms = new Date(t.completedAt).getTime();
          return cms >= todayStart.getTime() && cms <= todayEnd.getTime();
        }
        if (t.status === "deleted" && t.deletedAt) {
          const dms = new Date(t.deletedAt).getTime();
          return dms >= todayStart.getTime() && dms <= todayEnd.getTime();
        }
        // Aktivní úkoly s due date dnes
        if (!isDone(t) && !isDeleted(t)) {
          if (!t.dueDate) return false;
          const due = new Date(t.dueDate);
          return due >= todayStart && due <= todayEnd;
        }
        return false;
      });
    }
    else if (viewStatus === "active") {
      // Aktivní = všechny nesplněné, bez ohledu na termín
      result = result.filter(t => {
        if (!isDone(t) && !isDeleted(t)) {
          if (t.showFrom && daysDiff(t.showFrom) > 0 && !showDeferred) return false;
          return true;
        }
        // Recently completed/deleted (24h)
        if (t.status === "done" && t.completedAt && new Date(t.completedAt).getTime() > recentCutoff) return true;
        if (t.status === "deleted" && t.deletedAt && new Date(t.deletedAt).getTime() > recentCutoff) return true;
        return false;
      });
    }
    else if (viewStatus === "in_progress") {
      result = result.filter(t => t.status === "in_progress" && !isDeleted(t));
    }
    else if (viewStatus === "planned") {
      result = result.filter(t => t.showFrom && daysDiff(t.showFrom) > 0 && !isDone(t) && !isDeleted(t));
    }
    else if (viewStatus === "done") result = result.filter(t => t.status === "done");
    else if (viewStatus === "trash") result = result.filter(t => t.status === "deleted");
    // viewStatus === "all" — neaplikuje status filtr, vrátí všechny úkoly

    // Scope filter
    if (filter === "my") result = result.filter(t => t.assignedTo?.includes(currentUser.name));
    else if (filter === "for_me") result = result.filter(t =>
      t.assignedTo?.includes(currentUser.name) &&
      t.createdBy !== currentUser.name
    );
    else if (filter.startsWith("person:")) {
      const personName = filter.replace("person:", "");
      result = result.filter(t => t.assignedTo?.includes(personName));
    }
    else if (filter === "assigned") result = result.filter(t => t.createdBy === currentUser.name && !t.assignedTo?.every(a => a === currentUser.name));
    else if (filter === "shared") result = result.filter(t => t.assignTo === "both");
    else if (filter === "unread") result = result.filter(t =>
      !t.seenBy?.includes(currentUser.name) &&
      t.createdBy !== currentUser.name &&
      t.assignedTo?.includes(currentUser.name)  // only my own unread
    );

    // Category filter
    if (categoryFilter !== "all") result = result.filter(t => t.category === categoryFilter);

    // Priority filter
    if (priorityFilter !== "all") result = result.filter(t => (t.priority || "low") === priorityFilter);

    // Tag filter (auto-detected sloveso z názvu úkolu)
    if (tagFilter !== "all") {
      result = result.filter(t => detectTags(t.title).includes(tagFilter));
    }

    // Due date filter (Datum splnění)
    if (dueDateFilter !== "all") {
      result = result.filter(t => matchesDueDateFilter(t, dueDateFilter));
    }

    // Created-when filter — when was the task added
    if (createdWhenFilter !== "all") {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      result = result.filter(t => {
        if (!t.createdAt) return false;
        const createdMs = new Date(t.createdAt).getTime();
        const ageMs = now - createdMs;
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        if (createdWhenFilter === "today") return createdMs >= todayStart.getTime();
        if (createdWhenFilter === "yesterday") return createdMs >= yesterdayStart.getTime() && createdMs < todayStart.getTime();
        if (createdWhenFilter === "week") return ageMs <= 7 * oneDay;
        if (createdWhenFilter === "month") return ageMs <= 30 * oneDay;
        if (createdWhenFilter === "older") return ageMs > 30 * oneDay;
        return true;
      });
    }

    // Created-by filter — kdo úkol přidal
    if (createdByFilter !== "all") {
      result = result.filter(t => t.createdBy === createdByFilter);
    }

    // Search
    if (searchQuery) result = result.filter(t => searchMatch(t, searchQuery, customLists));

    // Sort — pokud user nastaví sortMode, respektujeme to vždy
    // (i v Today view). Pokud nechá default "created", v Today view použijeme smart urgency.
    // Sort modes: smart, priority,
    //   date_asc / date_desc (nejbližší termín první / nejvzdálenější první),
    //   created_desc / created_asc (nejnovější první / nejstarší první),
    //   alpha_asc / alpha_desc (A→Z / Z→A).
    // Legacy aliasy: "date" = date_asc, "created" = created_desc (kvůli zachování starých localStorage hodnot).
    if (sortMode === "smart") {
      result = [...result].sort(smartSort);
    } else if (sortMode === "priority") {
      result = [...result].sort((a, b) => getPriority(a.priority).weight - getPriority(b.priority).weight);
    } else if (sortMode === "date" || sortMode === "date_asc") {
      result = [...result].sort((a, b) => {
        const aDays = daysDiff(a.dueDate);
        const bDays = daysDiff(b.dueDate);
        if (isNaN(aDays) && isNaN(bDays)) return 0;
        if (isNaN(aDays)) return 1;
        if (isNaN(bDays)) return -1;
        return aDays - bDays;
      });
    } else if (sortMode === "date_desc") {
      result = [...result].sort((a, b) => {
        const aDays = daysDiff(a.dueDate);
        const bDays = daysDiff(b.dueDate);
        if (isNaN(aDays) && isNaN(bDays)) return 0;
        if (isNaN(aDays)) return 1;
        if (isNaN(bDays)) return -1;
        return bDays - aDays;
      });
    } else if (sortMode === "alpha_asc") {
      result = [...result].sort((a, b) =>
        (a.title || "").localeCompare(b.title || "", "cs", { sensitivity: "base" })
      );
    } else if (sortMode === "alpha_desc") {
      result = [...result].sort((a, b) =>
        (b.title || "").localeCompare(a.title || "", "cs", { sensitivity: "base" })
      );
    } else if (sortMode === "created_asc") {
      result = [...result].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (sortMode === "created" || sortMode === "created_desc") {
      // Default: V Today view smart urgency, jinak nejnovější
      if (viewStatus === "today" && sortMode === "created") {
        result = [...result].sort((a, b) => urgencyScore(b, currentUser.name) - urgencyScore(a, currentUser.name));
      } else {
        result = [...result].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }
    }

    // In active/today view, push completed to bottom, then deleted below completed
    if (viewStatus === "active" || viewStatus === "today") {
      const active = result.filter(t => !isDone(t) && !isDeleted(t));
      const recentlyDone = result.filter(t => isDone(t))
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      const recentlyDeleted = result.filter(t => isDeleted(t))
        .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
      result = [...active, ...recentlyDone, ...recentlyDeleted];
    }

    return result;
  }, [tasks, currentUser, filter, viewStatus, sortMode, categoryFilter, priorityFilter, tagFilter, searchQuery, showDeferred, createdWhenFilter, createdByFilter, dueDateFilter, customLists]);

  // Render items — mixed list of task cards + checklist progress cards
  // Only in "active"/"today" views, we show completed checklist items from still-active tasks
  const renderItems = useMemo(() => {
    if (viewStatus !== "active" && viewStatus !== "today") {
      return filteredTasks.map(task => ({ type: "task", task, key: task.id }));
    }

    const items = [];
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;

    const activeTasks = filteredTasks.filter(t => !isDone(t) && !isDeleted(t));
    const doneTasks = filteredTasks.filter(t => isDone(t));
    const deletedTasks = filteredTasks.filter(t => isDeleted(t));

    // ═══ Recently added (last 5 min) ═══
    // Úkoly z mapy `recentlyAdded` (přidané v této session) → na vrchol s fade efektem.
    // Po 5 min se odstraní z mapy a vrátí se mezi ostatní podle defaultní logiky.
    const now = Date.now();
    const fiveMinMs = 5 * 60 * 1000;
    const recentList = activeTasks
      .filter(t => recentlyAdded[t.id] !== undefined)
      .sort((a, b) => (recentlyAdded[b.id] || 0) - (recentlyAdded[a.id] || 0));

    const recentIds = new Set(recentList.map(t => t.id));

    // ═══ Dlouho rozpracované (>24h) ═══
    // Úkoly v in_progress déle než 24h jdou na vrchol jako varovná sekce.
    const staleList = activeTasks
      .filter(t => !recentIds.has(t.id))
      .filter(t => t.status === "in_progress" && t.inProgressAt && inProgressIntensity(t.inProgressAt) >= 1)
      .sort((a, b) => new Date(a.inProgressAt) - new Date(b.inProgressAt)); // nejstarší první
    const staleIds = new Set(staleList.map(t => t.id));

    const remainingActive = activeTasks.filter(t => !recentIds.has(t.id) && !staleIds.has(t.id));

    if (recentList.length > 0) {
      items.push({ type: "section_header_recent", key: "section-recent", count: recentList.length });
      recentList.forEach(task => {
        const addedAt = recentlyAdded[task.id] || now;
        const ageMs = now - addedAt;
        // fadeProgress 0 → čerstvý (plné zvýraznění), 1 → starý (žádné zvýraznění)
        const fadeProgress = Math.min(ageMs / fiveMinMs, 1);
        items.push({ type: "task", task, key: task.id, recentlyAdded: true, fadeProgress });
      });
      items.push({ type: "section_divider", key: "section-divider-recent" });
    }

    if (staleList.length > 0) {
      items.push({ type: "section_header_stale", key: "section-stale", count: staleList.length });
      staleList.forEach(task => items.push({ type: "task", task, key: task.id }));
      items.push({ type: "section_divider", key: "section-divider-stale" });
    }

    // ═══ Seskupování — nejdřív Dnes, pak vlastní seznamy (3+), pak ostatní ═══
    if (viewStatus === "active") {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

      // 1) Úkoly s dueDate=dnes
      const todayTasks = [];
      const remainingNonToday = [];
      remainingActive.forEach(task => {
        if (task.dueDate) {
          const due = new Date(task.dueDate);
          if (due >= todayStart && due <= todayEnd) {
            todayTasks.push(task);
            return;
          }
        }
        remainingNonToday.push(task);
      });

      if (todayTasks.length > 0) {
        items.push({ type: "section_header_today", key: "section-today", count: todayTasks.length });
        todayTasks.forEach(task => items.push({ type: "task", task, key: task.id, isToday: true }));
        items.push({ type: "section_divider", key: "section-divider-today" });
      }

      // 2) Seskupit ostatní podle vlastních seznamů (3+ úkolů)
      const groupedByList = {};  // listId → [tasks]
      const ungrouped = [];
      remainingNonToday.forEach(task => {
        if (task.category && task.category.startsWith("list:")) {
          const listId = task.category.slice(5);
          if (!groupedByList[listId]) groupedByList[listId] = [];
          groupedByList[listId].push(task);
        } else {
          ungrouped.push(task);
        }
      });
      // Sekce jen pro seznamy s 3+ úkoly. Menší zůstávají v "ungrouped"
      const bigGroups = [];
      Object.entries(groupedByList).forEach(([listId, tasks]) => {
        if (tasks.length >= 3) {
          bigGroups.push({ listId, tasks });
        } else {
          ungrouped.push(...tasks);
        }
      });
      // Vyčlenit zapomenuté úkoly (>7 dní bez termínu) z bigGroups i ungrouped — půjdou do vlastní sekce dole
      const forgottenTasks = [];
      const filterForgotten = (arr) => arr.filter(t => {
        if (isForgotten(t)) {
          forgottenTasks.push(t);
          return false;
        }
        return true;
      });
      bigGroups.forEach(g => { g.tasks = filterForgotten(g.tasks); });
      const ungroupedFiltered = filterForgotten(ungrouped);

      // Render bigGroups (sekce + jejich úkoly), pak ungrouped
      bigGroups.forEach(({ listId, tasks }) => {
        if (tasks.length === 0) return; // všechny byly zapomenuté → vynechej sekci
        const list = (customLists || []).find(l => l.id === listId);
        if (list) {
          items.push({
            type: "section_header_list",
            key: "section-list-" + listId,
            list,
            count: tasks.length,
          });
        }
        tasks.forEach(task => items.push({ type: "task", task, key: task.id }));
      });
      ungroupedFiltered.forEach(task => items.push({ type: "task", task, key: task.id }));

      // Sekce zapomenuté — jen aktivní úkoly bez termínu vytvořené před >7 dny
      if (forgottenTasks.length > 0) {
        items.push({ type: "section_header_forgotten", key: "section-forgotten", count: forgottenTasks.length });
        forgottenTasks.forEach(task => items.push({ type: "task", task, key: task.id }));
      }
    } else {
      remainingActive.forEach(task => items.push({ type: "task", task, key: task.id }));
    }

    // Progress + done items
    const progressCards = [];
    activeTasks.forEach(task => {
      (task.checklist || []).forEach(item => {
        if (item.done && item.doneAt && new Date(item.doneAt).getTime() > recentCutoff) {
          progressCards.push({
            type: "progress",
            task,
            checklistItem: item,
            key: `progress-${task.id}-${item.id}`,
            sortTime: new Date(item.doneAt).getTime(),
          });
        }
      });
    });

    const doneCards = doneTasks.map(task => ({
      type: "task",
      task,
      key: task.id,
      sortTime: task.completedAt ? new Date(task.completedAt).getTime() : 0,
    }));

    const combined = [...progressCards, ...doneCards].sort((a, b) => b.sortTime - a.sortTime);
    items.push(...combined);

    deletedTasks.forEach(task => items.push({ type: "task", task, key: task.id }));

    return items;
  }, [filteredTasks, viewStatus, currentUser, recentlyAdded, customLists]);

  // Pagination — z renderItems vytvoříme `visibleItems` omezený na prvních N tásk-items.
  // Sekce headery se zobrazí jen pokud následuje aspoň jeden viditelný task.
  // Done/deleted/progress karty se nepočítají do limitu — limit aplikujeme jen na aktivní úkoly,
  // aby uživatel měl vždy přehled o splněných/smazaných (jsou už pod aktivními).
  const { visibleItems, hiddenActiveCount, totalActiveCount } = useMemo(() => {
    let visibleTaskCount = 0;
    let totalActive = 0;
    // Spočítat celkové aktivní (pro porovnání s limit)
    for (const it of renderItems) {
      if (it.type === "task" && !isDone(it.task) && !isDeleted(it.task) && it.type !== "progress") {
        totalActive++;
      }
    }
    if (totalActive <= renderLimit) {
      return { visibleItems: renderItems, hiddenActiveCount: 0, totalActiveCount: totalActive };
    }
    // Filtrovat: do limit počítáme jen aktivní. Done/deleted/progress projdou vždy.
    const result = [];
    for (const it of renderItems) {
      const isActiveTask = it.type === "task" && !isDone(it.task) && !isDeleted(it.task);
      if (isActiveTask) {
        if (visibleTaskCount < renderLimit) {
          result.push(it);
          visibleTaskCount++;
        }
        // přes limit — skip
      } else {
        // sekce headery, dividery, progress, done, deleted — vždy
        result.push(it);
      }
    }
    return {
      visibleItems: result,
      hiddenActiveCount: totalActive - visibleTaskCount,
      totalActiveCount: totalActive,
    };
  }, [renderItems, renderLimit]);

  // Helper: apply all filters EXCEPT the one being computed for.
  // `skip` parameter: "scope" | "status" | "category" | "priority" — omits that filter from counting.
  const countTasks = useCallback((predicate, skip = []) => {
    if (!currentUser) return 0;
    return tasks.filter(t => {
      if (!predicate(t)) return false;
      // ═══ VISIBILITY FILTER (per-user privacy) ═══
      if (!currentUser.admin) {
        const isVisible = t.createdBy === currentUser.name ||
          (t.assignedTo && t.assignedTo.includes(currentUser.name));
        if (!isVisible) return false;
      }
      // Status filter (viewStatus) — skip if counting statuses
      if (!skip.includes("status")) {
        if (viewStatus === "today") {
          // Dnes = aktivní s dueDate=dnes + dnes splněné/smazané
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
          let pass = false;
          if (t.status === "done" && t.completedAt) {
            const cms = new Date(t.completedAt).getTime();
            pass = cms >= todayStart.getTime() && cms <= todayEnd.getTime();
          } else if (t.status === "deleted" && t.deletedAt) {
            const dms = new Date(t.deletedAt).getTime();
            pass = dms >= todayStart.getTime() && dms <= todayEnd.getTime();
          } else if (!isDone(t) && !isDeleted(t)) {
            if (t.dueDate) {
              const due = new Date(t.dueDate);
              pass = due >= todayStart && due <= todayEnd;
            }
          }
          if (!pass) return false;
        }
        else if (viewStatus === "active") {
          if (isDone(t) || isDeleted(t)) return false;
          if (t.showFrom && daysDiff(t.showFrom) > 0 && !showDeferred) return false;
        }
        else if (viewStatus === "in_progress" && (t.status !== "in_progress" || isDeleted(t))) return false;
        else if (viewStatus === "planned" && !(t.showFrom && daysDiff(t.showFrom) > 0 && !isDone(t) && !isDeleted(t))) return false;
        else if (viewStatus === "done" && t.status !== "done") return false;
        else if (viewStatus === "trash" && t.status !== "deleted") return false;
      }
      // Scope filter — skip if counting scopes
      if (!skip.includes("scope")) {
        if (filter === "my" && !t.assignedTo?.includes(currentUser.name)) return false;
        else if (filter === "for_me" && !(t.assignedTo?.includes(currentUser.name) && t.createdBy !== currentUser.name)) return false;
        else if (filter.startsWith("person:")) {
          const personName = filter.replace("person:", "");
          if (!t.assignedTo?.includes(personName)) return false;
        }
        else if (filter === "assigned" && !(t.createdBy === currentUser.name && !t.assignedTo?.every(a => a === currentUser.name))) return false;
        else if (filter === "shared" && t.assignTo !== "both") return false;
        else if (filter === "unread" && !(
          !t.seenBy?.includes(currentUser.name) &&
          t.createdBy !== currentUser.name &&
          t.assignedTo?.includes(currentUser.name)
        )) return false;
      }
      // Category filter — skip if counting categories
      if (!skip.includes("category")) {
        if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      }
      // Priority filter — skip if counting priorities
      if (!skip.includes("priority")) {
        if (priorityFilter !== "all" && (t.priority || "low") !== priorityFilter) return false;
      }
      // Tag filter — skip if counting tags
      if (!skip.includes("tag")) {
        if (tagFilter !== "all" && !detectTags(t.title).includes(tagFilter)) return false;
      }
      // Due date filter — skip if counting dueDates
      if (!skip.includes("dueDate")) {
        if (dueDateFilter !== "all" && !matchesDueDateFilter(t, dueDateFilter)) return false;
      }
      // Created-when filter
      if (!skip.includes("createdWhen") && createdWhenFilter !== "all") {
        if (!t.createdAt) return false;
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const createdMs = new Date(t.createdAt).getTime();
        const ageMs = now - createdMs;
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        if (createdWhenFilter === "today" && createdMs < todayStart.getTime()) return false;
        if (createdWhenFilter === "yesterday" && (createdMs < yesterdayStart.getTime() || createdMs >= todayStart.getTime())) return false;
        if (createdWhenFilter === "week" && ageMs > 7 * oneDay) return false;
        if (createdWhenFilter === "month" && ageMs > 30 * oneDay) return false;
        if (createdWhenFilter === "older" && ageMs <= 30 * oneDay) return false;
      }
      // Created-by filter
      if (!skip.includes("createdBy") && createdByFilter !== "all") {
        if (t.createdBy !== createdByFilter) return false;
      }
      return true;
    }).length;
  }, [tasks, currentUser, viewStatus, filter, categoryFilter, priorityFilter, tagFilter, showDeferred, createdWhenFilter, createdByFilter, dueDateFilter]);

  const stats = useMemo(() => {
    if (!currentUser) return {};
    return {
      // Scope counts — bez status filtru
      // Skip odložené (showFrom > dnes), jinak counter ukazuje "(2)" ale view je prázdné.
      my: countTasks(t => t.assignedTo?.includes(currentUser.name) && !isDone(t) && !isDeleted(t)
        && !(t.showFrom && daysDiff(t.showFrom) > 0 && !showDeferred), ["scope", "status"]),
      forMe: countTasks(t =>
        t.assignedTo?.includes(currentUser.name) && t.createdBy !== currentUser.name && !isDone(t) && !isDeleted(t)
        && !(t.showFrom && daysDiff(t.showFrom) > 0 && !showDeferred),
        ["scope", "status"]
      ),
      assigned: countTasks(t =>
        t.createdBy === currentUser.name && !t.assignedTo?.every(x => x === currentUser.name) && !isDone(t) && !isDeleted(t)
        && !(t.showFrom && daysDiff(t.showFrom) > 0 && !showDeferred),
        ["scope", "status"]
      ),
      shared: countTasks(t => t.assignTo === "both" && !isDone(t) && !isDeleted(t)
        && !(t.showFrom && daysDiff(t.showFrom) > 0 && !showDeferred), ["scope", "status"]),
      // "planned" count — status skipped, counts only deferred with all other filters
      planned: countTasks(t => t.showFrom && daysDiff(t.showFrom) > 0 && !isDone(t) && !isDeleted(t), ["status"]),
      // "done" count — status skipped
      done: countTasks(t => t.status === "done", ["status"]),
      // "trash" count
      trash: countTasks(t => t.status === "deleted", ["status"]),
      // "active" count (for viewStatus "Aktivní")
      active: countTasks(t => !isDone(t) && !isDeleted(t), ["status"]),
      // "in_progress" count
      in_progress: countTasks(t => t.status === "in_progress" && !isDeleted(t), ["status"]),
      // "today" count — úkoly s dueDate=dnes nebo dnes splněné/smazané
      today: countTasks(t => {
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
        if (t.status === "done" && t.completedAt) {
          const cms = new Date(t.completedAt).getTime();
          return cms >= todayStart.getTime() && cms <= todayEnd.getTime();
        }
        if (t.status === "deleted" && t.deletedAt) {
          const dms = new Date(t.deletedAt).getTime();
          return dms >= todayStart.getTime() && dms <= todayEnd.getTime();
        }
        if (!isDone(t) && !isDeleted(t) && t.dueDate) {
          const due = new Date(t.dueDate);
          return due >= todayStart && due <= todayEnd;
        }
        return false;
      }, ["status"]),
      // "all" count — všechny úkoly bez status filtru
      all: countTasks(() => true, ["status"]),
    };
  }, [currentUser, countTasks]);

  const categoryCounts = useMemo(() => {
    const counts = {};
    // "all" — total for current status+scope+priority (without category filter)
    counts.all = countTasks(() => true, ["category"]);
    CATEGORIES.forEach(cat => {
      counts[cat.id] = countTasks(t => t.category === cat.id, ["category"]);
    });
    return counts;
  }, [countTasks]);

  // Priority counts — for priority filter display
  const priorityCounts = useMemo(() => {
    return {
      all: countTasks(() => true, ["priority"]),
      urgent: countTasks(t => (t.priority || "low") === "urgent", ["priority"]),
      important: countTasks(t => (t.priority || "low") === "important", ["priority"]),
      low: countTasks(t => (t.priority || "low") === "low", ["priority"]),
    };
  }, [countTasks]);

  // Tag counts — kolik úkolů má daný tag (po aktuálních filtrech)
  const tagCounts = useMemo(() => {
    const counts = { all: countTasks(() => true, ["tag"]) };
    TAGS.forEach(tag => {
      counts[tag.id] = countTasks(t => detectTags(t.title).includes(tag.id), ["tag"]);
    });
    return counts;
  }, [countTasks]);

  // ── Render ──

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", background: "#0c1017",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#506880", fontFamily: FONT,
      }}>Načítám...</div>
    );
  }

  if (!users?.length) {
    return <SetupScreen onDone={async (user) => { await apiCreateUser(user); setUsers([user]); setCurrentUser(user); }} />;
  }

  if (!currentUser) {
    return <LoginScreen users={users} onLogin={setCurrentUser} themeName={themeName} />;
  }

  return (
    <div style={{
      // Layout: flex column = top část (header+input+filter) FIXED, bottom část scrollable.
      // Tím dosáhneme, že se scrolují jen úkoly, zbytek zůstává nehnutý.
      height: "100vh", background: theme.bg, fontFamily: FONT,
      color: theme.text, WebkitFontSmoothing: "antialiased",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Header — vždy viditelný, kompaktní výška (cca jako Focus tlačítko) ── */}
      <div ref={headerRef} style={{
        background: theme.headerBg, backdropFilter: "blur(20px)",
        borderBottom: `1px solid ${theme.cardBorder}`,
        padding: "2px 14px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
        zIndex: 30,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Focus mode trigger - vlevo */}
          <button onClick={() => setShowFocus(true)}
            title="Spustit Focus mode"
            style={{
              background: theme.accentSoft,
              border: `1px solid ${theme.accentBorder}`,
              borderRadius: "6px",
              padding: "3px 10px",
              color: theme.accent,
              cursor: "pointer",
              fontSize: "12px", fontWeight: 700,
              display: "inline-flex", alignItems: "center", gap: "4px",
            }}>
            🎯 Fokus
          </button>
          {!online && (
            <span style={{
              fontSize: "9px", background: theme.red, color: "#fff",
              padding: "2px 6px", borderRadius: "4px", fontWeight: 700,
            }}>OFFLINE{pendingCount > 0 ? ` (${pendingCount})` : ""}</span>
          )}
          {online && pendingCount > 0 && (
            <span style={{
              fontSize: "9px", background: theme.yellow, color: "#fff",
              padding: "2px 6px", borderRadius: "4px", fontWeight: 700,
            }}>{pendingCount}↑</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {/* Search ikona */}
          <button onClick={() => setShowSearchSheet(true)}
            title="Hledat"
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "16px", padding: "6px 8px",
              borderRadius: "6px",
            }}
            onMouseEnter={e => e.currentTarget.style.background = theme.inputBg}
            onMouseLeave={e => e.currentTarget.style.background = "none"}>
            🔍
          </button>
          {/* Stats ikona */}
          <button onClick={() => setShowStatsSheet(true)}
            title="Statistiky"
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "16px", padding: "6px 8px",
              borderRadius: "6px",
            }}
            onMouseEnter={e => e.currentTarget.style.background = theme.inputBg}
            onMouseLeave={e => e.currentTarget.style.background = "none"}>
            📊
          </button>
          {/* Notifications - jen badge když existují */}
          <button onClick={() => setUpdatesPanelOpen(true)}
            title="Zprávy"
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "16px", padding: "6px 8px",
              borderRadius: "6px", position: "relative",
            }}
            onMouseEnter={e => e.currentTarget.style.background = theme.inputBg}
            onMouseLeave={e => e.currentTarget.style.background = "none"}>
            🔔
            {(() => {
              const unseenCount = comments.filter(c =>
                c.author !== currentUser.name &&
                !c.seenBy?.includes(currentUser.name) &&
                tasks.find(t => t.id === c.taskId &&
                  (t.createdBy === currentUser.name || t.assignedTo?.includes(currentUser.name)))
              ).length;
              const noteCount = tasks.reduce((sum, t) => {
                if (isDeleted(t)) return sum;
                if (t.createdBy !== currentUser.name && !t.assignedTo?.includes(currentUser.name)) return sum;
                return sum + (t.checklist || []).reduce((s, item) =>
                  s + (item.notes || []).filter(n =>
                    n.author !== currentUser.name && !n.seenBy?.includes(currentUser.name)
                  ).length, 0);
              }, 0);
              const total = unseenCount + noteCount;
              if (total === 0) return null;
              return (
                <span style={{
                  position: "absolute", top: "1px", right: "1px",
                  background: theme.red, color: "#fff",
                  borderRadius: "8px", padding: "1px 4px",
                  fontSize: "9px", fontWeight: 800,
                  minWidth: "14px", textAlign: "center",
                  border: "2px solid var(--bg-card, #fff)",
                }}>{total}</span>
              );
            })()}
          </button>
          {/* User menu trigger */}
          <button onClick={() => setShowUserMenu(s => !s)}
            title="Uživatel"
            style={{
              fontSize: "12px", fontWeight: 600, color: theme.text,
              padding: "5px 10px", background: theme.accentSoft,
              border: `1px solid ${theme.accentBorder}`, borderRadius: "6px",
              cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: "4px",
            }}>
            {currentUser.name}
            <span style={{ fontSize: "9px" }}>▾</span>
          </button>
        </div>
      </div>

      {/* User menu dropdown */}
      {showUserMenu && (
        <>
          <div onClick={() => setShowUserMenu(false)} style={{
            position: "fixed", inset: 0, background: "transparent", zIndex: 99,
          }} />
          <div style={{
            position: "fixed", top: "55px", right: "12px", zIndex: 100,
            background: theme.card,
            border: `1px solid ${theme.cardBorder}`,
            borderRadius: "8px",
            padding: "6px",
            minWidth: "180px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            display: "flex", flexDirection: "column", gap: "2px",
          }}>
            <button onClick={() => { setThemeName(themeName === "dark" ? "light" : "dark"); setShowUserMenu(false); }}
              style={{
                ...buttonStyle(), padding: "8px 12px", fontSize: "12px",
                background: "transparent", color: theme.text, border: "none",
                textAlign: "left", display: "flex", alignItems: "center", gap: "8px",
              }}
              onMouseEnter={e => e.currentTarget.style.background = theme.inputBg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span>{themeName === "dark" ? "☀️" : "🌙"}</span>
              <span>{themeName === "dark" ? "Světlý režim" : "Tmavý režim"}</span>
            </button>
            <button onClick={() => { enterBulkMode(null); setShowUserMenu(false); }}
              style={{
                ...buttonStyle(), padding: "8px 12px", fontSize: "12px",
                background: "transparent", color: theme.text, border: "none",
                textAlign: "left", display: "flex", alignItems: "center", gap: "8px",
              }}
              onMouseEnter={e => e.currentTarget.style.background = theme.inputBg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span>☑️</span><span>Hromadný výběr</span>
            </button>
            <button onClick={() => { setShowNotifPanel(true); setShowUserMenu(false); }}
              style={{
                ...buttonStyle(), padding: "8px 12px", fontSize: "12px",
                background: "transparent", color: theme.text, border: "none",
                textAlign: "left", display: "flex", alignItems: "center", gap: "8px",
              }}
              onMouseEnter={e => e.currentTarget.style.background = theme.inputBg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span>⚙️</span><span>Nastavení notifikací</span>
            </button>
            {currentUser.admin && (
              <button onClick={() => { setShowAdmin(true); setShowUserMenu(false); }}
                style={{
                  ...buttonStyle(), padding: "8px 12px", fontSize: "12px",
                  background: "transparent", color: theme.text, border: "none",
                  textAlign: "left", display: "flex", alignItems: "center", gap: "8px",
                }}
                onMouseEnter={e => e.currentTarget.style.background = theme.inputBg}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span>👥</span><span>Správa uživatelů</span>
              </button>
            )}
            <div style={{ height: "1px", background: theme.cardBorder, margin: "4px 0" }} />
            <button onClick={() => { setCurrentUser(null); setShowUserMenu(false); }}
              style={{
                ...buttonStyle(), padding: "8px 12px", fontSize: "12px",
                background: "transparent", color: theme.red, border: "none",
                textAlign: "left", display: "flex", alignItems: "center", gap: "8px",
              }}
              onMouseEnter={e => e.currentTarget.style.background = `${theme.red}10`}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span>⏻</span><span>Odhlásit se</span>
            </button>
            <div style={{
              padding: "10px 12px 6px", fontSize: "11px", color: theme.textSub,
              borderTop: `1px solid ${theme.cardBorder}`, marginTop: "4px",
              textAlign: "center", lineHeight: 1.4, fontWeight: 500,
            }}>
              © {new Date().getFullYear()} Michal Bělohlav<br/>
              Rodinné úkoly · v{APP_VERSION}
            </div>
          </div>
        </>
      )}

      {/* ── Top container (non-scrollable) — header + input + filter ── */}
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "0 12px", width: "100%", flexShrink: 0 }}>

        {showAdmin && currentUser.admin && (
          <AdminPanel
            users={users}
            tasks={tasks}
            comments={comments}
            currentUser={currentUser}
            onAdd={async u => apiCreateUser(u)}
            onRemove={async (name, options) => {
              // options = { action: "transfer_me" | "transfer_other" | "delete", transferTo: string|null }
              const { action, transferTo } = options || { action: "transfer_me", transferTo: currentUser.name };

              if (action === "delete") {
                // Smazat všechny úkoly tohoto uživatele (kde je autor) a všechny komentáře
                const tasksToDelete = tasks.filter(t => t.createdBy === name).map(t => t.id);
                const commentsToDelete = comments.filter(c => c.author === name).map(c => c.id);
                // Sequential delete (bezpečně)
                for (const id of tasksToDelete) {
                  try {
                    const { error } = await supabase.from("tasks").delete().eq("id", id);
                    if (error) throw error;
                  } catch (e) {
                    if (!isNetworkError(e)) logServerError("deleteUser:task", e, { id });
                  }
                }
                for (const id of commentsToDelete) {
                  try {
                    const { error } = await supabase.from("task_comments").delete().eq("id", id);
                    if (error) throw error;
                  } catch (e) {
                    if (!isNetworkError(e)) logServerError("deleteUser:comment", e, { id });
                  }
                }
                // Také odebrat ze všech assigned_to polí (kde uživatel byl spolupracovník)
                const tasksWithAssign = tasks.filter(t => t.assignedTo?.includes(name) && t.createdBy !== name);
                for (const t of tasksWithAssign) {
                  const newAssigned = t.assignedTo.filter(n => n !== name);
                  await apiUpdateTask({ ...t, assignedTo: newAssigned });
                }
                // Refresh local stav
                setTasks(prev => prev.filter(t => !tasksToDelete.includes(t.id)).map(t => {
                  if (t.assignedTo?.includes(name)) {
                    return { ...t, assignedTo: t.assignedTo.filter(n => n !== name) };
                  }
                  return t;
                }));
                setComments(prev => prev.filter(c => !commentsToDelete.includes(c.id)));
              } else {
                // Transfer mode — přesměrovat všechno na transferTo
                if (!transferTo) return;
                // 1) Úkoly kde byl autorem → změnit created_by
                const tasksAsAuthor = tasks.filter(t => t.createdBy === name);
                for (const t of tasksAsAuthor) {
                  const updated = { ...t, createdBy: transferTo };
                  // assignedTo: pokud obsahoval mazaného, nahradit transferTo
                  if (t.assignedTo?.includes(name)) {
                    const newAssigned = [...new Set(t.assignedTo.map(n => n === name ? transferTo : n))];
                    updated.assignedTo = newAssigned;
                  }
                  await apiUpdateTask(updated);
                }
                // 2) Úkoly kde byl jen v assigned_to → odebrat ho a přidat transferTo (pokud tam ještě není)
                const tasksAssignedOnly = tasks.filter(t => t.createdBy !== name && t.assignedTo?.includes(name));
                for (const t of tasksAssignedOnly) {
                  const newAssigned = [...new Set(t.assignedTo.map(n => n === name ? transferTo : n))];
                  await apiUpdateTask({ ...t, assignedTo: newAssigned });
                }
                // 3) Komentáře → změnit author
                const userComments = comments.filter(c => c.author === name);
                for (const c of userComments) {
                  await apiUpdateComment({ ...c, author: transferTo });
                }
                // Refresh local stav
                setTasks(prev => prev.map(t => {
                  let updated = t;
                  if (t.createdBy === name) updated = { ...updated, createdBy: transferTo };
                  if (t.assignedTo?.includes(name)) {
                    const newAssigned = [...new Set(t.assignedTo.map(n => n === name ? transferTo : n))];
                    updated = { ...updated, assignedTo: newAssigned };
                  }
                  return updated;
                }));
                setComments(prev => prev.map(c =>
                  c.author === name ? { ...c, author: transferTo } : c
                ));
              }

              // Po dokončení převodu/smazání: smazat samotného uživatele
              await apiDeleteUser(name);
              setUsers(prev => prev.filter(u => u.name !== name));
            }}
            onResetPin={async (name, newPin) => {
              const ok = await apiUpdateUserPin(name, newPin);
              if (ok) {
                // Update local state
                setUsers(prev => prev.map(u => u.name === name ? { ...u, pin: newPin } : u));
              }
              return ok;
            }}
            onClose={() => setShowAdmin(false)}
            theme={theme}
          />
        )}

        {showNotifPanel && (
          <NotificationPanel
            currentUser={currentUser}
            onClose={() => setShowNotifPanel(false)}
            theme={theme}
          />
        )}

        {showStatsSheet && (
          <StatsSheet
            tasks={tasks}
            currentUser={currentUser}
            users={users}
            theme={theme}
            onClose={() => setShowStatsSheet(false)}
          />
        )}

        {showCalendar && (
          <CalendarSheet
            tasks={tasks}
            currentUser={currentUser}
            theme={theme}
            onClose={() => setShowCalendar(false)}
            onNavigate={(taskId) => {
              const t = tasks.find(x => x.id === taskId);
              if (t) {
                if (isDeleted(t)) setViewStatus("trash");
                else if (t.status === "done") setViewStatus("done");
                else setViewStatus("active");
                // ZACHOVAT scope filter (moje/...) — privacy
                setCategoryFilter("all");
                setPriorityFilter("all");
                setTagFilter("all");
                setDueDateFilter("all");
              }
              setScrollToTaskId(taskId);
              setHighlightedTaskId(taskId);
            }}
          />
        )}

        {showSearchSheet && (
          <SearchSheet
            tasks={tasks}
            comments={comments}
            currentUser={currentUser}
            customLists={customLists}
            theme={theme}
            onClose={() => setShowSearchSheet(false)}
            onNavigate={(taskId) => {
              // Pokud je úkol v jiném view než aktuální, přepneme
              const t = tasks.find(x => x.id === taskId);
              if (t) {
                if (isDeleted(t)) setViewStatus("trash");
                else if (t.status === "done") setViewStatus("done");
                else if (t.showFrom && daysDiff(t.showFrom) > 0) setViewStatus("planned");
                else setViewStatus("active");
                // Inteligentně nastavit scope
                const isMine = t.assignedTo?.includes(currentUser.name) || t.createdBy === currentUser.name;
                if (isMine) {
                  setFilter("my");
                } else if (currentUser.admin) {
                  setFilter("all");
                }
                setCategoryFilter("all");
                setPriorityFilter("all");
                setTagFilter("all");
                setCreatedWhenFilter("all");
                setCreatedByFilter("all");
                setDueDateFilter("all");
              }
              setScrollToTaskId(taskId);
              setHighlightedTaskId(taskId);
            }}
          />
        )}

        {showMoreFilters && (
          <MoreFiltersSheet
            theme={theme}
            users={users}
            currentUser={currentUser}
            customLists={customLists}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            tagFilter={tagFilter}
            onTagFilterChange={setTagFilter}
            tagCounts={tagCounts}
            dueDateFilter={dueDateFilter}
            onDueDateFilterChange={setDueDateFilter}
            createdWhenFilter={createdWhenFilter}
            onCreatedWhenFilterChange={setCreatedWhenFilter}
            createdByFilter={createdByFilter}
            onCreatedByFilterChange={setCreatedByFilter}
            onCreateList={() => setShowCreateList(true)}
            onEditList={(list) => setEditingList(list)}
            onClose={() => setShowMoreFilters(false)}
          />
        )}

        {(showCreateList || editingList) && (
          <CreateListModal
            theme={theme}
            currentUser={currentUser}
            editingList={editingList}
            allLists={customLists}
            tasksInList={editingList ? tasks.filter(t => t.category === `list:${editingList.id}`).length : 0}
            onClose={() => { setShowCreateList(false); setEditingList(null); }}
            onCreate={(newList) => setCustomLists(prev => [...prev, newList])}
            onUpdate={(updated) => setCustomLists(prev => prev.map(l => l.id === updated.id ? updated : l))}
            onDelete={(deletedId) => setCustomLists(prev => prev.filter(l => l.id !== deletedId))}
            onDeleteListAndTasks={async (listId) => {
              // Smaž úkoly v daném seznamu
              const idsToDelete = tasks.filter(t => t.category === `list:${listId}`).map(t => t.id);
              for (const id of idsToDelete) {
                await supabase.from("tasks").delete().eq("id", id);
              }
              setTasks(prev => prev.filter(t => t.category !== `list:${listId}`));
            }}
            onMoveTasksToList={async (fromListId, toListId) => {
              const newCategory = `list:${toListId}`;
              const idsToMove = tasks.filter(t => t.category === `list:${fromListId}`).map(t => t.id);
              for (const id of idsToMove) {
                await supabase.from("tasks").update({ category: newCategory }).eq("id", id);
              }
              setTasks(prev => prev.map(t =>
                t.category === `list:${fromListId}` ? { ...t, category: newCategory } : t
              ));
            }}
          />
        )}

        {/* Focus mode — fullscreen overlay */}
        {showFocus && (
          <FocusMode
            tasks={tasks}
            currentUser={currentUser}
            users={users}
            comments={comments}
            theme={theme}
            initialTaskId={focusInitialTask}
            onClose={(allDone) => {
              setShowFocus(false);
              setFocusInitialTask(null); // reset for next time
              if (allDone) {
                setFocusSummaryAfter(Date.now());
                setTimeout(() => setFocusSummaryAfter(null), 5000);
              }
            }}
            onUpdate={updateTask}
            onStatusChange={changeStatus}
            onAddComment={addComment}
            onToggleReaction={toggleReaction}
          />
        )}

        {/* Summary banner after focus ends with all done */}
        {focusSummaryAfter && (
          <div style={{
            position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
            background: theme.green, color: "#fff",
            padding: "12px 20px", borderRadius: "10px",
            fontSize: "13px", fontWeight: 700,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            zIndex: 1000,
          }}>
            🎉 Focus session dokončena!
          </div>
        )}

        <UpdatesPanel
          comments={comments}
          tasks={tasks}
          currentUser={currentUser}
          users={users}
          open={updatesPanelOpen}
          onToggle={() => setUpdatesPanelOpen(o => !o)}
          onNavigate={(taskId) => {
            const t = tasks.find(x => x.id === taskId);
            if (t) {
              if (isDeleted(t)) setViewStatus("trash");
              else if (t.status === "done") setViewStatus("done");
              else if (t.showFrom && daysDiff(t.showFrom) > 0) setViewStatus("planned");
              else setViewStatus("active");
              // Inteligentně nastavit scope tak aby úkol byl vidět
              const isMine = t.assignedTo?.includes(currentUser.name) || t.createdBy === currentUser.name;
              if (isMine) {
                setFilter("my");
              } else {
                // Úkol není ve scope "my" → admin pohled, zachovat aktuální nebo "all"
                if (currentUser.admin) setFilter("all");
              }
              // Reset ostatních filtrů aby úkol byl vidět
              setCategoryFilter("all");
              setPriorityFilter("all");
              setTagFilter("all");
              setDueDateFilter("all");
            }
            setScrollToTaskId(taskId);
            setHighlightedTaskId(taskId);
            setUpdatesPanelOpen(false);
          }}
          onMarkSeen={markCommentsSeen}
          onMarkItemNoteSeen={markItemNoteSeen}
          onQuickReply={(taskId, text) => addComment(taskId, text)}
          theme={theme}
        />

        <div ref={stickyWrapperRef} style={{
          // Input + filter řádek — v Top containeru, tedy nikdy se nescrolluje.
          background: theme.bg,
          paddingTop: "0px",
          paddingBottom: "4px",
        }}>
          <QuickAddBar
            currentUser={currentUser}
            users={users}
            onAdd={addTask}
            theme={theme}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            categoryCounts={categoryCounts}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            scopeFilter={filter}
            onScopeFilterChange={setFilter}
            showDeferred={showDeferred}
            onShowDeferredChange={setShowDeferred}
            tagFilter={tagFilter}
            onTagFilterChange={setTagFilter}
            tagCounts={tagCounts}
            allTasks={tasks}
            customLists={customLists}
            onCreateList={() => setShowCreateList(true)}
            onEditList={(list) => setEditingList(list)}
            dueDateFilter={dueDateFilter}
            onDueDateFilterChange={setDueDateFilter}
            viewStatus={viewStatus}
            onTypingChange={setIsTypingMode}
          />

          {/* App-level filter bar — pouze v filter mode (v typing mode má QuickAddBar svůj TypingFilterRow) */}
          {!isTypingMode && (() => {
            // Sdílená proměnná pro ikony i popover (musí být v jednom scope kvůli TDZ)
            const visibleListsForFilter = (customLists || []).filter(l =>
              l.is_shared || l.created_by_user === currentUser.name);
            return (
          <>
          {/* Kompaktní ikonový filter row.
              Sticky pozicování řeší celý wrapper okolo (sticky top: 56px nebo 0px). */}
          <div style={{
            position: "relative",
            paddingTop: "4px",
            paddingBottom: "4px",
          }} data-filter-icon-row>
            <div style={{
              display: "flex", alignItems: "stretch", gap: "4px",
            }}>
              {(() => {
                // Helper IconBtn s aktivním stavem a klikem
                const IconBtn = ({ icon, color, isActive, onClick, title, popoverKey }) => (
                  <button type="button" onClick={onClick} title={title}
                    style={{
                      flex: 1, height: "35px",
                      background: isActive ? `${color}15` : theme.inputBg,
                      color: isActive ? color : theme.textMid,
                      border: `1.5px solid ${isActive ? color : theme.inputBorder}`,
                      borderRadius: "10px",
                      fontSize: "16px", fontWeight: 700,
                      cursor: "pointer", fontFamily: FONT,
                      boxShadow: isActive ? `0 1px 4px ${color}25` : "none",
                      transition: "all 0.15s",
                    }}>
                    {icon}
                  </button>
                );

                // Status icon výběr
                const statusIcons = {
                  today: "🎯", active: "📋", in_progress: "🔥",
                  planned: "⏰", done: "✓", trash: "🗑", all: "🌐",
                };
                const statusIcon = statusIcons[viewStatus] || "📋";
                const statusActive = viewStatus !== "active";

                // Scope icon
                const scopeIcons = { my: "👤", for_me: "📥", assigned: "📤",
                                     shared: "👥", unread: "🔴", all: "📋" };
                let scopeIcon = scopeIcons[filter] || "👤";
                if (filter && filter.startsWith("person:")) scopeIcon = "👤";
                const scopeActive = filter !== "my";

                // Date icon
                let dateIcon = "📅";
                if (dueDateFilter === "today") dateIcon = "🎯";
                else if (dueDateFilter && dueDateFilter.startsWith("range:")) dateIcon = "📆";
                const dateActive = dueDateFilter !== "all";

                // List icon
                let listIcon = "📁";
                if (categoryFilter.startsWith("list:")) {
                  const list = visibleListsForFilter.find(l => `list:${l.id}` === categoryFilter);
                  if (list) listIcon = list.emoji || "📁";
                } else if (categoryFilter !== "all") {
                  const cat = CATEGORIES.find(c => c.id === categoryFilter);
                  if (cat) listIcon = cat.icon;
                }
                const listActive = categoryFilter !== "all";

                // Priority
                const isImp = priorityFilter === "important";
                const isUrg = priorityFilter === "urgent";
                const priColor = isUrg ? "#ef4444" : isImp ? "#f59e0b" : theme.textMid;
                const priIcon = isUrg ? "‼" : "!";
                const priActive = isImp || isUrg;

                // More filters
                const hasMore = tagFilter !== "all" ||
                  createdWhenFilter !== "all" || createdByFilter !== "all";

                return (
                  <>
                    <IconBtn icon={statusIcon} color={theme.accent}
                      isActive={statusActive}
                      title="Status úkolu"
                      onClick={() => setFilterPopover(filterPopover === "status" ? null : "status")} />
                    <IconBtn icon={scopeIcon} color={theme.accent}
                      isActive={scopeActive}
                      title="Pro koho je úkol"
                      onClick={() => setFilterPopover(filterPopover === "scope" ? null : "scope")} />
                    <IconBtn
                      icon={(() => {
                        // Dynamická ikona podle aktuálního sortu — uživatel hned vidí aktivní směr
                        if (sortMode === "smart") return "🎯";
                        if (sortMode === "priority") return "❗";
                        if (sortMode === "date" || sortMode === "date_asc") return "📅↑";
                        if (sortMode === "date_desc") return "📅↓";
                        if (sortMode === "alpha_asc") return "A↓";
                        if (sortMode === "alpha_desc") return "Z↓";
                        if (sortMode === "created_asc") return "🆕↑";
                        return "🆕↓"; // created / created_desc
                      })()}
                      color={theme.accent}
                      isActive={sortMode !== "created"}
                      title={`Řazení (aktuálně: ${sortMode})`}
                      onClick={() => setFilterPopover(filterPopover === "sort" ? null : "sort")} />
                    <IconBtn icon={dateIcon} color={theme.accent}
                      isActive={dateActive}
                      title="Termín splnění"
                      onClick={() => setFilterPopover(filterPopover === "date" ? null : "date")} />
                    <IconBtn icon={listIcon} color={theme.accent}
                      isActive={listActive}
                      title="Seznam"
                      onClick={() => setFilterPopover(filterPopover === "list" ? null : "list")} />
                    <button type="button" onClick={() => {
                        if (priorityFilter === "all" || priorityFilter === "low") setPriorityFilter("important");
                        else if (priorityFilter === "important") setPriorityFilter("urgent");
                        else setPriorityFilter("all");
                      }}
                      title="Priorita"
                      style={{
                        flex: 1, height: "35px",
                        background: priActive ? `${priColor}15` : theme.inputBg,
                        color: priColor, fontSize: "18px", fontWeight: 800,
                        border: `1.5px solid ${priActive ? priColor : theme.inputBorder}`,
                        borderRadius: "10px",
                        cursor: "pointer", fontFamily: FONT,
                        boxShadow: priActive ? `0 1px 4px ${priColor}25` : "none",
                      }}>
                      {priIcon}
                    </button>
                    <button onClick={() => setShowMoreFilters(true)}
                      title="Více filtrů"
                      style={{
                        flex: 1, height: "35px",
                        background: hasMore ? `${theme.accent}15` : theme.inputBg,
                        color: hasMore ? theme.accent : theme.textMid,
                        fontSize: "18px", fontWeight: 800,
                        border: `1.5px solid ${hasMore ? theme.accent : theme.inputBorder}`,
                        borderRadius: "10px", cursor: "pointer", fontFamily: FONT,
                      }}>
                      ⋯
                    </button>
                  </>
                );
              })()}
            </div>

            {/* Popovery — širší, s nadpisem */}
            {filterPopover && (() => {
              const popoverWrap = {
                position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                background: theme.bg,
                border: `1px solid ${theme.cardBorder}`,
                borderRadius: "12px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                padding: "12px",
                zIndex: 50,
                animation: "slideUp 0.15s",
                maxHeight: "60vh", overflowY: "auto",
              };
              const popHeader = {
                fontSize: "11px", fontWeight: 800, color: theme.textMid,
                textTransform: "uppercase", letterSpacing: "0.4px",
                marginBottom: "10px",
                paddingBottom: "8px",
                borderBottom: `1px solid ${theme.cardBorder}`,
              };
              const optStyle = (isSel, color = theme.accent) => ({
                ...buttonStyle(),
                width: "100%",
                padding: "10px 12px", fontSize: "13px", fontWeight: 600,
                background: isSel ? `${color}20` : "transparent",
                color: isSel ? color : theme.text,
                border: "none", textAlign: "left", borderRadius: "8px",
                display: "flex", alignItems: "center", gap: "10px",
                marginBottom: "2px",
              });

              if (filterPopover === "status") {
                const opts = [
                  { value: "today",       icon: "🎯", label: "Dnes" },
                  { value: "active",      icon: "📋", label: "Aktivní" },
                  { value: "in_progress", icon: "🔥", label: "Rozpracované" },
                  { value: "planned",     icon: "⏰", label: "Plánované" },
                  { value: "done",        icon: "✓",  label: "Splněné" },
                  { value: "trash",       icon: "🗑", label: "Koš" },
                  { value: "all",         icon: "🌐", label: "Vše" },
                ];
                return (
                  <div style={popoverWrap} data-filter-popover onClick={e => e.stopPropagation()}>
                    <div style={popHeader}>📋 Status úkolu</div>
                    {opts.map(o => {
                      const isSel = viewStatus === o.value;
                      const cnt = stats[o.value === "active" ? "active" : o.value] || 0;
                      return (
                        <button key={o.value} type="button"
                          onClick={() => { setViewStatus(o.value); setFilterPopover(null); }}
                          style={optStyle(isSel)}>
                          <span style={{ width: "20px", fontSize: "16px" }}>{o.icon}</span>
                          <span style={{ flex: 1 }}>{o.label}</span>
                          <span style={{ fontSize: "11px", color: theme.textSub, fontWeight: 500 }}>{cnt}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              }

              if (filterPopover === "scope") {
                return (
                  <div style={popoverWrap} data-filter-popover onClick={e => e.stopPropagation()}>
                    <div style={popHeader}>👤 Pro koho je úkol</div>
                    <button type="button" onClick={() => { setFilter("my"); setFilterPopover(null); }}
                      style={optStyle(filter === "my")}>
                      <span style={{ width: "20px", fontSize: "16px" }}>👤</span>
                      <span style={{ flex: 1 }}>Moje</span>
                      <span style={{ fontSize: "11px", color: theme.textSub, fontWeight: 500 }}>{stats.my}</span>
                    </button>
                    <button type="button" onClick={() => { setFilter("for_me"); setFilterPopover(null); }}
                      style={optStyle(filter === "for_me")}>
                      <span style={{ width: "20px", fontSize: "16px" }}>📥</span>
                      <span style={{ flex: 1 }}>Pro mě (od ostatních)</span>
                      <span style={{ fontSize: "11px", color: theme.textSub, fontWeight: 500 }}>{stats.forMe || 0}</span>
                    </button>
                    {users.filter(u => u.name !== currentUser.name).map(u => (
                      <button key={u.name} type="button"
                        onClick={() => { setFilter(`person:${u.name}`); setFilterPopover(null); }}
                        style={optStyle(filter === `person:${u.name}`)}>
                        <span style={{ width: "20px", fontSize: "16px" }}>👤</span>
                        <span style={{ flex: 1 }}>{u.name}</span>
                      </button>
                    ))}
                    <button type="button" onClick={() => { setFilter("assigned"); setFilterPopover(null); }}
                      style={optStyle(filter === "assigned")}>
                      <span style={{ width: "20px", fontSize: "16px" }}>📤</span>
                      <span style={{ flex: 1 }}>Zadané (od mě)</span>
                      <span style={{ fontSize: "11px", color: theme.textSub, fontWeight: 500 }}>{stats.assigned}</span>
                    </button>
                    <button type="button" onClick={() => { setFilter("shared"); setFilterPopover(null); }}
                      style={optStyle(filter === "shared")}>
                      <span style={{ width: "20px", fontSize: "16px" }}>👥</span>
                      <span style={{ flex: 1 }}>Společné</span>
                      <span style={{ fontSize: "11px", color: theme.textSub, fontWeight: 500 }}>{stats.shared}</span>
                    </button>
                    <button type="button" onClick={() => { setFilter("unread"); setFilterPopover(null); }}
                      style={optStyle(filter === "unread")}>
                      <span style={{ width: "20px", fontSize: "16px" }}>🔴</span>
                      <span style={{ flex: 1 }}>Nové</span>
                      <span style={{ fontSize: "11px", color: theme.textSub, fontWeight: 500 }}>{unreadCounts[currentUser.name] || 0}</span>
                    </button>
                    <button type="button" onClick={() => { setFilter("all"); setFilterPopover(null); }}
                      style={optStyle(filter === "all")}>
                      <span style={{ width: "20px", fontSize: "16px" }}>📋</span>
                      <span style={{ flex: 1 }}>Vše</span>
                    </button>
                  </div>
                );
              }

              if (filterPopover === "sort") {
                const opts = [
                  { value: "smart",        icon: "🎯", label: "Chytré řazení" },
                  { value: "priority",     icon: "❗", label: "Podle priority" },
                  { value: "date_asc",     icon: "📅", label: "Termín — nejbližší první", arrow: "↑" },
                  { value: "date_desc",    icon: "📅", label: "Termín — nejvzdálenější první", arrow: "↓" },
                  { value: "created_desc", icon: "🆕", label: "Vytvořeno — nejnovější první", arrow: "↓" },
                  { value: "created_asc",  icon: "🆕", label: "Vytvořeno — nejstarší první", arrow: "↑" },
                  { value: "alpha_asc",    icon: "🔤", label: "Abecedně A → Z", arrow: "↓" },
                  { value: "alpha_desc",   icon: "🔤", label: "Abecedně Z → A", arrow: "↑" },
                ];
                // Zachovat zpětnou kompatibilitu s legacy hodnotami
                const isActive = (v) => {
                  if (sortMode === v) return true;
                  if (sortMode === "created" && v === "created_desc") return true;
                  if (sortMode === "date" && v === "date_asc") return true;
                  return false;
                };
                return (
                  <div style={popoverWrap} data-filter-popover onClick={e => e.stopPropagation()}>
                    <div style={popHeader}>↕ Řazení</div>
                    {opts.map(o => (
                      <button key={o.value} type="button"
                        onClick={() => { setSortMode(o.value); setFilterPopover(null); }}
                        style={optStyle(isActive(o.value))}>
                        <span style={{ width: "20px", fontSize: "14px" }}>{o.icon}</span>
                        <span style={{ flex: 1 }}>{o.label}</span>
                        {o.arrow && (
                          <span style={{ fontSize: "16px", color: theme.textSub, fontWeight: 700 }}>
                            {o.arrow}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              }

              if (filterPopover === "date") {
                const opts = [
                  { value: "all",       icon: "📅", label: "Všechna data" },
                  { value: "today",     icon: "🎯", label: "Dnes" },
                  { value: "week",      icon: "📅", label: "Tento týden" },
                  { value: "next_week", icon: "📅", label: "Příští týden" },
                  { value: "month",     icon: "📅", label: "Tento měsíc" },
                ];
                const isRange = dueDateFilter && dueDateFilter.startsWith("range:");
                const [rangeFrom, rangeTo] = isRange ? dueDateFilter.slice(6).split(",") : ["", ""];
                return (
                  <div style={popoverWrap} data-filter-popover onClick={e => e.stopPropagation()}>
                    <div style={popHeader}>📅 Termín splnění</div>
                    {opts.map(o => (
                      <button key={o.value} type="button"
                        onClick={() => { setDueDateFilter(o.value); setFilterPopover(null); }}
                        style={optStyle(dueDateFilter === o.value)}>
                        <span style={{ width: "20px", fontSize: "16px" }}>{o.icon}</span>
                        <span style={{ flex: 1 }}>{o.label}</span>
                      </button>
                    ))}
                    {/* Vlastní rozsah */}
                    <div style={{
                      marginTop: "8px", paddingTop: "8px",
                      borderTop: `1px solid ${theme.cardBorder}`,
                    }}>
                      <div style={{
                        fontSize: "10px", fontWeight: 700, color: theme.textMid,
                        textTransform: "uppercase", marginBottom: "5px",
                      }}>📆 Vlastní rozsah</div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <input type="date" value={rangeFrom}
                          onChange={(e) => {
                            const f = e.target.value;
                            if (f) setDueDateFilter(`range:${f},${rangeTo || f}`);
                          }}
                          style={{ ...inputStyle(theme), padding: "5px 8px", fontSize: "11px", flex: 1 }} />
                        <span style={{ fontSize: "11px" }}>→</span>
                        <input type="date" value={rangeTo}
                          onChange={(e) => {
                            const t = e.target.value;
                            if (t) setDueDateFilter(`range:${rangeFrom || t},${t}`);
                          }}
                          style={{ ...inputStyle(theme), padding: "5px 8px", fontSize: "11px", flex: 1 }} />
                      </div>
                    </div>
                  </div>
                );
              }

              if (filterPopover === "list") {
                return (
                  <div style={popoverWrap} data-filter-popover onClick={e => e.stopPropagation()}>
                    <div style={popHeader}>📁 Seznam</div>
                    <button type="button" onClick={() => { setCategoryFilter("all"); setFilterPopover(null); }}
                      style={optStyle(categoryFilter === "all")}>
                      <span style={{ width: "20px", fontSize: "16px" }}>📋</span>
                      <span style={{ flex: 1 }}>Všechny</span>
                    </button>
                    {/* Předdefinované kategorie */}
                    {CATEGORIES.map(cat => (
                      <button key={cat.id} type="button"
                        onClick={() => { setCategoryFilter(cat.id); setFilterPopover(null); }}
                        style={optStyle(categoryFilter === cat.id)}>
                        <span style={{ width: "20px", fontSize: "16px" }}>{cat.icon}</span>
                        <span style={{ flex: 1 }}>{cat.label}</span>
                      </button>
                    ))}
                    {/* Vlastní seznamy */}
                    {visibleListsForFilter.length > 0 && (
                      <div style={{
                        margin: "8px 0 4px",
                        paddingTop: "6px",
                        borderTop: `1px solid ${theme.cardBorder}`,
                        fontSize: "9px", fontWeight: 800, color: theme.textMid,
                        textTransform: "uppercase", letterSpacing: "0.4px",
                      }}>Vlastní seznamy</div>
                    )}
                    {visibleListsForFilter.map(list => (
                      <button key={list.id} type="button"
                        onClick={() => { setCategoryFilter(`list:${list.id}`); setFilterPopover(null); }}
                        style={optStyle(categoryFilter === `list:${list.id}`, list.color)}>
                        <span style={{ width: "20px", fontSize: "16px" }}>{list.emoji || "📁"}</span>
                        <span style={{ flex: 1 }}>{list.name}</span>
                      </button>
                    ))}
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Vybrané filtry — vlastní sekce s nadpisem */}
          {(() => {
            const activeChips = [];
            if (categoryFilter !== "all") {
              if (categoryFilter.startsWith("list:")) {
                const list = (customLists || []).find(l => `list:${l.id}` === categoryFilter);
                if (list) {
                  activeChips.push({
                    key: "cat", label: `${list.emoji || "📁"} ${list.name}`,
                    color: list.color, onRemove: () => setCategoryFilter("all"),
                  });
                }
              } else {
                const cat = getCategory(categoryFilter);
                if (cat) {
                  activeChips.push({
                    key: "cat", label: `${cat.icon} ${cat.label}`,
                    color: theme.accent, onRemove: () => setCategoryFilter("all"),
                  });
                }
              }
            }
            if (tagFilter !== "all") {
              const td = getTagDef(tagFilter);
              if (td) {
                activeChips.push({
                  key: "tag", label: `${td.emoji} ${td.label}`,
                  color: theme.purple, onRemove: () => setTagFilter("all"),
                });
              }
            }
            if (dueDateFilter !== "all") {
              const labels = { today: "🎯 Dnes", week: "Tento týden", next_week: "Příští týden", month: "Tento měsíc" };
              const lbl = dueDateFilter.startsWith("range:") ? "📆 Rozsah" : labels[dueDateFilter];
              if (lbl) {
                activeChips.push({
                  key: "due", label: lbl,
                  color: theme.accent, onRemove: () => setDueDateFilter("all"),
                });
              }
            }
            if (createdWhenFilter !== "all") {
              const labels = { today: "Přidáno dnes", yesterday: "Přidáno včera", week: "Přidáno tento týden", month: "Přidáno tento měsíc", older: "Starší" };
              activeChips.push({
                key: "cw", label: labels[createdWhenFilter] || createdWhenFilter,
                color: theme.textMid, onRemove: () => setCreatedWhenFilter("all"),
              });
            }
            if (createdByFilter !== "all") {
              activeChips.push({
                key: "cb", label: `Přidal: ${createdByFilter}`,
                color: theme.textMid, onRemove: () => setCreatedByFilter("all"),
              });
            }
            if (activeChips.length === 0) return null;
            return (
              <div style={{
                marginBottom: "8px",
                background: `${theme.accent}05`,
                border: `1px solid ${theme.accent}30`,
                borderRadius: "8px",
                padding: "6px 8px",
              }}>
                <div style={{
                  fontSize: "9px", fontWeight: 800, color: theme.accent,
                  textTransform: "uppercase", letterSpacing: "0.4px",
                  marginBottom: "5px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <span>🎯 Vybrané filtry ({activeChips.length})</span>
                  <button onClick={() => {
                    setCategoryFilter("all");
                    setTagFilter("all");
                    setDueDateFilter("all");
                    setCreatedWhenFilter("all");
                    setCreatedByFilter("all");
                  }} style={{
                    ...buttonStyle(),
                    padding: "2px 8px", fontSize: "9px", fontWeight: 700,
                    background: "transparent", color: theme.red,
                    border: `1px solid ${theme.red}40`, borderRadius: "8px",
                    textTransform: "uppercase",
                  }}>Resetovat</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  {activeChips.map(c => (
                    <button key={c.key} onClick={c.onRemove}
                      title={`Odebrat: ${c.label}`}
                      style={{
                        ...buttonStyle(),
                        padding: "4px 8px 4px 10px", fontSize: "11px", fontWeight: 600,
                        background: `${c.color}15`, color: c.color,
                        border: `1px solid ${c.color}40`, borderRadius: "12px",
                        display: "inline-flex", alignItems: "center", gap: "4px",
                      }}>
                      <span>{c.label}</span>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: "14px", height: "14px", fontSize: "11px",
                        opacity: 0.7,
                      }}>✕</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          </>
            );
          })()}
        </div>

      </div>

      {/* ── Scrollable container — obsahuje pouze úkoly, scrolluje se uvnitř ── */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
      }}>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "0 12px 140px", width: "100%" }}>

        {/* Trash view info banner */}
        {viewStatus === "trash" && filteredTasks.length > 0 && (
          <div style={{
            margin: "0 0 8px 0",
            padding: "10px 12px",
            background: theme.inputBg,
            border: `1px solid ${theme.cardBorder}`,
            borderRadius: 8,
            fontSize: 12,
            color: theme.textMid,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}>
            <span>ℹ️ Úkoly v koši se automaticky smažou po 30 dnech.</span>
            {currentUser?.admin && (
              <button
                onClick={() => {
                  const trashed = tasks.filter(t => t.status === "deleted");
                  if (trashed.length === 0) return;
                  if (!window.confirm(`Vyprázdnit koš? Trvale smazat ${trashed.length} úkolů?`)) return;
                  // Sekvenčně permanentně smazat všechny
                  (async () => {
                    for (const t of trashed) {
                      try {
                        const { error } = await supabase.from("tasks").delete().eq("id", t.id);
                        if (error) throw error;
                      } catch (e) {
                        if (!isNetworkError(e)) logServerError("emptyTrash", e, { id: t.id });
                      }
                    }
                    setTasks(prev => prev.filter(t => t.status !== "deleted"));
                  })();
                }}
                style={{
                  marginLeft: "auto",
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: "transparent",
                  color: theme.red,
                  border: `1px solid ${theme.red}`,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Vyprázdnit koš
              </button>
            )}
          </div>
        )}

        {/* Task list */}
        {filteredTasks.length === 0 ? (
          <div style={{ textAlign: "center", color: theme.textDim, padding: "50px 20px" }}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>
              {searchQuery ? "🔍" : viewStatus === "active" ? "🎉" : "📭"}
            </div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: theme.textMid }}>
              {searchQuery ? "Nic nenalezeno"
                : viewStatus === "active" ? "Žádné aktivní úkoly"
                : "Žádné úkoly"}
            </div>
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} style={{
                ...buttonStyle(), marginTop: "8px", padding: "6px 14px", fontSize: "12px",
                background: theme.inputBg, color: theme.textSub,
                border: `1px solid ${theme.inputBorder}`,
              }}>Zrušit hledání</button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {(() => {
              let shownUnreadSep = false;
              let shownDoneSep = false;
              let shownDelSep = false;
              // Find if there is at least 1 unread-from-others task
              const hasUnread = visibleItems.some(it =>
                it.type === "task" && it.task.seenBy &&
                !it.task.seenBy.includes(currentUser.name) &&
                it.task.createdBy !== currentUser.name &&
                !isDone(it.task) && !isDeleted(it.task)
              );
              // Track when we've passed all unreads (to show normal section header after)
              let passedUnread = false;

              return visibleItems.map(item => {
                // Section header: "Právě přidáno"
                if (item.type === "section_header_recent") {
                  return (
                    <div key={item.key} style={{
                      margin: "4px 0 8px",
                      padding: "8px 12px",
                      background: `${theme.green}10`,
                      border: `2px solid ${theme.green}`,
                      borderRadius: "8px",
                      display: "flex", alignItems: "center", gap: "6px",
                    }}>
                      <span style={{
                        fontSize: "11px", color: theme.green, fontWeight: 800,
                        textTransform: "uppercase", letterSpacing: "0.3px",
                      }}>
                        ✨ Právě přidáno ({item.count})
                      </span>
                      <span style={{
                        fontSize: "10px", color: theme.textMid, fontWeight: 500,
                        marginLeft: "auto",
                      }}>
                        zmizí během 5 min
                      </span>
                    </div>
                  );
                }
                if (item.type === "section_header_stale") {
                  return (
                    <div key={item.key} style={{
                      margin: "4px 0 8px",
                      padding: "8px 12px",
                      background: "#ea580c10",
                      border: `2px solid #ea580c`,
                      borderRadius: "8px",
                      display: "flex", alignItems: "center", gap: "6px",
                    }}>
                      <span style={{
                        fontSize: "11px", color: "#ea580c", fontWeight: 800,
                        textTransform: "uppercase", letterSpacing: "0.3px",
                      }}>
                        🔥 Dlouho rozpracované ({item.count})
                      </span>
                      <span style={{
                        fontSize: "10px", color: theme.textMid, fontWeight: 500,
                        marginLeft: "auto",
                      }}>
                        dotáhni nebo odlož
                      </span>
                    </div>
                  );
                }
                if (item.type === "section_header_today") {
                  return (
                    <div key={item.key} style={{
                      margin: "4px 0 8px",
                      padding: "8px 12px",
                      background: `${theme.accent}10`,
                      border: `2px solid ${theme.accent}`,
                      borderRadius: "8px",
                      display: "flex", alignItems: "center", gap: "6px",
                    }}>
                      <span style={{
                        fontSize: "11px", color: theme.accent, fontWeight: 800,
                        textTransform: "uppercase", letterSpacing: "0.3px",
                      }}>
                        🎯 Dnes ({item.count})
                      </span>
                      <span style={{
                        fontSize: "10px", color: theme.textMid, fontWeight: 500,
                        marginLeft: "auto",
                      }}>
                        termín na dnes
                      </span>
                    </div>
                  );
                }
                if (item.type === "section_header_list") {
                  const list = item.list;
                  return (
                    <div key={item.key} style={{
                      margin: "12px 0 6px",
                      padding: "6px 10px",
                      background: `${list.color}10`,
                      borderLeft: `3px solid ${list.color}`,
                      borderRadius: "0 6px 6px 0",
                      display: "flex", alignItems: "center", gap: "6px",
                    }}>
                      <span style={{ fontSize: "13px" }}>{list.emoji || "📁"}</span>
                      <span style={{
                        fontSize: "11px", fontWeight: 800,
                        color: list.color,
                        textTransform: "uppercase", letterSpacing: "0.4px",
                        flex: 1,
                      }}>
                        {list.name}
                      </span>
                      <span style={{
                        fontSize: "10px", color: theme.textMid, fontWeight: 600,
                      }}>
                        {item.count} {item.count === 1 ? "úkol" : item.count < 5 ? "úkoly" : "úkolů"}
                      </span>
                    </div>
                  );
                }
                if (item.type === "section_header_forgotten") {
                  return (
                    <div key={item.key} style={{
                      margin: "16px 0 6px",
                      padding: "8px 12px",
                      background: `${theme.purple}10`,
                      border: `1px dashed ${theme.purple}60`,
                      borderRadius: "8px",
                      display: "flex", alignItems: "center", gap: "6px",
                    }}>
                      <span style={{
                        fontSize: "11px", color: theme.purple, fontWeight: 800,
                        textTransform: "uppercase", letterSpacing: "0.3px",
                      }}>
                        💤 Zapomenuté ({item.count})
                      </span>
                      <span style={{
                        fontSize: "10px", color: theme.textMid, fontWeight: 500,
                        marginLeft: "auto",
                      }}>
                        bez termínu, vytvořené před více než 7 dny
                      </span>
                    </div>
                  );
                }
                if (item.type === "section_divider") {
                  return (
                    <div key={item.key} style={{
                      margin: "10px 0",
                      height: "1px",
                      background: theme.cardBorder,
                    }} />
                  );
                }

                const task = item.task;
                const isUnread = task.seenBy &&
                  !task.seenBy.includes(currentUser.name) &&
                  task.createdBy !== currentUser.name &&
                  !isDone(task) && !isDeleted(task);

                // "🆕 NOVÉ OD DRUHÝCH" separator — first unread task (todo view)
                const showUnreadSep = hasUnread && isUnread && !shownUnreadSep && (viewStatus === "today" || viewStatus === "active");
                if (showUnreadSep) shownUnreadSep = true;

                // After last unread, show normal section header
                const showNormalSep = hasUnread && !isUnread && !passedUnread &&
                  item.type === "task" && !isDone(task) && !isDeleted(task) &&
                  (viewStatus === "today" || viewStatus === "active");
                if (showNormalSep) passedUnread = true;

                // Show "Dnes hotovo" separator when we encounter first done task OR first progress item
                const isDoneSection =
                  (item.type === "task" && isDone(task) && !isDeleted(task)) ||
                  item.type === "progress";
                const showDoneSep = (viewStatus === "active" || viewStatus === "today") && isDoneSection && !shownDoneSep;
                if (showDoneSep) shownDoneSep = true;

                const showDelSep = (viewStatus === "active" || viewStatus === "today") && item.type === "task" && isDeleted(task) && !shownDelSep;
                if (showDelSep) shownDelSep = true;

                return (
                  <div key={item.key}>
                    {showUnreadSep && (
                      <div style={{
                        margin: "4px 0 8px",
                        padding: "8px 12px",
                        background: `${theme.green}15`,
                        border: `2px solid ${theme.green}`,
                        borderRadius: "8px",
                        display: "flex", alignItems: "center", gap: "6px",
                      }}>
                        <span style={{
                          fontSize: "11px", color: theme.green, fontWeight: 800,
                          textTransform: "uppercase", letterSpacing: "0.3px",
                        }}>
                          🆕 Nové od druhých — přečti
                        </span>
                      </div>
                    )}
                    {showNormalSep && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        margin: "10px 0 6px",
                      }}>
                        <span style={{ flex: 1, height: "1px", background: theme.cardBorder }} />
                        <span style={{
                          fontSize: "10px", color: theme.textMid, fontWeight: 600,
                          textTransform: "uppercase", letterSpacing: "0.3px",
                        }}>
                          {viewStatus === "today" ? "🎯 Dnes — podle urgency" : "📋 Ostatní"}
                        </span>
                        <span style={{ flex: 1, height: "1px", background: theme.cardBorder }} />
                      </div>
                    )}
                    {showDoneSep && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        margin: "12px 0 8px",
                      }}>
                        <span style={{ flex: 1, height: "1px", background: theme.cardBorder }} />
                        <span style={{
                          fontSize: "10px", color: theme.green, fontWeight: 700,
                          textTransform: "uppercase", letterSpacing: "0.3px",
                          whiteSpace: "nowrap",
                        }}>
                          ✓ Dnes hotovo
                        </span>
                        <span style={{ flex: 1, height: "1px", background: theme.cardBorder }} />
                      </div>
                    )}
                    {showDelSep && (
                      <div style={{
                        margin: "14px 0 8px",
                        padding: "10px 12px",
                        background: theme.inputBg,
                        borderTop: `3px solid ${theme.textDim}`,
                        borderRadius: "8px 8px 0 0",
                        borderLeft: `1px solid ${theme.inputBorder}`,
                        borderRight: `1px solid ${theme.inputBorder}`,
                        display: "flex", alignItems: "center", gap: "6px",
                      }}>
                        <span style={{
                          fontSize: "11px", color: theme.textSub, fontWeight: 700,
                          textTransform: "uppercase", letterSpacing: "0.3px",
                          display: "flex", alignItems: "center", gap: "5px",
                        }}>
                          🗑 Dnes smazáno — koš
                        </span>
                      </div>
                    )}
                    <BulkSelectableCard
                      taskId={task.id}
                      bulkMode={bulkMode}
                      isSelected={bulkSelection.has(task.id)}
                      onToggle={toggleBulkSelection}
                      onLongPress={enterBulkMode}
                      theme={theme}
                    >
                      <TaskCard
                        task={task}
                        currentUser={currentUser}
                        users={users}
                        onStatusChange={changeStatus}
                        onMarkSeen={markSeen}
                        onUpdate={updateTask}
                        onDelete={deleteTask}
                        onRestore={restoreTask}
                        onPermanentDelete={permanentlyDeleteTask}
                        theme={theme}
                        comments={comments.filter(c => c.taskId === task.id)}
                        onAddComment={addComment}
                        onToggleReaction={toggleReaction}
                        onMarkCommentsSeen={markCommentsSeen}
                        autoOpen={scrollToTaskId === task.id}
                        isHighlighted={highlightedTaskId === task.id}
                        progressItem={item.type === "progress" ? item.checklistItem : null}
                        recentlyAdded={item.recentlyAdded === true}
                        fadeProgress={item.fadeProgress || 0}
                        isToday={item.isToday === true}
                        customLists={customLists}
                        onStartFocus={(taskId) => {
                          setFocusInitialTask(taskId);
                          setShowFocus(true);
                        }}
                      />
                    </BulkSelectableCard>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {/* Pagination — Načíst další */}
        {hiddenActiveCount > 0 && (
          <div style={{
            marginTop: 12,
            padding: "12px 14px",
            background: theme.inputBg,
            border: `1px dashed ${theme.cardBorder}`,
            borderRadius: 10,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "center",
          }}>
            <div style={{ fontSize: 12, color: theme.textMid }}>
              Zobrazeno {totalActiveCount - hiddenActiveCount} z {totalActiveCount} aktivních úkolů
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={() => setRenderLimit(prev => prev + PAGE_SIZE)}
                style={{
                  padding: "8px 16px",
                  background: theme.accent,
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Načíst dalších {Math.min(PAGE_SIZE, hiddenActiveCount)}
              </button>
              <button
                onClick={() => setRenderLimit(totalActiveCount + 100)}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: theme.textSub,
                  border: `1px solid ${theme.cardBorder}`,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Zobrazit vše
              </button>
            </div>
            <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>
              💡 Tip: Pro lepší přehled si rozděl úkoly do <strong>kategorií</strong> nebo <strong>vlastních seznamů</strong>
            </div>
          </div>
        )}

        <Legend theme={theme} />

        {/* Copyright footer */}
        <div style={{
          marginTop: "20px", padding: "14px 8px",
          textAlign: "center",
          fontSize: "13px", color: theme.textSub,
          fontFamily: FONT,
          opacity: 0.95,
          userSelect: "none",
          fontWeight: 600,
        }}>
          © {new Date().getFullYear()} Michal Bělohlav · Rodinné úkoly · v{APP_VERSION}
        </div>
      </div>
      </div>

      <Snackbar
        message={undoState?.message}
        visible={!!undoState}
        onUndo={performUndo}
        theme={theme}
      />

      {/* Bulk action bar — viditelný když je zapnutý bulk mode a aspoň 1 úkol vybraný */}
      {bulkMode && (
        <div style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: theme.cardBg,
          borderTop: `1px solid ${theme.cardBorder}`,
          boxShadow: "0 -4px 16px rgba(0,0,0,0.15)",
          padding: "10px 12px",
          paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
          zIndex: 9998,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <button
            onClick={exitBulkMode}
            aria-label="Zrušit výběr"
            style={{
              padding: "8px 10px",
              background: "transparent",
              color: theme.textSub,
              border: "none",
              fontSize: 18,
              cursor: "pointer",
              borderRadius: 6,
              minWidth: 36,
            }}
          >
            ✕
          </button>
          <div style={{ fontSize: 13, color: theme.text, fontWeight: 600, minWidth: 80 }}>
            {bulkSelection.size === 0 ? "Žádný výběr" : `Vybráno ${bulkSelection.size}`}
          </div>
          <div style={{ flex: 1 }} />
          {bulkSelection.size > 0 && (
            <>
              <button
                onClick={bulkComplete}
                aria-label="Označit jako splněné"
                title="Splnit"
                style={{
                  padding: "10px 12px",
                  background: "transparent",
                  color: "#10b981",
                  border: `1px solid ${theme.cardBorder}`,
                  borderRadius: 8,
                  fontSize: 18,
                  cursor: "pointer",
                  minWidth: 44,
                  minHeight: 44,
                }}
              >
                ✓
              </button>
              <select
                onChange={(e) => { if (e.target.value) bulkSetPriority(e.target.value); }}
                defaultValue=""
                aria-label="Změnit prioritu"
                title="Priorita"
                style={{
                  padding: "10px 8px",
                  background: theme.inputBg,
                  color: theme.text,
                  border: `1px solid ${theme.cardBorder}`,
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                  minHeight: 44,
                }}
              >
                <option value="" disabled>Priorita</option>
                <option value="urgent">‼ Akutní</option>
                <option value="important">! Důležité</option>
                <option value="low">— Nedůležité</option>
              </select>
              <select
                onChange={(e) => { if (e.target.value) bulkAssign(e.target.value); }}
                defaultValue=""
                aria-label="Přiřadit"
                title="Přiřadit"
                style={{
                  padding: "10px 8px",
                  background: theme.inputBg,
                  color: theme.text,
                  border: `1px solid ${theme.cardBorder}`,
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                  minHeight: 44,
                }}
              >
                <option value="" disabled>Přiřadit</option>
                {(users || []).map(u => (
                  <option key={u.name} value={u.name}>👤 {u.name}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (window.confirm(`Smazat ${bulkSelection.size} úkolů?`)) bulkDelete();
                }}
                aria-label="Smazat"
                title="Smazat"
                style={{
                  padding: "10px 12px",
                  background: "transparent",
                  color: "#ef4444",
                  border: `1px solid ${theme.cardBorder}`,
                  borderRadius: 8,
                  fontSize: 18,
                  cursor: "pointer",
                  minWidth: 44,
                  minHeight: 44,
                }}
              >
                🗑
              </button>
            </>
          )}
        </div>
      )}

      {/* PWA install banner — aktivní jen v Chrome/Edge/Brave + když user nemá appku nainstalovanou */}
      {showInstallBanner && pwaInstallEvent && (
        <div style={{
          position: "fixed",
          bottom: 16,
          left: 16,
          right: 16,
          maxWidth: 480,
          margin: "0 auto",
          background: theme.cardBg,
          border: `1px solid ${theme.cardBorder}`,
          borderRadius: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          padding: 14,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <div style={{ fontSize: 32, flexShrink: 0 }}>📱</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: theme.text }}>
              Nainstalovat na plochu
            </div>
            <div style={{ fontSize: 12, color: theme.textSub, marginTop: 2 }}>
              Rychlejší přístup, vypadá jako nativní aplikace
            </div>
          </div>
          <button
            onClick={handlePwaInstall}
            style={{
              padding: "8px 14px",
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Instalovat
          </button>
          <button
            onClick={handlePwaDismiss}
            aria-label="Zavřít"
            style={{
              padding: "6px 8px",
              background: "transparent",
              color: theme.textSub,
              border: "none",
              borderRadius: 6,
              fontSize: 18,
              cursor: "pointer",
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ERROR BOUNDARY — last line of defense
   Když kdekoli v render tree vyletí výjimka, místo bílé stránky
   ukáže recovery screen s tlačítkem Reload + diagnostické info.
   ═══════════════════════════════════════════════════════ */

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary] caught:", error);
    console.error("[ErrorBoundary] component stack:", errorInfo?.componentStack);
    this.setState({ errorInfo });
    // Zaznamenej do localStorage pro pozdější diagnostiku (max 5 posledních)
    try {
      const log = JSON.parse(localStorage.getItem("ft_render_errors") || "[]");
      log.unshift({
        ts: new Date().toISOString(),
        message: error?.message || String(error),
        stack: error?.stack || null,
        componentStack: errorInfo?.componentStack || null,
      });
      localStorage.setItem("ft_render_errors", JSON.stringify(log.slice(0, 5)));
    } catch (e) { /* ignore */ }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleClearAndReload = () => {
    // Nuclear option — vyčistí cache (ne PIN/přihlášení) a reload.
    // Užitečné, pokud cache je v rozbitém stavu.
    try {
      localStorage.removeItem("ft_cache_tasks");
      localStorage.removeItem("ft_cache_users");
      localStorage.removeItem("ft_cache_comments");
      localStorage.removeItem("ft_offline_queue");
    } catch (e) { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const errorMsg = this.state.error?.message || String(this.state.error);
    const stack = this.state.error?.stack || "";
    const componentStack = this.state.errorInfo?.componentStack || "";

    return (
      <div style={{
        minHeight: "100vh",
        background: "#fef2f2",
        color: "#1f2937",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "24px",
        boxSizing: "border-box",
      }}>
        <div style={{
          maxWidth: 640,
          margin: "0 auto",
          background: "white",
          borderRadius: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          padding: 24,
        }}>
          <div style={{ fontSize: 48, textAlign: "center", marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, textAlign: "center", margin: "0 0 8px" }}>
            Něco se rozbilo
          </h1>
          <p style={{ textAlign: "center", color: "#6b7280", margin: "0 0 20px", fontSize: 14 }}>
            Aplikace narazila na neočekávanou chybu. Zkus jedno z těchto řešení:
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: "12px 16px",
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🔄 Načíst znovu
            </button>
            <button
              onClick={this.handleClearAndReload}
              style={{
                padding: "12px 16px",
                background: "#f3f4f6",
                color: "#1f2937",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              🧹 Vyčistit cache a načíst znovu
            </button>
          </div>

          <details style={{ fontSize: 12, color: "#6b7280" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>
              Technické detaily (pošli Michalovi)
            </summary>
            <div style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: 12,
              marginTop: 8,
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 300,
              overflow: "auto",
            }}>
              <div style={{ fontWeight: 700, color: "#dc2626" }}>{errorMsg}</div>
              {stack && <div style={{ marginTop: 8, opacity: 0.75 }}>{stack}</div>}
              {componentStack && (
                <div style={{ marginTop: 8, opacity: 0.6 }}>
                  <div style={{ fontWeight: 600 }}>Component stack:</div>
                  {componentStack}
                </div>
              )}
            </div>
          </details>

          <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 16 }}>
            © 2026 Michal Bělohlav
          </p>
        </div>
      </div>
    );
  }
}

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

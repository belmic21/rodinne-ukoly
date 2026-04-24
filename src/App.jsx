import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase, dbToTask, taskToDb, dbToUser, dbToComment, commentToDb } from "./supabase.js";

/* ═══════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════ */

const UNDO_MS = 5000;

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
const isDone = (task) => task.status === "done" || task.status === "cancelled";
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

function autoDetectCategory(title) {
  const lower = title.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(kw => lower.includes(kw))) return cat.id;
  }
  return "other";
}

function searchMatch(task, query) {
  if (!query) return true;
  const lower = query.toLowerCase();
  return (
    task.title?.toLowerCase().includes(lower) ||
    task.note?.toLowerCase().includes(lower) ||
    task.checklist?.some(c => c.text?.toLowerCase().includes(lower))
  );
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
@keyframes completePulse {
  0% { transform: scale(1); }
  30% { transform: scale(1.25); }
  60% { transform: scale(1.12); }
  100% { transform: scale(1); }
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
  const remaining = [];

  for (const action of queue) {
    try {
      if (action.type === "create_task") {
        await supabase.from("tasks").insert(taskToDb(action.task));
      } else if (action.type === "update_task") {
        await supabase.from("tasks").update(taskToDb(action.task)).eq("id", action.task.id);
      } else if (action.type === "create_user") {
        await supabase.from("users").insert({ name: action.user.name, pin: action.user.pin, is_admin: action.user.admin });
      } else if (action.type === "create_comment") {
        await supabase.from("task_comments").insert(commentToDb(action.comment));
      } else if (action.type === "update_comment") {
        await supabase.from("task_comments").update(commentToDb(action.comment)).eq("id", action.comment.id);
      }
      flushed++;
    } catch (e) {
      // Keep failed actions in queue for next attempt
      remaining.push(action);
    }
  }

  cacheSet(OFFLINE_QUEUE, remaining);
  return flushed;
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
  try {
    const { data, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    const tasks = (data || []).map(dbToTask);
    cacheSet(CACHE_TASKS, tasks); // Cache for offline
    return tasks;
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
    console.warn("apiCreateUser offline, queued");
    addToOfflineQueue({ type: "create_user", user });
  }
}

async function apiDeleteUser(name) {
  try {
    await supabase.from("users").delete().eq("name", name);
  } catch (e) {
    console.warn("apiDeleteUser failed offline");
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
    console.warn("apiCreateTask offline, queued");
    addToOfflineQueue({ type: "create_task", task });
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
    console.warn("apiUpdateTask offline, queued");
    addToOfflineQueue({ type: "update_task", task });
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
    console.warn("apiCreateComment offline, queued");
    addToOfflineQueue({ type: "create_comment", comment });
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
    addToOfflineQueue({ type: "update_comment", comment });
  }
}

async function apiDeleteComment(commentId) {
  try {
    await supabase.from("task_comments").delete().eq("id", commentId);
    const cached = cacheGet(CACHE_COMMENTS) || [];
    cacheSet(CACHE_COMMENTS, cached.filter(c => c.id !== commentId));
  } catch (e) {
    console.warn("apiDeleteComment failed");
  }
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
      onUpdate(task.id, { checklist: updated });

      // Auto-complete the whole task when all checklist items are done — with animation
      if (updated.length > 0 && updated.every(item => item.done)) {
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
      <div style={{ marginTop: "10px", paddingLeft: "32px", animation: "fadeIn 0.12s" }}
           onClick={e => e.stopPropagation()}>

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
            {task.dueDate && !taskIsDone && (
              <span style={{ color: overdue ? theme.red : theme.textSub, fontWeight: 600 }}>
                📅 Termín: {formatDate(task.dueDate)}
              </span>
            )}
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
          }}>
            {task.note}
          </div>
        )}

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
              return (
                <div key={item.id} style={{
                  display: "flex", alignItems: "center", gap: "8px",
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
                    flex: 1, fontSize: "13px",
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
          </div>

          {/* ── Due date with quick picks ── */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>
              Termín splnění {editDueDate && <span style={{ fontWeight: 400, textTransform: "none" }}>— {formatDate(editDueDate)}</span>}
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
   TASK CARD
   ═══════════════════════════════════════════════════════ */

function TaskCard({ task, currentUser, users, onStatusChange, onMarkSeen, onUpdate, onDelete, onRestore, onPermanentDelete, theme, comments, onAddComment, onToggleReaction, onMarkCommentsSeen, autoOpen, progressItem }) {
  const [isOpen, setIsOpen] = useState(false);
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);

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

  const isNew = !task.seenBy?.includes(currentUser.name) && task.createdBy !== currentUser.name;
  const overdue = daysDiff(task.dueDate) < 0 && !isDone(task);
  const soon = !overdue && daysDiff(task.dueDate) >= 0 && daysDiff(task.dueDate) <= 3 && !isDone(task);
  const forgotten = isForgotten(task);
  const inProgress = task.status === "in_progress" ||
    (task.assignTo === "both" && (task.doneBy?.length || 0) > 0 && task.status !== "done");

  const priority = getPriority(task.priority);
  const priorityTheme = theme.priority[priority.id];
  const canAct = task.assignTo === "both" || task.assignedTo?.includes(currentUser.name) || task.createdBy === currentUser.name;

  const checklistDone = task.checklist?.filter(c => c.done).length || 0;
  const checklistTotal = task.checklist?.length || 0;
  const allChecked = checklistTotal > 0 && checklistDone === checklistTotal;

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
    if (opening && isNew) onMarkSeen(task.id);
  };

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

    // Smart: if task has checklist items, mark them all as done first
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
  };

  // Derived animation properties — used by card + circle
  const animColor = actionAnim === "delete" ? theme.red
    : actionAnim === "complete" ? theme.green
    : actionAnim === "restore" || actionAnim === "reopen" ? theme.accent
    : null;
  const completing = actionAnim === "complete"; // legacy alias

  // Assignment label
  let assignLabel = "";
  if (task.assignTo === "both") assignLabel = "Všichni";
  else if (task.createdBy !== task.assignedTo?.[0]) assignLabel = `→ ${task.assignedTo?.[0]}`;

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
    <div id={progressItem ? `progress-${task.id}-${progressItem.id}` : `task-${task.id}`} style={{
      position: "relative",
      borderRadius: "12px",
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
      background: actionAnim ? `${animColor}15` : cardBackground,
      border: `1px solid ${actionAnim ? animColor : cardBorderColor}`,
      borderRadius: "12px",
      borderLeft: `5px solid ${actionAnim ? animColor : leftBorderColor}`,
      padding: "8px 11px",
      opacity: actionAnim ? 1 : (taskIsDone ? 0.35 : taskIsDeleted ? 0.55 : 1),
      cursor: "pointer",
      position: "relative",
      animation: actionAnim ? "actionCardGlow 0.55s ease-out"
        : isNew ? "glow 2s ease 3, slideUp 0.3s ease"
        : taskIsDone ? "completedFade 0.5s ease forwards"
        : "slideUp 0.3s ease",
      transform: `translateX(${swipeX}px) ${actionAnim ? "scale(1.02)" : ""}`,
      transition: isSwiping ? "none" : "transform 0.25s ease, all 0.2s",
      boxShadow: actionAnim ? `0 0 30px ${animColor}60, 0 4px 16px ${animColor}45` : "none",
      touchAction: "pan-y",  // allow vertical scroll, our JS handles horizontal swipe
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
          <button onClick={handleQuickComplete} style={{
            width: completing ? "40px" : "32px",
            height: completing ? "40px" : "32px",
            minWidth: completing ? "40px" : "32px",
            borderRadius: "8px",
            border: `2.5px solid ${completing ? theme.green : (inProgress ? theme.yellow : priorityTheme.text)}`,
            background: completing ? theme.green : (inProgress ? `${theme.yellow}20` : `${priorityTheme.text}10`),
            cursor: completing ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: completing ? "#fff" : (inProgress ? theme.yellow : priorityTheme.text),
            fontSize: completing ? "22px" : "14px",
            fontWeight: 700,
            transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
            boxShadow: completing ? `0 0 0 10px ${theme.green}25, 0 4px 20px ${theme.green}60` : "none",
            animation: completing ? "completePulse 0.55s ease-out" : "none",
          }} title="Splnit">
            {completing ? "✓" : (inProgress ? "◐" : "○")}
          </button>
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
            background: actionAnim === "reopen" ? theme.accent : (task.status === "cancelled" ? `${theme.priority.low.text}15` : `${theme.green}20`),
            color: actionAnim === "reopen" ? "#fff" : (task.status === "cancelled" ? theme.priority.low.text : theme.green),
            border: `2.5px solid ${actionAnim === "reopen" ? theme.accent : (task.status === "cancelled" ? theme.priority.low.text + "40" : theme.green + "50")}`,
            cursor: actionAnim ? "default" : "pointer",
            transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
            boxShadow: actionAnim === "reopen" ? `0 0 0 10px ${theme.accent}25, 0 4px 20px ${theme.accent}60` : "none",
            animation: actionAnim === "reopen" ? "completePulse 0.55s ease-out" : "none",
          }} title="Vrátit zpět do aktivních">
            {task.status === "done" ? "↩" : "⊘"}
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
            {task.category && task.category !== "other" && (
              <span style={{ fontSize: "10px", color: theme.textMid }}>
                {getCategory(task.category).icon}
              </span>
            )}

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
            {task.showFrom && daysDiff(task.showFrom) > 0 && (
              <span style={{ fontSize: "10px", fontWeight: 600, color: theme.purple }}>
                ⏰ od {formatDate(task.showFrom)}
              </span>
            )}
            {task.dueDate && !taskIsDone && !isDeleted(task) && (
              <span style={{
                fontSize: "10px", fontWeight: 600,
                color: overdue ? theme.red : soon ? theme.yellow : theme.textMid,
              }}>
                {overdue ? "⚠ " : ""}{formatDate(task.dueDate)}
              </span>
            )}
            {/* Time trace for completed */}
            {taskIsDone && task.completedAt && (
              <span style={{ fontSize: "10px", color: theme.green, fontWeight: 600 }}>
                ✓ {formatTimeTrace(task.completedAt)}{task.completedByUser ? ` — ${task.completedByUser}` : ""}
              </span>
            )}
            {/* Time trace for deleted */}
            {isDeleted(task) && task.deletedAt && (
              <span style={{ fontSize: "10px", color: theme.red, fontWeight: 600 }}>
                🗑 {formatTimeTrace(task.deletedAt)}
              </span>
            )}
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

function QuickAddBar({ currentUser, users, onAdd, theme, categoryFilter, onCategoryFilterChange, categoryCounts, priorityFilter, onPriorityFilterChange, scopeFilter, onScopeFilterChange, showDeferred, onShowDeferredChange }) {
  const [text, setText] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [note, setNote] = useState("");
  const [type, setType] = useState("simple");
  const [dueDate, setDueDate] = useState("");
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
  const otherUsers = users.filter(u => u.name !== currentUser.name);

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

  // Compute final assignment from quickAssignees array
  const computeAssignment = () => {
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
    return {
      id: generateId(),
      title,
      note: note.trim() || null,
      type,
      createdBy: currentUser.name,
      assignTo,
      assignedTo,
      priority: quickPriority || "low",
      dueDate: dueDate || null,
      showFrom: showFrom || null,
      recDays: recurrence,
      category: quickCategory || (category === "other" ? autoDetectCategory(title) : category),
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
    setText(""); setNote(""); setDueDate(""); setRecurrence(0);
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
    <div style={{ marginBottom: "14px" }}>
      {/* Always visible quick input */}
      <div style={{
        ...cardStyle(theme), padding: "6px 8px",
        display: "flex", gap: "6px", alignItems: "center",
      }}>
        <span style={{ fontSize: "16px", color: theme.accent, paddingLeft: "4px" }}>+</span>
        <input
          ref={inputRef}
          type="text"
          placeholder="Napiš úkol a stiskni Enter..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { if (showFull) fullSubmit(); else quickSubmit(); } }}
          style={{
            background: "transparent", border: "none", color: theme.text,
            padding: "8px 4px", fontSize: "14px", fontFamily: FONT,
            outline: "none", flex: 1, width: "100%",
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
        <button onClick={() => setShowFull(!showFull)} title="Podrobnosti" style={{
          ...buttonStyle(), width: "32px", height: "32px",
          background: showFull ? theme.accent : theme.inputBg,
          color: showFull ? "#fff" : theme.textSub,
          border: `1px solid ${showFull ? theme.accent : theme.inputBorder}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "14px", flexShrink: 0,
        }}>
          {showFull ? "×" : "⚙"}
        </button>
      </div>

      {/* Segmented filter bar — 3 buttons with mini-dropdowns + chips below. Shown ALWAYS. */}
      {(() => {
        const isTyping = text.trim().length > 0;

        // Figure out CURRENT state for each segment based on mode
        const currentCategory = isTyping ? quickCategory : (categoryFilter !== "all" ? categoryFilter : null);
        const currentPriority = isTyping
          ? quickPriority
          : (priorityFilter !== "all" ? priorityFilter : null);
        // For filter mode, "person" is extracted from scopeFilter
        let currentPersonLabel = null;
        let currentPersonCount = 0;
        if (isTyping) {
          currentPersonCount = quickAssignees.length;
          if (quickAssignees.length === users.length && users.length > 1) {
            currentPersonLabel = "Všichni";
          } else if (quickAssignees.length === 1) {
            currentPersonLabel = quickAssignees[0];
          } else if (quickAssignees.length > 1) {
            // Show first 2 initials + count indicator: "Mi, Pe +1"
            const labels = quickAssignees.slice(0, 2).map(getUserLabel).join(", ");
            const extra = quickAssignees.length > 2 ? ` +${quickAssignees.length - 2}` : "";
            currentPersonLabel = labels + extra;
          }
        } else {
          if (scopeFilter === "my") { currentPersonLabel = currentUser.name; currentPersonCount = 1; }
          else if (scopeFilter && scopeFilter.startsWith("person:")) {
            currentPersonLabel = scopeFilter.replace("person:", "");
            currentPersonCount = 1;
          }
        }

        // Segment helper — renders a button with its mini-dropdown
        const renderSegment = (id, defaultLabel, activeLabel, activeColor, isActive, dropdownContent) => {
          const isOpen = openSegment === id;
          return (
            <div style={{ position: "relative", flexShrink: 0 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenSegment(isOpen ? null : id);
                }}
                style={{
                  ...buttonStyle(),
                  padding: "5px 10px", fontSize: "12px", fontWeight: 600,
                  background: isActive ? (activeColor + "15") : theme.inputBg,
                  color: isActive ? activeColor : theme.textSub,
                  border: `1px solid ${isActive ? activeColor + "50" : theme.inputBorder}`,
                  borderRadius: "16px",
                  display: "inline-flex", alignItems: "center", gap: "4px",
                  whiteSpace: "nowrap",
                }}>
                {isActive ? activeLabel : defaultLabel}
                <span style={{ fontSize: "8px", opacity: 0.7 }}>{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0,
                    background: theme.card, border: `1px solid ${theme.cardBorder}`,
                    borderRadius: "10px", padding: "6px",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                    zIndex: 25, minWidth: "170px",
                    animation: "slideUp 0.15s",
                  }}>
                  {dropdownContent}
                </div>
              )}
            </div>
          );
        };

        // DROPDOWN CONTENTS
        const catDropdown = (
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            {CATEGORIES.map(cat => {
              const selected = currentCategory === cat.id;
              const count = categoryCounts?.[cat.id] || 0;
              return (
                <button key={cat.id}
                  onClick={() => {
                    if (isTyping) {
                      setQuickCategory(selected ? null : cat.id);
                    } else {
                      onCategoryFilterChange(selected ? "all" : cat.id);
                    }
                    setOpenSegment(null);
                  }}
                  style={{
                    ...buttonStyle(),
                    padding: "7px 10px", fontSize: "12px",
                    background: selected ? theme.accentSoft : "transparent",
                    color: selected ? theme.accent : theme.text,
                    border: "none", textAlign: "left", borderRadius: "6px",
                    display: "flex", alignItems: "center", gap: "6px",
                  }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = theme.inputBg; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ fontSize: "15px" }}>{cat.icon}</span>
                  <span style={{ flex: 1 }}>{cat.label}</span>
                  {count > 0 && !isTyping && (
                    <span style={{ fontSize: "10px", color: theme.textMid, fontWeight: 700 }}>{count}</span>
                  )}
                  {selected && <span style={{ color: theme.accent, fontSize: "11px" }}>✓</span>}
                </button>
              );
            })}
            {currentCategory && (
              <button onClick={() => {
                if (isTyping) setQuickCategory(null);
                else onCategoryFilterChange("all");
                setOpenSegment(null);
              }} style={{
                ...buttonStyle(), padding: "7px 10px", fontSize: "11px",
                background: "transparent", color: theme.red,
                border: "none", borderTop: `1px solid ${theme.cardBorder}`,
                textAlign: "left", borderRadius: 0, marginTop: "2px",
              }}>✕ Zrušit výběr</button>
            )}
          </div>
        );

        const priDropdown = (
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            {PRIORITIES.map(pri => {
              const pt = theme.priority[pri.id];
              // Is this priority the currently selected one (in either mode)?
              const isSet = isTyping
                ? quickPriority === pri.id
                : priorityFilter === pri.id;
              return (
                <button key={pri.id}
                  onClick={() => {
                    if (isTyping) {
                      // Typing mode: "low" is default, clicking it means reset
                      setQuickPriority(pri.id === "low" ? null : pri.id);
                    } else {
                      // Filter mode: toggle this priority
                      if (priorityFilter === pri.id) {
                        onPriorityFilterChange && onPriorityFilterChange("all");
                      } else {
                        onPriorityFilterChange && onPriorityFilterChange(pri.id);
                      }
                    }
                    setOpenSegment(null);
                  }}
                  style={{
                    ...buttonStyle(),
                    padding: "7px 10px", fontSize: "12px",
                    background: isSet ? pt.cardBg : "transparent",
                    color: isSet ? pt.text : theme.text,
                    border: "none", textAlign: "left", borderRadius: "6px",
                    display: "flex", alignItems: "center", gap: "8px",
                  }}
                  onMouseEnter={e => { if (!isSet) e.currentTarget.style.background = theme.inputBg; }}
                  onMouseLeave={e => { if (!isSet) e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ fontSize: "15px", fontWeight: 900, color: pt.text, width: "16px" }}>
                    {pri.sym}
                  </span>
                  <span style={{ flex: 1 }}>{pri.label}</span>
                  {isSet && <span style={{ color: pt.text, fontSize: "11px" }}>✓</span>}
                </button>
              );
            })}
            {!isTyping && priorityFilter !== "all" && (
              <button onClick={() => {
                onPriorityFilterChange && onPriorityFilterChange("all");
                setOpenSegment(null);
              }} style={{
                ...buttonStyle(), padding: "7px 10px", fontSize: "11px",
                background: "transparent", color: theme.red,
                border: "none", borderTop: `1px solid ${theme.cardBorder}`,
                textAlign: "left", borderRadius: 0, marginTop: "2px",
              }}>✕ Zrušit filtr</button>
            )}
          </div>
        );

        const perDropdown = (
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            {/* Quick "Všichni" option (typing mode only) — one-tap multi-select */}
            {isTyping && users.length > 1 && (() => {
              const allSelected = users.every(u => quickAssignees.includes(u.name));
              return (
                <button
                  onClick={() => {
                    if (allSelected) {
                      setQuickAssignees([]);
                    } else {
                      setQuickAssignees(users.map(u => u.name));
                    }
                  }}
                  style={{
                    ...buttonStyle(),
                    padding: "7px 10px", fontSize: "12px", fontWeight: 600,
                    background: allSelected ? theme.accentSoft : "transparent",
                    color: allSelected ? theme.accent : theme.text,
                    border: "none",
                    borderBottom: `1px solid ${theme.cardBorder}`,
                    textAlign: "left", borderRadius: 0,
                    display: "flex", alignItems: "center", gap: "8px",
                    marginBottom: "2px",
                  }}
                  onMouseEnter={e => { if (!allSelected) e.currentTarget.style.background = theme.inputBg; }}
                  onMouseLeave={e => { if (!allSelected) e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ fontSize: "14px", width: "24px", textAlign: "center" }}>👥</span>
                  <span style={{ flex: 1 }}>Všichni</span>
                  {allSelected && <span style={{ color: theme.accent, fontSize: "11px" }}>✓</span>}
                </button>
              );
            })()}

            {users.map(u => {
              const selected = isTyping
                ? quickAssignees.includes(u.name)
                : (u.name === currentUser.name ? scopeFilter === "my" : scopeFilter === `person:${u.name}`);
              return (
                <button key={u.name}
                  onClick={() => {
                    if (isTyping) {
                      setQuickAssignees(prev =>
                        prev.includes(u.name) ? prev.filter(n => n !== u.name) : [...prev, u.name]
                      );
                      // keep open in typing mode so user can pick multiple
                    } else {
                      if (u.name === currentUser.name) {
                        onScopeFilterChange && onScopeFilterChange(scopeFilter === "my" ? "all" : "my");
                      } else {
                        const key = `person:${u.name}`;
                        onScopeFilterChange && onScopeFilterChange(scopeFilter === key ? "all" : key);
                      }
                      setOpenSegment(null);
                    }
                  }}
                  style={{
                    ...buttonStyle(),
                    padding: "7px 10px", fontSize: "12px",
                    background: selected ? theme.accentSoft : "transparent",
                    color: selected ? theme.accent : theme.text,
                    border: "none", textAlign: "left", borderRadius: "6px",
                    display: "flex", alignItems: "center", gap: "8px",
                  }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = theme.inputBg; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
                  <span style={{
                    fontSize: "10px", fontWeight: 700,
                    width: "24px", textAlign: "center",
                    color: selected ? theme.accent : theme.textMid,
                  }}>{getUserLabel(u.name)}</span>
                  <span style={{ flex: 1 }}>{u.name}</span>
                  {selected && <span style={{ color: theme.accent, fontSize: "11px" }}>✓</span>}
                </button>
              );
            })}
            {isTyping && quickAssignees.length > 0 && (
              <button onClick={() => { setQuickAssignees([]); setOpenSegment(null); }} style={{
                ...buttonStyle(), padding: "7px 10px", fontSize: "11px",
                background: "transparent", color: theme.red,
                border: "none", borderTop: `1px solid ${theme.cardBorder}`,
                textAlign: "left", borderRadius: 0, marginTop: "2px",
              }}>✕ Zrušit výběr</button>
            )}
            {isTyping && (
              <div style={{
                fontSize: "10px", color: theme.textMid,
                padding: "5px 10px",
                borderTop: quickAssignees.length > 0 ? "none" : `1px solid ${theme.cardBorder}`,
                marginTop: quickAssignees.length > 0 ? 0 : "2px",
              }}>
                💡 Můžeš vybrat víc osob zároveň
              </div>
            )}
          </div>
        );

        // CHIPS (active filters)
        const chips = [];
        if (isTyping) {
          if (quickCategory) {
            const cat = getCategory(quickCategory);
            chips.push({ key: "cat", label: cat.icon + " " + cat.label, color: theme.accent,
              onRemove: () => setQuickCategory(null) });
          }
          if (quickPriority && quickPriority !== "low") {
            const pri = getPriority(quickPriority);
            chips.push({ key: "pri", label: pri.sym + " " + pri.label, color: theme.priority[quickPriority].text,
              onRemove: () => setQuickPriority(null) });
          }
          // If all users are assigned, collapse to single "Všichni" chip
          if (quickAssignees.length === users.length && users.length > 1) {
            chips.push({
              key: "all", label: "👥 Všichni", color: theme.accent,
              onRemove: () => setQuickAssignees([]),
            });
          } else {
            quickAssignees.forEach(name => {
              chips.push({ key: "a_" + name, label: name, color: theme.accent,
                onRemove: () => setQuickAssignees(prev => prev.filter(n => n !== name)) });
            });
          }
        } else {
          if (categoryFilter && categoryFilter !== "all") {
            const cat = getCategory(categoryFilter);
            chips.push({ key: "cat", label: cat.icon + " " + cat.label, color: theme.accent,
              onRemove: () => onCategoryFilterChange("all") });
          }
          if (priorityFilter && priorityFilter !== "all") {
            const pri = getPriority(priorityFilter);
            chips.push({
              key: "pri", label: pri.sym + " " + pri.label,
              color: theme.priority[priorityFilter].text,
              onRemove: () => onPriorityFilterChange && onPriorityFilterChange("all"),
            });
          }
          if (scopeFilter && scopeFilter !== "all" && scopeFilter !== "my") {
            if (scopeFilter.startsWith("person:")) {
              const name = scopeFilter.replace("person:", "");
              chips.push({ key: "p", label: "👤 " + name, color: theme.accent,
                onRemove: () => onScopeFilterChange("all") });
            } else {
              const labels = { assigned: "Zadané", shared: "Společné", unread: "Nové" };
              chips.push({ key: "s", label: labels[scopeFilter] || scopeFilter, color: theme.accent,
                onRemove: () => onScopeFilterChange("all") });
            }
          }
        }

        return (
          <div ref={segmentBarRef} style={{ marginTop: "6px" }}>
            {/* Row of segmented buttons */}
            <div style={{
              display: "flex", gap: "6px", alignItems: "center",
              paddingLeft: "4px", flexWrap: "wrap",
            }}>
              {renderSegment("cat",
                <><span>🏷️</span><span>Kategorie</span></>,
                currentCategory ? <><span>{getCategory(currentCategory).icon}</span><span>{getCategory(currentCategory).label}</span></> : "Kategorie",
                theme.accent, !!currentCategory, catDropdown
              )}
              {renderSegment("pri",
                <><span style={{ fontWeight: 900 }}>!</span><span>Priorita</span></>,
                currentPriority ? <><span style={{ fontWeight: 900, color: theme.priority[currentPriority].text }}>{getPriority(currentPriority).sym}</span><span>{getPriority(currentPriority).label}</span></> : "Priorita",
                currentPriority ? theme.priority[currentPriority].text : theme.accent,
                !!currentPriority, priDropdown
              )}
              {renderSegment("per",
                <><span>👤</span><span>Osoba</span></>,
                currentPersonLabel ? <><span>👤</span><span>{currentPersonLabel}</span></> : "Osoba",
                theme.accent, !!currentPersonLabel, perDropdown
              )}

              {/* Spacer */}
              <span style={{ flex: 1 }} />

              {/* Deferred toggle — filter mode only */}
              {!isTyping && (
                <button
                  onClick={() => onShowDeferredChange && onShowDeferredChange(!showDeferred)}
                  title={showDeferred ? "Skrýt odložené úkoly" : "Zobrazit i odložené úkoly"}
                  style={{
                    ...buttonStyle(),
                    minWidth: "32px", height: "26px", padding: "0 6px",
                    fontSize: "13px",
                    background: showDeferred ? `${theme.purple}15` : "transparent",
                    color: showDeferred ? theme.purple : theme.textDim,
                    border: `1px solid ${showDeferred ? theme.purple + "40" : theme.inputBorder}`,
                    borderRadius: "14px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: showDeferred ? 1 : 0.6,
                  }}>
                  ⏰
                </button>
              )}
            </div>

            {/* Chips row (only if any active filter) */}
            {chips.length > 0 && (
              <div style={{
                display: "flex", gap: "4px", flexWrap: "wrap",
                marginTop: "6px", paddingLeft: "4px",
              }}>
                {chips.map(chip => (
                  <span key={chip.key} style={{
                    display: "inline-flex", alignItems: "center", gap: "4px",
                    padding: "2px 5px 2px 8px", fontSize: "11px", fontWeight: 600,
                    background: chip.color + "15", color: chip.color,
                    border: `1px solid ${chip.color}35`,
                    borderRadius: "12px",
                  }}>
                    {chip.label}
                    <button onClick={chip.onRemove} title="Odebrat" style={{
                      ...buttonStyle(),
                      width: "14px", height: "14px", padding: 0,
                      background: "transparent", color: chip.color,
                      border: "none", fontSize: "13px", lineHeight: 1,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Bottom sheet: filter/picker panel — big icons, touch-friendly */}
      {pickerOpen && (() => {
        const isTyping = text.trim().length > 0;
        return (
          <div
            onClick={() => setPickerOpen(false)}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.4)",
              zIndex: 50,
              display: "flex", alignItems: "flex-end", justifyContent: "center",
              animation: "fadeIn 0.15s",
            }}>
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: "100%", maxWidth: "560px",
                background: theme.card,
                borderTopLeftRadius: "16px", borderTopRightRadius: "16px",
                padding: "14px 16px 24px",
                maxHeight: "80vh", overflowY: "auto",
                animation: "slideUp 0.2s",
              }}>
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: "16px",
              }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: theme.text }}>
                  {isTyping ? "Nastavit nový úkol" : "Filtry"}
                </span>
                <button onClick={() => setPickerOpen(false)} style={{
                  ...buttonStyle(), width: "28px", height: "28px", padding: 0,
                  background: theme.inputBg, color: theme.textSub,
                  border: `1px solid ${theme.inputBorder}`, fontSize: "14px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>×</button>
              </div>

              {/* Kategorie section */}
              <div style={{
                fontSize: "10px", color: theme.textMid, fontWeight: 700,
                marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.3px",
              }}>Kategorie</div>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px",
                marginBottom: "16px",
              }}>
                {/* "Vše" pseudo-kategorie — resetuje filter */}
                {!isTyping && (
                  <button
                    onClick={() => onCategoryFilterChange("all")}
                    style={{
                      ...buttonStyle(),
                      padding: "10px 4px", fontSize: "13px",
                      background: categoryFilter === "all" ? theme.accentSoft : theme.inputBg,
                      color: categoryFilter === "all" ? theme.accent : theme.text,
                      border: `2px solid ${categoryFilter === "all" ? theme.accentBorder : theme.inputBorder}`,
                      borderRadius: "10px",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
                    }}>
                    <span style={{ fontSize: "22px" }}>📋</span>
                    <span style={{ fontSize: "10px", fontWeight: 600 }}>Vše</span>
                    {categoryCounts?.all > 0 && (
                      <span style={{
                        fontSize: "9px", color: categoryFilter === "all" ? theme.accent : theme.textMid,
                        fontWeight: 700,
                      }}>{categoryCounts.all}</span>
                    )}
                  </button>
                )}
                {CATEGORIES.filter(c => c.id !== "other").map(cat => {
                  const isHighlighted = isTyping
                    ? quickCategory === cat.id
                    : categoryFilter === cat.id;
                  const count = categoryCounts?.[cat.id] || 0;
                  return (
                    <button key={cat.id}
                      onClick={() => {
                        if (isTyping) {
                          setQuickCategory(quickCategory === cat.id ? null : cat.id);
                        } else {
                          onCategoryFilterChange(categoryFilter === cat.id ? "all" : cat.id);
                        }
                      }}
                      style={{
                        ...buttonStyle(),
                        padding: "10px 4px", fontSize: "13px",
                        background: isHighlighted ? theme.accentSoft : theme.inputBg,
                        color: isHighlighted ? theme.accent : theme.text,
                        border: `2px solid ${isHighlighted ? theme.accentBorder : theme.inputBorder}`,
                        borderRadius: "10px",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
                      }}>
                      <span style={{ fontSize: "22px" }}>{cat.icon}</span>
                      <span style={{ fontSize: "10px", fontWeight: 600 }}>{cat.label}</span>
                      {count > 0 && !isTyping && (
                        <span style={{
                          fontSize: "9px", color: isHighlighted ? theme.accent : theme.textMid,
                          fontWeight: 700,
                        }}>{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Priorita section */}
              <div style={{
                fontSize: "10px", color: theme.textMid, fontWeight: 700,
                marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.3px",
              }}>Priorita</div>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px",
                marginBottom: "16px",
              }}>
                {PRIORITIES.map(pri => {
                  const priTheme = theme.priority[pri.id];
                  const activePri = isTyping ? (quickPriority || "low") : null;
                  const isHighlighted = isTyping && activePri === pri.id;
                  return (
                    <button key={pri.id}
                      onClick={() => {
                        if (isTyping) {
                          // low is default — clicking low again means "reset to low"
                          setQuickPriority(pri.id === "low" ? null : pri.id);
                        }
                      }}
                      disabled={!isTyping}
                      style={{
                        ...buttonStyle(),
                        padding: "10px 6px", fontSize: "12px",
                        background: isHighlighted ? priTheme.cardBg : theme.inputBg,
                        color: isHighlighted ? priTheme.text : theme.text,
                        border: `2px solid ${isHighlighted ? priTheme.border : theme.inputBorder}`,
                        borderRadius: "10px",
                        opacity: !isTyping ? 0.4 : 1,
                        display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
                      }}>
                      <span style={{ fontSize: "20px", fontWeight: 900, color: priTheme.text }}>
                        {pri.sym}
                      </span>
                      <span style={{ fontSize: "11px", fontWeight: 600 }}>{pri.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Pro koho / filter: uživatelé */}
              <div style={{
                fontSize: "10px", color: theme.textMid, fontWeight: 700,
                marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.3px",
              }}>{isTyping ? "Pro koho" : "Filtr podle osoby"}</div>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "6px",
                marginBottom: "12px",
              }}>
                {users.map(u => {
                  const isHighlighted = isTyping
                    ? quickAssignees.includes(u.name)
                    : (u.name === currentUser.name
                      ? scopeFilter === "my"
                      : scopeFilter === `person:${u.name}`);
                  return (
                    <button key={u.name}
                      onClick={() => {
                        if (isTyping) {
                          setQuickAssignees(prev =>
                            prev.includes(u.name)
                              ? prev.filter(n => n !== u.name)
                              : [...prev, u.name]
                          );
                        } else {
                          if (u.name === currentUser.name) {
                            onScopeFilterChange && onScopeFilterChange(scopeFilter === "my" ? "all" : "my");
                          } else {
                            const key = `person:${u.name}`;
                            onScopeFilterChange && onScopeFilterChange(scopeFilter === key ? "all" : key);
                          }
                        }
                      }}
                      style={{
                        ...buttonStyle(),
                        padding: "10px 8px", fontSize: "13px", fontWeight: 600,
                        background: isHighlighted ? theme.accentSoft : theme.inputBg,
                        color: isHighlighted ? theme.accent : theme.text,
                        border: `2px solid ${isHighlighted ? theme.accentBorder : theme.inputBorder}`,
                        borderRadius: "10px",
                      }}>
                      {u.name}
                    </button>
                  );
                })}
              </div>

              {/* Done button */}
              <button onClick={() => setPickerOpen(false)} style={{
                ...buttonStyle(), width: "100%", padding: "12px",
                background: theme.accent, color: "#fff", fontSize: "14px",
                marginTop: "8px",
              }}>
                Hotovo
              </button>
            </div>
          </div>
        );
      })()}

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

          <textarea placeholder="Poznámka..." value={note} onChange={e => setNote(e.target.value)}
            rows={2} style={{
              ...inputStyle(theme), fontSize: "13px", marginBottom: "8px",
              resize: "vertical", lineHeight: 1.4,
            }}
          />

          {/* Checklist builder for complex type */}
          {type === "complex" && (
            <div style={{
              marginBottom: "10px", padding: "10px",
              background: theme.inputBg, borderRadius: "8px",
              border: `1px solid ${theme.inputBorder}`,
            }}>
              <div style={labelStyle}>Checklist — přidej položky</div>
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
                  ...buttonStyle(), padding: "7px 14px",
                  background: theme.accent, color: "#fff", fontSize: "14px",
                }}>+</button>
              </div>
            </div>
          )}

          {/* Informační hint — Pro koho a Prioritu nastavuješ v liště nad formulářem */}
          <div style={{
            fontSize: "11px", color: theme.textSub, marginBottom: "10px",
            padding: "6px 10px", background: `${theme.accent}08`,
            border: `1px dashed ${theme.accentBorder}`, borderRadius: "6px",
            lineHeight: 1.4,
          }}>
            💡 <strong>Pro koho</strong> a <strong>Prioritu</strong> nastavuješ v liště nad formulářem (segmenty Kategorie / Priorita / Osoba).
          </div>

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
                      background: isSel ? theme.accentSoft : theme.inputBg,
                      color: isSel ? theme.accent : theme.textSub,
                      border: `1px solid ${isSel ? theme.accentBorder : theme.inputBorder}`,
                      borderRadius: "12px",
                    }}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick dates */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>Termín splnění</div>
            <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginBottom: "4px" }}>
              {quickDates.map(qd => (
                <button key={qd.label} onClick={() => setDueDate(qd.value)} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: dueDate === qd.value ? theme.accentSoft : theme.inputBg,
                  color: dueDate === qd.value ? theme.accent : theme.textSub,
                  border: `1px solid ${dueDate === qd.value ? theme.accentBorder : theme.inputBorder}`,
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
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: showFrom === sf.value ? theme.accentSoft : theme.inputBg,
                  color: showFrom === sf.value ? theme.accent : theme.textSub,
                  border: `1px solid ${showFrom === sf.value ? theme.accentBorder : theme.inputBorder}`,
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
              ...buttonStyle(), flex: 1, padding: "11px",
              background: theme.accent, color: "#fff", fontSize: "14px",
            }}>Přidat úkol</button>
            <button onClick={resetForm} style={{
              ...buttonStyle(), padding: "11px 16px",
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

function StatsBar({ tasks, currentUser, users, theme, onStatClick, activeStatId }) {
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

  // Helper: je úkol "viditelně aktivní" — tj. není done, není deleted,
  // a buď nemá showFrom nebo už showFrom nastal (není odložený do budoucnosti)
  const isVisiblyActive = (t) =>
    !isDone(t) && !isDeleted(t) &&
    !(t.showFrom && daysDiff(t.showFrom) > 0);

  // Aktivní úkoly které mám plnit JÁ (nezahrnuje odložené do budoucnosti)
  const myActive = tasks.filter(t =>
    isVisiblyActive(t) && t.assignedTo?.includes(currentUser.name)
  );

  // Úkoly, které JÁ jsem zadal NĚKOMU DRUHÉMU (ne sobě)
  const assignedByMeToOthers = tasks.filter(t =>
    isVisiblyActive(t) &&
    t.createdBy === currentUser.name &&
    !t.assignedTo?.every(a => a === currentUser.name)
  );

  // Úkoly které JÁ jsem splnil za tento týden
  const doneThisWeekByMe = tasks.filter(t =>
    t.status === "done" && t.completedAt && new Date(t.completedAt) >= weekAgo &&
    t.completedByUser === currentUser.name
  ).length;

  const overdueCount = myActive.filter(t => daysDiff(t.dueDate) < 0).length;

  // Per-user týdenní dokončené — ukáže aktivitu celé rodiny
  const perUserWeek = users.map(u => ({
    name: u.name,
    count: tasks.filter(t =>
      t.status === "done" && t.completedAt && new Date(t.completedAt) >= weekAgo &&
      t.completedByUser === u.name
    ).length,
  }));

  const stats = [
    { id: "my",       value: myActive.length,              label: "Zbývá mně",     color: theme.accent },
    { id: "assigned", value: assignedByMeToOthers.length,  label: "Zadáno druhým", color: theme.purple },
    { id: "done_week", value: doneThisWeekByMe,            label: "Splněno týden", color: theme.green },
    { id: "overdue",  value: overdueCount,                 label: "Po termínu",    color: overdueCount > 0 ? theme.red : theme.textDim },
  ];

  return (
    <div style={{ ...cardStyle(theme), padding: "12px 14px", marginBottom: "14px" }}>
      <div style={{ display: "flex", gap: "4px", marginBottom: perUserWeek.length > 1 ? "8px" : "0" }}>
        {stats.map((stat) => {
          const isActive = activeStatId === stat.id;
          return (
            <button key={stat.id}
              onClick={() => onStatClick && onStatClick(stat.id)}
              title={`Filtrovat: ${stat.label}`}
              style={{
                ...buttonStyle(),
                flex: "1 1 0",
                background: isActive ? `${stat.color}15` : "transparent",
                border: `1px solid ${isActive ? stat.color + "50" : "transparent"}`,
                borderRadius: "8px",
                padding: "6px 4px",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.15s",
              }}>
              <div style={{ fontSize: "18px", fontWeight: 700, color: stat.color }}>{stat.value}</div>
              <div style={{
                fontSize: "9px", color: theme.textMid, fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.2px", marginTop: "1px",
              }}>{stat.label}</div>
            </button>
          );
        })}
      </div>
      {perUserWeek.length > 1 && (
        <div style={{
          display: "flex", gap: "12px", justifyContent: "center",
          paddingTop: "6px", borderTop: `1px solid ${theme.cardBorder}`,
        }}>
          {perUserWeek.map(u => (
            <span key={u.name} style={{ fontSize: "10px", color: theme.textSub }}>
              {u.name}: <strong style={{ color: theme.green }}>{u.count}</strong> /týden
            </span>
          ))}
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

function AdminPanel({ users, onAdd, onRemove, onClose, theme }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");

  return (
    <div style={{ ...cardStyle(theme), padding: "16px", marginBottom: "14px", animation: "slideUp 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "14px", fontWeight: 700 }}>Správa uživatelů</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textSub, cursor: "pointer", fontSize: "18px" }}>×</button>
      </div>

      {users.map(u => (
        <div key={u.name} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 0", borderBottom: `1px solid ${theme.cardBorder}`,
        }}>
          <span style={{ fontSize: "13px" }}>
            {u.name} {u.admin && <span style={{ fontSize: "10px", color: theme.textSub }}>(admin)</span>}
          </span>
          {!u.admin && (
            <button onClick={() => onRemove(u.name)} style={{
              background: "none", border: "none", color: theme.red,
              fontSize: "11px", cursor: "pointer", fontFamily: FONT, fontWeight: 600,
            }}>Odebrat</button>
          )}
        </div>
      ))}

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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   UPDATES PANEL — inline expandable section showing
   comments and task changes the user hasn't seen yet
   ═══════════════════════════════════════════════════════ */

function UpdatesPanel({ comments, tasks, currentUser, users, open, onToggle, onNavigate, onMarkSeen, onQuickReply, theme }) {
  // Get unseen comments — the user hasn't seen them AND they're not by this user
  const unseenComments = comments.filter(c =>
    c.author !== currentUser.name &&
    !c.seenBy?.includes(currentUser.name)
  );

  // Only comments relevant to me: task is assigned to me, created by me, or it's on a shared task
  const relevantComments = unseenComments.filter(c => {
    const task = tasks.find(t => t.id === c.taskId);
    if (!task) return false;
    return (
      task.createdBy === currentUser.name ||
      task.assignedTo?.includes(currentUser.name) ||
      task.assignTo === "both"
    );
  });

  // Group by task
  const byTask = {};
  relevantComments.forEach(c => {
    if (!byTask[c.taskId]) byTask[c.taskId] = [];
    byTask[c.taskId].push(c);
  });

  const totalCount = relevantComments.length;
  const taskCount = Object.keys(byTask).length;
  const hasUpdates = totalCount > 0;

  // Quick reply state — single text field when user decides to reply
  const [replyTo, setReplyTo] = useState(null); // taskId or null
  const [replyText, setReplyText] = useState("");

  const sendReply = () => {
    if (replyTo && replyText.trim() && onQuickReply) {
      onQuickReply(replyTo, replyText.trim());
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

  // Compact header — always visible
  return (
    <div style={{
      ...cardStyle(theme),
      marginBottom: "14px",
      overflow: "hidden",
      animation: hasUpdates ? "slideUp 0.3s" : "none",
      borderColor: hasUpdates ? theme.accent + "40" : theme.cardBorder,
      borderWidth: hasUpdates ? "2px" : "1px",
      boxShadow: hasUpdates ? `0 0 0 3px ${theme.accent}10` : "none",
    }}>
      <button
        onClick={onToggle}
        style={{
          ...buttonStyle(),
          width: "100%", padding: "10px 14px",
          background: "transparent", color: theme.text,
          border: "none", textAlign: "left",
          display: "flex", alignItems: "center", gap: "10px",
          fontSize: "13px", fontWeight: 600,
          cursor: hasUpdates ? "pointer" : "default",
        }}
        disabled={!hasUpdates}>
        {/* Bell icon with badge */}
        <span style={{ position: "relative", fontSize: "17px" }}>
          🔔
          {hasUpdates && (
            <span style={{
              position: "absolute", top: "-6px", right: "-8px",
              background: theme.red, color: "#fff",
              fontSize: "9px", fontWeight: 800,
              padding: "1px 5px", borderRadius: "8px",
              minWidth: "16px", textAlign: "center",
              animation: "pulse 1.5s infinite",
            }}>
              {totalCount}
            </span>
          )}
        </span>
        <span style={{ flex: 1 }}>
          {hasUpdates
            ? `${totalCount} ${totalCount === 1 ? "nová zpráva" : totalCount < 5 ? "nové zprávy" : "nových zpráv"} v ${taskCount} ${taskCount === 1 ? "úkolu" : taskCount < 5 ? "úkolech" : "úkolech"}`
            : "Žádné nové zprávy"
          }
        </span>
        {hasUpdates && (
          <span style={{ fontSize: "10px", color: theme.textSub }}>
            {open ? "▲" : "▼"}
          </span>
        )}
      </button>

      {/* Expanded list */}
      {open && hasUpdates && (
        <div style={{
          borderTop: `1px solid ${theme.cardBorder}`,
          animation: "slideUp 0.2s",
        }}>
          {Object.entries(byTask).map(([taskId, taskComments]) => {
            const task = tasks.find(t => t.id === taskId);
            if (!task) return null;
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

                {/* Quick reply */}
                {replyTo === taskId ? (
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
                )}
              </div>
            );
          })}

          {/* Mark all as seen */}
          <button
            onClick={() => onMarkSeen(relevantComments.map(c => c.id))}
            style={{
              ...buttonStyle(),
              width: "100%", padding: "8px",
              background: theme.inputBg, color: theme.textSub,
              border: "none", borderTop: `1px solid ${theme.cardBorder}`,
              fontSize: "11px", fontWeight: 600,
            }}>
            ✓ Označit vše jako přečtené
          </button>
        </div>
      )}
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

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [comments, setComments] = useState([]);
  const [users, setUsers] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [filter, setFilter] = useState("my");
  const [viewStatus, setViewStatus] = useState("active");
  const [sortMode, setSortMode] = useState("smart");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all"); // "all" | "low" | "important" | "urgent"
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeferred, setShowDeferred] = useState(false); // Show deferred tasks in active view
  const [updatesPanelOpen, setUpdatesPanelOpen] = useState(false);
  const [scrollToTaskId, setScrollToTaskId] = useState(null);

  // Clear scrollToTaskId after a short delay so autoOpen doesn't re-trigger
  useEffect(() => {
    if (scrollToTaskId) {
      const t = setTimeout(() => setScrollToTaskId(null), 500);
      return () => clearTimeout(t);
    }
  }, [scrollToTaskId]);
  const [undoState, setUndoState] = useState(null);
  const [themeName, setThemeName] = useState(() => {
    try { return localStorage.getItem("ft_theme") || "dark"; } catch (e) { return "dark"; }
  });
  const [showAdmin, setShowAdmin] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
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
            try {
              const existingSub = await reg.pushManager.getSubscription();
              if (!existingSub) {
                const subscription = await reg.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: urlBase64ToUint8Array(
                    import.meta.env.VITE_VAPID_PUBLIC_KEY || ""
                  ),
                });
                console.log("✅ Push subscription created");
                // Save subscription to Supabase (will be linked to user on login)
                try {
                  localStorage.setItem("ft_push_sub", JSON.stringify(subscription.toJSON()));
                } catch (e) {}
              }
            } catch (err) {
              console.warn("Push subscription failed:", err);
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
  useEffect(() => {
    if (loading) return;

    const tasksChannel = supabase.channel("tasks-realtime-v11")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setTasks(prev => prev.find(t => t.id === payload.new.id) ? prev : [dbToTask(payload.new), ...prev]);
        } else if (payload.eventType === "UPDATE") {
          setTasks(prev => prev.map(t => t.id === payload.new.id ? dbToTask(payload.new) : t));
        } else if (payload.eventType === "DELETE") {
          setTasks(prev => prev.filter(t => t.id !== payload.old.id));
        }
      }).subscribe();

    const usersChannel = supabase.channel("users-realtime-v11")
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => {
        apiLoadUsers().then(setUsers);
      }).subscribe();

    const commentsChannel = supabase.channel("comments-realtime-v12")
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setComments(prev => prev.find(c => c.id === payload.new.id) ? prev : [...prev, dbToComment(payload.new)]);
        } else if (payload.eventType === "UPDATE") {
          setComments(prev => prev.map(c => c.id === payload.new.id ? dbToComment(payload.new) : c));
        } else if (payload.eventType === "DELETE") {
          setComments(prev => prev.filter(c => c.id !== payload.old.id));
        }
      }).subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(commentsChannel);
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
    setTasks(prev => {
      const next = updater(prev);
      const updated = next.find(t => t.id === taskId);
      if (updated) apiUpdateTask(updated);
      setUndoState({ previousTasks: prev, message, taskId });
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setUndoState(null), UNDO_MS);
      return next;
    });
  }, []);

  const addTask = useCallback(async (task) => {
    setTasks(prev => [task, ...prev]);
    await apiCreateTask(task);
    setPendingCount(getOfflineQueue().length);
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
      cancelled: "Nerealizováno", reopen: "Vráceno", in_progress: "Rozpracováno",
    };
    const message = `${actionLabels[action] || "Změněno"}: ${shortTitle}`;

    // Track completion so we can push-notify the creator AFTER state update
    let completedTaskForNotify = null;

    withUndo(message, taskId, prev => prev.map(task => {
      if (task.id !== taskId) return task;
      const now = new Date().toISOString();

      switch (action) {
        case "in_progress":
          return { ...task, status: "in_progress" };
        case "cancelled":
          return { ...task, status: "cancelled", completedAt: now, completedByUser: currentUser.name };
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
          return { ...task, status: "active", completedAt: null, completedByUser: null, doneBy: [] };
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

  const deleteTask = useCallback((taskId) => {
    const taskTitle = tasks.find(t => t.id === taskId)?.title || "";
    const shortTitle = taskTitle.length > 30 ? taskTitle.slice(0, 30) + "…" : taskTitle;

    withUndo(`Smazáno: ${shortTitle}`, taskId, prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return { ...task, status: "deleted", deletedAt: new Date().toISOString() };
    }));
  }, [tasks, withUndo]);

  // Permanently remove tasks in trash older than 30 days
  useEffect(() => {
    const cleanup = setInterval(async () => {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const toDelete = tasks.filter(t =>
        t.status === "deleted" && t.deletedAt && new Date(t.deletedAt).getTime() < cutoff
      );
      for (const task of toDelete) {
        await supabase.from("tasks").delete().eq("id", task.id);
        setTasks(prev => prev.filter(t => t.id !== task.id));
      }
    }, 3600000); // Check every hour
    return () => clearInterval(cleanup);
  }, [tasks]);

  const permanentlyDeleteTask = useCallback(async (taskId) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    await supabase.from("tasks").delete().eq("id", taskId);
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

    // Status filter
    if (viewStatus === "active") {
      const recentCutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
      result = result.filter(t => {
        if (!isDone(t) && !isDeleted(t)) {
          // In active view, hide planned (future showFrom) tasks UNLESS showDeferred is on
          if (t.showFrom && daysDiff(t.showFrom) > 0 && !showDeferred) return false;
          return true;
        }
        // Show recently completed tasks (within 24h) crossed out
        if (t.status === "done" && t.completedAt && new Date(t.completedAt).getTime() > recentCutoff) return true;
        // Show recently deleted tasks (within 24h) for undo possibility — user wanted this
        if (t.status === "deleted" && t.deletedAt && new Date(t.deletedAt).getTime() > recentCutoff) return true;
        return false;
      });
    }
    else if (viewStatus === "planned") {
      result = result.filter(t => t.showFrom && daysDiff(t.showFrom) > 0 && !isDone(t) && !isDeleted(t));
    }
    else if (viewStatus === "done") result = result.filter(t => t.status === "done");
    else if (viewStatus === "trash") result = result.filter(t => t.status === "deleted");

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

    // Search
    if (searchQuery) result = result.filter(t => searchMatch(t, searchQuery));

    // Sort — completed tasks always at bottom in active view
    if (sortMode === "smart") result = [...result].sort(smartSort);
    else if (sortMode === "priority") result = [...result].sort((a, b) => getPriority(a.priority).weight - getPriority(b.priority).weight);
    else if (sortMode === "date") result = [...result].sort((a, b) => daysDiff(a.dueDate) - daysDiff(b.dueDate));
    else if (sortMode === "created") result = [...result].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // In active view, push completed to bottom, then deleted below completed
    if (viewStatus === "active") {
      const active = result.filter(t => !isDone(t) && !isDeleted(t));
      const recentlyDone = result.filter(t => isDone(t))
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      const recentlyDeleted = result.filter(t => isDeleted(t))
        .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
      result = [...active, ...recentlyDone, ...recentlyDeleted];
    }

    return result;
  }, [tasks, currentUser, filter, viewStatus, sortMode, categoryFilter, priorityFilter, searchQuery, showDeferred]);

  // Render items — mixed list of task cards + checklist progress cards
  // Only in "active" view, we show completed checklist items from still-active tasks
  const renderItems = useMemo(() => {
    if (viewStatus !== "active") {
      // Other views: just tasks
      return filteredTasks.map(task => ({ type: "task", task, key: task.id }));
    }

    const items = [];
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;

    // Active tasks first, then done, then deleted
    const activeTasks = filteredTasks.filter(t => !isDone(t) && !isDeleted(t));
    const doneTasks = filteredTasks.filter(t => isDone(t));
    const deletedTasks = filteredTasks.filter(t => isDeleted(t));

    // Push active tasks
    activeTasks.forEach(task => items.push({ type: "task", task, key: task.id }));

    // For each active task, collect its recently-done checklist items (done within 24h)
    // They go into the "Dnes hotovo" section as progress cards
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

    // Done tasks with sortTime
    const doneCards = doneTasks.map(task => ({
      type: "task",
      task,
      key: task.id,
      sortTime: task.completedAt ? new Date(task.completedAt).getTime() : 0,
    }));

    // Merge progress + done, sort newest first (by sortTime)
    const combined = [...progressCards, ...doneCards].sort((a, b) => b.sortTime - a.sortTime);
    items.push(...combined);

    // Finally deleted
    deletedTasks.forEach(task => items.push({ type: "task", task, key: task.id }));

    return items;
  }, [filteredTasks, viewStatus]);

  // Helper: apply all filters EXCEPT the one being computed for.
  // `skip` parameter: "scope" | "status" | "category" | "priority" — omits that filter from counting.
  const countTasks = useCallback((predicate, skip = []) => {
    if (!currentUser) return 0;
    return tasks.filter(t => {
      if (!predicate(t)) return false;
      // Status filter (viewStatus) — skip if counting statuses
      if (!skip.includes("status")) {
        if (viewStatus === "active" && (isDone(t) || isDeleted(t))) return false;
        if (viewStatus === "active" && t.showFrom && daysDiff(t.showFrom) > 0 && !showDeferred) return false;
        if (viewStatus === "planned" && !(t.showFrom && daysDiff(t.showFrom) > 0 && !isDone(t) && !isDeleted(t))) return false;
        if (viewStatus === "done" && t.status !== "done") return false;
        if (viewStatus === "trash" && t.status !== "deleted") return false;
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
      return true;
    }).length;
  }, [tasks, currentUser, viewStatus, filter, categoryFilter, priorityFilter, showDeferred]);

  const stats = useMemo(() => {
    if (!currentUser) return {};
    return {
      // "my" count — scope skipped (counting per-scope)
      my: countTasks(t => t.assignedTo?.includes(currentUser.name), ["scope"]),
      forMe: countTasks(t =>
        t.assignedTo?.includes(currentUser.name) && t.createdBy !== currentUser.name,
        ["scope"]
      ),
      assigned: countTasks(t =>
        t.createdBy === currentUser.name && !t.assignedTo?.every(x => x === currentUser.name),
        ["scope"]
      ),
      shared: countTasks(t => t.assignTo === "both", ["scope"]),
      // "planned" count — status skipped, counts only deferred with all other filters
      planned: countTasks(t => t.showFrom && daysDiff(t.showFrom) > 0 && !isDone(t) && !isDeleted(t), ["status"]),
      // "done" count — status skipped
      done: countTasks(t => t.status === "done", ["status"]),
      // "trash" count
      trash: countTasks(t => t.status === "deleted", ["status"]),
      // "active" count (for viewStatus "Aktivní")
      active: countTasks(t => !isDone(t) && !isDeleted(t), ["status"]),
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
      minHeight: "100vh", background: theme.bg, fontFamily: FONT,
      color: theme.text, WebkitFontSmoothing: "antialiased",
    }}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Header ── */}
      <div style={{
        background: theme.headerBg, backdropFilter: "blur(20px)",
        borderBottom: `1px solid ${theme.cardBorder}`,
        padding: "11px 14px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 30,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 700, fontSize: "15px" }}>Úkoly</span>
          <button onClick={() => setThemeName(themeName === "dark" ? "light" : "dark")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", padding: "2px" }}>
            {themeName === "dark" ? "☀️" : "🌙"}
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
            }}>Odesílám {pendingCount}...</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {users.filter(u => u.name !== currentUser.name).map(u =>
            unreadCounts[u.name] > 0 ? (
              <button key={u.name}
                onClick={() => setFilter(`person:${u.name}`)}
                title={`Zobrazit úkoly pro ${u.name}`}
                style={{
                  ...buttonStyle(),
                  fontSize: "10px", color: theme.textSub,
                  background: "transparent", border: "none",
                  padding: "2px 4px", display: "flex", alignItems: "center", gap: "4px",
                }}>
                {u.name}: <span style={{
                  background: theme.yellow, color: "#fff", borderRadius: "8px",
                  padding: "1px 5px", fontSize: "9px", fontWeight: 800,
                }}>{unreadCounts[u.name]}</span>
              </button>
            ) : null
          )}
          {currentUser.admin && (
            <button onClick={() => setShowAdmin(!showAdmin)}
              style={{ background: "none", border: "none", color: theme.textSub, cursor: "pointer", fontSize: "13px" }}>
              ⚙️
            </button>
          )}
          {/* Notification diagnostic panel */}
          <button onClick={() => setShowNotifPanel(!showNotifPanel)}
            title="Nastavení notifikací"
            style={{ background: "none", border: "none", color: theme.textSub, cursor: "pointer", fontSize: "14px" }}>
            🔔
          </button>
          {/* Visible user name */}
          <span style={{
            fontSize: "12px", fontWeight: 600, color: theme.text,
            padding: "4px 8px", background: theme.accentSoft,
            border: `1px solid ${theme.accentBorder}`, borderRadius: "6px",
          }}>
            {currentUser.name}
          </span>
          <button onClick={() => setCurrentUser(null)} title="Odhlásit se" style={{
            ...buttonStyle(), background: theme.inputBg,
            border: `1px solid ${theme.inputBorder}`,
            color: theme.textSub, padding: "5px 9px", fontSize: "12px",
          }}>⏻</button>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: "560px", margin: "0 auto", padding: "14px 12px 140px" }}>

        {showAdmin && currentUser.admin && (
          <AdminPanel
            users={users}
            onAdd={async u => apiCreateUser(u)}
            onRemove={async n => apiDeleteUser(n)}
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

        <UpdatesPanel
          comments={comments}
          tasks={tasks}
          currentUser={currentUser}
          users={users}
          open={updatesPanelOpen}
          onToggle={() => setUpdatesPanelOpen(o => !o)}
          onNavigate={(taskId) => {
            setScrollToTaskId(taskId);
            setUpdatesPanelOpen(false);
          }}
          onMarkSeen={markCommentsSeen}
          onQuickReply={(taskId, text) => addComment(taskId, text)}
          theme={theme}
        />

        <StatsBar
          tasks={tasks}
          currentUser={currentUser}
          users={users}
          theme={theme}
          activeStatId={
            filter === "my" && viewStatus === "active" && sortMode === "smart" ? "my"
            : filter === "assigned" && viewStatus === "active" ? "assigned"
            : filter === "my" && viewStatus === "done" ? "done_week"
            : filter === "my" && viewStatus === "active" && sortMode === "date" ? "overdue"
            : null
          }
          onStatClick={(id) => {
            // Apply filter based on which stat was clicked
            if (id === "my") {
              setFilter("my"); setViewStatus("active"); setSortMode("smart");
            } else if (id === "assigned") {
              setFilter("assigned"); setViewStatus("active");
            } else if (id === "done_week") {
              setFilter("my"); setViewStatus("done");
            } else if (id === "overdue") {
              setFilter("my"); setViewStatus("active"); setSortMode("date");
            }
          }}
        />

        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: theme.bg,
          paddingTop: "2px",
          paddingBottom: "4px",
          marginLeft: "-2px",
          marginRight: "-2px",
          paddingLeft: "2px",
          paddingRight: "2px",
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
          />

          {/* Search */}
          <div style={{ marginBottom: "10px" }}>
            <input
              type="text"
              placeholder="🔍 Hledat v úkolech..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                ...inputStyle(theme), fontSize: "13px", padding: "8px 12px",
                background: searchQuery ? theme.accentSoft : theme.inputBg,
                border: `1px solid ${searchQuery ? theme.accentBorder : theme.inputBorder}`,
              }}
            />
          </div>

          {/* Compact filters — one row */}
          <div style={{
            display: "flex", alignItems: "center", gap: "4px",
            marginBottom: "8px", flexWrap: "wrap",
          }}>
            {/* Scope filter — includes per-person */}
            <select value={filter} onChange={e => setFilter(e.target.value)} style={{
              ...inputStyle(theme), width: "auto", padding: "4px 8px", fontSize: "11px",
              background: theme.accentSoft, border: `1px solid ${theme.accentBorder}`,
              color: theme.accent, fontWeight: 600,
            }}>
              <option value="my">👤 Moje ({stats.my})</option>
              <option value="for_me">📥 Pro mě ({stats.forMe || 0})</option>
              {users.filter(u => u.name !== currentUser.name).map(u => (
                <option key={u.name} value={`person:${u.name}`}>👤 {u.name}</option>
              ))}
              <option value="assigned">📤 Zadané ({stats.assigned})</option>
              <option value="shared">👥 Společné ({stats.shared})</option>
              <option value="unread">🔴 Nové ({unreadCounts[currentUser.name] || 0})</option>
              <option value="all">📋 Vše</option>
            </select>

            {/* Status */}
            <select value={viewStatus} onChange={e => setViewStatus(e.target.value)} style={{
              ...inputStyle(theme), width: "auto", padding: "4px 8px", fontSize: "11px",
              background: "transparent", border: `1px solid ${theme.inputBorder}`,
              color: theme.textSub,
            }}>
              <option value="active">⚡ Aktivní ({stats.active || 0})</option>
              <option value="planned">⏰ Plánované ({stats.planned || 0})</option>
              <option value="done">✓ Splněné ({stats.done || 0})</option>
              <option value="trash">🗑 Koš ({stats.trash || 0})</option>
            </select>

            {/* Sort */}
            <select value={sortMode} onChange={e => setSortMode(e.target.value)} style={{
              ...inputStyle(theme), width: "auto", padding: "4px 8px", fontSize: "11px",
              background: "transparent", border: `1px solid ${theme.inputBorder}`,
              color: theme.textSub,
            }}>
              <option value="smart">↕ Chytré</option>
              <option value="priority">↕ Priorita</option>
              <option value="date">↕ Termín</option>
              <option value="created">↕ Nejnovější</option>
            </select>
          </div>
        </div>

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
              let shownDoneSep = false;
              let shownDelSep = false;
              return renderItems.map(item => {
                const task = item.task;
                // Show "Dnes hotovo" separator when we encounter first done task OR first progress item
                const isDoneSection =
                  (item.type === "task" && isDone(task) && !isDeleted(task)) ||
                  item.type === "progress";
                const showDoneSep = viewStatus === "active" && isDoneSection && !shownDoneSep;
                if (showDoneSep) shownDoneSep = true;

                const showDelSep = viewStatus === "active" && item.type === "task" && isDeleted(task) && !shownDelSep;
                if (showDelSep) shownDelSep = true;

                return (
                  <div key={item.key}>
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
                      progressItem={item.type === "progress" ? item.checklistItem : null}
                    />
                  </div>
                );
              });
            })()}
          </div>
        )}

        <Legend theme={theme} />
      </div>

      <Snackbar
        message={undoState?.message}
        visible={!!undoState}
        onUndo={performUndo}
        theme={theme}
      />
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase, dbToTask, taskToDb, dbToUser } from "./supabase.js";

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

function daysDiff(dateStr) {
  if (!dateStr) return Infinity;
  return Math.round((new Date(dateStr) - new Date(new Date().toDateString())) / 86400000);
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
   CHECKLIST COMPONENT
   ═══════════════════════════════════════════════════════ */

function Checklist({ items = [], onChange, userName, theme, onAllCompleted }) {
  const [newItemText, setNewItemText] = useState("");

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

      {items.map(item => (
        <div key={item.id} style={{
          display: "flex", alignItems: "center", gap: "8px",
          padding: "6px 8px", borderRadius: "6px",
          background: item.done ? `${theme.green}08` : theme.inputBg,
          border: `1px solid ${item.done ? theme.green + "15" : theme.inputBorder}`,
          marginBottom: "3px",
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
          <span style={{
            flex: 1, fontSize: "13px",
            color: item.done ? theme.textSub : theme.text,
            textDecoration: item.done ? "line-through" : "none",
            lineHeight: 1.3,
          }}>
            {item.text}
            {item.done && item.doneBy && (
              <span style={{ fontSize: "10px", color: theme.textMid, marginLeft: "6px" }}>
                — {item.doneBy}
              </span>
            )}
          </span>
        </div>
      ))}

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
   TASK DETAIL (inline edit panel)
   ═══════════════════════════════════════════════════════ */

function TaskDetail({ task, currentUser, users, onUpdate, onStatusChange, onDelete, onRestore, onPermanentDelete, theme, showCompleteBanner, onClose }) {
  const otherUsers = users.filter(u => u.name !== currentUser.name);
  const canAct = task.assignTo === "both" || task.assignedTo?.includes(currentUser.name) || task.createdBy === currentUser.name;
  const taskIsDone = isDone(task);

  // Local state for title/note — saves only on button click, not on every keystroke
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNote, setEditNote] = useState(task.note || "");
  const hasTextChanges = editTitle !== task.title || editNote !== (task.note || "");

  const saveTextChanges = () => {
    const changes = {};
    if (editTitle !== task.title) changes.title = editTitle;
    if (editNote !== (task.note || "")) changes.note = editNote.trim() || null;
    if (Object.keys(changes).length > 0) onUpdate(task.id, changes);
  };

  const labelStyle = {
    fontSize: "10px", color: theme.textMid, fontWeight: 700,
    marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.3px"
  };

  const updateField = (key, value) => onUpdate(task.id, { [key]: value });

  const quickDates = [
    { label: "Dnes",   value: addDays(0) },
    { label: "Zítra",  value: addDays(1) },
    { label: "3d",     value: addDays(3) },
    { label: "Týden",  value: addDays(7) },
    { label: "14d",    value: addDays(14) },
    { label: "Měsíc",  value: addDays(30) },
  ];

  return (
    <div style={{ marginTop: "10px", paddingLeft: "32px", animation: "fadeIn 0.12s" }}
         onClick={e => e.stopPropagation()}>

      {/* ── Top bar: back to list + cycling priority ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px",
      }}>
        <button onClick={onClose} title="Přepnout na seznam"
          style={{
            ...buttonStyle(),
            padding: "6px 10px", fontSize: "12px",
            background: theme.inputBg, color: theme.textSub,
            border: `1px solid ${theme.inputBorder}`,
            display: "flex", alignItems: "center", gap: "4px",
          }}>
          ☰ Přepnout na seznam
        </button>

        {/* Cycling priority icon — matches quick-add bar behavior */}
        {!taskIsDone && (() => {
          const currentPri = task.priority || "low";
          const priObj = getPriority(currentPri);
          const priTheme = theme.priority[currentPri];
          const isDefault = currentPri === "low";
          const cycleNext = () => {
            // low → important → urgent → low
            const next = currentPri === "low" ? "important"
                       : currentPri === "important" ? "urgent"
                       : "low";
            onUpdate(task.id, { priority: next });
          };
          return (
            <button onClick={cycleNext} title={`Priorita: ${priObj.label} (klikni pro změnu)`}
              style={{
                ...buttonStyle(),
                minWidth: "36px", height: "30px", padding: "0 8px",
                fontSize: "14px", fontWeight: 800,
                background: isDefault ? "transparent" : priTheme.cardBg,
                color: isDefault ? theme.textDim : priTheme.text,
                border: `2px solid ${isDefault ? theme.inputBorder : priTheme.border}`,
                borderRadius: "8px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "3px",
                opacity: isDefault ? 0.5 : 1,
                transition: "all 0.15s",
              }}>
              ❗ <span style={{ fontSize: "10px" }}>{priObj.label}</span>
            </button>
          );
        })()}
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

      {/* ── Save button — only visible when changes exist ── */}
      {hasTextChanges && (
        <button onClick={saveTextChanges} style={{
          ...buttonStyle(), width: "100%", padding: "8px",
          background: theme.accent, color: "#fff", fontSize: "13px",
          marginBottom: "8px",
        }}>
          💾 Uložit změny
        </button>
      )}

      {!taskIsDone && (
        <>
          {/* ── Quick settings grid — Kategorie + Pro koho ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
            <div>
              <div style={labelStyle}>Kategorie</div>
              <select value={task.category || "other"} onChange={e => updateField("category", e.target.value)}
                style={{ ...inputStyle(theme), padding: "8px", fontSize: "12px" }}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Pro koho</div>
              <select
                value={task.assignTo === "person" ? "person" : task.assignTo}
                onChange={e => {
                  const val = e.target.value;
                  if (val === "self") {
                    updateField("assignedTo", [currentUser.name]);
                    updateField("assignTo", "self");
                  } else if (val === "both") {
                    updateField("assignedTo", users.map(u => u.name));
                    updateField("assignTo", "both");
                  } else if (otherUsers[0]) {
                    updateField("assignedTo", [otherUsers[0].name]);
                    updateField("assignTo", "person");
                  }
                }}
                style={{ ...inputStyle(theme), padding: "8px", fontSize: "12px" }}>
                <option value="self">Pro mě</option>
                {otherUsers.map(o => <option key={o.name} value="person">Pro {o.name}</option>)}
                <option value="both">Pro všechny</option>
              </select>
            </div>
          </div>

          {/* ── Recurrence (full width, standalone) ── */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>Opakování</div>
            <select value={task.recDays || 0} onChange={e => updateField("recDays", Number(e.target.value))}
              style={{ ...inputStyle(theme), padding: "8px", fontSize: "12px" }}>
              {RECURRENCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {/* ── Due date with quick picks ── */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>
              Termín {task.dueDate && <span style={{ fontWeight: 400, textTransform: "none" }}>— {formatDate(task.dueDate)}</span>}
            </div>
            <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginBottom: "4px" }}>
              {quickDates.map(qd => (
                <button key={qd.label} onClick={() => updateField("dueDate", qd.value)} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: task.dueDate === qd.value ? theme.accentSoft : theme.inputBg,
                  color: task.dueDate === qd.value ? theme.accent : theme.textSub,
                  border: `1px solid ${task.dueDate === qd.value ? theme.accentBorder : theme.inputBorder}`,
                }}>{qd.label}</button>
              ))}
              {task.dueDate && (
                <button onClick={() => updateField("dueDate", null)} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: "transparent", color: theme.red,
                  border: `1px solid ${theme.red}25`,
                }}>✕</button>
              )}
            </div>
            <input type="date" value={task.dueDate || ""}
              onChange={e => updateField("dueDate", e.target.value || null)}
              style={{ ...inputStyle(theme), fontSize: "12px", padding: "6px 10px" }}
            />
          </div>

          {/* ── Show from — deferred tasks ── */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>
              Zobrazit od {task.showFrom && <span style={{ fontWeight: 400, textTransform: "none" }}>— {formatDate(task.showFrom)}</span>}
            </div>
            <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginBottom: "4px" }}>
              {[
                { label: "Za týden", value: addDays(7) },
                { label: "Za 14d", value: addDays(14) },
                { label: "Za měsíc", value: addDays(30) },
                { label: "Za 2 měsíce", value: addDays(60) },
              ].map(sf => (
                <button key={sf.label} onClick={() => updateField("showFrom", sf.value)} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: task.showFrom === sf.value ? theme.accentSoft : theme.inputBg,
                  color: task.showFrom === sf.value ? theme.accent : theme.textSub,
                  border: `1px solid ${task.showFrom === sf.value ? theme.accentBorder : theme.inputBorder}`,
                }}>{sf.label}</button>
              ))}
              {task.showFrom && (
                <button onClick={() => updateField("showFrom", null)} style={{
                  ...buttonStyle(), padding: "4px 7px", fontSize: "10px",
                  background: "transparent", color: theme.red,
                  border: `1px solid ${theme.red}25`,
                }}>✕ Zobrazit hned</button>
              )}
            </div>
            <input type="date" value={task.showFrom || ""}
              onChange={e => updateField("showFrom", e.target.value || null)}
              style={{ ...inputStyle(theme), fontSize: "12px", padding: "6px 10px" }}
            />
            {task.showFrom && (
              <div style={{ fontSize: "11px", color: theme.accent, marginTop: "3px" }}>
                📅 Úkol se zobrazí od {formatDate(task.showFrom)}{task.dueDate ? `, termín ${formatDate(task.dueDate)}` : ""}
              </div>
            )}
          </div>

          {/* ── Season months for recurring ── */}
          {task.recDays > 0 && (
            <div style={{ marginBottom: "8px" }}>
              <div style={labelStyle}>Aktivní měsíce (prázdné = celoročně)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                {MONTH_LABELS.map((m, i) => {
                  const monthNum = i + 1;
                  const isActive = (task.activeMo || []).includes(monthNum);
                  return (
                    <button key={i} onClick={() => {
                      const current = task.activeMo || [];
                      updateField("activeMo", isActive
                        ? current.filter(x => x !== monthNum)
                        : [...current, monthNum]
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

          {/* ── Type toggle (simple ↔ complex) ── */}
          <button onClick={() => {
            const newType = task.type === "complex" ? "simple" : "complex";
            onUpdate(task.id, {
              type: newType,
              checklist: newType === "complex" ? (task.checklist || []) : task.checklist,
            });
          }} style={{
            ...buttonStyle(), padding: "5px 10px", fontSize: "10px",
            background: theme.inputBg, color: theme.textSub,
            border: `1px solid ${theme.inputBorder}`, marginBottom: "6px",
          }}>
            {task.type === "complex"
              ? "☰ Komplexní → Přepnout na jednoduchý"
              : "✓ Jednoduchý → Přepnout na checklist"
            }
          </button>
        </>
      )}

      {/* ── Checklist (shown for complex type OR if items exist) ── */}
      {(task.type === "complex" || (task.checklist && task.checklist.length > 0)) && (
        <Checklist
          items={task.checklist || []}
          userName={currentUser.name}
          theme={theme}
          onChange={cl => updateField("checklist", cl)}
          onAllCompleted={() => {}}
        />
      )}

      {/* ── Images ── */}
      {(task.images?.length > 0 || !taskIsDone) && (
        <ImageAttachments
          images={task.images || []}
          theme={theme}
          onChange={imgs => updateField("images", imgs)}
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
          <ActionButton label="⏰ Odlož" onClick={() => updateField("showFrom", addDays(7))} theme={theme} subtle />
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

function TaskCard({ task, currentUser, users, onStatusChange, onMarkSeen, onUpdate, onDelete, onRestore, onPermanentDelete, theme }) {
  const [isOpen, setIsOpen] = useState(false);

  const isNew = !task.seenBy?.includes(currentUser.name) && task.createdBy !== currentUser.name;
  const overdue = daysDiff(task.dueDate) < 0 && !isDone(task);
  const soon = !overdue && daysDiff(task.dueDate) >= 0 && daysDiff(task.dueDate) <= 3 && !isDone(task);
  const forgotten = isForgotten(task);
  const taskIsDone = isDone(task);
  const inProgress = task.status === "in_progress" ||
    (task.assignTo === "both" && (task.doneBy?.length || 0) > 0 && task.status !== "done");

  const priority = getPriority(task.priority);
  const priorityTheme = theme.priority[priority.id];
  const canAct = task.assignTo === "both" || task.assignedTo?.includes(currentUser.name) || task.createdBy === currentUser.name;

  const checklistDone = task.checklist?.filter(c => c.done).length || 0;
  const checklistTotal = task.checklist?.length || 0;
  const allChecked = checklistTotal > 0 && checklistDone === checklistTotal;

  const handleClick = () => {
    // Don't toggle if task was just reopened (status change closes detail)
    const opening = !isOpen;
    setIsOpen(opening);
    if (opening && isNew) onMarkSeen(task.id);
  };

  const handleQuickComplete = (e) => {
    e.stopPropagation();
    setIsOpen(false); // Close detail if open
    if (task.assignTo === "both") onStatusChange(task.id, "done_my");
    else onStatusChange(task.id, "done");
  };

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

  // Left border color — priority color by default, overridden by state
  let leftBorderColor = priorityTheme.text;
  if (forgotten) leftBorderColor = theme.purple;
  if (soon) leftBorderColor = theme.yellow;
  if (overdue) leftBorderColor = theme.red;
  if (isNew) leftBorderColor = theme.green;

  return (
    <div onClick={handleClick} style={{
      background: cardBackground,
      border: `1px solid ${cardBorderColor}`,
      borderRadius: "12px",
      borderLeft: `5px solid ${leftBorderColor}`,
      padding: "11px 13px",
      opacity: taskIsDone ? 0.35 : 1,
      cursor: "pointer",
      position: "relative",
      animation: isNew ? "glow 2s ease 3, slideUp 0.3s ease"
        : taskIsDone ? "completedFade 0.5s ease forwards"
        : "slideUp 0.3s ease",
      transition: "all 0.2s",
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
        {/* Quick complete checkbox */}
        {!taskIsDone && canAct ? (
          <button onClick={handleQuickComplete} style={{
            width: "32px", height: "32px", minWidth: "32px",
            borderRadius: "8px",
            border: `2.5px solid ${inProgress ? theme.yellow : priorityTheme.text}`,
            background: inProgress ? `${theme.yellow}20` : `${priorityTheme.text}10`,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: inProgress ? theme.yellow : priorityTheme.text,
            fontSize: "14px", fontWeight: 700,
            transition: "all 0.15s",
          }} title="Splnit">
            {inProgress ? "◐" : "○"}
          </button>
        ) : (
          <button onClick={(e) => {
            e.stopPropagation();
            onStatusChange(task.id, "reopen");
          }} style={{
            width: "32px", height: "32px", minWidth: "32px",
            borderRadius: "8px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "16px", fontWeight: 700,
            background: task.status === "cancelled" ? `${theme.priority.low.text}15` : `${theme.green}20`,
            color: task.status === "cancelled" ? theme.priority.low.text : theme.green,
            border: `2.5px solid ${task.status === "cancelled" ? theme.priority.low.text + "40" : theme.green + "50"}`,
            cursor: "pointer",
            transition: "all 0.15s",
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
          }}>
            {task.title}
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            marginTop: "4px", flexWrap: "wrap",
          }}>
            {/* Priority with STRONG visual */}
            <span style={{
              fontSize: "11px", fontWeight: 800,
              color: priorityTheme.text, letterSpacing: "0.5px",
              background: priorityTheme.bg,
              padding: "1px 6px", borderRadius: "4px",
              border: `1px solid ${priorityTheme.border}`,
            }}>
              {priority.sym} {priority.label}
            </span>

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
            {task.dueDate && (
              <span style={{
                fontSize: "10px", fontWeight: 600,
                color: overdue ? theme.red : soon ? theme.yellow : theme.textMid,
              }}>
                {overdue ? "⚠ " : ""}{formatDate(task.dueDate)}
              </span>
            )}
            {taskIsDone && task.completedByUser && (
              <span style={{ fontSize: "10px", color: theme.textMid }}>✓ {task.completedByUser}</span>
            )}
          </div>
        </div>

        {/* Right side: chevron only */}
        <span style={{ fontSize: "10px", color: theme.textDim, marginTop: "5px", marginLeft: "4px" }}>
          {isOpen ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded detail */}
      {isOpen && (
        <TaskDetail
          task={task}
          currentUser={currentUser}
          users={users}
          onUpdate={onUpdate}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
          onRestore={onRestore}
          onPermanentDelete={onPermanentDelete}
          theme={theme}
          showCompleteBanner={allChecked}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   QUICK ADD BAR
   ═══════════════════════════════════════════════════════ */

function QuickAddBar({ currentUser, users, onAdd, theme, categoryFilter, onCategoryFilterChange, categoryCounts }) {
  const [text, setText] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [note, setNote] = useState("");
  const [type, setType] = useState("simple");
  const [assign, setAssign] = useState("self");
  const [priority, setPriority] = useState("low");
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState(0);
  const [category, setCategory] = useState("other");
  const [initialChecklist, setInitialChecklist] = useState([]);
  const [checklistInput, setChecklistInput] = useState("");
  const [quickCategory, setQuickCategory] = useState(null);
  const [quickPriority, setQuickPriority] = useState(null); // null = default "important"
  const [showFrom, setShowFrom] = useState("");
  const inputRef = useRef();
  const otherUsers = users.filter(u => u.name !== currentUser.name);

  const createTaskObject = (title) => ({
    id: generateId(),
    title,
    note: note.trim() || null,
    type,
    createdBy: currentUser.name,
    assignTo: assign === "person" ? "person" : assign,
    assignedTo: assign === "self" ? [currentUser.name]
      : assign === "person" ? [otherUsers[0]?.name || currentUser.name]
      : users.map(u => u.name),
    priority: quickPriority || priority,
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
  });

  const quickSubmit = () => {
    if (!text.trim()) return;
    onAdd(createTaskObject(text.trim()));
    setText("");
    setQuickCategory(null);
    setQuickPriority(null);
    inputRef.current?.focus();
  };

  const fullSubmit = () => {
    if (!text.trim()) return;
    onAdd(createTaskObject(text.trim()));
    resetForm();
  };

  const resetForm = () => {
    setText(""); setNote(""); setDueDate(""); setRecurrence(0);
    setPriority("low"); setAssign("self"); setCategory("other");
    setType("simple"); setShowFull(false); setShowFrom("");
    setInitialChecklist([]); setChecklistInput(""); setQuickCategory(null);
    setQuickPriority(null);
  };

  const labelStyle = {
    fontSize: "10px", color: theme.textMid, fontWeight: 700,
    marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.3px"
  };

  const quickDates = [
    { label: "Dnes", value: addDays(0) },
    { label: "Zítra", value: addDays(1) },
    { label: "3d", value: addDays(3) },
    { label: "Týden", value: addDays(7) },
    { label: "14d", value: addDays(14) },
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

      {/* Category icon bar — dual purpose: FILTER (when not typing) + CATEGORY pick (when typing) */}
      {!showFull && (
        <div style={{
          display: "flex", gap: "2px", marginTop: "4px",
          paddingLeft: "4px", overflowX: "auto",
        }}>
          {(() => {
            const isTyping = text.trim().length > 0;
            return CATEGORIES.filter(c => c.id !== "other").map(cat => {
              // In typing mode: highlight = quickCategory match
              // In filter mode: highlight = categoryFilter match
              const isHighlighted = isTyping ? (quickCategory === cat.id) : (categoryFilter === cat.id);
              const anyActive = isTyping ? !!quickCategory : (categoryFilter !== "all");
              const count = categoryCounts?.[cat.id] || 0;

              return (
                <button key={cat.id}
                  onClick={() => {
                    if (isTyping) {
                      // Typing mode → set/toggle category for new task
                      setQuickCategory(quickCategory === cat.id ? null : cat.id);
                    } else {
                      // Filter mode → toggle category filter
                      onCategoryFilterChange(categoryFilter === cat.id ? "all" : cat.id);
                    }
                  }}
                  title={cat.label + (count > 0 ? ` (${count})` : "")}
                  style={{
                    ...buttonStyle(),
                    minWidth: "32px", height: "30px",
                    padding: "0 4px",
                    fontSize: "15px",
                    background: isHighlighted ? theme.accentSoft : "transparent",
                    border: `2px solid ${isHighlighted ? theme.accentBorder : "transparent"}`,
                    borderRadius: "8px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: "2px",
                    opacity: anyActive && !isHighlighted ? 0.3 : 1,
                    transition: "all 0.15s",
                  }}>
                  {cat.icon}
                  {count > 0 && !isTyping && (
                    <span style={{
                      fontSize: "9px", fontWeight: 700,
                      color: isHighlighted ? theme.accent : theme.textDim,
                    }}>{count}</span>
                  )}
                </button>
              );
            });
          })()}

          {/* Divider */}
          <span style={{ width: "1px", height: "20px", background: theme.cardBorder, margin: "0 2px", flexShrink: 0 }} />

          {/* Priority cycling icon — always visible as grey ❗, lights up on click */}
          {(() => {
            // Cycle: null(low) → important → urgent → null(low)
            const currentPri = quickPriority || "low";
            const priObj = getPriority(currentPri);
            const priTheme = theme.priority[currentPri];
            const isDefault = !quickPriority || quickPriority === "low";
            const cycleNext = () => {
              if (!quickPriority || quickPriority === "low") setQuickPriority("important");
              else if (quickPriority === "important") setQuickPriority("urgent");
              else setQuickPriority(null); // back to low (default)
            };
            return (
              <button onClick={cycleNext} title={`Priorita: ${priObj.label} (klikni pro změnu)`}
                style={{
                  ...buttonStyle(),
                  minWidth: "34px", height: "30px", padding: "0 6px",
                  fontSize: "16px", fontWeight: 800,
                  background: isDefault ? "transparent" : priTheme.cardBg,
                  color: isDefault ? theme.textDim : priTheme.text,
                  border: `2px solid ${isDefault ? theme.inputBorder : priTheme.border}`,
                  borderRadius: "8px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                  opacity: isDefault ? 0.5 : 1,
                }}>
                ❗
              </button>
            );
          })()}

          {/* Mode indicator / reset filter */}
          {text.trim() ? (
            <span style={{
              fontSize: "9px", color: theme.textMid, display: "flex",
              alignItems: "center", paddingLeft: "4px", whiteSpace: "nowrap",
            }}>← kategorie</span>
          ) : categoryFilter !== "all" && (
            <button onClick={() => onCategoryFilterChange("all")}
              title="Zobrazit vše"
              style={{
                ...buttonStyle(), minWidth: "32px", height: "30px",
                fontSize: "11px", color: theme.red,
                background: "transparent",
                border: `1px solid ${theme.red}25`,
                borderRadius: "8px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>✕</button>
          )}
        </div>
      )}

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
                  <span style={{ flex: 1, fontSize: "13px", color: theme.text }}>{item.text}</span>
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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
            <div>
              <div style={labelStyle}>Pro koho</div>
              <select value={assign} onChange={e => setAssign(e.target.value)}
                style={{ ...inputStyle(theme), padding: "8px", fontSize: "12px" }}>
                <option value="self">Pro mě</option>
                {otherUsers.length === 1 && <option value="person">Pro {otherUsers[0].name}</option>}
                <option value="both">Pro všechny</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Priorita</div>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                style={{ ...inputStyle(theme), padding: "8px", fontSize: "12px" }}>
                {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.sym} {p.label}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Kategorie</div>
              <select value={category} onChange={e => setCategory(e.target.value)}
                style={{ ...inputStyle(theme), padding: "8px", fontSize: "12px" }}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Opakování</div>
              <select value={recurrence} onChange={e => setRecurrence(Number(e.target.value))}
                style={{ ...inputStyle(theme), padding: "8px", fontSize: "12px" }}>
                {RECURRENCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          {/* Quick dates */}
          <div style={{ marginBottom: "8px" }}>
            <div style={labelStyle}>Termín</div>
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
                { label: "Za týden", value: addDays(7) },
                { label: "Za 14d", value: addDays(14) },
                { label: "Za měsíc", value: addDays(30) },
                { label: "Za 2 měsíce", value: addDays(60) },
              ].map(sf => (
                <button key={sf.label} onClick={() => setShowFrom(sf.value)} style={{
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

function StatsBar({ tasks, currentUser, users, theme }) {
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

  // Aktivní úkoly které mám plnit JÁ
  const myActive = tasks.filter(t =>
    !isDone(t) && !isDeleted(t) && t.assignedTo?.includes(currentUser.name)
  );

  // Úkoly, které JÁ jsem zadal NĚKOMU DRUHÉMU (ne sobě)
  const assignedByMeToOthers = tasks.filter(t =>
    !isDone(t) && !isDeleted(t) &&
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

  return (
    <div style={{ ...cardStyle(theme), padding: "12px 14px", marginBottom: "14px" }}>
      <div style={{ display: "flex", gap: "4px", marginBottom: perUserWeek.length > 1 ? "8px" : "0" }}>
        {[
          { value: myActive.length, label: "Zbývá mně", color: theme.accent },
          { value: assignedByMeToOthers.length, label: "Zadáno druhým", color: theme.purple },
          { value: doneThisWeekByMe, label: "Splněno týden", color: theme.green },
          { value: overdueCount, label: "Po termínu", color: overdueCount > 0 ? theme.red : theme.textDim },
        ].map((stat, i) => (
          <div key={i} style={{ flex: "1 1 0", textAlign: "center" }}>
            <div style={{ fontSize: "18px", fontWeight: 700, color: stat.color }}>{stat.value}</div>
            <div style={{
              fontSize: "9px", color: theme.textMid, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.2px", marginTop: "1px",
            }}>{stat.label}</div>
          </div>
        ))}
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
  const [users, setUsers] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [filter, setFilter] = useState("my");
  const [viewStatus, setViewStatus] = useState("active");
  const [sortMode, setSortMode] = useState("smart");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [undoState, setUndoState] = useState(null);
  const [themeName, setThemeName] = useState(() => {
    try { return localStorage.getItem("ft_theme") || "dark"; } catch (e) { return "dark"; }
  });
  const [showAdmin, setShowAdmin] = useState(false);
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
        const [freshUsers, freshTasks] = await Promise.all([apiLoadUsers(), apiLoadTasks()]);
        setUsers(freshUsers);
        setTasks(freshTasks);
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

      const [loadedUsers, loadedTasks] = await Promise.all([apiLoadUsers(), apiLoadTasks()]);
      setUsers(loadedUsers);
      const { tasks: processed, updates } = processRecurring(loadedTasks);
      setTasks(processed);
      if (updates.length > 0) apiUpdateTasks(updates);
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
        !t.seenBy?.includes(currentUser.name) && t.createdBy !== currentUser.name && !isDone(t)
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

    return () => {
      supabase.removeChannel(tasksChannel);
      supabase.removeChannel(usersChannel);
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
        case "done": {
          const updated = { ...task, status: "done", completedAt: now, completedByUser: currentUser.name, doneBy: users.map(u => u.name) };
          if (task.createdBy && task.createdBy !== currentUser.name) completedTaskForNotify = updated;
          return updated;
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
    setTasks(prev => {
      return prev.map(t => {
        if (t.id !== taskId) return t;
        updatedTask = { ...t, ...patch };
        return updatedTask;
      });
    });
    // Wait for state to settle, then persist
    setTimeout(async () => {
      if (updatedTask) await apiUpdateTask(updatedTask);
    }, 50);
  }, []);

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

  // ── Computed values ──

  const unreadCounts = useMemo(() => {
    if (!currentUser || !users) return {};
    const counts = {};
    users.forEach(u => {
      counts[u.name] = tasks.filter(t =>
        !t.seenBy?.includes(u.name) && t.createdBy !== u.name && !isDone(t)
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
        if (isDeleted(t)) return false;
        if (!isDone(t)) {
          // In active view, hide planned (future showFrom) tasks
          if (t.showFrom && daysDiff(t.showFrom) > 0) return false;
          return true;
        }
        // Show recently completed tasks (within 24h) crossed out
        if (t.status === "done" && t.completedAt && new Date(t.completedAt).getTime() > recentCutoff) return true;
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
    else if (filter.startsWith("person:")) {
      const personName = filter.replace("person:", "");
      result = result.filter(t => t.assignedTo?.includes(personName));
    }
    else if (filter === "assigned") result = result.filter(t => t.createdBy === currentUser.name && !t.assignedTo?.every(a => a === currentUser.name));
    else if (filter === "shared") result = result.filter(t => t.assignTo === "both");
    else if (filter === "unread") result = result.filter(t => !t.seenBy?.includes(currentUser.name) && t.createdBy !== currentUser.name);

    // Category filter
    if (categoryFilter !== "all") result = result.filter(t => t.category === categoryFilter);

    // Search
    if (searchQuery) result = result.filter(t => searchMatch(t, searchQuery));

    // Sort — completed tasks always at bottom in active view
    if (sortMode === "smart") result = [...result].sort(smartSort);
    else if (sortMode === "priority") result = [...result].sort((a, b) => getPriority(a.priority).weight - getPriority(b.priority).weight);
    else if (sortMode === "date") result = [...result].sort((a, b) => daysDiff(a.dueDate) - daysDiff(b.dueDate));
    else if (sortMode === "created") result = [...result].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // In active view, push completed to bottom, sorted newest first
    if (viewStatus === "active") {
      const active = result.filter(t => !isDone(t));
      const recentlyDone = result.filter(t => isDone(t))
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      result = [...active, ...recentlyDone];
    }

    return result;
  }, [tasks, currentUser, filter, viewStatus, sortMode, categoryFilter, searchQuery]);

  const stats = useMemo(() => {
    if (!currentUser) return {};
    const activeTasks = tasks.filter(t => !isDone(t) && !isDeleted(t));
    const plannedCount = activeTasks.filter(t => t.showFrom && daysDiff(t.showFrom) > 0).length;
    return {
      my: activeTasks.filter(t => t.assignedTo?.includes(currentUser.name)).length,
      assigned: activeTasks.filter(t => t.createdBy === currentUser.name && !t.assignedTo?.every(x => x === currentUser.name)).length,
      shared: activeTasks.filter(t => t.assignTo === "both").length,
      planned: plannedCount,
    };
  }, [tasks, currentUser]);

  const categoryCounts = useMemo(() => {
    const relevantTasks = tasks.filter(t =>
      viewStatus === "active" ? (!isDone(t) && !isDeleted(t))
      : viewStatus === "done" ? t.status === "done"
      : viewStatus === "trash" ? t.status === "deleted"
      : t.status === "cancelled"
    );
    const counts = {};
    CATEGORIES.forEach(cat => {
      counts[cat.id] = relevantTasks.filter(t => t.category === cat.id).length;
    });
    return counts;
  }, [tasks, viewStatus]);

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
              <span key={u.name} style={{ fontSize: "10px", color: theme.textSub }}>
                {u.name}: <span style={{
                  background: theme.yellow, color: "#fff", borderRadius: "8px",
                  padding: "1px 5px", fontSize: "9px", fontWeight: 800,
                }}>{unreadCounts[u.name]}</span>
              </span>
            ) : null
          )}
          {currentUser.admin && (
            <button onClick={() => setShowAdmin(!showAdmin)}
              style={{ background: "none", border: "none", color: theme.textSub, cursor: "pointer", fontSize: "13px" }}>
              ⚙️
            </button>
          )}
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

        <StatsBar tasks={tasks} currentUser={currentUser} users={users} theme={theme} />

        <QuickAddBar
          currentUser={currentUser}
          users={users}
          onAdd={addTask}
          theme={theme}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          categoryCounts={categoryCounts}
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
            <option value="my">Moje ({stats.my})</option>
            {users.filter(u => u.name !== currentUser.name).map(u => (
              <option key={u.name} value={`person:${u.name}`}>{u.name}</option>
            ))}
            <option value="assigned">Zadané ({stats.assigned})</option>
            <option value="shared">Společné ({stats.shared})</option>
            <option value="unread">Nové ({unreadCounts[currentUser.name] || 0})</option>
            <option value="all">Vše</option>
          </select>

          {/* Status */}
          <select value={viewStatus} onChange={e => setViewStatus(e.target.value)} style={{
            ...inputStyle(theme), width: "auto", padding: "4px 8px", fontSize: "11px",
            background: "transparent", border: `1px solid ${theme.inputBorder}`,
            color: theme.textSub,
          }}>
            <option value="active">Aktivní</option>
            <option value="planned">⏰ Plánované ({stats.planned || 0})</option>
            <option value="done">Splněné</option>
            <option value="trash">🗑 Koš</option>
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
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {(() => {
              let shownSeparator = false;
              return filteredTasks.map(task => {
                const showSep = viewStatus === "active" && isDone(task) && !shownSeparator;
                if (showSep) shownSeparator = true;
                return (
                  <div key={task.id}>
                    {showSep && (
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

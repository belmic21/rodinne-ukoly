import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase, dbToTask, taskToDb, dbToUser } from "./supabase.js";

const UNDO_MS = 5000;
const PRI = [
  { id: "urgent", label: "Akutní", w: 0 },
  { id: "important", label: "Důležité", w: 1 },
  { id: "low", label: "Nedůležité", w: 2 },
];
const CATS = [
  { id: "home", label: "Domácnost", icon: "🏠" },
  { id: "garden", label: "Zahrada", icon: "🌿" },
  { id: "finance", label: "Finance", icon: "💰" },
  { id: "kids", label: "Děti", icon: "👶" },
  { id: "health", label: "Zdraví", icon: "❤️" },
  { id: "car", label: "Auto", icon: "🚗" },
  { id: "shopping", label: "Nákupy", icon: "🛒" },
  { id: "work", label: "Práce", icon: "💼" },
  { id: "other", label: "Ostatní", icon: "📌" },
];
const REC = [
  { v: 0, l: "Jednorázový" }, { v: 1, l: "Každý den" }, { v: 3, l: "Každé 3 dny" },
  { v: 7, l: "Každý týden" }, { v: 14, l: "Každých 14 dní" },
  { v: 30, l: "Každý měsíc" }, { v: 90, l: "Čtvrtletí" },
];
const MOS = ["Led","Úno","Bře","Dub","Kvě","Čvn","Čvc","Srp","Zář","Říj","Lis","Pro"];

const uid = () => crypto.randomUUID();
const gp = id => PRI.find(p => p.id === id) || PRI[1];
const gc = id => CATS.find(c => c.id === id) || CATS[8];
const dn = t => t.status === "done" || t.status === "cancelled";

function dd(s) { if (!s) return Infinity; return Math.round((new Date(s) - new Date(new Date().toDateString())) / 864e5); }
function fd(iso) {
  if (!iso) return ""; const d = dd(iso);
  if (d === 0) return "Dnes"; if (d === 1) return "Zítra"; if (d === -1) return "Včera";
  if (d < -1) return `${Math.abs(d)}d po`; if (d <= 7) return `Za ${d}d`;
  return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "short" });
}
function ff(iso) { if (!iso) return ""; return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
const forgot = t => !dn(t) && !t.dueDate && (Date.now() - new Date(t.createdAt).getTime()) / 864e5 > 30;

function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

function ssort(a, b) {
  const ao = dd(a.dueDate) < 0 && !dn(a), bo = dd(b.dueDate) < 0 && !dn(b);
  if (ao !== bo) return ao ? -1 : 1;
  const fa = forgot(a), fb = forgot(b);
  if (fa !== fb) return fa ? -1 : 1;
  const pw = gp(a.priority).w - gp(b.priority).w;
  if (pw) return pw;
  const da = dd(a.dueDate), db = dd(b.dueDate);
  if (da !== db) return da - db;
  return new Date(b.createdAt) - new Date(a.createdAt);
}

function noti(t, b) { if ("Notification" in window && Notification.permission === "granted") try { new Notification(t, { body: b, icon: "/icon-192.png" }); } catch(e) {} }

function processRec(tasks) {
  const now = new Date(), cm = now.getMonth() + 1;
  const updates = [];
  const newTasks = tasks.map(t => {
    if (t.recDays > 0 && t.status === "done" && t.completedAt) {
      const nx = new Date(t.completedAt); nx.setDate(nx.getDate() + t.recDays);
      if (now >= nx && (!t.activeMo?.length || t.activeMo.includes(cm))) {
        const u = { ...t, status: "active", doneBy: [], completedAt: null, completedByUser: null,
          dueDate: nx.toISOString().slice(0, 10), seenBy: [t.createdBy],
          checklist: t.checklist?.map(ci => ({ ...ci, done: false, doneBy: null, doneAt: null })) || [] };
        updates.push(u); return u;
      }
    }
    return t;
  });
  return { tasks: newTasks, updates };
}

/* ── THEME ── */
const themes = {
  dark: {
    bg: "#0c1017", card: "#131a24", cardBorder: "#1a2233", headerBg: "rgba(12,16,23,0.92)",
    text: "#dbe4ed", textSub: "#506880", textDim: "#2a3a50", textMid: "#3a5060",
    inputBg: "#080c12", inputBorder: "#1a2438",
    accent: "#3b82f6", accentSoft: "#3b82f612", accentBorder: "#3b82f625",
    green: "#22c55e", red: "#ef4444", yellow: "#f59e0b", purple: "#a855f7",
    priUrgent: "#ef4444", priImportant: "#f59e0b", priLow: "#64748b",
    btnBg: "#1e2e40", snackBg: "#1e293b",
    unreadBg: "#0d1f1a", unreadBorder: "#134e3a",
    readBg: "#131a24", readBorder: "#1a2233",
  },
  light: {
    bg: "#f5f7fa", card: "#ffffff", cardBorder: "#e2e8f0", headerBg: "rgba(245,247,250,0.92)",
    text: "#1e293b", textSub: "#64748b", textDim: "#cbd5e1", textMid: "#94a3b8",
    inputBg: "#f1f5f9", inputBorder: "#e2e8f0",
    accent: "#2563eb", accentSoft: "#2563eb10", accentBorder: "#2563eb20",
    green: "#16a34a", red: "#dc2626", yellow: "#d97706", purple: "#7c3aed",
    priUrgent: "#dc2626", priImportant: "#d97706", priLow: "#94a3b8",
    btnBg: "#e2e8f0", snackBg: "#ffffff",
    unreadBg: "#f0fdf4", unreadBorder: "#86efac",
    readBg: "#ffffff", readBorder: "#e2e8f0",
  },
};
const priColors = th => ({ urgent: th.priUrgent, important: th.priImportant, low: th.priLow });
const F = "'DM Sans', system-ui, sans-serif";
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,700&display=swap');
@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,0.3)}50%{box-shadow:0 0 0 7px rgba(52,211,153,0)}}
@keyframes sUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes fIn{from{opacity:0}to{opacity:1}}
@keyframes snIn{from{transform:translateY(80px);opacity:0}to{transform:translateY(0);opacity:1}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}select{appearance:auto}body{margin:0;font-family:'DM Sans',system-ui,sans-serif}
`;
const cardS = th => ({ background: th.card, border: `1px solid ${th.cardBorder}`, borderRadius: "12px" });
const inpS = th => ({ background: th.inputBg, border: `1px solid ${th.inputBorder}`, borderRadius: "8px", color: th.text, padding: "10px 12px", fontSize: "14px", fontFamily: F, outline: "none", width: "100%", boxSizing: "border-box" });
const btnS = th => ({ border: "none", borderRadius: "8px", fontFamily: F, fontWeight: 600, cursor: "pointer" });

/* ── API ── */
async function apiLoadUsers() { const { data } = await supabase.from("users").select("*").order("created_at"); return (data || []).map(dbToUser); }
async function apiLoadTasks() { const { data } = await supabase.from("tasks").select("*").order("created_at", { ascending: false }); return (data || []).map(dbToTask); }
async function apiCreateUser(u) { await supabase.from("users").insert({ name: u.name, pin: u.pin, is_admin: u.admin }); }
async function apiDeleteUser(n) { await supabase.from("users").delete().eq("name", n); }
async function apiCreateTask(t) { await supabase.from("tasks").insert(taskToDb(t)); }
async function apiUpdateTask(t) { await supabase.from("tasks").update(taskToDb(t)).eq("id", t.id); }
async function apiUpdateTasks(ts) { for (const t of ts) await apiUpdateTask(t); }

/* ════════════════════════════════════════════
   COMPONENTS
   ════════════════════════════════════════════ */

function Checklist({ items = [], onChange, user, th }) {
  const [val, setVal] = useState("");
  const add = () => { if (!val.trim()) return; onChange([...items, { id: uid(), text: val.trim(), done: false, doneBy: null, doneAt: null }]); setVal(""); };
  const toggle = id => onChange(items.map(i => i.id === id ? { ...i, done: !i.done, doneBy: !i.done ? user : null, doneAt: !i.done ? new Date().toISOString() : null } : i));
  return (
    <div style={{ marginTop: "8px" }} onClick={e => e.stopPropagation()}>
      <div style={{ fontSize: "10px", color: th.textMid, fontWeight: 700, marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.3px" }}>
        Checklist ({items.filter(i => i.done).length}/{items.length})
      </div>
      {items.map(it => (
        <div key={it.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", borderRadius: "6px", background: it.done ? `${th.green}08` : th.inputBg, border: `1px solid ${it.done ? th.green + "15" : th.inputBorder}`, marginBottom: "3px" }}>
          <button onClick={() => toggle(it.id)} style={{ width: "20px", height: "20px", minWidth: "20px", borderRadius: "5px", border: `2px solid ${it.done ? th.green : th.textDim}`, background: it.done ? th.green : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "11px", fontWeight: 800 }}>
            {it.done && "✓"}
          </button>
          <span style={{ flex: 1, fontSize: "13px", color: it.done ? th.textSub : th.text, textDecoration: it.done ? "line-through" : "none", lineHeight: 1.3 }}>
            {it.text}
            {it.done && it.doneBy && <span style={{ fontSize: "10px", color: th.textMid, marginLeft: "6px" }}>— {it.doneBy}</span>}
          </span>
        </div>
      ))}
      <div style={{ display: "flex", gap: "5px", marginTop: "5px" }}>
        <input placeholder="Přidat položku..." value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} style={{ ...inpS(th), fontSize: "13px", padding: "8px 10px", flex: 1 }} />
        <button onClick={add} style={{ ...btnS(th), padding: "8px 14px", background: th.accent, color: "#fff", fontSize: "14px" }}>+</button>
      </div>
    </div>
  );
}

function Images({ images = [], onChange, th }) {
  const ref = useRef();
  const add = e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 1048576) { alert("Max 1 MB"); return; } const r = new FileReader(); r.onload = () => { onChange([...images, { id: uid(), data: r.result }]); }; r.readAsDataURL(f); e.target.value = ""; };
  return (
    <div style={{ marginTop: "8px" }} onClick={e => e.stopPropagation()}>
      {images.length > 0 && <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "6px" }}>
        {images.map(img => (
          <div key={img.id} style={{ position: "relative", width: "56px", height: "56px", borderRadius: "6px", overflow: "hidden", border: `1px solid ${th.cardBorder}` }}>
            <img src={img.data} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button onClick={() => onChange(images.filter(i => i.id !== img.id))} style={{ position: "absolute", top: "1px", right: "1px", background: "rgba(0,0,0,0.65)", border: "none", color: "#fff", borderRadius: "50%", width: "16px", height: "16px", fontSize: "10px", cursor: "pointer", lineHeight: "16px", textAlign: "center", padding: 0 }}>×</button>
          </div>
        ))}
      </div>}
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={add} style={{ display: "none" }} />
      <button onClick={() => ref.current?.click()} style={{ ...btnS(th), background: th.inputBg, border: `1px solid ${th.inputBorder}`, color: th.textSub, padding: "6px 12px", fontSize: "11px" }}>📷 Přidat fotku</button>
    </div>
  );
}

/* ── TASK CARD ── */
function TaskCard({ task: t, user, users, onStatus, onSeen, onUpdate, th }) {
  const [open, setOpen] = useState(false);
  const pc = priColors(th);
  const isNew = !t.seenBy?.includes(user.name) && t.createdBy !== user.name;
  const wasSeen = t.seenBy?.includes(user.name) || t.createdBy === user.name;
  const overdue = dd(t.dueDate) < 0 && !dn(t);
  const soon = !overdue && dd(t.dueDate) >= 0 && dd(t.dueDate) <= 3 && !dn(t);
  const fg = forgot(t);
  const isDn = dn(t);
  const inPr = t.status === "in_progress" || (t.assignTo === "both" && (t.doneBy?.length || 0) > 0 && t.status !== "done");
  const p = gp(t.priority);
  const canAct = t.assignTo === "both" || t.assignedTo?.includes(user.name) || t.createdBy === user.name;

  const handleOpen = () => { const nx = !open; setOpen(nx); if (nx && isNew) onSeen(t.id); };

  let aLabel = "";
  if (t.assignTo === "both") aLabel = "Pro všechny";
  else if (t.createdBy !== t.assignedTo?.[0]) aLabel = `${t.createdBy} → ${t.assignedTo?.[0]}`;

  let bc = pc[p.id] + "40";
  if (overdue) bc = th.red;
  else if (soon) bc = th.yellow;
  else if (isNew) bc = th.green;
  else if (fg) bc = th.purple;

  const clDone = t.checklist?.filter(c => c.done).length || 0;
  const clTotal = t.checklist?.length || 0;

  // Quick complete handler
  const quickComplete = (e) => {
    e.stopPropagation();
    if (t.assignTo === "both") onStatus(t.id, "done_my");
    else onStatus(t.id, "done");
  };

  // Card background based on read/unread and done status
  let cardBg = wasSeen ? th.readBg : th.unreadBg;
  let cardBorderColor = wasSeen ? th.readBorder : th.unreadBorder;
  if (overdue && !isDn) cardBg = th.card;
  if (isDn) { cardBg = th.card; cardBorderColor = th.cardBorder; }

  return (
    <div onClick={handleOpen} style={{
      background: cardBg, border: `1px solid ${cardBorderColor}`, borderRadius: "12px",
      borderLeft: `3px solid ${bc}`, padding: "11px 13px",
      opacity: isDn ? 0.35 : 1, cursor: "pointer", position: "relative",
      animation: isNew ? "glow 2s ease 3, sUp 0.3s ease" : "sUp 0.3s ease",
      transition: "all 0.2s",
      ...(overdue && !isDn ? { background: `linear-gradient(135deg,${th.card} 80%,${th.red}08 100%)` } : {}),
    }}>
      {isNew && <span style={{ position: "absolute", top: "7px", right: "9px", background: th.green, color: "#fff", fontSize: "8px", fontWeight: 800, padding: "2px 6px", borderRadius: "4px", textTransform: "uppercase" }}>Nové</span>}
      {fg && !isDn && <span style={{ position: "absolute", top: "7px", right: isNew ? "50px" : "9px", background: th.purple, color: "#fff", fontSize: "8px", fontWeight: 800, padding: "2px 6px", borderRadius: "4px" }}>30+d</span>}

      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        {/* Quick complete button */}
        {!isDn && canAct ? (
          <button onClick={quickComplete} style={{
            width: "22px", height: "22px", minWidth: "22px", marginTop: "1px", borderRadius: "6px",
            border: `2px solid ${inPr ? th.yellow : th.textDim}`, background: inPr ? `${th.yellow}15` : "transparent",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            color: inPr ? th.yellow : th.textMid, fontSize: "10px", fontWeight: 700, transition: "all 0.15s",
          }} title="Označit jako splněné">
            {inPr ? "◐" : "○"}
          </button>
        ) : (
          <div style={{
            width: "22px", height: "22px", minWidth: "22px", marginTop: "1px", borderRadius: "6px",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700,
            background: t.status === "cancelled" ? `${th.priLow}15` : `${th.green}18`,
            color: t.status === "cancelled" ? th.priLow : th.green,
            border: `2px solid ${t.status === "cancelled" ? th.priLow + "30" : th.green + "35"}`,
          }}>
            {t.status === "done" ? "✓" : "⊘"}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: "14px", fontWeight: 500,
            color: isDn ? th.textSub : th.text,
            textDecoration: isDn ? "line-through" : "none",
            opacity: isDn ? 0.7 : 1,
            lineHeight: 1.4, wordBreak: "break-word",
          }}>
            {t.title}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, color: pc[p.id], textTransform: "uppercase" }}>● {p.label}</span>
            {t.category && t.category !== "other" && <span style={{ fontSize: "10px", color: th.textMid }}>{gc(t.category).icon}</span>}
            {clTotal > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                <span style={{ width: "32px", height: "4px", borderRadius: "2px", background: th.inputBorder, overflow: "hidden", display: "inline-block" }}>
                  <span style={{ display: "block", height: "100%", width: `${clTotal > 0 ? clDone / clTotal * 100 : 0}%`, background: clDone === clTotal && clTotal > 0 ? th.green : th.accent, borderRadius: "2px", transition: "width 0.3s" }} />
                </span>
                <span style={{ fontSize: "10px", color: th.textSub, fontWeight: 600 }}>{clDone}/{clTotal}</span>
              </span>
            )}
            {t.assignTo === "both" && <span style={{ display: "inline-flex", gap: "2px" }}>
              {users.map(u => <span key={u.name} title={u.name} style={{ width: 7, height: 7, borderRadius: "50%", background: t.doneBy?.includes(u.name) ? th.green : th.inputBorder, border: `1px solid ${t.doneBy?.includes(u.name) ? th.green : th.textDim}` }} />)}
            </span>}
            {aLabel && <span style={{ fontSize: "10px", color: th.textMid }}>{aLabel}</span>}
            {t.recDays > 0 && <span style={{ fontSize: "10px", color: th.textSub }}>🔄</span>}
            {t.images?.length > 0 && <span style={{ fontSize: "10px", color: th.textSub }}>📷{t.images.length}</span>}
            {t.dueDate && <span style={{ fontSize: "10px", fontWeight: 600, color: overdue ? th.red : soon ? th.yellow : th.textMid }}>{overdue ? "⚠ " : ""}{fd(t.dueDate)}</span>}
            {isDn && t.completedByUser && <span style={{ fontSize: "10px", color: th.textMid }}>✓ {t.completedByUser}</span>}
          </div>
        </div>
        <span style={{ fontSize: "9px", color: th.textDim, marginTop: "5px" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ marginTop: "10px", paddingLeft: "32px", animation: "fIn 0.12s" }} onClick={e => e.stopPropagation()}>
          {t.note && <div style={{ fontSize: "13px", color: th.textSub, lineHeight: 1.5, padding: "8px 10px", background: th.inputBg, borderRadius: "6px", marginBottom: "8px", borderLeft: `2px solid ${th.inputBorder}` }}>{t.note}</div>}
          {(clTotal > 0 || (!isDn && t.type === "complex")) && <Checklist items={t.checklist || []} user={user.name} th={th} onChange={cl => onUpdate(t.id, { checklist: cl })} />}
          {(t.images?.length > 0 || !isDn) && <Images images={t.images || []} th={th} onChange={imgs => onUpdate(t.id, { images: imgs })} />}
          <div style={{ fontSize: "10px", color: th.textDim, marginTop: "8px", display: "flex", flexDirection: "column", gap: "1px" }}>
            <span>Vytvořeno: {ff(t.createdAt)} ({t.createdBy})</span>
            {t.completedAt && <span>Dokončeno: {ff(t.completedAt)}{t.completedByUser ? ` (${t.completedByUser})` : ""}</span>}
            {t.recDays > 0 && <span>🔄 {REC.find(r => r.v === t.recDays)?.l}{t.activeMo?.length > 0 && t.activeMo.length < 12 ? ` (${t.activeMo.map(m => MOS[m-1]).join(", ")})` : ""}</span>}
          </div>
          {!isDn && canAct && (
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "8px" }}>
              {t.assignTo === "both" ? (<>
                {!t.doneBy?.includes(user.name) && <ABtn l="Moje hotovo ✓" a={() => onStatus(t.id, "done_my")} th={th} />}
                {t.createdBy === user.name && <ABtn l="Všichni hotovo ✓" a={() => onStatus(t.id, "done_all")} th={th} />}
              </>) : (<>
                {t.status !== "in_progress" && <ABtn l="◐ Rozpracováno" a={() => onStatus(t.id, "in_progress")} th={th} sub />}
                <ABtn l="Splněno ✓" a={() => onStatus(t.id, "done")} th={th} />
              </>)}
              <ABtn l="⊘ Nerealizováno" a={() => onStatus(t.id, "cancelled")} th={th} sub />
            </div>
          )}
          {isDn && <ABtn l="↩ Vrátit zpět" a={() => onStatus(t.id, "reopen")} th={th} sub style={{ marginTop: "8px" }} />}
        </div>
      )}
    </div>
  );
}

function ABtn({ l, a, th, sub, style: sx }) {
  return <button onClick={a} style={{ ...btnS(th), padding: "6px 12px", fontSize: "12px", background: sub ? "transparent" : `${th.green}15`, color: sub ? th.textSub : th.green, border: `1px solid ${sub ? th.cardBorder : th.green + "30"}`, ...sx }}>{l}</button>;
}

/* ── QUICK DATE PICKER ── */
function DatePicker({ value, onChange, th }) {
  const quick = [
    { l: "Dnes", v: addDays(0) },
    { l: "Zítra", v: addDays(1) },
    { l: "Za 3 dny", v: addDays(3) },
    { l: "Týden", v: addDays(7) },
    { l: "2 týdny", v: addDays(14) },
    { l: "Měsíc", v: addDays(30) },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "6px" }}>
        {quick.map(q => (
          <button key={q.l} onClick={() => onChange(q.v)} style={{
            ...btnS(th), padding: "4px 8px", fontSize: "10px",
            background: value === q.v ? th.accentSoft : th.inputBg,
            color: value === q.v ? th.accent : th.textSub,
            border: `1px solid ${value === q.v ? th.accentBorder : th.inputBorder}`,
          }}>{q.l}</button>
        ))}
        {value && <button onClick={() => onChange("")} style={{ ...btnS(th), padding: "4px 8px", fontSize: "10px", background: "transparent", color: th.red, border: `1px solid ${th.red}25` }}>✕</button>}
      </div>
      <input type="date" value={value} onChange={e => onChange(e.target.value)} style={inpS(th)} />
    </div>
  );
}

/* ── ADD FORM ── */
function AddForm({ user, users, onAdd, th }) {
  const [op, setOp] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [type, setType] = useState("simple");
  const [assign, setAssign] = useState("self");
  const [assignTarget, setAssignTarget] = useState("");
  const [prio, setPrio] = useState("important");
  const [due, setDue] = useState("");
  const [rec, setRec] = useState(0);
  const [cat, setCat] = useState("other");
  const [adv, setAdv] = useState(false);
  const [amo, setAmo] = useState([]);
  const [initChecklist, setInitChecklist] = useState([]);
  const [clVal, setClVal] = useState("");
  const ref = useRef();
  const others = users.filter(u => u.name !== user.name);

  const addClItem = () => {
    if (!clVal.trim()) return;
    setInitChecklist(p => [...p, { id: uid(), text: clVal.trim(), done: false, doneBy: null, doneAt: null }]);
    setClVal("");
  };

  const submit = () => {
    if (!title.trim()) return;
    const to = assign === "self" ? [user.name] : assign === "person" ? [assignTarget || others[0]?.name] : assign === "both" ? users.map(u => u.name) : [user.name];
    onAdd({
      id: uid(), title: title.trim(), note: note.trim() || null,
      type, createdBy: user.name, assignTo: assign === "person" ? "person" : assign,
      assignedTo: to, priority: prio, dueDate: due || null, recDays: rec,
      category: cat, activeMo: amo.length === 12 ? [] : amo,
      status: "active", doneBy: [], seenBy: [user.name],
      createdAt: new Date().toISOString(), completedAt: null, completedByUser: null,
      checklist: type === "complex" ? initChecklist : [], images: [],
    });
    setTitle(""); setNote(""); setDue(""); setRec(0); setPrio("important");
    setAssign("self"); setCat("other"); setAdv(false); setAmo([]); setType("simple");
    setInitChecklist([]); setClVal("");
    setOp(false);
  };

  if (!op) return (
    <button onClick={() => { setOp(true); setTimeout(() => ref.current?.focus(), 80); }} style={{ ...cardS(th), width: "100%", padding: "14px 16px", fontSize: "14px", color: th.textSub, display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px", textAlign: "left", cursor: "pointer", fontFamily: F, fontWeight: 500 }}>
      <span style={{ fontSize: "18px", color: th.accent }}>+</span> Přidat úkol...
    </button>
  );

  const lbl = { fontSize: "10px", color: th.textMid, fontWeight: 700, marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.3px" };

  return (
    <div style={{ ...cardS(th), padding: "14px", marginBottom: "14px", animation: "sUp 0.2s" }}>
      {/* Type toggle — WORKING */}
      <div style={{ display: "flex", gap: "0", marginBottom: "12px", border: `1px solid ${th.cardBorder}`, borderRadius: "8px", overflow: "hidden" }}>
        {[{ id: "simple", l: "✓ Jednoduchý", desc: "Jeden úkol" }, { id: "complex", l: "☰ Komplexní", desc: "S checklistem" }].map(tp => (
          <button key={tp.id} onClick={() => setType(tp.id)} style={{
            ...btnS(th), flex: 1, padding: "10px 8px", fontSize: "12px", borderRadius: 0,
            background: type === tp.id ? th.accent : "transparent",
            color: type === tp.id ? "#fff" : th.textSub,
            border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
          }}>
            <span style={{ fontWeight: 700 }}>{tp.l}</span>
            <span style={{ fontSize: "9px", opacity: 0.7 }}>{tp.desc}</span>
          </button>
        ))}
      </div>

      <input ref={ref} type="text" placeholder="Název úkolu..." value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && submit()} style={{ ...inpS(th), fontSize: "15px", fontWeight: 500, marginBottom: "8px" }} />
      <textarea placeholder="Poznámka..." value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...inpS(th), resize: "vertical", marginBottom: "10px", lineHeight: 1.4 }} />

      {/* Checklist for complex type */}
      {type === "complex" && (
        <div style={{ marginBottom: "10px", padding: "10px", background: th.inputBg, borderRadius: "8px", border: `1px solid ${th.inputBorder}` }}>
          <div style={lbl}>Checklist položky</div>
          {initChecklist.map((it, i) => (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
              <span style={{ fontSize: "12px", color: th.textSub }}>○</span>
              <span style={{ flex: 1, fontSize: "13px", color: th.text }}>{it.text}</span>
              <button onClick={() => setInitChecklist(p => p.filter(x => x.id !== it.id))} style={{ background: "none", border: "none", color: th.textDim, cursor: "pointer", fontSize: "14px" }}>×</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: "5px", marginTop: "4px" }}>
            <input placeholder="Přidat položku..." value={clVal} onChange={e => setClVal(e.target.value)} onKeyDown={e => e.key === "Enter" && addClItem()} style={{ ...inpS(th), fontSize: "12px", padding: "7px 10px", flex: 1 }} />
            <button onClick={addClItem} style={{ ...btnS(th), padding: "7px 12px", background: th.accent, color: "#fff", fontSize: "14px" }}>+</button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
        <div><div style={lbl}>Pro koho</div>
          <select value={assign} onChange={e => setAssign(e.target.value)} style={inpS(th)}>
            <option value="self">Pro mě</option>
            {others.length === 1 && <option value="person">Pro {others[0].name}</option>}
            {others.length > 1 && <option value="person">Pro konkrétního</option>}
            <option value="both">Pro všechny</option>
          </select>
          {assign === "person" && others.length > 1 && <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)} style={{ ...inpS(th), marginTop: "4px" }}>
            <option value="">— vyber —</option>
            {others.map(o => <option key={o.name} value={o.name}>{o.name}</option>)}
          </select>}
        </div>
        <div><div style={lbl}>Priorita</div>
          <select value={prio} onChange={e => setPrio(e.target.value)} style={inpS(th)}>
            {PRI.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select></div>
        <div><div style={lbl}>Kategorie</div>
          <select value={cat} onChange={e => setCat(e.target.value)} style={inpS(th)}>
            {CATS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select></div>
        <div><div style={lbl}>Termín</div>
          <DatePicker value={due} onChange={setDue} th={th} />
        </div>
      </div>

      <button onClick={() => setAdv(!adv)} style={{ background: "none", border: "none", color: th.textMid, fontSize: "11px", cursor: "pointer", fontFamily: F, fontWeight: 600, padding: "4px 0", marginBottom: adv ? "8px" : "10px" }}>
        {adv ? "▲ Méně" : "▼ Opakování a sezónnost"}
      </button>
      {adv && (
        <div style={{ marginBottom: "10px", animation: "fIn 0.12s" }}>
          <div style={lbl}>Opakování</div>
          <select value={rec} onChange={e => setRec(Number(e.target.value))} style={{ ...inpS(th), marginBottom: "6px" }}>
            {REC.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
          {rec > 0 && (<>
            <div style={lbl}>Aktivní měsíce (prázdné = celoročně)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
              {MOS.map((m, i) => (
                <button key={i} onClick={() => setAmo(p => p.includes(i+1) ? p.filter(x => x !== i+1) : [...p, i+1])} style={{ ...btnS(th), padding: "4px 7px", fontSize: "10px", background: amo.includes(i+1) ? th.accentSoft : th.inputBg, color: amo.includes(i+1) ? th.accent : th.textMid, border: `1px solid ${amo.includes(i+1) ? th.accentBorder : th.inputBorder}` }}>{m}</button>
              ))}
            </div>
          </>)}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={submit} style={{ ...btnS(th), flex: 1, padding: "12px", background: th.accent, color: "#fff", fontSize: "14px" }}>Přidat úkol</button>
        <button onClick={() => setOp(false)} style={{ ...btnS(th), padding: "12px 18px", background: "transparent", color: th.textSub, border: `1px solid ${th.cardBorder}`, fontSize: "14px" }}>Zrušit</button>
      </div>
    </div>
  );
}

/* ── SETUP / LOGIN / ADMIN ── */
function Setup({ onDone }) {
  const [name, setName] = useState(""); const [pin, setPin] = useState(""); const [busy, setBusy] = useState(false);
  const th = themes.dark;
  return (
    <div style={{ minHeight: "100vh", background: th.bg, fontFamily: F, color: th.text, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <style>{CSS}</style>
      <div style={{ width: "300px", textAlign: "center", animation: "fIn 0.4s" }}>
        <div style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Rodinné úkoly</div>
        <div style={{ fontSize: "12px", color: th.textSub, marginBottom: "28px" }}>První spuštění — vytvoř hlavního uživatele</div>
        <input placeholder="Tvoje jméno" value={name} onChange={e => setName(e.target.value)} style={{ ...inpS(th), padding: "12px", fontSize: "15px", marginBottom: "10px", textAlign: "center" }} />
        <input placeholder="4místný PIN" value={pin} onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) setPin(e.target.value); }} type="tel" inputMode="numeric" maxLength={4} style={{ ...inpS(th), padding: "12px", fontSize: "20px", marginBottom: "16px", textAlign: "center", letterSpacing: "8px" }} />
        <button onClick={async () => { if (name.trim() && pin.length === 4) { setBusy(true); await onDone({ name: name.trim(), pin, admin: true }); } }} disabled={!name.trim() || pin.length !== 4 || busy} style={{ ...btnS(th), width: "100%", padding: "12px", background: name.trim() && pin.length === 4 ? th.accent : th.btnBg, color: "#fff", fontSize: "14px", opacity: !name.trim() || pin.length !== 4 || busy ? 0.4 : 1 }}>
          {busy ? "Vytvářím..." : "Vytvořit účet"}
        </button>
      </div>
    </div>
  );
}

function Login({ users, onLogin, theme }) {
  const [sel, setSel] = useState(null); const [pin, setPin] = useState(""); const [err, setErr] = useState(false);
  const th = themes[theme];
  const tryLogin = () => { const u = users.find(u => u.name === sel); if (u && u.pin === pin) { setErr(false); onLogin(u); } else { setErr(true); setPin(""); } };
  return (
    <div style={{ minHeight: "100vh", background: th.bg, fontFamily: F, color: th.text, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <style>{CSS}</style>
      <div style={{ width: "320px", textAlign: "center", animation: "fIn 0.4s" }}>
        <div style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Rodinné úkoly</div>
        <div style={{ fontSize: "12px", color: th.textSub, marginBottom: "28px" }}>Vyber se a zadej PIN</div>
        {!sel ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {users.map(u => (
              <button key={u.name} onClick={() => setSel(u.name)} style={{ ...cardS(th), padding: "16px", fontSize: "16px", fontWeight: 600, color: th.text, cursor: "pointer", fontFamily: F, textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>{u.name}</span>
                {u.admin && <span style={{ fontSize: "10px", color: th.textSub, background: th.accentSoft, padding: "2px 6px", borderRadius: "4px" }}>admin</span>}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ animation: "sUp 0.2s" }}>
            <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>{sel}</div>
            <input placeholder="PIN" value={pin} onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) { setPin(e.target.value); setErr(false); } }} onKeyDown={e => e.key === "Enter" && pin.length === 4 && tryLogin()} type="tel" inputMode="numeric" maxLength={4} autoFocus style={{ ...inpS(th), padding: "12px", fontSize: "22px", marginBottom: "8px", textAlign: "center", letterSpacing: "10px", borderColor: err ? th.red : th.inputBorder }} />
            {err && <div style={{ fontSize: "12px", color: th.red, marginBottom: "8px" }}>Špatný PIN</div>}
            <button onClick={tryLogin} disabled={pin.length !== 4} style={{ ...btnS(th), width: "100%", padding: "11px", background: pin.length === 4 ? th.accent : th.btnBg, color: "#fff", fontSize: "14px", opacity: pin.length === 4 ? 1 : 0.4, marginBottom: "8px" }}>Přihlásit</button>
            <button onClick={() => { setSel(null); setPin(""); setErr(false); }} style={{ background: "none", border: "none", color: th.textSub, fontSize: "12px", cursor: "pointer", fontFamily: F }}>← Zpět</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminPanel({ users, onAdd, onRemove, onClose, th }) {
  const [name, setName] = useState(""); const [pin, setPin] = useState("");
  return (
    <div style={{ ...cardS(th), padding: "16px", marginBottom: "14px", animation: "sUp 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "14px", fontWeight: 700 }}>Správa uživatelů</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: th.textSub, cursor: "pointer", fontSize: "18px" }}>×</button>
      </div>
      {users.map(u => (
        <div key={u.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${th.cardBorder}` }}>
          <span style={{ fontSize: "13px" }}>{u.name} {u.admin && <span style={{ fontSize: "10px", color: th.textSub }}>(admin)</span>}</span>
          {!u.admin && <button onClick={() => onRemove(u.name)} style={{ background: "none", border: "none", color: th.red, fontSize: "11px", cursor: "pointer", fontFamily: F, fontWeight: 600 }}>Odebrat</button>}
        </div>
      ))}
      <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
        <input placeholder="Jméno" value={name} onChange={e => setName(e.target.value)} style={{ ...inpS(th), flex: 1 }} />
        <input placeholder="PIN" value={pin} onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) setPin(e.target.value); }} type="tel" inputMode="numeric" maxLength={4} style={{ ...inpS(th), width: "70px", textAlign: "center", letterSpacing: "4px" }} />
        <button onClick={() => { if (name.trim() && pin.length === 4 && !users.find(u => u.name === name.trim())) { onAdd({ name: name.trim(), pin, admin: false }); setName(""); setPin(""); } }} style={{ ...btnS(th), padding: "8px 14px", background: th.accent, color: "#fff", fontSize: "14px" }}>+</button>
      </div>
    </div>
  );
}

function Weekly({ tasks, user, th }) {
  const wa = new Date(); wa.setDate(wa.getDate() - 7);
  const d = tasks.filter(t => t.status === "done" && t.completedAt && new Date(t.completedAt) >= wa && t.assignedTo?.includes(user.name)).length;
  const r = tasks.filter(t => !dn(t) && t.assignedTo?.includes(user.name)).length;
  const o = tasks.filter(t => !dn(t) && t.assignedTo?.includes(user.name) && dd(t.dueDate) < 0).length;
  return (
    <div style={{ ...cardS(th), padding: "14px 16px", marginBottom: "14px", display: "flex", gap: "6px" }}>
      {[{ v: d, l: "Splněno\ntento týden", c: th.green }, { v: r, l: "Zbývá", c: th.accent }, { v: o, l: "Po termínu", c: o > 0 ? th.red : th.textDim }].map((s, i) => (
        <div key={i} style={{ flex: "1 1 0", textAlign: "center" }}>
          <div style={{ fontSize: "20px", fontWeight: 700, color: s.c }}>{s.v}</div>
          <div style={{ fontSize: "9px", color: th.textMid, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px", marginTop: "2px", whiteSpace: "pre-line" }}>{s.l}</div>
        </div>
      ))}
    </div>
  );
}

function Snack({ msg, onUndo, vis, th }) {
  if (!vis) return null;
  return <div style={{ position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)", background: th.snackBg, border: `1px solid ${th.cardBorder}`, borderRadius: "12px", padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px", zIndex: 100, animation: "snIn 0.25s ease", fontFamily: F, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxWidth: "90vw" }}>
    <span style={{ fontSize: "13px", color: th.text }}>{msg}</span>
    <button onClick={onUndo} style={{ ...btnS(th), background: th.accent, color: "#fff", padding: "6px 14px", fontSize: "12px" }}>VRÁTIT</button>
  </div>;
}

/* ════════════════════════════════════════════
   MAIN APP
   ════════════════════════════════════════════ */
export default function App() {
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("my");
  const [vs, setVs] = useState("active");
  const [sort, setSort] = useState("smart");
  const [catF, setCatF] = useState("all");
  const [undo, setUndo] = useState(null);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("ft_theme") || "dark"; } catch(e) { return "dark"; } });
  const [showAdmin, setShowAdmin] = useState(false);
  const ut = useRef();

  useEffect(() => { try { const s = localStorage.getItem("ft_user"); if (s) setUser(JSON.parse(s)); } catch(e) {} }, []);
  useEffect(() => { try { if (user) localStorage.setItem("ft_user", JSON.stringify(user)); else localStorage.removeItem("ft_user"); } catch(e) {} }, [user]);
  useEffect(() => { try { localStorage.setItem("ft_theme", theme); } catch(e) {} }, [theme]);

  useEffect(() => {
    (async () => {
      const [u, t] = await Promise.all([apiLoadUsers(), apiLoadTasks()]);
      setUsers(u); const { tasks: p, updates } = processRec(t); setTasks(p);
      if (updates.length > 0) apiUpdateTasks(updates); setLoading(false);
    })();
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }, []);

  useEffect(() => {
    if (loading) return;
    const tCh = supabase.channel("tasks-ch")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, p => {
        if (p.eventType === "INSERT") setTasks(prev => prev.find(t => t.id === p.new.id) ? prev : [dbToTask(p.new), ...prev]);
        else if (p.eventType === "UPDATE") setTasks(prev => prev.map(t => t.id === p.new.id ? dbToTask(p.new) : t));
        else if (p.eventType === "DELETE") setTasks(prev => prev.filter(t => t.id !== p.old.id));
      }).subscribe();
    const uCh = supabase.channel("users-ch")
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => { apiLoadUsers().then(setUsers); })
      .subscribe();
    return () => { supabase.removeChannel(tCh); supabase.removeChannel(uCh); };
  }, [loading]);

  useEffect(() => {
    const iv = setInterval(() => {
      setTasks(p => { const { tasks: u2, updates } = processRec(p); if (updates.length > 0) apiUpdateTasks(updates); return updates.length > 0 ? u2 : p; });
      supabase.from("tasks").select("id", { count: "exact", head: true });
    }, 60000);
    return () => clearInterval(iv);
  }, []);

  const th = themes[theme];
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const addUser = useCallback(async u => { await apiCreateUser(u); }, []);
  const removeUser = useCallback(async name => { await apiDeleteUser(name); }, []);

  const doUndo = useCallback(async () => {
    if (!undo) return;
    setTasks(undo.prev);
    const t = undo.prev.find(t => t.id === undo.taskId);
    if (t) apiUpdateTask(t);
    clearTimeout(ut.current); setUndo(null);
  }, [undo]);

  const withUndo = useCallback((msg, taskId, fn) => {
    setTasks(prev => {
      const nx = fn(prev); const updated = nx.find(t => t.id === taskId);
      if (updated) apiUpdateTask(updated);
      setUndo({ prev, msg, taskId });
      clearTimeout(ut.current); ut.current = setTimeout(() => setUndo(null), UNDO_MS);
      return nx;
    });
  }, []);

  const addTask = useCallback(async t => { setTasks(p => [t, ...p]); await apiCreateTask(t); if (t.assignTo !== "self") noti(`📋 Nový úkol od ${t.createdBy}`, t.title); }, []);

  const chgStatus = useCallback((id, action) => {
    const m = { done: "Splněno", done_all: "Splněno", done_my: "Moje část hotová", cancelled: "Nerealizováno", reopen: "Vráceno", in_progress: "Rozpracováno" }[action] || "Změněno";
    withUndo(m, id, prev => prev.map(t => {
      if (t.id !== id) return t;
      const now = new Date().toISOString();
      if (action === "in_progress") return { ...t, status: "in_progress" };
      if (action === "cancelled") return { ...t, status: "cancelled", completedAt: now, completedByUser: user.name };
      if (action === "done") return { ...t, status: "done", completedAt: now, completedByUser: user.name, doneBy: users.map(u => u.name) };
      if (action === "done_my") { const nb = [...new Set([...(t.doneBy || []), user.name])]; const all = users.every(u => nb.includes(u.name)); return { ...t, doneBy: nb, status: all ? "done" : t.status, completedAt: all ? now : t.completedAt, completedByUser: all ? user.name : t.completedByUser }; }
      if (action === "done_all") return { ...t, status: "done", completedAt: now, completedByUser: user.name, doneBy: users.map(u => u.name) };
      if (action === "reopen") return { ...t, status: "active", completedAt: null, completedByUser: null, doneBy: [] };
      return t;
    }));
  }, [user, users, withUndo]);

  const markSeen = useCallback(async id => {
    const t = tasks.find(t => t.id === id);
    if (!t || t.seenBy?.includes(user.name)) return;
    const updated = { ...t, seenBy: [...(t.seenBy || []), user.name] };
    setTasks(p => p.map(x => x.id === id ? updated : x));
    await apiUpdateTask(updated);
  }, [tasks, user]);

  const updateTask = useCallback(async (id, patch) => {
    const t = tasks.find(t => t.id === id); if (!t) return;
    const updated = { ...t, ...patch };
    setTasks(p => p.map(x => x.id === id ? updated : x));
    await apiUpdateTask(updated);
  }, [tasks]);

  const unread = useMemo(() => {
    if (!user || !users) return {};
    const r = {}; users.forEach(u => { r[u.name] = tasks.filter(t => !t.seenBy?.includes(u.name) && t.createdBy !== u.name && !dn(t)).length; }); return r;
  }, [tasks, user, users]);

  const filtered = useMemo(() => {
    if (!user) return [];
    let l = tasks;
    if (vs === "active") l = l.filter(t => !dn(t));
    else if (vs === "done") l = l.filter(t => t.status === "done");
    else if (vs === "cancelled") l = l.filter(t => t.status === "cancelled");
    if (filter === "my") l = l.filter(t => t.assignedTo?.includes(user.name));
    else if (filter === "assigned") l = l.filter(t => t.createdBy === user.name && !t.assignedTo?.every(a => a === user.name));
    else if (filter === "shared") l = l.filter(t => t.assignTo === "both");
    else if (filter === "unread") l = l.filter(t => !t.seenBy?.includes(user.name) && t.createdBy !== user.name);
    if (catF !== "all") l = l.filter(t => t.category === catF);
    if (sort === "smart") l = [...l].sort(ssort);
    else if (sort === "priority") l = [...l].sort((a, b) => gp(a.priority).w - gp(b.priority).w);
    else if (sort === "date") l = [...l].sort((a, b) => dd(a.dueDate) - dd(b.dueDate));
    else if (sort === "created") l = [...l].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return l;
  }, [tasks, user, filter, vs, sort, catF]);

  const stats = useMemo(() => {
    if (!user) return {};
    const a = tasks.filter(t => !dn(t));
    return { my: a.filter(t => t.assignedTo?.includes(user.name)).length, out: a.filter(t => t.createdBy === user.name && !t.assignedTo?.every(x => x === user.name)).length, shared: a.filter(t => t.assignTo === "both").length };
  }, [tasks, user]);

  if (loading) return <div style={{ minHeight: "100vh", background: "#0c1017", display: "flex", alignItems: "center", justifyContent: "center", color: "#506880", fontFamily: F }}>Načítám...</div>;
  if (!users?.length) return <Setup onDone={async u => { await apiCreateUser(u); setUsers([u]); setUser(u); }} />;
  if (!user) return <Login users={users} onLogin={setUser} theme={theme} />;

  return (
    <div style={{ minHeight: "100vh", background: th.bg, fontFamily: F, color: th.text, WebkitFontSmoothing: "antialiased" }}>
      <style>{CSS}</style>
      <div style={{ background: th.headerBg, backdropFilter: "blur(20px)", borderBottom: `1px solid ${th.cardBorder}`, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 30 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 700, fontSize: "15px" }}>Úkoly</span>
          <button onClick={toggleTheme} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", padding: "2px" }}>{theme === "dark" ? "☀️" : "🌙"}</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {users.filter(u => u.name !== user.name).map(u => unread[u.name] > 0 ? <span key={u.name} style={{ fontSize: "10px", color: th.textSub }}>{u.name}: <span style={{ background: th.yellow, color: "#fff", borderRadius: "8px", padding: "1px 5px", fontSize: "9px", fontWeight: 800 }}>{unread[u.name]}</span></span> : null)}
          {user.admin && <button onClick={() => setShowAdmin(!showAdmin)} style={{ background: "none", border: "none", color: th.textSub, cursor: "pointer", fontSize: "13px" }}>⚙️</button>}
          <button onClick={() => setUser(null)} style={{ ...btnS(th), background: th.inputBg, border: `1px solid ${th.inputBorder}`, color: th.textSub, padding: "5px 10px", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}>{user.name}</button>
        </div>
      </div>
      <div style={{ maxWidth: "560px", margin: "0 auto", padding: "14px 12px 140px" }}>
        {showAdmin && user.admin && <AdminPanel users={users} onAdd={addUser} onRemove={removeUser} onClose={() => setShowAdmin(false)} th={th} />}
        <Weekly tasks={tasks} user={user} th={th} />
        <AddForm user={user} users={users} onAdd={addTask} th={th} />
        <div style={{ display: "flex", gap: "3px", marginBottom: "6px", overflowX: "auto", paddingBottom: "2px" }}>
          {[{ id: "my", l: "Moje", n: stats.my }, { id: "assigned", l: "Zadané", n: stats.out }, { id: "shared", l: "Společné", n: stats.shared }, { id: "unread", l: "Nepřečtené", n: unread[user.name] }, { id: "all", l: "Vše" }].map(tab => (
            <button key={tab.id} onClick={() => setFilter(tab.id)} style={{ ...btnS(th), padding: "6px 10px", fontSize: "11px", background: filter === tab.id ? th.accentSoft : "transparent", color: filter === tab.id ? th.accent : th.textMid, border: filter === tab.id ? `1px solid ${th.accentBorder}` : "1px solid transparent", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
              {tab.l}{tab.n > 0 && <span style={{ background: filter === tab.id ? th.accent : th.btnBg, color: filter === tab.id ? "#fff" : th.textSub, borderRadius: "8px", padding: "0 5px", fontSize: "9px", fontWeight: 800 }}>{tab.n}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px", gap: "6px" }}>
          <div style={{ display: "flex", gap: "2px" }}>
            {[{ id: "active", l: "Aktivní" }, { id: "done", l: "Splněné" }, { id: "cancelled", l: "Nerealizované" }].map(v => (
              <button key={v.id} onClick={() => setVs(v.id)} style={{ ...btnS(th), padding: "4px 8px", fontSize: "10px", background: vs === v.id ? th.btnBg : "transparent", color: vs === v.id ? th.text : th.textDim }}>{v.l}</button>
            ))}
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ ...inpS(th), width: "auto", padding: "3px 6px", fontSize: "10px", background: "transparent", border: `1px solid ${th.inputBorder}` }}>
            {[{ id: "smart", l: "↕ Chytré" }, { id: "priority", l: "↕ Priorita" }, { id: "date", l: "↕ Termín" }, { id: "created", l: "↕ Nejnovější" }].map(s => <option key={s.id} value={s.id}>{s.l}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: "3px", marginBottom: "12px", overflowX: "auto", paddingBottom: "2px" }}>
          <button onClick={() => setCatF("all")} style={{ ...btnS(th), padding: "3px 8px", fontSize: "10px", background: catF === "all" ? th.btnBg : "transparent", color: catF === "all" ? th.text : th.textDim, whiteSpace: "nowrap" }}>Vše</button>
          {CATS.map(c => { const cnt = tasks.filter(t => t.category === c.id && (vs === "active" ? !dn(t) : vs === "done" ? t.status === "done" : t.status === "cancelled")).length; if (cnt === 0 && catF !== c.id) return null; return <button key={c.id} onClick={() => setCatF(c.id)} style={{ ...btnS(th), padding: "3px 7px", fontSize: "10px", background: catF === c.id ? th.btnBg : "transparent", color: catF === c.id ? th.text : th.textDim, whiteSpace: "nowrap" }}>{c.icon} {cnt}</button>; })}
        </div>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: th.textDim, padding: "50px 20px" }}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>{vs === "active" ? "🎉" : vs === "done" ? "📭" : "✨"}</div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: th.textMid }}>{vs === "active" ? "Žádné aktivní úkoly" : vs === "done" ? "Zatím nic splněného" : "Žádné nerealizované"}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {filtered.map(t => <TaskCard key={t.id} task={t} user={user} users={users} onStatus={chgStatus} onSeen={markSeen} onUpdate={updateTask} th={th} />)}
          </div>
        )}
      </div>
      <Snack msg={undo?.msg} vis={!!undo} onUndo={doUndo} th={th} />
    </div>
  );
}

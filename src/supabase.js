import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Chybí Supabase údaje! Zkontroluj soubor .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: { params: { eventsPerSecond: 10 } }
})

// ─────────── Task mapping ───────────

export const dbToTask = (r) => ({
  id: r.id,
  title: r.title,
  note: r.note,
  type: r.type,
  priority: r.priority,
  category: r.category,
  status: r.status,
  dueDate: r.due_date,
  showFrom: r.show_from,
  recDays: r.rec_days,
  recurrenceRule: r.recurrence_rule || null,    // advanced recurrence
  activeMo: r.active_months || [],
  assignTo: r.assign_to,
  assignedTo: r.assigned_to || [],
  doneBy: r.done_by || [],
  seenBy: r.seen_by || [],
  checklist: r.checklist || [],
  images: r.images || [],
  createdBy: r.created_by,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  completedByUser: r.completed_by_user,
  deletedAt: r.deleted_at,
  // ─ Iterace B: Focus mode ─
  scratchPad: r.scratch_pad || [],
  parkedReason: r.parked_reason || null,
  parkedAt: r.parked_at,
  parkedBy: r.parked_by || null,
  timeSpentMin: r.time_spent_min || 0,
})

export const taskToDb = (t) => ({
  id: t.id,
  title: t.title,
  note: t.note,
  type: t.type,
  priority: t.priority,
  category: t.category,
  status: t.status,
  due_date: t.dueDate,
  show_from: t.showFrom,
  rec_days: t.recDays,
  recurrence_rule: t.recurrenceRule || null,    // advanced recurrence
  active_months: t.activeMo,
  assign_to: t.assignTo,
  assigned_to: t.assignedTo,
  done_by: t.doneBy,
  seen_by: t.seenBy,
  checklist: t.checklist,
  images: t.images,
  created_by: t.createdBy,
  created_at: t.createdAt,
  completed_at: t.completedAt,
  completed_by_user: t.completedByUser,
  deleted_at: t.deletedAt,
  // ─ Iterace B: Focus mode ─
  scratch_pad: t.scratchPad || [],
  parked_reason: t.parkedReason || null,
  parked_at: t.parkedAt || null,
  parked_by: t.parkedBy || null,
  time_spent_min: t.timeSpentMin || 0,
})

// ─────────── User mapping ───────────

export const dbToUser = (r) => ({
  name: r.name,
  pin: r.pin,
  admin: r.is_admin,
})

// ─────────── Comment mapping ───────────

export const dbToComment = (r) => ({
  id: r.id,
  taskId: r.task_id,
  checklistItemId: r.checklist_item_id || null,
  author: r.author,
  content: r.content,
  type: r.type || 'comment',    // 'comment' | 'reaction' | 'system'
  reaction: r.reaction || null,
  seenBy: r.seen_by || [],
  createdAt: r.created_at,
})

export const commentToDb = (c) => ({
  id: c.id,
  task_id: c.taskId,
  checklist_item_id: c.checklistItemId || null,
  author: c.author,
  content: c.content || null,
  type: c.type || 'comment',
  reaction: c.reaction || null,
  seen_by: c.seenBy || [],
  created_at: c.createdAt,
})

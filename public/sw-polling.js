/* ═══════════════════════════════════════════════════════
   SERVICE WORKER — Push notifications + polling fallback
   ═══════════════════════════════════════════════════════ */

const SUPABASE_URL = "__SUPABASE_URL__";
const SUPABASE_KEY = "__SUPABASE_KEY__";
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ─── Push notification handler ───
self.addEventListener("push", (event) => {
  let data = { title: "📋 Nový úkol", body: "" };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = {
        title: parsed.title || data.title,
        body: parsed.body || data.body,
        icon: parsed.icon || "/icon-192.png",
        badge: parsed.badge || "/icon-192.png",
        tag: parsed.tag || "task-notification",
        data: parsed.data || { url: "/" },
      };
    }
  } catch (e) {
    // If not JSON, use as text
    if (event.data) {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || "/icon-192.png",
      badge: data.badge || "/icon-192.png",
      tag: data.tag || "task-notification",
      renotify: true,
      vibrate: [200, 100, 200],
      data: data.data || { url: "/" },
      actions: [
        { action: "open", title: "Otevřít" },
      ],
    })
  );
});

// ─── Notification click handler ───
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("/");
      }
    })
  );
});

// ─── Polling fallback (for Android + when push unavailable) ───

async function getFromCache(key) {
  try {
    const cache = await caches.open("ft-sw-data");
    const response = await cache.match(new Request(`/__sw_data__/${key}`));
    if (response) return await response.text();
    return null;
  } catch (e) { return null; }
}

async function setInCache(key, value) {
  try {
    const cache = await caches.open("ft-sw-data");
    await cache.put(new Request(`/__sw_data__/${key}`), new Response(value));
  } catch (e) {}
}

async function checkForNewTasks() {
  try {
    const userJson = await getFromCache("ft_user");
    if (!userJson) return;
    const user = JSON.parse(userJson);
    if (!user || !user.name) return;

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?status=eq.active&order=created_at.desc&limit=50`,
      {
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) return;
    const tasks = await response.json();

    const unreadTasks = tasks.filter(task => {
      const seenBy = task.seen_by || [];
      const assignedTo = task.assigned_to || [];
      return assignedTo.includes(user.name) && task.created_by !== user.name && !seenBy.includes(user.name);
    });

    if (unreadTasks.length === 0) return;

    const lastCount = parseInt(await getFromCache("ft_last_notified") || "0");
    if (unreadTasks.length <= lastCount) return;

    const latest = unreadTasks[0];
    const title = unreadTasks.length === 1
      ? `📋 Nový úkol od ${latest.created_by}`
      : `📋 ${unreadTasks.length} nových úkolů`;
    const body = unreadTasks.length === 1
      ? latest.title
      : unreadTasks.slice(0, 3).map(t => t.title).join(", ");

    await self.registration.showNotification(title, {
      body, icon: "/icon-192.png", badge: "/icon-192.png",
      tag: "new-tasks", renotify: true, vibrate: [200, 100, 200],
      data: { url: "/" },
    });

    await setInCache("ft_last_notified", String(unreadTasks.length));
  } catch (e) {
    console.warn("SW poll failed:", e);
  }
}

// ─── Message handler (sync user session from app) ───
self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_USER") {
    setInCache("ft_user", JSON.stringify(event.data.user));
  }
  if (event.data?.type === "CLEAR_USER") {
    setInCache("ft_user", "");
    setInCache("ft_last_notified", "0");
  }
  if (event.data?.type === "TASKS_SEEN") {
    setInCache("ft_last_notified", "0");
  }
});

// ─── Lifecycle ───
let pollTimer = null;

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  setTimeout(() => checkForNewTasks(), 30000);
  pollTimer = setInterval(() => checkForNewTasks(), POLL_INTERVAL);
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
  startPolling();
});

self.addEventListener("fetch", () => {
  if (!pollTimer) startPolling();
});

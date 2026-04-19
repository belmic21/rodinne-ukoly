/* ═══════════════════════════════════════════════════════
   SERVICE WORKER — Background polling for new tasks
   ═══════════════════════════════════════════════════════
   
   This service worker checks for new tasks every 5 minutes
   and shows a notification if there are unread tasks.
   Works on Android even with the app closed.
   ═══════════════════════════════════════════════════════ */

// These values are injected at build time by vite
const SUPABASE_URL = "__SUPABASE_URL__";
const SUPABASE_KEY = "__SUPABASE_KEY__";
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ─── Polling logic ───

async function checkForNewTasks() {
  try {
    // Get current user from cache
    const userJson = await getFromCache("ft_user");
    if (!userJson) return; // No logged in user

    const user = JSON.parse(userJson);
    if (!user || !user.name) return;

    // Fetch tasks from Supabase
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

    // Find unread tasks assigned to this user
    const unreadTasks = tasks.filter(task => {
      const seenBy = task.seen_by || [];
      const assignedTo = task.assigned_to || [];
      const createdBy = task.created_by;
      return (
        assignedTo.includes(user.name) &&
        createdBy !== user.name &&
        !seenBy.includes(user.name)
      );
    });

    if (unreadTasks.length === 0) return;

    // Check if we already notified about these tasks
    const lastNotifiedKey = "ft_last_notified_count";
    const lastCount = parseInt(await getFromCache(lastNotifiedKey) || "0");
    
    if (unreadTasks.length <= lastCount) return; // No new ones since last notification

    // Show notification
    const latestTask = unreadTasks[0];
    const title = unreadTasks.length === 1
      ? `📋 Nový úkol od ${latestTask.created_by}`
      : `📋 ${unreadTasks.length} nových úkolů`;
    
    const body = unreadTasks.length === 1
      ? latestTask.title
      : unreadTasks.slice(0, 3).map(t => t.title).join(", ") +
        (unreadTasks.length > 3 ? ` a ${unreadTasks.length - 3} další...` : "");

    await self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "new-tasks", // Replaces previous notification
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: "/" },
    });

    // Remember count to avoid duplicate notifications
    await setInCache(lastNotifiedKey, String(unreadTasks.length));

  } catch (error) {
    console.warn("SW: checkForNewTasks failed", error);
  }
}

// ─── Cache helpers (using Cache API since SW can't use localStorage) ───

async function getFromCache(key) {
  try {
    const cache = await caches.open("ft-sw-data");
    const response = await cache.match(new Request(`/__sw_data__/${key}`));
    if (response) return await response.text();
    return null;
  } catch (e) {
    return null;
  }
}

async function setInCache(key, value) {
  try {
    const cache = await caches.open("ft-sw-data");
    await cache.put(
      new Request(`/__sw_data__/${key}`),
      new Response(value)
    );
  } catch (e) {}
}

// ─── Sync user session from main app ───

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SET_USER") {
    setInCache("ft_user", JSON.stringify(event.data.user));
  }
  if (event.data && event.data.type === "CLEAR_USER") {
    setInCache("ft_user", "");
    setInCache("ft_last_notified_count", "0");
  }
  if (event.data && event.data.type === "TASKS_SEEN") {
    // Reset notification count when user has seen tasks
    setInCache("ft_last_notified_count", "0");
  }
});

// ─── Notification click handler ───

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow("/");
      }
    })
  );
});

// ─── Periodic polling using setInterval in SW ───

let pollTimer = null;

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  // Initial check after 30 seconds
  setTimeout(() => checkForNewTasks(), 30000);
  // Then every 5 minutes
  pollTimer = setInterval(() => checkForNewTasks(), POLL_INTERVAL);
}

// Start polling when SW activates
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
  startPolling();
});

// Also handle install
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Restart polling on fetch (keeps SW alive)
self.addEventListener("fetch", (event) => {
  // Don't interfere with normal fetches, just use it to keep SW alive
  if (!pollTimer) startPolling();
});

// ════════════════════════════════════════════════════════
// SERVICE WORKER — push handler + polling fallback + deeplink podpora
//
// Zpracovává push notifikace ze serveru. Klik na notifikaci otevře:
//   - URL z payload.data.url (deeplink jako /?open=task:123)
//   - nebo "/" pokud není
// ════════════════════════════════════════════════════════

const SW_VERSION = "v4-deeplinks";

self.addEventListener("install", (event) => {
  console.log("[SW]", SW_VERSION, "installing");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SW]", SW_VERSION, "activated");
  event.waitUntil(self.clients.claim());
});

// ─── Push notifikace ───
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Rodinné úkoly", body: event.data.text() };
  }

  const title = payload.title || "Rodinné úkoly";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    tag: payload.tag,
    data: payload.data || {},
    requireInteraction: false,
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Klik na notifikaci ───
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Cílová URL — z payload.data.url (deeplink), default "/"
  const data = event.notification.data || {};
  const targetUrl = data.url || "/";

  // Pokud je už otevřené okno appky, fokusneme ho a navigujeme tam.
  // Jinak otevřeme nové okno.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Najdi okno se stejným origin
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);
          const targetUrlAbs = new URL(targetUrl, self.location.origin);
          if (clientUrl.origin === targetUrlAbs.origin) {
            // Nasměruj na správnou URL (s deeplink parametrem) a fokus
            return client.navigate(targetUrlAbs.pathname + targetUrlAbs.search + targetUrlAbs.hash)
              .then((c) => (c || client).focus())
              .catch(() => client.focus());
          }
        } catch {}
      }
      // Žádné okno není otevřené — otevři nové
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ─── Polling fallback (Brave / iOS bez push) ───
// Klient v App.jsx posílá ping přes postMessage; SW jen drží registraci aktivní.
self.addEventListener("message", (event) => {
  if (event.data?.type === "ping") {
    event.ports[0]?.postMessage({ type: "pong", version: SW_VERSION });
  }
});

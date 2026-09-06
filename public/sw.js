/* Service worker — mode hors connexion.
   Stratégie : le réseau d'abord, le cache en secours. L'application reste
   utilisable dans une salle sans réseau, et se met à jour dès qu'il revient. */

const CACHE = "wgu-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./manifest.json"]).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // On ne met jamais en cache les appels au modèle : une réponse de coach
  // figée serait pire que pas de réponse du tout.
  if (req.url.includes("api.anthropic.com")) return;

  e.respondWith(
    fetch(req)
      .then((rep) => {
        if (rep && rep.status === 200 && rep.type === "basic") {
          const copie = rep.clone();
          caches.open(CACHE).then((c) => c.put(req, copie)).catch(() => {});
        }
        return rep;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
  );
});

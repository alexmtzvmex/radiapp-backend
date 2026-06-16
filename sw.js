self.addEventListener("install", event => {
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(keys.map(key => caches.delete(key)));
        }).then(() => clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;

    // Para RadiApp preferimos siempre red en HTML/JS/CSS,
    // así no se quedan versiones viejas rompiendo funciones ya corregidas.
    if (request.mode === "navigate" || request.url.endsWith(".html") || request.url.endsWith(".js") || request.url.endsWith(".css")) {
        event.respondWith(fetch(request).catch(() => caches.match(request)));
        return;
    }

    event.respondWith(fetch(request).catch(() => caches.match(request)));
});

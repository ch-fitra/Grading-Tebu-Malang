// Run against an Electron window started with --remote-debugging-port=9222.
const port = process.env.DESKTOP_DEBUG_PORT ?? "9222";
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(entry => entry.type === "page" && entry.title === "Tebu AI");
if (!page) throw new Error("Jendela Tebu AI tidak ditemukan");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Renderer tidak menjawab")), 10000);
  socket.addEventListener("message", event => {
    const response = JSON.parse(event.data);
    if (response.id !== 1) return;
    clearTimeout(timeout);
    if (response.error || response.result?.exceptionDetails) reject(new Error(JSON.stringify(response.error ?? response.result.exceptionDetails)));
    else resolve(response.result.result.value);
  });
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      expression: `(async () => ({
        title: document.title,
        url: location.href,
        rootChildren: document.getElementById("root")?.children.length ?? 0,
        hasUi: document.body.innerText.includes("Sign In to Console") || document.body.innerText.includes("Real-time sugar cane impurity scanning control panel"),
        config: window.sugarcaneDesktop,
        imagesLoaded: [...document.images].every(image => image.complete && image.naturalWidth > 0),
        stylesLoaded: document.styleSheets.length > 0,
        storageWorks: (() => { try { localStorage.getItem("tebu-ui-theme"); return true; } catch { return false; } })(),
        apiHealth: await fetch(window.sugarcaneDesktop.apiBaseUrl + "/health").then(response => response.ok).catch(() => false),
        websocketClients: await (async () => {
          let session = null;
          try { session = JSON.parse(localStorage.getItem("tebu-session") ?? "null"); } catch { return null; }
          if (!session?.token) return null;
          return fetch(window.sugarcaneDesktop.apiBaseUrl + "/api/system/status", {
            headers: { Authorization: "Bearer " + session.token }
          }).then(response => response.json()).then(status => status.websocket?.clients ?? 0).catch(() => 0);
        })(),
        navigation: await (async () => {
          const buttons = [...document.querySelectorAll("aside.sidebar nav button")];
          const pages = [];
          for (const button of buttons) {
            button.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            pages.push({ menu: button.getAttribute("aria-label"), heading: document.querySelector("main h1")?.textContent ?? "" });
          }
          return pages;
        })()
      }))()`,
      awaitPromise: true,
      returnByValue: true
    }
  }));
});
socket.close();

console.log(result);
if (!result.url.startsWith("file:") || !result.hasUi || !result.config?.apiBaseUrl || !result.imagesLoaded || !result.stylesLoaded || !result.storageWorks || !result.apiHealth || (result.websocketClients !== null && result.websocketClients < 1) || result.navigation.some(page => !page.heading)) {
  throw new Error("Pemeriksaan UI desktop gagal");
}

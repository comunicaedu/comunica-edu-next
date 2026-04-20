// Web Worker para keepalive e timer preciso do player de áudio.
// Timers dentro de Web Workers NUNCA são throttled pelo Chrome em background,
// ao contrário de setInterval/setTimeout na aba principal.
let intervalId = null;
let timeoutId = null;

self.onmessage = function (e) {
  if (e.data.type === "start") {
    // Keepalive tick periódico
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      self.postMessage({ type: "tick" });
    }, e.data.interval || 1000);

  } else if (e.data.type === "stop") {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }

  } else if (e.data.type === "schedule-next") {
    // Timer único para fim de música — preciso mesmo em background
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    const delay = Math.max(0, e.data.delayMs || 0);
    timeoutId = setTimeout(() => {
      self.postMessage({ type: "song-end" });
      timeoutId = null;
    }, delay);

  } else if (e.data.type === "cancel-next") {
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
  }
};

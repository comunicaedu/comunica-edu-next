/**
 * Returns the best supported MediaRecorder MIME type for the current browser.
 * Safari/iOS only supports audio/mp4 (AAC). Chrome/Firefox prefer webm/opus.
 */
export function getSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";

  const types = [
    "audio/webm;codecs=opus",   // Chrome, Firefox, Edge (best quality)
    "audio/webm",               // Chrome, Firefox fallback
    "audio/ogg;codecs=opus",    // Firefox
    "audio/mp4;codecs=aac",     // Safari 14.1+ on iOS/macOS
    "audio/mp4",                // Safari fallback
  ];

  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/**
 * Returns true if the current device is iOS (iPhone, iPad, iPod).
 * Also catches iPad on iOS 13+ which reports as MacIntel.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Returns true if the browser is Safari (not Chrome/Firefox on iOS).
 */
export function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
}

/**
 * Loads SpeechSynthesis voices, waiting for async load on Safari/iOS.
 */
export function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") {
      resolve([]);
      return;
    }

    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }

    // Safari/iOS loads voices asynchronously
    const onVoicesChanged = () => {
      resolve(speechSynthesis.getVoices());
    };

    speechSynthesis.addEventListener("voiceschanged", onVoicesChanged, { once: true });

    // Timeout fallback — if voiceschanged never fires
    setTimeout(() => {
      speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(speechSynthesis.getVoices());
    }, 2000);
  });
}

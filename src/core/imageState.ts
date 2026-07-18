type Listener = (url: string | null) => void;
let currentUrl: string | null = null;
const listeners = new Set<Listener>();

export function getImageUrl(): string | null {
  return currentUrl;
}

export function setImageUrl(url: string | null): void {
  currentUrl = url;
  listeners.forEach((fn) => fn(url));
}

export function subscribeToImageUrl(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

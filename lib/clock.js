'use client';
import { useStore } from './store';
// Scene time in seconds since this page loaded (local clock).
export const EPOCH = typeof performance !== 'undefined' ? Date.now() : 0;
// window.__tOff (seconds) is a testing hook to preview later moments.
export const sceneNow = () => (Date.now() - EPOCH) / 1000 + ((typeof window !== 'undefined' && window.__tOff) || 0);
// Convert a server-clock timestamp (ms) into scene seconds.
export const toScene = (serverMs) => (serverMs - useStore.getState().offset - EPOCH) / 1000;

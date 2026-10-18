'use client';
import { useStore } from './store';
// Scene time in seconds since this page loaded (local clock).
export const EPOCH = typeof performance !== 'undefined' ? Date.now() : 0;
export const sceneNow = () => (Date.now() - EPOCH) / 1000;
// Convert a server-clock timestamp (ms) into scene seconds.
export const toScene = (serverMs) => (serverMs - useStore.getState().offset - EPOCH) / 1000;

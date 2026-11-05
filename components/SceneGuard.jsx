'use client';
// Keeps the page usable even if 3D can't run (very old phone, WebGL off, GPU crash):
// people can still join, lay their log and follow along.
import { Component, useEffect, useState } from 'react';

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    // give the test context back straight away (phones only allow a few at once)
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

const MAX_RESTARTS = 3; // after this many lost 3D views, stay on the simple view

function Fallback() {
  return (
    <div className="fallback-fire" aria-hidden="true">
      <div className="ff-glow" />
      <div className="ff-flame" />
    </div>
  );
}

class Boundary extends Component {
  constructor(p) {
    super(p);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e) {
    console.warn('3D scene failed, showing simple view', e);
  }
  render() {
    return this.state.failed ? <Fallback /> : this.props.children;
  }
}

export default function SceneGuard({ children }) {
  const [ok, setOk] = useState(null);
  // bumped to start the 3D view afresh (a new canvas and context)
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!hasWebGL2()) {
      setOk(false);
      return;
    }
    setOk(true);
    let restarts = 0;
    let waiting = false;
    let timer = 0;
    const restart = () => {
      if (!waiting || document.visibilityState !== 'visible') return;
      waiting = false;
      clearTimeout(timer);
      restarts++;
      setRun((r) => r + 1);
      setOk(true);
    };
    // if the GPU drops the context (low memory phones, or the phone was locked),
    // show the simple view, then start the 3D again once the page is visible
    const lost = (e) => {
      e.preventDefault?.();
      if (waiting) return;
      setOk(false);
      if (restarts >= MAX_RESTARTS) return;
      waiting = true;
      clearTimeout(timer);
      timer = setTimeout(restart, 1500);
    };
    const visible = () => document.visibilityState === 'visible' && restart();
    window.addEventListener('webglcontextlost', lost, true);
    window.addEventListener('webglcontextrestored', restart, true);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('webglcontextlost', lost, true);
      window.removeEventListener('webglcontextrestored', restart, true);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  if (ok === null) return null;
  if (!ok) return <Fallback />;
  return <Boundary key={run}>{children}</Boundary>;
}

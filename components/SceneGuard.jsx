'use client';
// Keeps the page usable even if 3D can't run (very old phone, WebGL off, GPU crash):
// people can still join, lay their log and follow along.
import { Component, useEffect, useState } from 'react';

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

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
  useEffect(() => {
    setOk(hasWebGL2());
    // if the GPU drops the context (rare, low memory phones), fall back instead of a black screen
    const lost = (e) => {
      e.preventDefault?.();
      setOk(false);
    };
    window.addEventListener('webglcontextlost', lost, true);
    return () => window.removeEventListener('webglcontextlost', lost, true);
  }, []);
  if (ok === null) return null;
  if (!ok) return <Fallback />;
  return <Boundary>{children}</Boundary>;
}

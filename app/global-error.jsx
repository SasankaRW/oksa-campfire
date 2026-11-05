'use client';
// Last-resort error page for crashes in the root layout itself. It replaces the
// layout, so it brings its own <html>, <body> and styles.
import './globals.css';

export default function GlobalError() {
  return (
    <html lang="en">
      <body>
        <main className="stage crash">
          <div className="card" role="alert">
            <div className="eyebrow">The fire flickered</div>
            <h2>Something went wrong</h2>
            <p className="lede">Nothing is lost. Reloading the page usually brings everything back.</p>
            <button className="btn btn--cta lg wide" onClick={() => location.reload()}>
              Tap to reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

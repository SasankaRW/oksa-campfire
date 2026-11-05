'use client';
// Shown if something on the page crashes. A full reload is the surest fix
// (it also brings back a lost 3D canvas), so that's the one button.
export default function ErrorPage() {
  return (
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
  );
}

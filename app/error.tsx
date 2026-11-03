"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="panel rivets" style={{ maxWidth: 640 }} role="alert">
      <div className="panel-head"><span className="label">Control plane fault</span><span className="label">500</span></div>
      <div className="panel-body">
        <p>The page failed to render: {error.message.slice(0, 160)}</p>
        <button className="btn" onClick={reset}>Retry</button>
      </div>
    </section>
  );
}

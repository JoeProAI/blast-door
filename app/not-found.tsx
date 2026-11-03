import Link from "next/link";
export default function NotFound() {
  return (
    <section className="panel rivets" style={{ maxWidth: 640 }}>
      <div className="panel-head"><span className="label">Bay empty</span><span className="label">404</span></div>
      <div className="panel-body">
        <p>Nothing is stored under that address. The run may have been purged, or the link is mistyped.</p>
        <Link className="btn btn-ghost" href="/">Back to the bay</Link>
      </div>
    </section>
  );
}

export function LoadingOverlay({ authorizing = false }: { authorizing?: boolean }) {
  return (
    <div className="zivora-loading" role="status">
      <span className="zivora-spinner" aria-hidden="true" />
      {authorizing ? "Preparing your video…" : "Buffering…"}
    </div>
  );
}

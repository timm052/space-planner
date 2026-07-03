// Tiny shared UI primitives. One place to change error/empty markup for the
// whole app (App shell, tabs, rail, popovers).

export function Banner({ kind = 'error', children }) {
  return (
    <div className={`banner ${kind}`} role="alert">
      {children}
    </div>
  );
}

export function Empty({ small = false, children }) {
  return <div className={`empty${small ? ' small' : ''}`}>{children}</div>;
}

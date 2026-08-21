/** Petit graphe en barres horizontales, sans dépendance externe. */
export function Bars({ rows }: { rows: { label: string; value: number; display: string }[] }) {
  if (rows.length === 0) {
    return <div className="empty-state">Pas encore de données.</div>;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="bars">
      {rows.map((row) => (
        <div className="bar-row" key={row.label}>
          <span>{row.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 3 : 0)}%` }} />
          </span>
          <span className="val">{row.display}</span>
        </div>
      ))}
    </div>
  );
}

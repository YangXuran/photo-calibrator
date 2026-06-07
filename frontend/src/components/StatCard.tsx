type StatCardProps = {
  label: string;
  value: string;
  tone?: "default" | "accent";
};

export function StatCard({ label, value, tone = "default" }: StatCardProps) {
  return (
    <article className={`pc-stat-card pc-stat-card-${tone}`}>
      <span className="pc-stat-label">{label}</span>
      <strong className="pc-stat-value">{value}</strong>
    </article>
  );
}

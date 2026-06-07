type TopbarActionButtonProps = {
  children: string;
  onClick: () => void;
  testId: string;
  tone?: "primary" | "secondary";
};

export function TopbarActionButton({ children, onClick, testId, tone = "secondary" }: TopbarActionButtonProps) {
  return (
    <button className={`pc-button${tone === "secondary" ? " pc-button-secondary" : ""}`} data-testid={testId} onClick={onClick} type="button">
      {children}
    </button>
  );
}

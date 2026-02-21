// Branded zeros using Fira Code with tight spacing — the signature r00t visual
export function BrandedZeros({ className = '' }: { className?: string }) {
  return (
    <span
      className={className}
      style={{
        fontFamily: "'Fira Code', monospace",
        fontWeight: 300,
        letterSpacing: '-0.14em',
        opacity: 0.7,
        fontSize: '0.88em',
        position: 'relative',
        top: '0.02em',
        marginRight: '0.04em',
      }}
    >
      00
    </span>
  );
}

// Renders /public/kautis-logo.png -- swap that one file for a newer brand
// asset if it changes; nothing here needs to change.
export function KautisMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/kautis-logo.png"
      alt="Kautis"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, borderRadius: size * 0.27, objectFit: 'cover' }}
    />
  );
}

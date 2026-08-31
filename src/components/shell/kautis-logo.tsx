// Renders /public/kautis-logo.svg -- swap that one file for the real brand
// asset when it's ready; nothing here needs to change.
export function KautisMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/kautis-logo.svg"
      alt="Kautis"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, borderRadius: size * 0.27 }}
    />
  );
}

// Renders /public/kautis-mark.svg (navy) or /public/kautis-mark-white.svg
// (white, for dark/navy backgrounds like the login page) -- the eagle-in-
// circle mark. Swap those files for a newer brand asset if it changes;
// nothing here needs to change. The mark already draws its own circular
// border, so it's rendered at native aspect ratio rather than
// cropped/rounded like a raster photo.
export function KautisMark({
  size = 40,
  className,
  variant = 'navy',
}: {
  size?: number;
  className?: string;
  variant?: 'navy' | 'white';
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={variant === 'white' ? '/kautis-mark-white.svg' : '/kautis-mark.svg'}
      alt="Kautis"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}

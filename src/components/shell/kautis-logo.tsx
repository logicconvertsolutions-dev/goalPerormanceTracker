import { cn } from '@/lib/utils';

// Renders /public/kautis-mark.svg (navy) or /public/kautis-mark-white.svg
// (white, for dark/navy backgrounds like the login page and dark mode) -- the eagle-in-
// circle mark. Swap those files for a newer brand asset if it changes;
// nothing here needs to change. The mark already draws its own circular
// border, so it's rendered at native aspect ratio rather than
// cropped/rounded like a raster photo.
export function KautisMark({
  size = 40,
  className,
  variant = 'auto',
}: {
  size?: number;
  className?: string;
  /** `auto` follows the theme (navy in light, white in dark) with pure CSS,
   * so it's right on first paint; `navy`/`white` pin one for fixed surfaces. */
  variant?: 'auto' | 'navy' | 'white';
}) {
  if (variant === 'auto') {
    return (
      <>
        <MarkImage src="/kautis-mark.svg" size={size} className={cn(className, 'dark:hidden')} />
        <MarkImage src="/kautis-mark-white.svg" size={size} className={cn(className, 'hidden dark:block')} />
      </>
    );
  }
  return (
    <MarkImage
      src={variant === 'white' ? '/kautis-mark-white.svg' : '/kautis-mark.svg'}
      size={size}
      className={className}
    />
  );
}

function MarkImage({ src, size, className }: { src: string; size: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Kautis"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}

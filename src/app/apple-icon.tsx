import { readFile } from 'fs/promises';
import { join } from 'path';
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// Apple touch icons must not be transparent/rounded (iOS applies its own
// mask), so this is a plain filled square unlike icon.tsx. Same underlying
// artwork -- public/kautis-logo.png -- as every other KautisMark usage.
export default async function AppleIcon() {
  const file = await readFile(join(process.cwd(), 'public', 'kautis-logo.png'));
  const src = `data:image/png;base64,${file.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0B1E3D',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={size.width} height={size.height} alt="" />
      </div>
    ),
    { ...size }
  );
}

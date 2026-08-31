import { readFile } from 'fs/promises';
import { join } from 'path';
import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

// Generated at request time via next/og, but the artwork itself is the real
// brand mark at public/kautis-logo.png -- swap that file and this updates
// automatically, same as every other KautisMark usage in the app.
export default async function Icon() {
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
          borderRadius: 96,
          overflow: 'hidden',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={size.width} height={size.height} alt="" />
      </div>
    ),
    { ...size }
  );
}

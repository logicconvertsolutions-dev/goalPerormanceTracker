import { readFile } from 'fs/promises';
import { join } from 'path';
import { ImageResponse } from 'next/og';

// A real, versioned URL (not Next's `apple-icon` file-convention route, and
// not just a query-string cache-buster) for the iOS "Add to Home Screen"
// touch icon. iOS Safari caches the home-screen icon at the OS level keyed
// to the <link rel="apple-touch-icon"> URL and is known to ignore
// query-string-only cache-busting on that specific tag -- clearing Safari
// history/re-adding the shortcut doesn't help because the URL never
// actually changed. Giving it a literal new path forces a real refetch.
//
// To ship new artwork: bump the folder name (v3 -> v4), update the
// `metadata.icons.apple` path in src/app/layout.tsx, and update the
// manifest.ts icons entry to match. Old versioned routes can be deleted
// once no installed home-screen icons should still reference them.
const size = { width: 180, height: 180 };

export async function GET() {
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

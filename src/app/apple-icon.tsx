import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// Apple touch icons must not be transparent/rounded (iOS applies its own
// mask), so this is a plain filled square unlike icon.tsx.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#08090A',
        }}
      >
        <div
          style={{
            fontSize: 92,
            fontWeight: 700,
            color: '#3D9AFF',
            fontFamily: 'sans-serif',
          }}
        >
          P
        </div>
      </div>
    ),
    { ...size }
  );
}

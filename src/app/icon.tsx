import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

// Generated at request time via next/og — no file lives in public/.
export default function Icon() {
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
          borderRadius: 96,
        }}
      >
        <div
          style={{
            fontSize: 260,
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

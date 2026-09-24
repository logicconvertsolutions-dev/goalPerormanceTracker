// A short, soft two-note "done" chime (P31) for ticking off a to-do or
// completing a reminder. Synthesised with the Web Audio API -- no sound file,
// no dependency. Call it straight from the tap handler: browsers (iOS
// especially) only start audio inside a user gesture. It is a normal page
// sound, so the phone's silent switch and volume still apply.

let context: AudioContext | null = null;

export function playChime() {
  if (typeof window === 'undefined') return;
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context ??= new Ctor();
    const ctx = context;
    if (ctx.state === 'suspended') void ctx.resume();

    const start = ctx.currentTime + 0.01;
    // E6 then A6: bright but quiet, ~0.45 s in total.
    [
      { freq: 1318.5, at: 0 },
      { freq: 1760, at: 0.12 },
    ].forEach(({ freq, at }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = start + at;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.34);
    });
  } catch {
    // Sound is a nicety; never let it break the action.
  }
}

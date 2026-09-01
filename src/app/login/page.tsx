import { Suspense } from 'react';
import { Target, ClipboardCheck, BarChart3, PieChart, TrendingUp, ShieldCheck } from 'lucide-react';
import { KautisMark } from '@/components/shell/kautis-logo';
import { formatVersion } from '@/lib/version';
import { LoginForm } from './login-form';

const STEPS = [
  { label: 'Set Goals', icon: Target, style: { left: 106, top: 10 } },
  { label: 'Take Action', icon: ClipboardCheck, style: { left: 197, top: 76 } },
  { label: 'Track Progress', icon: BarChart3, style: { left: 162, top: 184 } },
  { label: 'Analyze', icon: PieChart, style: { left: 50, top: 184 } },
  { label: 'Improve', icon: TrendingUp, style: { left: 15, top: 76 } },
] as const;

// Same five steps, laid out as a plain row for the mobile header strip
// instead of the desktop circle -- see StepStrip below.
function StepCircle({ label, icon: Icon, style }: (typeof STEPS)[number]) {
  return (
    <div className="absolute h-12 w-12 -translate-x-0 -translate-y-0" style={style}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5">
        <Icon className="h-5 w-5 text-white" aria-hidden="true" />
      </div>
      <span
        className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10.5px] font-medium text-[#C7CCDD] ${
          label === 'Set Goals' ? '-top-5' : 'top-14'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function StepStrip() {
  return (
    <div className="flex justify-center gap-3 px-6 pb-4 lg:hidden">
      {STEPS.map(({ label, icon: Icon }) => (
        <div
          key={label}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5"
          title={label}
        >
          <Icon className="h-4 w-4 text-white" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen content-start bg-bg lg:content-stretch lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1fr)]">
      {/* Brand pane -- full content on desktop, compact header + step strip on mobile */}
      <div
        className="flex flex-col gap-5 px-6 pb-2 pt-8 text-white lg:gap-10 lg:px-11 lg:pb-8 lg:pt-12"
        style={{ background: 'linear-gradient(165deg, #0B1E3D 0%, #122A54 100%)' }}
      >
        <div className="flex items-center gap-3">
          <KautisMark size={40} variant="white" />
          <div>
            <div className="text-xl font-extrabold tracking-wide lg:text-[22px]">KAUTIS</div>
            <div className="text-[12.5px] font-medium text-gold">From action to achievement</div>
          </div>
        </div>

        <div className="hidden lg:block">
          <h1 className="text-[32px] font-extrabold leading-[1.25] text-balance">
            Turn every action into <span className="text-gold">achievement.</span>
          </h1>
          <p className="mt-3 max-w-[380px] text-[14.5px] leading-relaxed text-[#B9C0D6]">
            Kautis helps teams set goals, track performance, and achieve more — every single day.
          </p>
        </div>

        {/* Desktop: full circular diagram */}
        <div className="relative mx-auto hidden h-[260px] w-[260px] lg:block">
          <div className="absolute inset-[22px] rounded-full border border-dashed border-gold/30" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/15 bg-white/5 p-3 shadow-[0_6px_18px_-4px_rgba(30,63,168,0.5)]">
            <KautisMark size={54} variant="white" />
          </div>
          {STEPS.map((step) => (
            <StepCircle key={step.label} {...step} />
          ))}
        </div>

        {/* Mobile: condensed step strip */}
        <StepStrip />

        <div className="hidden items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3.5 lg:mt-auto lg:flex">
          <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-white/10">
            <ShieldCheck className="h-[17px] w-[17px] text-white" aria-hidden="true" />
          </div>
          <div>
            <div className="text-[12.5px] font-semibold text-white">
              Secure. Reliable. Built for performance.
            </div>
            <div className="text-[11px] text-[#A9B0C8]">
              Your data is safe with enterprise-grade security.
            </div>
          </div>
        </div>
      </div>

      {/* Form pane */}
      <div className="flex items-center justify-center px-6 py-10 lg:px-8">
        <div className="w-full max-w-[380px]">
          <h1 className="text-[27px] font-extrabold text-fg">Welcome back</h1>
          <p className="mb-6 mt-1.5 text-sm text-fg-2">Sign in to continue to Kautis</p>
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-8 text-center text-[11px] text-fg-4">{formatVersion()}</p>
        </div>
      </div>
    </div>
  );
}

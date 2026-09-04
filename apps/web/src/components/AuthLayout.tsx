import type { ReactNode } from 'react';
import { Wallet } from 'lucide-react';
import { Illustration, type IllustrationName } from './Illustration';

/**
 * The shell the two signed-out screens share.
 *
 * On a wide viewport it is a split panel — brand on the left, the form on the
 * right. Below `lg` the panel is dropped rather than stacked: someone signing
 * in on a phone wants the password field, not a full-height illustration above
 * it.
 */
export function AuthLayout({
  children,
  illustration,
  headline,
  blurb,
}: {
  children: ReactNode;
  illustration: IllustrationName;
  headline: string;
  blurb: string;
}) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      <div className="hidden flex-col bg-brand-800 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
            <Wallet className="h-5 w-5 text-peridot-400" aria-hidden="true" />
          </span>
          <span className="font-semibold">Finance Ops</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center">
          <Illustration name={illustration} className="h-64" eager />
          <h2 className="mt-10 max-w-sm text-center text-2xl font-semibold tracking-tight">
            {headline}
          </h2>
          <span className="mt-5 h-1 w-12 rounded-full bg-peridot-500" />
          <p className="mt-5 max-w-sm text-center text-sm text-brand-100">{blurb}</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}

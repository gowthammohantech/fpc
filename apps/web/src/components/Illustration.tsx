import approved from '@/assets/illustrations/approved.svg?url';
import bank from '@/assets/illustrations/bank.svg?url';
import broken from '@/assets/illustrations/broken.svg?url';
import charts from '@/assets/illustrations/charts.svg?url';
import inboxZero from '@/assets/illustrations/inbox-zero.svg?url';
import noAccess from '@/assets/illustrations/no-access.svg?url';
import noDocuments from '@/assets/illustrations/no-documents.svg?url';
import review from '@/assets/illustrations/review.svg?url';
import signIn from '@/assets/illustrations/sign-in.svg?url';
import sync from '@/assets/illustrations/sync.svg?url';
import wallet from '@/assets/illustrations/wallet.svg?url';
import welcome from '@/assets/illustrations/welcome.svg?url';

/**
 * The illustration set, imported by URL rather than inlined.
 *
 * Inlining twelve files of 12–65KB would put them in the JS bundle and parse
 * them on every load, for artwork most sessions never see — an empty state only
 * renders when a list is empty. As URLs they stay separate, content-hashed and
 * cacheable, and a missing file is a build error rather than a runtime 404.
 */
const SOURCES = {
  approved,
  bank,
  broken,
  charts,
  'inbox-zero': inboxZero,
  'no-access': noAccess,
  'no-documents': noDocuments,
  review,
  'sign-in': signIn,
  sync,
  wallet,
  welcome,
} as const;

export type IllustrationName = keyof typeof SOURCES;

/**
 * Storyset artwork, recoloured into the Apex palette by
 * `scripts/illustrations.mjs`.
 *
 * The credit line is rendered here rather than left to each call site, because
 * Storyset's free licence requires attribution wherever the artwork appears and
 * a per-page credit is the kind of thing that gets forgotten. `CREDITS.md` in
 * the assets folder records the source of every file.
 */
export function Illustration({
  name,
  className = 'h-40',
  credit = true,
  eager = false,
}: {
  name: IllustrationName;
  className?: string;
  /** Suppress the caption where another credit already appears on screen. */
  credit?: boolean;
  /** Load immediately — for artwork that is visible on arrival. */
  eager?: boolean;
}) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <img
        src={SOURCES[name]}
        // Decorative: the surrounding heading always carries the meaning.
        alt=""
        aria-hidden="true"
        loading={eager ? 'eager' : 'lazy'}
        width={500}
        height={500}
        className={`w-auto max-w-full ${className}`}
      />
      {credit ? (
        <figcaption className="text-[10px] text-ink-400">
          Illustration by{' '}
          <a
            className="underline underline-offset-2 hover:text-ink-600"
            href="https://storyset.com"
            target="_blank"
            rel="noreferrer"
          >
            Storyset
          </a>
        </figcaption>
      ) : null}
    </figure>
  );
}

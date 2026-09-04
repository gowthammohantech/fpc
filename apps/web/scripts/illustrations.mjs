/**
 * Fetches the Storyset illustrations the app uses and recolours them into the
 * Apex palette.
 *
 * Run by hand, never as part of a build: the outputs are committed so neither
 * `pnpm build` nor CI ever depends on storyset.com being reachable.
 *
 *   node scripts/illustrations.mjs
 *
 * Storyset artwork is free to use with attribution, which `Illustration.tsx`
 * renders alongside every image and CREDITS.md records per file.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets/illustrations');

/** `name` is the key the app imports by; `slug` is the storyset.com illustration. */
const MANIFEST = [
  { name: 'sign-in', slug: 'authentication', style: 'amico' },
  { name: 'welcome', slug: 'verified', style: 'amico' },
  { name: 'no-documents', slug: 'no-data', style: 'amico' },
  { name: 'review', slug: 'printing-invoices', style: 'amico' },
  { name: 'approved', slug: 'team-checklist', style: 'amico' },
  { name: 'wallet', slug: 'wallet', style: 'amico' },
  { name: 'bank', slug: 'online-banking', style: 'amico' },
  { name: 'sync', slug: 'transfer-money', style: 'amico' },
  { name: 'inbox-zero', slug: 'inbox-cleanup', style: 'amico' },
  { name: 'charts', slug: 'data-report', style: 'amico' },
  { name: 'no-access', slug: 'warning', style: 'amico' },
  { name: 'broken', slug: 'no-connection', style: 'amico' },
];

/**
 * Storyset's own palette, mapped onto Apex.
 *
 * Warm tones are deliberately absent: they carry skin and hair, and recolouring
 * people to brand colours reads as a rendering fault rather than as branding.
 */
const RECOLOUR = {
  // Storyset ships each illustration in one of four accent themes, and every
  // one of them lands on Sports Teal so the set reads as a single family.
  '#407BFF': '#14697B', // blue
  '#BA68C8': '#14697B', // purple
  '#92E3A9': '#14697B', // green
  '#FFC727': '#14697B', // yellow
  // Their lighter and darker siblings, where a style uses them.
  '#69A5FF': '#23899F',
  '#8CB8FF': '#40B1C9',
  '#1A5CE0': '#0D3F4A',
  // Line work → Black Steel. Storyset uses two darks across its styles.
  '#263238': '#0F172B',
  '#37474F': '#1E293B',
  '#2E353A': '#1E293B',
  '#455A64': '#334155',
  // Neutral fills → the ink ramp, with one nudged to a teal wash.
  '#FAFAFA': '#FFFFFF',
  '#F8F8F8': '#F8FAFC',
  '#F5F5F5': '#F8FAFC',
  '#F0F0F0': '#EEF9FC',
  '#EBEBEB': '#F1F5F9',
  '#E6E6E6': '#E2E8F0',
  '#E0E0E0': '#E2E8F0',
  '#DBDBDB': '#E2E8F0',
  '#D8D8D8': '#CBD5E1',
  '#CFCFCF': '#CBD5E1',
  '#C7C7C7': '#CBD5E1',
  '#A6A6A6': '#94A3B8',
  '#787878': '#64748B',
  '#636363': '#64748B',
  '#5E5E5E': '#475569',
  // Secondary accent → Peridot. This is where the lime enters the artwork.
  '#FF5652': '#E0EA49',
  '#DE5753': '#D1DC28',
};

const UA = { 'user-agent': 'Mozilla/5.0 (fpc illustration fetcher)' };

async function get(url) {
  const response = await fetch(url, { headers: UA });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

/**
 * Lists the illustration's own SVGs on its storyset.com page.
 *
 * The page also links related artwork, so a candidate only counts when its
 * filename starts with the illustration slug.
 */
async function findCandidates(slug, style) {
  const page = `https://storyset.com/illustration/${slug}/${style}`;
  const html = await get(page);
  const found = [
    ...html.matchAll(/https:\/\/stories\.freepiklabs\.com\/storage\/(\d+)\/([^"' ]+\.svg)/g),
  ];

  const wanted = slug.replace(/-/g, '');
  const candidates = found
    .map(([url, id, file]) => ({
      url,
      id: Number(id),
      key: file.toLowerCase().replace(/[^a-z0-9]/g, ''),
    }))
    .filter((candidate) => candidate.key.startsWith(wanted))
    .sort((a, b) => b.id - a.id)
    .slice(0, 5);

  if (!candidates.length) throw new Error(`no SVG on ${page} whose filename matches "${slug}"`);
  return { candidates, page };
}

/**
 * Removes a top-level group by id, counting nested <g> so the close tag it
 * stops at is the matching one.
 *
 * Storyset draws its decorative backdrop into `background-complete` and
 * `background-simple` — the same layers its own editor toggles off. Dropping
 * them is most of the file weight, and leaves the artwork sitting cleanly on a
 * card rather than on its own pale rectangle.
 */
function dropGroup(svg, id) {
  const open = svg.indexOf(`<g id="${id}"`);
  if (open === -1) return svg;

  let depth = 0;
  const tag = /<\/?g\b/g;
  tag.lastIndex = open;

  for (let match = tag.exec(svg); match; match = tag.exec(svg)) {
    depth += match[0] === '</g' ? -1 : 1;
    if (depth === 0) return svg.slice(0, open) + svg.slice(svg.indexOf('>', match.index) + 1);
  }
  return svg;
}

/**
 * Substitutes every colour in one pass.
 *
 * Replacing sequentially would cascade — a rule whose output is another rule's
 * input would be rewritten twice — so the mapping is applied by lookup instead.
 */
function recolour(svg) {
  const normalised = svg.replace(
    /#([0-9a-fA-F]{3})\b/g,
    (_, short) => `#${[...short].map((character) => character + character).join('')}`,
  );

  const seen = new Set();
  const out = normalised.replace(/#[0-9a-fA-F]{6}/g, (hex) => {
    const key = hex.toUpperCase();
    if (!RECOLOUR[key]) seen.add(key);
    return RECOLOUR[key] ?? hex;
  });

  return { svg: out, unmapped: [...seen] };
}

/** Validates one downloaded SVG, strips its backdrop and recolours it. */
function process(raw) {
  if (!raw.includes('<svg')) throw new Error('response was not an SVG');
  if (!/viewBox="0 0 \d+ \d+"/.test(raw)) throw new Error('no usable viewBox');

  let svg = dropGroup(dropGroup(raw, 'background-complete'), 'background-simple');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<(title|desc)>[\s\S]*?<\/\1>/g, '');

  const { svg: coloured, unmapped } = recolour(svg);
  return { svg: coloured.replace(/>\s+</g, '><').trim(), unmapped };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const credits = [];

  for (const entry of MANIFEST) {
    const { candidates, page } = await findCandidates(entry.slug, entry.style);

    // Every candidate draws the same subject in a different Storyset style, so
    // take the leanest that is still a full illustration rather than a
    // stripped-back variant — these ship to the browser.
    const built = [];
    for (const candidate of candidates) {
      try {
        built.push(process(await get(candidate.url)));
      } catch {
        // A candidate that will not parse is simply not a candidate.
      }
    }

    const usable = built.filter((option) => option.svg.length > 8_000);
    const best = (usable.length ? usable : built).sort((a, b) => a.svg.length - b.svg.length)[0];
    if (!best) throw new Error(`no usable SVG for "${entry.slug}"`);

    await writeFile(`${OUT_DIR}/${entry.name}.svg`, best.svg, 'utf8');
    credits.push(`| \`${entry.name}\` | [${entry.slug}](${page}) |`);

    // Warm tones are intentionally unmapped; anything else is palette drift.
    const drift = best.unmapped.filter((hex) => !/^#[7-9A-F][0-9A-F]/.test(hex));
    console.warn(
      `${entry.name.padEnd(14)} ${(best.svg.length / 1024).toFixed(0).padStart(3)}KB` +
        (drift.length ? `  unmapped: ${drift.join(' ')}` : ''),
    );
  }

  await writeFile(
    `${OUT_DIR}/CREDITS.md`,
    [
      '# Illustration credits',
      '',
      'Artwork by [Storyset](https://storyset.com), used under its free licence,',
      'recoloured into the Apex palette by `apps/web/scripts/illustrations.mjs`.',
      'Attribution is rendered in-app by `src/components/Illustration.tsx`.',
      '',
      '| File | Source |',
      '| --- | --- |',
      ...credits,
      '',
    ].join('\n'),
    'utf8',
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

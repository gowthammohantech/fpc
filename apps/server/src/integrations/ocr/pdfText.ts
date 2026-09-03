import { inflateSync } from 'node:zlib';

/**
 * Minimal PDF text-layer reader.
 *
 * Written rather than pulled in as a dependency for two reasons: the popular
 * option lazily `require`s a bundled pdf.js at runtime, which fails under the
 * ESM dev and test runners (so it silently returned nothing where it mattered
 * most); and the credential-free extractor only needs the text layer, not a
 * full renderer. Scanned images have no text layer and correctly yield
 * nothing, which routes those invoices to manual review.
 */
export function extractPdfText(buffer: Buffer): string {
  const pieces: string[] = [];

  for (const content of contentStreams(buffer)) {
    const text = textFromContentStream(content);
    if (text.trim()) pieces.push(text);
  }

  return pieces.join('\n');
}

/** Yields each stream's decoded bytes, inflating FlateDecode where used. */
function* contentStreams(buffer: Buffer): Generator<string> {
  const haystack = buffer.toString('latin1');
  const streamToken = 'stream';
  const endToken = 'endstream';

  let cursor = 0;
  while (cursor < haystack.length) {
    const start = haystack.indexOf(streamToken, cursor);
    if (start === -1) return;

    const end = haystack.indexOf(endToken, start);
    if (end === -1) return;

    // The dictionary immediately before the stream says how it is encoded.
    const dictionary = haystack.slice(Math.max(0, start - 400), start);

    // Skip the EOL that must follow the `stream` keyword.
    let bodyStart = start + streamToken.length;
    if (haystack[bodyStart] === '\r') bodyStart += 1;
    if (haystack[bodyStart] === '\n') bodyStart += 1;

    const raw = buffer.subarray(bodyStart, end);

    if (/\/FlateDecode/.test(dictionary)) {
      try {
        yield inflateSync(raw).toString('latin1');
      } catch {
        // A stream we cannot inflate is simply not text we can read.
      }
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|Image)/.test(dictionary)) {
      yield raw.toString('latin1');
    }

    cursor = end + endToken.length;
  }
}

/**
 * Pulls the string operands out of a content stream.
 *
 * Handles the two text-showing operators that matter — `Tj` for a single
 * string and `TJ` for an array of strings and kerning offsets — plus the
 * escape sequences PDF allows inside a literal string.
 */
function textFromContentStream(content: string): string {
  const lines: string[] = [];
  let current = '';

  // Matches a literal string, or a line/paragraph-advancing operator.
  const pattern = /\((?:\\.|[^\\()])*\)|\bT\*|\bTd\b|\bTD\b|\bTJ\b|\bTj\b|\bET\b/gs;

  for (const match of content.matchAll(pattern)) {
    const token = match[0]!;

    if (token.startsWith('(')) {
      current += unescapePdfString(token.slice(1, -1));
      continue;
    }

    // These operators end the current line of text.
    if (token === 'T*' || token === 'Td' || token === 'TD' || token === 'ET') {
      if (current.trim()) lines.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) lines.push(current.trim());
  return lines.join('\n');
}

function unescapePdfString(value: string): string {
  return value.replace(/\\(n|r|t|b|f|\(|\)|\\|[0-7]{1,3})/g, (_match, escape: string) => {
    switch (escape) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '(': return '(';
      case ')': return ')';
      case '\\': return '\\';
      default: return String.fromCharCode(parseInt(escape, 8));
    }
  });
}

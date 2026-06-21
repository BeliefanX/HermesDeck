import { existsSync, statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = resolvePath(repoRoot, 'src');

function withParentSearch(url, parentURL) {
  if (!parentURL) return url;
  const parent = new URL(parentURL);
  if (!parent.search) return url;
  const child = new URL(url);
  child.search = parent.search;
  return child.href;
}

function fileUrlForFirstExisting(candidates, parentURL) {
  const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return found ? withParentSearch(pathToFileURL(found).href, parentURL) : undefined;
}

function sourceCandidates(base) {
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    resolvePath(base, 'index.ts'),
    resolvePath(base, 'index.tsx'),
    resolvePath(base, 'index.js'),
  ];
}

function resolveSourceSpecifier(specifier, parentURL) {
  if (!specifier.startsWith('@/')) return undefined;
  return fileUrlForFirstExisting(sourceCandidates(resolvePath(srcRoot, specifier.slice(2))), parentURL);
}

function resolveRelativeTsSpecifier(specifier, parentURL) {
  if (!parentURL || !(specifier.startsWith('./') || specifier.startsWith('../'))) return undefined;
  if (!parentURL.startsWith('file://')) return undefined;
  return fileUrlForFirstExisting(sourceCandidates(fileURLToPath(new URL(specifier, parentURL))), parentURL);
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === 'next/server') {
    return defaultResolve('next/server.js', context, defaultResolve);
  }
  const sourceUrl = resolveSourceSpecifier(specifier, context.parentURL);
  if (sourceUrl) return { url: sourceUrl, shortCircuit: true };
  const relativeUrl = resolveRelativeTsSpecifier(specifier, context.parentURL);
  if (relativeUrl) return { url: relativeUrl, shortCircuit: true };
  return defaultResolve(specifier, context, defaultResolve);
}

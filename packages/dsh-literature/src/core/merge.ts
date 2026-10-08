/**
 * Pure merge/dedupe over normalized {@link RawHit}s: collapse hits that name
 * the same paper (CoRR bridge, then publisher DOI, then normalized title),
 * prefer the formal dblp record's metadata, and retain the arXiv id for full
 * text.
 * @module @eduwork/dsh-literature/core/merge
 */

import type { LiteratureRecord, RawHit } from './types.ts'
import { corrKeyToArxivId, normalizeTitle, stableRecordId } from './normalize.ts'
import { compact } from './compact.ts'

/** The dedupe key that identifies one paper. */
interface PaperKey {
  readonly arxivId: string | null
  readonly doi: string | null
  readonly title: string
}

/** Derive a hit's arXiv id, including from its dblp CoRR key. */
function arxivIdOf(hit: RawHit): string | undefined {
  if (hit.arxivId !== undefined) return hit.arxivId
  /* v8 ignore next -- every hit carries either an arXiv id or a dblp key, so the dblpKey-less branch is unreachable */
  return hit.dblpKey !== undefined ? corrKeyToArxivId(hit.dblpKey) ?? undefined : undefined
}

/** Derive the strongest available identity keys for one hit. */
function keyOf(hit: RawHit): PaperKey {
  return {
    arxivId: arxivIdOf(hit) ?? null,
    doi: hit.doi ?? null,
    title: normalizeTitle(hit.title),
  }
}

/** The arXiv DataCite DOI for an id (`10.48550/arXiv.<id>`), lowercased. */
function arxivDataCiteDoi(arxivId: string): string {
  return `10.48550/arxiv.${arxivId.toLowerCase()}`
}

/** The arXiv id a DataCite DOI names, or null when it is not one. */
function arxivIdFromDataCiteDoi(doi: string): string | null {
  return /^10\.48550\/arxiv\.(.+)$/u.exec(doi)?.[1] ?? null
}

/** Seed a record from the first hit that names a paper. */
function seed(hit: RawHit): LiteratureRecord {
  const arxivId = arxivIdOf(hit)
  return compact({
    id: stableRecordId({ arxivId, dblpKey: hit.dblpKey, doi: hit.doi, title: hit.title }),
    title: hit.title,
    rawTitle: hit.rawTitle,
    authors: hit.authors,
    year: hit.year,
    venue: hit.venue,
    doi: hit.doi,
    arxivId,
    dblpKey: hit.dblpKey,
    published: !hit.preprint,
    sources: [hit.source],
    url: hit.url,
    openAccessUrl: hit.openAccessUrl,
    abstract: hit.abstract,
  })
}

/** Fold one hit into an accumulator, preferring formal (published) metadata. */
function fold(acc: LiteratureRecord, hit: RawHit): LiteratureRecord {
  const formal = !hit.preprint
  return compact({
    ...acc,
    authors: hit.authors.length > 0 ? hit.authors : acc.authors,
    rawTitle: formal ? hit.rawTitle : acc.rawTitle,
    year: formal && hit.year !== undefined ? hit.year : acc.year,
    venue: formal && hit.venue !== undefined ? hit.venue : acc.venue,
    doi: formal && hit.doi !== undefined ? hit.doi : acc.doi,
    arxivId: arxivIdOf(hit) ?? acc.arxivId,
    /* v8 ignore next -- only dblp hits are formal and they always carry a dblpKey */
    dblpKey: formal && hit.dblpKey !== undefined ? hit.dblpKey : acc.dblpKey,
    published: acc.published || formal,
    sources: acc.sources.includes(hit.source) ? acc.sources : [...acc.sources, hit.source],
    url: formal && hit.url !== undefined ? hit.url : acc.url,
    openAccessUrl: hit.openAccessUrl ?? acc.openAccessUrl,
    abstract: hit.abstract ?? acc.abstract,
  })
}

/**
 * The sort key of one record: its publication year, or -1 when absent.
 */
function yearOf(record: LiteratureRecord): number {
  return record.year ?? -1
}

/**
 * Merge raw hits into deduplicated records, ordered by publication year
 * descending (year-less records last). Clustering is union-find over the
 * identity keys, so a large hit list (the exact-title resolution pulls up to
 * 1000 dblp hits) stays linear instead of pairwise. A matching arXiv id or a
 * matching DOI is decisive; a differing DOI is NOT (a dblp CoRR mirror carries
 * the arXiv DataCite DOI while its formal record carries the publisher DOI),
 * and an empty title is never a dedupe key.
 * @param hits - normalized hits from one or more sources.
 * @returns deduplicated records ordered by year
 */
export function mergeHits(hits: readonly RawHit[]): LiteratureRecord[] {
  // Union-find over hit indexes: every paper identity key maps to the first
  // hit carrying it, and a new hit unions with every key's holder.
  const parent: number[] = hits.map((_, index) => index)
  const find = (index: number): number => {
    let current = index
    for (;;) {
      const next = parent[current]
      if (next === undefined || next === current) return current
      current = next
    }
  }
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b)
  }
  const byArxivId = new Map<string, number>()
  const byDoi = new Map<string, number>()
  const byTitle = new Map<string, number>()
  hits.forEach((hit, index) => {
    const key = keyOf(hit)
    const candidates = new Set<number>()
    if (key.arxivId !== null) {
      const holder = byArxivId.get(key.arxivId)
      if (holder !== undefined) candidates.add(holder)
      const dataCiteHolder = byDoi.get(arxivDataCiteDoi(key.arxivId))
      if (dataCiteHolder !== undefined) candidates.add(dataCiteHolder)
      byArxivId.set(key.arxivId, index)
    }
    if (key.doi !== null) {
      const holder = byDoi.get(key.doi)
      if (holder !== undefined) candidates.add(holder)
      const namedArxivId = arxivIdFromDataCiteDoi(key.doi)
      if (namedArxivId !== null) {
        const arxivHolder = byArxivId.get(namedArxivId)
        if (arxivHolder !== undefined) candidates.add(arxivHolder)
      }
      byDoi.set(key.doi, index)
    }
    if (key.title !== '') {
      const holder = byTitle.get(key.title)
      if (holder !== undefined) candidates.add(holder)
      byTitle.set(key.title, index)
    }
    for (const candidate of candidates) union(index, candidate)
  })

  const groups = new Map<number, RawHit[]>()
  hits.forEach((hit, index) => {
    const root = find(index)
    const group = groups.get(root)
    if (group === undefined) groups.set(root, [hit])
    else group.push(hit)
  })

  const records = [...groups.values()].map((cluster) => {
    const first = cluster[0]
    /* v8 ignore next 2 -- clusters are seeded with at least one hit, so the empty guard is unreachable */
    if (first === undefined) return undefined
    let record = seed(first)
    for (const hit of cluster.slice(1)) record = fold(record, hit)
    return {
      ...record,
      id: stableRecordId({ arxivId: record.arxivId, dblpKey: record.dblpKey, doi: record.doi, title: record.title }),
    }
  }).filter((record): record is LiteratureRecord => record !== undefined)

  return records.sort((a, b) => yearOf(b) - yearOf(a))
}

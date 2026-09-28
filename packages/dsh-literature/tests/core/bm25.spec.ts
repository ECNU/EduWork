import { describe, expect, it } from 'vitest'
import { bm25TitleScores, normalizeTitle } from '@eduwork/dsh-literature/core'

describe('bm25TitleScores', () => {
  it('ranks the exact-title candidate highest over partial-overlap noise', () => {
    const query = normalizeTitle('Deep residual learning for image recognition')
    const titles = [
      normalizeTitle('Multi-residual unit fusion and Wasserstein distance-based deep transfer learning for mill load recognition'),
      normalizeTitle('Deep Residual Learning based on ResNet50 for COVID-19 Recognition in Lung CT Images'),
      normalizeTitle('Deep Residual Learning for Image Recognition'),
    ]
    const scores = bm25TitleScores(titles, query)
    expect(scores[2]!).toBeGreaterThan(scores[0]!)
    expect(scores[2]!).toBeGreaterThan(scores[1]!)
  })

  it('ranks a title that merely contains all query words below the exact title', () => {
    const query = normalizeTitle('Attention is all you need')
    const titles = [
      normalizeTitle('Attention Is All You Need But You Don\'t Need All Of It For Inference of Large Language Models'),
      normalizeTitle('Attention Is All You Need'),
    ]
    const scores = bm25TitleScores(titles, query)
    expect(scores[1]!).toBeGreaterThan(scores[0]!)
  })

  it('weights a term appearing in every candidate lower (idf)', () => {
    const query = normalizeTitle('residual learning')
    const titles = [
      normalizeTitle('Residual learning for vision'),
      normalizeTitle('Residual learning for audio'),
    ]
    const scores = bm25TitleScores(titles, query)
    // Both share 'residual learning'; the distinguishing terms are absent from
    // the query, so the scores stay close — and neither dominates via a
    // corpus-wide term.
    expect(scores[0]!).toBeCloseTo(scores[1]!, 6)
  })

  it('returns zeros for an empty corpus or query', () => {
    expect(bm25TitleScores([], 'a query')).toEqual([])
    expect(bm25TitleScores(['a title'], '')).toEqual([0])
  })

  it('ranks a CJK exact-title candidate over partial-overlap ones', () => {
    const query = normalizeTitle('基于深度学习的图像识别方法研究')
    const titles = [
      normalizeTitle('基于深度学习的图像识别方法研究'),
      normalizeTitle('基于深度学习的自然语言处理方法研究'),
      normalizeTitle('图像识别方法综述'),
    ]
    const scores = bm25TitleScores(titles, query)
    expect(scores[0]!).toBeGreaterThan(scores[1]!)
    expect(scores[0]!).toBeGreaterThan(scores[2]!)
  })
})

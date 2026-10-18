// Build-time public GitHub metadata. Credentials never enter the website output.
export const repository = 'ECNU/EduWork';

export function selectDownloads(release) {
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error('Expected a published stable desktop release');
  }
  const version = release.tag_name.slice(1);
  return [
    `EduWork-${version}-windows-x64-setup.zip`,
    `EduWork-${version}-macos-arm64-electron.dmg`,
  ].map(name => {
    const matches = release.assets.filter(asset => asset.name === name);
    const asset = matches[0];
    const expected = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
    if (matches.length !== 1 || asset.state !== 'uploaded' || !(asset.size > 0) || asset.browser_download_url !== expected) {
      throw new Error(`Missing or invalid stable download: ${name}`);
    }
    return { name, url: asset.browser_download_url, size: asset.size };
  });
}

export function starHistory(weeks, now = new Date()) {
  const counts = new Map();
  const today = now.toISOString().slice(0, 10);
  for (const week of weeks) {
    if (!Number.isFinite(week.week) || !Array.isArray(week.days) || week.days.length !== 7) throw new Error('Invalid Star history week');
    week.days.forEach((count, index) => {
      if (!Number.isInteger(count) || count < 0) throw new Error('Invalid daily Star count');
      const day = new Date(week.week * 1000 + index * 86400000).toISOString().slice(0, 10);
      if (day <= today) counts.set(day, count);
    });
  }
  let total = 0;
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, stars: total += count })).filter(point => point.stars > 0);
}

async function api(endpoint, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'EduWork-project-website' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`https://api.github.com/repos/${repository}${endpoint ? '/' + endpoint : ''}`, {
        headers, signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`GitHub ${endpoint}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

export async function fetchCommunity() {
  const [repo, release] = await Promise.all([api(''), api('releases/latest')]);
  const assets = selectDownloads(release);
  const weeks = [];
  for (let page = 1; ; page++) {
    const batch = await api(`stargazers/history?per_page=30&page=${page}`);
    weeks.push(...batch);
    if (batch.length < 30) break;
    if (page === 100) throw new Error('Star history exceeds the GitHub pagination limit');
  }
  return {
    repository, url: repo.html_url, fetchedAt: new Date().toISOString(), stars: repo.stargazers_count,
    history: starHistory(weeks),
    historyNote: '按 GitHub 提供的每日 Star 统计累计，可能与当前 Star 总数存在差异。',
    release: { tag: release.tag_name, url: release.html_url, publishedAt: release.published_at, assets },
  };
}

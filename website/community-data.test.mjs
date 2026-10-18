import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDownloads, starHistory } from './community-data.mjs';

const release = () => ({
  tag_name: 'v1.2.3', draft: false, prerelease: false,
  assets: ['windows-x64-setup.zip', 'macos-arm64-electron.dmg'].map(suffix => ({
    name: `EduWork-1.2.3-${suffix}`, size: 100, state: 'uploaded',
    browser_download_url: `https://github.com/ECNU/EduWork/releases/download/v1.2.3/EduWork-1.2.3-${suffix}`,
  })),
});

test('downloads select the exact stable setup and DMG, ignoring portable and development assets', () => {
  const input = release();
  input.assets.push({ name: 'EduWork-1.2.3-windows-x64-electron.zip' }, { name: 'EduWork-1.2.4-dev.20261017.1-windows-x64-setup.zip' });
  assert.deepEqual(selectDownloads(input).map(a => a.name), release().assets.map(a => a.name));
});
test('incomplete, draft, prerelease and mismatched downloads stop publication', () => {
  for (const patch of [{ draft: true }, { prerelease: true }, { tag_name: 'v1.2.4-dev.20261017.1' }, { assets: release().assets.slice(0, 1) }]) {
    assert.throws(() => selectDownloads({ ...release(), ...patch }));
  }
  for (const patch of [{ state: 'starter' }, { size: 0 }, { browser_download_url: 'https://example.org/file.zip' }]) {
    const input = release(); Object.assign(input.assets[0], patch);
    assert.throws(() => selectDownloads(input));
  }
});
test('public Star history sorts reverse-ordered weeks, keeps empty days and omits future days', () => {
  assert.deepEqual(starHistory([
    { week: Date.parse('2026-10-18T00:00:00Z') / 1000, days: [2, 1, 0, 0, 0, 0, 0] },
    { week: Date.parse('2026-10-11T00:00:00Z') / 1000, days: [0, 0, 0, 0, 0, 1, 0] },
  ], new Date('2026-10-18T12:00:00Z')), [
    { date: '2026-10-16', stars: 1 }, { date: '2026-10-17', stars: 1 }, { date: '2026-10-18', stars: 3 },
  ]);
  assert.throws(() => starHistory([{ week: 0, days: [-1, 0, 0, 0, 0, 0, 0] }]), /Invalid/);
});

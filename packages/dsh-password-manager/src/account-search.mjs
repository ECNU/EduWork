const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase()
export function searchAccounts(entries, query) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
  return entries.filter(({ origin, username }) => {
    const text = normalize(`${origin} ${username}`)
    return terms.every(term => text.includes(term))
  })
}

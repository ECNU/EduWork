/** 日历日期按本地日历日计算，避免用 UTC 日期翻页。 */
const pad = (value: number) => String(value).padStart(2, '0')

export const localDate = (value: Date = new Date()): string =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`

export function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(date: string, days: number): string {
  const value = parseDate(date)
  value.setDate(value.getDate() + days)
  return localDate(value)
}

export const startOfWeek = (date: string = localDate()): string =>
  addDays(date, -((parseDate(date).getDay() + 6) % 7))

export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`

/** 翻月时保留日号，目标月份较短时取该月最后一天。 */
export function shiftMonth(date: string, months: number): string {
  const value = parseDate(monthStart(date))
  value.setMonth(value.getMonth() + months)
  const lastDay = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate()
  value.setDate(Math.min(Number(date.slice(8)), lastDay))
  return localDate(value)
}

/** 月历查询范围含首尾两周在相邻月份的日期。 */
export function monthRange(date: string): { from: string; to: string } {
  const first = monthStart(date)
  const last = addDays(shiftMonth(first, 1), -1)
  return { from: startOfWeek(first), to: addDays(startOfWeek(last), 6) }
}

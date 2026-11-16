/** 轻量 DOM 用于验证面板与服务接线；完整网格由浏览器验收。 */
import React from 'react'
import { occurrenceNote } from '../../src/personal-settings.js'

export const AcademicYear = () => null
export const CalendarStyles = () => null

export function CalendarCanvas({ noteIndex, occurrences, occurrenceKeyOf, onSelect }) {
  return React.createElement('div', null, ...occurrences.map(entry => {
    const id = occurrenceKeyOf(entry)
    const note = occurrenceNote(noteIndex, entry)
    return React.createElement('button', {
      key: id, 'data-occurrence': id, onClick: () => onSelect(entry),
      'aria-label': note ? `${entry.title} · 笔记：${note}` : entry.title,
    }, entry.title)
  }))
}

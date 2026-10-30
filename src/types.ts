export type Status = 'Pending' | 'In Progress' | 'Completed'
export type Priority = 'Low' | 'Medium' | 'High'
export interface Task {
  id: string
  title: string
  description: string
  status: Status
  tags: string[]
  dueDate: string | null
  priority: Priority
  list: string
  createdAt: string
  updatedAt: string
}
export interface User { id: string; name: string; email: string | null; isGuest: boolean }
export type TaskInput = Pick<Task, 'title' | 'description' | 'status' | 'tags' | 'dueDate' | 'priority' | 'list'>
export const statuses: Status[] = ['Pending', 'In Progress', 'Completed']
export const priorities: Priority[] = ['Low', 'Medium', 'High']
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function dateLabel(date: string | null) {
  if (!date) return 'No deadline'
  const today = localDate()
  if (date === today) return 'Today'
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  if (date === localDate(tomorrow)) return 'Tomorrow'
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) })
}

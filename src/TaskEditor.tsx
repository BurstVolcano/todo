import { useState, type FormEvent } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Modal } from './Modal'
import { priorities, statuses, type Task, type TaskInput, type Status, type Priority } from './types'
export function TaskEditor({ task, onClose, onSave }: { task: Task | null; onClose: () => void; onSave: (input: TaskInput, id?: string) => Promise<void> }) {
  const [form, setForm] = useState<TaskInput>(task ? { title: task.title, description: task.description, status: task.status, tags: task.tags, dueDate: task.dueDate, priority: task.priority, list: task.list } : { title: '', description: '', status: 'Pending', tags: [], dueDate: null, priority: 'Medium', list: 'Personal' })
  const [tags, setTags] = useState(form.tags.join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function change<K extends keyof TaskInput>(key: K, value: TaskInput[K]) { setForm(old => ({ ...old, [key]: value })) }
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      await onSave({ ...form, title: form.title.trim(), list: form.list.trim() || 'Personal', tags: [...new Set(tags.split(',').map(tag => tag.trim()).filter(Boolean))] }, task?.id)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save task.') }
    finally { setSaving(false) }
  }
  return <Modal title={task ? 'A little fine-tuning.' : 'Make space for a new task.'} onClose={() => { if (!saving) onClose() }}>
    <p className="modal-subtitle">Small steps. Meaningful progress.</p>
    <form onSubmit={submit} className="editor-form">
      <label>Task name<input autoFocus required maxLength={200} placeholder="What would you like to get done?" value={form.title} onChange={e => change('title', e.target.value)} /></label>
      <label>Description <span className="optional">optional</span><textarea maxLength={5000} rows={3} placeholder="Add a little context…" value={form.description} onChange={e => change('description', e.target.value)} /></label>
      <div className="form-grid"><label>Status<select aria-label="Status" value={form.status} onChange={e => change('status', e.target.value as Status)}>{statuses.map(s => <option key={s}>{s}</option>)}</select></label><label>Priority<select aria-label="Priority" value={form.priority} onChange={e => change('priority', e.target.value as Priority)}>{priorities.map(s => <option key={s}>{s}</option>)}</select></label></div>
      <div className="form-grid"><label>Deadline<input type="date" value={form.dueDate || ''} onChange={e => change('dueDate', e.target.value || null)} /></label><label>List<input aria-label="List" list="task-lists" maxLength={60} value={form.list} onChange={e => change('list', e.target.value)} /><datalist id="task-lists"><option value="Personal" /><option value="Work" /></datalist></label></div>
      <label>Tags <span className="optional">separate with commas</span><input value={tags} maxLength={400} placeholder="Design, Planning, Life" onChange={e => setTags(e.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer"><button type="button" className="secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}<ArrowUpRight size={16} /></button></div>
    </form>
  </Modal>
}

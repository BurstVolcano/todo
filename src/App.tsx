import { useEffect, useMemo, useState } from 'react'
import { ArrowDownWideNarrow, ArrowRight, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronRight, Circle, CircleDashed, Clock3, Folder, LayoutGrid, List, ListTodo, LogOut, Menu, MoreHorizontal, Pencil, Plus, Search, Sparkles, Sun, Tag, Trash2, X } from 'lucide-react'
import { api, ApiError } from './api'
import { AuthDialog } from './AuthDialog'
import { TaskEditor } from './TaskEditor'
import { dateLabel, localDate, priorities, statuses, type Status, type Task, type TaskInput, type User } from './types'

type Navigation = 'all' | 'today' | 'upcoming' | 'completed'
const navItems = [{ id: 'all', label: 'My tasks', icon: ListTodo }, { id: 'today', label: 'Today', icon: Sun }, { id: 'upcoming', label: 'Upcoming', icon: CalendarDays }, { id: 'completed', label: 'Completed', icon: CheckCheck }] as const
const statusClass = (status: Status) => status.toLowerCase().replace(' ', '-')

function TaskRow({ task, board, busy, onEdit, onToggle, onDelete }: { task: Task; board: boolean; busy: boolean; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  const overdue = task.dueDate && task.dueDate < localDate() && task.status !== 'Completed'
  return <article className={`task-row ${board ? 'board-card' : ''} ${task.status === 'Completed' ? 'is-completed' : ''}`}>
    <button className={`task-check ${statusClass(task.status)}`} onClick={onToggle} disabled={busy} aria-label={`${task.status === 'Completed' ? 'Reopen' : 'Complete'} ${task.title}`} aria-pressed={task.status === 'Completed'}>{task.status === 'Completed' ? <Check size={13} strokeWidth={3} /> : task.status === 'In Progress' ? <span /> : null}</button>
    <div className="task-main"><button className="task-title" onClick={onEdit}>{task.title}</button>{task.description && <p className="task-description">{task.description}</p>}<div className="task-meta"><span className="task-list"><Folder size={11} />{task.list}</span>{task.tags.map((tag, index) => <span key={tag} className={`tag tag-${index % 3}`}>{tag}</span>)}</div></div>
    <div className="task-details"><span className={`status-pill ${statusClass(task.status)}`}><span />{task.status}</span><span className={`priority priority-${task.priority.toLowerCase()}`}><i /><i /><i /><span>{task.priority}</span></span><span className={`due-date ${overdue ? 'overdue' : ''} ${task.dueDate === localDate() ? 'due-today' : ''}`} title={task.dueDate || undefined}><CalendarDays size={13} />{dateLabel(task.dueDate)}</span></div>
    <div className="task-actions"><button className="icon-button" onClick={onEdit} aria-label={`Edit ${task.title}`}><Pencil size={14} /></button><button className="icon-button delete-button" disabled={busy} onClick={onDelete} aria-label={`Delete ${task.title}`}><Trash2 size={14} /></button></div>
  </article>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [nav, setNav] = useState<Navigation>('all')
  const [selectedList, setSelectedList] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [sort, setSort] = useState('created')
  const [view, setView] = useState<'list' | 'board'>('list')
  const [editor, setEditor] = useState<Task | 'new' | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [accountBusy, setAccountBusy] = useState(false)
  const today = localDate()

  async function refreshTasks() { const result = await api<{ tasks: Task[] }>('/tasks'); setTasks(result.tasks) }
  async function load() {
    setLoading(true); setError('')
    try {
      let session: { user: User }
      try { session = await api('/auth/me') }
      catch (e) { if (e instanceof ApiError && e.status === 401) session = await api('/auth/guest', 'POST'); else throw e }
      setUser(session.user); await refreshTasks()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load your workspace.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer) } }, [notice])

  const completed = tasks.filter(t => t.status === 'Completed').length
  const inProgress = tasks.filter(t => t.status === 'In Progress').length
  const pending = tasks.filter(t => t.status === 'Pending').length
  const lists = [...new Set(['Personal', 'Work', ...tasks.map(t => t.list)])]
  const tags = [...new Set(tasks.flatMap(t => t.tags))].sort()
  const visibleTasks = useMemo(() => {
    const result = tasks.filter(task => {
      if (nav === 'today' && task.dueDate !== today) return false
      if (nav === 'upcoming' && (!task.dueDate || task.dueDate <= today || task.status === 'Completed')) return false
      if (nav === 'completed' && task.status !== 'Completed') return false
      if (selectedList && task.list !== selectedList) return false
      if (selectedTag && !task.tags.includes(selectedTag)) return false
      if (statusFilter && task.status !== statusFilter) return false
      if (priorityFilter && task.priority !== priorityFilter) return false
      const query = search.trim().toLowerCase()
      return !query || [task.title, task.description, task.list, ...task.tags].join(' ').toLowerCase().includes(query)
    })
    return result.sort((a, b) => sort === 'deadline' ? (a.dueDate || '9999').localeCompare(b.dueDate || '9999') : sort === 'priority' ? priorities.indexOf(b.priority) - priorities.indexOf(a.priority) : sort === 'title' ? a.title.localeCompare(b.title) : b.createdAt.localeCompare(a.createdAt))
  }, [tasks, nav, today, selectedList, selectedTag, statusFilter, priorityFilter, search, sort])

  function navigate(next: Navigation, list = '', tag = '') { setNav(next); setSelectedList(list); setSelectedTag(tag); setStatusFilter(''); setSidebarOpen(false) }
  async function saveTask(input: TaskInput, id?: string) {
    const { task } = await api<{ task: Task }>(id ? `/tasks/${id}` : '/tasks', id ? 'PATCH' : 'POST', input)
    setTasks(old => id ? old.map(t => t.id === id ? task : t) : [task, ...old]); setNotice(id ? 'Task updated. Keep moving forward.' : 'A new task, a fresh start.')
  }
  async function mutateTask(task: Task, remove = false) {
    if (remove && !window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return
    setBusyIds(old => new Set(old).add(task.id)); setError('')
    try {
      if (remove) { await api(`/tasks/${task.id}`, 'DELETE'); setTasks(old => old.filter(t => t.id !== task.id)); setNotice('Task deleted.') }
      else { const result = await api<{ task: Task }>(`/tasks/${task.id}`, 'PATCH', { status: task.status === 'Completed' ? 'Pending' : 'Completed' }); setTasks(old => old.map(t => t.id === task.id ? result.task : t)); setNotice(result.task.status === 'Completed' ? 'One less thing. Nicely done!' : 'Task reopened.') }
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update task.') }
    finally { setBusyIds(old => { const next = new Set(old); next.delete(task.id); return next }) }
  }
  async function signedIn(next: User) { setUser(next); await refreshTasks(); setNotice(`Welcome, ${next.name.split(' ')[0]}.`); navigate('all') }
  async function logout() {
    setAccountBusy(true)
    try { await api('/auth/logout', 'POST'); setTasks([]); await load(); navigate('all'); setNotice('You’re signed out.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign out.') }
    finally { setAccountBusy(false) }
  }
  const sectionTitle = selectedList || (selectedTag ? `# ${selectedTag}` : navItems.find(n => n.id === nav)?.label || 'My tasks')
  function renderTask(task: Task) { return <TaskRow key={task.id} task={task} board={view === 'board'} busy={busyIds.has(task.id)} onEdit={() => setEditor(task)} onToggle={() => void mutateTask(task)} onDelete={() => void mutateTask(task, true)} /> }

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to tasks</a>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('all') }}><span className="brand-mark"><Sun size={23} strokeWidth={1.6} /></span>daylight<span className="brand-dot">.</span></a>
      <div className="workspace-label"><span className="workspace-icon">{user && !user.isGuest ? user.name.charAt(0).toUpperCase() : 'D'}</span><div><strong>{user && !user.isGuest ? `${user.name.split(' ')[0]}’s workspace` : 'My workspace'}</strong><span>Room to make things happen</span></div></div>
      <div className="nav-section-label">WORKSPACE</div>
      <nav aria-label="Workspace">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${nav === id && !selectedList && !selectedTag ? 'active' : ''}`} onClick={() => navigate(id)}><Icon size={18} /><span>{label}</span><span className="nav-count">{id === 'all' ? tasks.length : id === 'completed' ? completed : id === 'today' ? tasks.filter(t => t.dueDate === today).length : tasks.filter(t => t.dueDate && t.dueDate > today && t.status !== 'Completed').length}</span></button>)}</nav>
      <div className="nav-section-label list-label">MY LISTS<span>{lists.length}</span></div>
      <nav aria-label="Task lists">{lists.map((list, i) => <button key={list} className={`nav-item ${selectedList === list ? 'active' : ''}`} onClick={() => navigate('all', list)}><span className={`list-dot list-dot-${i % 3}`} /><span>{list}</span><span className="nav-count">{tasks.filter(t => t.list === list).length}</span></button>)}</nav>
      {tags.length > 0 && <><div className="nav-section-label">TAGS</div><div className="sidebar-tags">{tags.map(tag => <button key={tag} className={selectedTag === tag ? 'selected' : ''} onClick={() => navigate('all', '', selectedTag === tag ? '' : tag)}><span>#</span>{tag}</button>)}</div></>}
      <div className="sidebar-bottom"><div className="gentle-reminder"><Sparkles size={18} /><h3>A little progress, every day.</h3><p>You don’t have to do it all.<br />Just the next right thing.</p><div className="reminder-art"><span /><span /><span /><span /><span /></div></div><div className="sidebar-footer"><span className="tiny-sun"><Sun size={14} /></span>Less noise. More clarity.</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{sectionTitle}</strong></div><div className="topbar-right"><span className="topbar-date"><CalendarDays size={14} />{new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span className="topbar-divider" />{user?.isGuest ? <button className="account-link" onClick={() => setAuthOpen(true)}>Save your workspace <ArrowRight size={14} /></button> : user ? <button className="icon-button" aria-label="Sign out" title="Sign out" disabled={accountBusy} onClick={() => void logout()}><LogOut size={17} /></button> : null}<button className="avatar" aria-label={user?.isGuest ? 'Create an account or sign in' : `Signed in as ${user?.name || 'loading'}`} onClick={() => { if (user?.isGuest) setAuthOpen(true) }}>{user && !user.isGuest ? user.name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() : 'Y'}</button></div></header>
      <main id="main">
        <section className="welcome"><div><div className="eyebrow"><Sun size={15} />A LITTLE FOCUS GOES A LONG WAY</div><h1>Make room for<br className="mobile-break" /> what matters<span>.</span></h1><p>Your thoughts, plans, and next steps. All in a calmer place.</p></div><button className="primary new-task" disabled={loading || !user} onClick={() => setEditor('new')}><Plus size={17} />New task</button></section>
        <section className="stats-grid" aria-label="Task overview">
          <button className="stat-card" onClick={() => { navigate('all'); setStatusFilter('') }}><div className="stat-label"><span>Total tasks</span><ListTodo size={17} /></div><div className="stat-bottom"><strong>{tasks.length.toString().padStart(2, '0')}</strong><span>Everything on your plate</span></div></button>
          <button className="stat-card" onClick={() => { navigate('all'); setStatusFilter('Pending') }}><div className="stat-label"><span>Pending</span><CircleDashed size={17} /></div><div className="stat-bottom"><strong>{pending.toString().padStart(2, '0')}</strong><span>Ready when you are</span></div></button>
          <button className="stat-card progress-stat" onClick={() => { navigate('all'); setStatusFilter('In Progress') }}><div className="stat-label"><span>In progress</span><Clock3 size={17} /></div><div className="stat-bottom"><strong>{inProgress.toString().padStart(2, '0')}</strong><span>A little closer each day</span></div></button>
          <button className="stat-card completed-stat" onClick={() => navigate('completed')}><div className="stat-label"><span>Completed</span><CheckCircle2 size={17} /></div><div className="stat-bottom"><strong>{completed.toString().padStart(2, '0')}</strong><span>Look at you go!</span></div></button>
        </section>
        <section className="tasks-section" aria-labelledby="tasks-heading">
          <div className="section-heading"><div><h2 id="tasks-heading">{sectionTitle}<span className="section-count">{visibleTasks.length}</span></h2><p>{nav === 'completed' ? 'A moment to appreciate how far you’ve come.' : 'A clear head starts with a little organization.'}</p></div><div className="view-toggle" role="group" aria-label="Task view"><button aria-label="List view" aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={16} /><span>List</span></button><button aria-label="Board view" aria-pressed={view === 'board'} className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}><LayoutGrid size={15} /><span>Board</span></button></div></div>
          <div className="task-toolbar"><label className="search-field"><Search size={17} /><input aria-label="Search tasks" placeholder="Search your tasks…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label><div className="filter-controls"><label className="select-control"><Circle size={12} /><select aria-label="Filter by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All statuses</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></label><label className="select-control"><Tag size={13} /><select aria-label="Filter by priority" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}><option value="">All priorities</option>{priorities.map(p => <option key={p}>{p}</option>)}</select></label><label className="select-control sort-control"><ArrowDownWideNarrow size={15} /><select aria-label="Sort tasks" value={sort} onChange={e => setSort(e.target.value)}><option value="created">Newest first</option><option value="deadline">Due date</option><option value="priority">Priority</option><option value="title">A to Z</option></select></label></div></div>
          {error && <div role="alert" className="error-banner"><span>{error}</span><button onClick={() => void load()}>Retry</button><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
          {loading ? <div className="loading-state" role="status"><span className="loading-dot" />Making a little room for you…</div> : visibleTasks.length === 0 ? <div className="empty-state"><span className="empty-icon"><Sun size={28} strokeWidth={1.3} /></span><h3>{tasks.length ? 'A little breathing room.' : 'A fresh page, just for you.'}</h3><p>{tasks.length ? 'No tasks match this view. Try another filter or add something new.' : 'Start with one small thing you’d like to get done.'}</p><button className="secondary" disabled={!user} onClick={() => setEditor('new')}><Plus size={15} />Add a task</button>{(search || statusFilter || priorityFilter || selectedTag) && <button className="text-button" onClick={() => { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setSelectedTag('') }}>Clear filters</button>}</div> : view === 'list' ? <div className="task-table"><div className="table-heading"><span>Task name</span><div><span>Status</span><span>Priority</span><span>Due date</span></div><MoreHorizontal size={16} /></div>{visibleTasks.map(renderTask)}<button className="inline-add" onClick={() => setEditor('new')}><Plus size={16} />Add a new task<span>One small step at a time</span></button></div> : <div className="board-grid">{statuses.map(status => <section className="board-column" key={status}><div className="board-heading"><span className={`status-pill ${statusClass(status)}`}><span />{status}</span><span>{visibleTasks.filter(t => t.status === status).length}</span></div>{visibleTasks.filter(t => t.status === status).map(renderTask)}{!visibleTasks.some(t => t.status === status) && <p className="board-empty">Nothing here just yet.</p>}</section>)}</div>}
          <div className="tasks-footer"><span><span className="live-dot" />{user?.isGuest ? 'Your personal guest workspace' : 'Your tasks, safely saved'}</span><span>{completed} of {tasks.length} tasks completed<div className="progress-track"><div style={{ width: `${tasks.length ? completed / tasks.length * 100 : 0}%` }} /></div></span></div>
        </section>
        <footer className="page-footer"><span>Find your focus. Enjoy your day.</span><span>Made for a little more peace of mind <Sun size={13} /></span></footer>
      </main>
    </div>
    {editor && <TaskEditor task={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSave={saveTask} />}
    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSuccess={signedIn} />}
    {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}</div>}
  </div>
}

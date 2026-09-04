'use client'
import { useEffect, useState, useCallback } from 'react'
import { usePlannerStore } from '@/store/plannerStore'
import { useAuthUser, authDisplayName } from '@/lib/auth'
import Header from '@/components/Header'
import Toolbar from '@/components/Toolbar'
import MyWork from '@/components/views/MyWork'
import Teams from '@/components/views/Teams'
import Gantt from '@/components/gantt/Gantt'
import Board from '@/components/board/Board'
import Calendar from '@/components/calendar/Calendar'
import Table from '@/components/table/Table'
import SearchPalette from '@/components/SearchPalette'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { version } from '@/package.json'
import TaskEditor from '@/components/modals/TaskEditor'
import LaneEditor from '@/components/modals/LaneEditor'
import WorkspaceEditor from '@/components/modals/WorkspaceEditor'
import WorkstreamsEditor from '@/components/modals/WorkstreamsEditor'
import NewWorkspaceModal from '@/components/modals/NewWorkspaceModal'
import type { Task, Lane, Workspace } from '@/lib/types'
import AppAccessGate from '@/components/AppAccessGate'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Stack } from '@astryxdesign/core/Stack'

type ModalState =
  | { type: 'task'; wsId: string; task: Task; isNew?: boolean }
  | { type: 'lane'; wsId: string; lane: Lane }
  | { type: 'workspace'; ws: Workspace }
  | { type: 'workstreams'; ws: Workspace }
  | { type: 'newWs' }
  | null

function PlannerInner() {
  const { data, ui, init, loading, initError, addTask, setUi, saveUi } = usePlannerStore()
  const authUser = useAuthUser()
  const [modal, setModal] = useState<ModalState>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [dropzone, setDropzone] = useState(false)

  useEffect(() => { init() }, [])

  // Auto-select first workspace when none is selected
  useEffect(() => {
    if (!loading && !ui.ws && data.workspaces.length > 0) {
      setUi({ ws: data.workspaces[0].id })
      saveUi()
    }
  }, [loading, ui.ws, data.workspaces.length])

  // Deep link (e.g. the "Open in Planner" button on Teams notification cards):
  // /?ws=<id>&task=<id> selects the workspace, scrolls to/highlights the
  // task and opens its editor. Params are stripped immediately so a refresh
  // doesn't re-trigger the jump.
  useEffect(() => {
    if (loading) return
    const params = new URLSearchParams(window.location.search)
    const wsId = params.get('ws')
    const taskId = params.get('task')
    if (!wsId) return
    window.history.replaceState(null, '', window.location.pathname)
    const store = usePlannerStore.getState()
    const ws = store.data.workspaces.find(w => w.id === wsId)
    if (!ws) return
    const task = taskId ? ws.tasks.find(t => t.id === taskId) : undefined
    if (task) {
      store.jumpToTask(ws.id, task.id)
      setModal({ type: 'task', wsId: ws.id, task })
    } else {
      store.openWs(ws.id)
    }
  }, [loading])

  // Auto-set identity from Microsoft account
  useEffect(() => {
    if (!authUser) return
    const name = authDisplayName(authUser)
    if (name && name !== ui.me) {
      setUi({ me: name })
      saveUi()
    }
  }, [authUser?.id])

  // Keyboard shortcuts (g-then-m is GitHub-style two-key navigation)
  useEffect(() => {
    let gAt = 0
    const inField = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    const handler = (e: KeyboardEvent) => {
      // Search palette entry point (button + shortcut) is hidden for now — see
      // Header.tsx's "gsearch" button. Re-enable both together.
      if (false && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setShowPalette(true) }
      else if (e.key === 'Escape') { setShowPalette(false); setModal(null) }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField(e.target)) {
        if (e.key === 'g') { gAt = Date.now(); return }
        if (e.key === 'm' && Date.now() - gAt < 800) {
          const s = usePlannerStore.getState()
          s.setUi({ primaryTab: 'mywork' })
          s.saveUi()
        }
        gAt = 0
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Drag-to-import JSON
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth++; setDropzone(true) } }
    const leave = () => { if (--depth <= 0) { depth = 0; setDropzone(false) } }
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault(); depth = 0; setDropzone(false)
      const f = e.dataTransfer.files[0]
      if (f?.name.endsWith('.json')) {
        const rd = new FileReader()
        rd.onload = () => {
          try { usePlannerStore.getState().importData(JSON.parse(rd.result as string), f.name) }
          catch (err) { alert('Could not parse JSON: ' + (err as Error).message) }
        }
        rd.readAsText(f)
      }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const curWs = data.workspaces.find(w => w.id === ui.ws) ?? data.workspaces[0]

  const openTaskModal = useCallback((wsId: string, task: Task, isNew?: boolean) => {
    setModal({ type: 'task', wsId, task, isNew })
  }, [])

  const handleAddTask = useCallback((wsId: string, laneId: string, start?: string) => {
    const t = addTask(wsId, laneId, start)
    setModal({ type: 'task', wsId, task: t, isNew: true })
  }, [addTask])

  // Gantt-originated adds create the task inline (name typed directly into the
  // row) instead of opening the modal — the lane/assignee/date defaults already
  // come from addTask, so there's nothing the modal needs to collect up front.
  const handleAddTaskInline = useCallback((wsId: string, laneId: string, start?: string) => {
    return addTask(wsId, laneId, start)
  }, [addTask])

  // Board-originated adds open the full editor (a workstream is required and
  // Board has no natural default to pick from, unlike Gantt's lane context)
  // pre-set to whichever status column's "Add task" was clicked.
  const handleAddBoardTask = useCallback((wsId: string, laneId: string, start: string | undefined, statusId: string) => {
    const t = addTask(wsId, laneId, start, undefined, statusId)
    setModal({ type: 'task', wsId, task: t, isNew: true })
  }, [addTask])

  const handleAddStandaloneTask = useCallback(() => {
    const ws = usePlannerStore.getState().data.workspaces.find(w => w.id === usePlannerStore.getState().ui.ws)
      ?? usePlannerStore.getState().data.workspaces[0]
    if (!ws) return
    const t = addTask(ws.id, '', undefined)
    setModal({ type: 'task', wsId: ws.id, task: t, isNew: true })
  }, [addTask])

  const openLaneModal = useCallback((wsId: string, lane: Lane) => {
    setModal({ type: 'lane', wsId, lane })
  }, [])

  const tab = ui.primaryTab ?? 'timeline'

  if (initError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--muted)', fontSize: 14 }}>
        <span>{initError}</span>
        <Button variant="outline" onClick={() => init()}>Retry</Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div data-astryx-theme="neutral" style={{ minHeight: '100vh', background: 'var(--cauliflower)' }}>
        <Stack direction="horizontal" gap={4} align="center" style={{ height: 56, padding: '0 20px', background: 'white', borderBottom: '1px solid var(--color-border)' }}>
          <Skeleton width={110} height={20} radius="rounded" index={0} />
          <Skeleton width={64} height={16} index={1} />
          <Skeleton width={64} height={16} index={2} />
          <Skeleton width={64} height={16} index={3} />
          <Skeleton width={64} height={16} index={4} />
          <div style={{ marginLeft: 'auto' }}>
            <Skeleton width={32} height={32} radius="rounded" index={5} />
          </div>
        </Stack>
        <Stack gap={3} style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px' }}>
          <Skeleton width={180} height={24} index={0} />
          {[0, 1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} width={i % 2 ? '92%' : '100%'} height={44} index={i + 1} />
          ))}
        </Stack>
      </div>
    )
  }

  return (
    <>
      <Header onSearch={() => setShowPalette(true)} />

      <main>
        <Toolbar ws={curWs ?? null} onAddTask={handleAddStandaloneTask} />

        {tab === 'timeline' && curWs ? (
          <Gantt ws={curWs} onOpenTask={openTaskModal} onAddTask={handleAddTaskInline} onOpenLane={openLaneModal} />
        ) : tab === 'timeline' ? (
          <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14 }}>
            No workspace yet — create one from the Workspaces page.
          </div>
        ) : null}

        {tab === 'board' && curWs ? (
          <Board ws={curWs} onOpenTask={openTaskModal} onAddTask={handleAddBoardTask} />
        ) : tab === 'board' && !curWs ? (
          <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14 }}>
            No workspace yet — create one from the Workspaces page.
          </div>
        ) : null}

        {tab === 'calendar' && curWs && <Calendar ws={curWs} onOpenTask={openTaskModal} onAddTask={handleAddTask} />}
        {tab === 'table' && curWs && <Table ws={curWs} onOpenTask={openTaskModal} />}

        {tab === 'mywork' && <MyWork onOpenTask={openTaskModal} />}
        {tab === 'teams' && <Teams onManage={(ws) => setModal({ type: 'workspace', ws })} onNew={() => setModal({ type: 'newWs' })} />}
      </main>

      <div className="footerbar">
        <span className="tagline">For a full life.</span>
        <span className="hintline">
          <kbd>g m</kbd> my work · drag bars to reschedule · drag ⠿ to reorder · double-click Gantt row to add task · drag header to pan
        </span>
        <span className="spacer" />
        <span>v{version} · {process.env.NEXT_PUBLIC_SUPABASE_URL ? 'cloud' : 'local'}</span>
      </div>

      {dropzone && (
        <div id="dropzone" className="show">Drop backup JSON to import</div>
      )}

      {/* Modals */}
      {modal?.type === 'task' && (() => {
        const ws = data.workspaces.find(w => w.id === modal.wsId)
        const task = ws?.tasks.find(t => t.id === modal.task.id) ?? modal.task
        if (!ws) return null
        return <TaskEditor ws={ws} task={task} isNew={modal.isNew} onClose={() => setModal(null)} />
      })()}
      {modal?.type === 'lane' && (() => {
        const ws = data.workspaces.find(w => w.id === modal.wsId)
        if (!ws) return null
        const lane = ws.lanes.find(l => l.id === modal.lane.id) ?? modal.lane
        return <LaneEditor wsId={modal.wsId} lane={lane} onClose={() => setModal(null)} />
      })()}
      {modal?.type === 'workspace' && (
        <WorkspaceEditor ws={data.workspaces.find(w => w.id === modal.ws.id) ?? modal.ws} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'workstreams' && (
        <WorkstreamsEditor ws={data.workspaces.find(w => w.id === modal.ws.id) ?? modal.ws} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'newWs' && <NewWorkspaceModal onClose={() => setModal(null)} />}

      {showPalette && <SearchPalette onClose={() => setShowPalette(false)} />}
      <Toaster />
    </>
  )
}

export default function Home() {
  return (
    <AppAccessGate appKey="planner">
      <PlannerInner />
    </AppAccessGate>
  )
}

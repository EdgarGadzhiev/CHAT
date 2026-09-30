import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { REPORT_CATEGORIES, fmtDate, rpc, signedUrls, type Me } from './api'
import { OPERATOR_READY } from './operator'
import { Empty, Sheet, useAction } from './ui'

const catLabel = (k: string) => REPORT_CATEGORIES.find(([c]) => c === k)?.[1] ?? k
const removeFile = async (path?: string | null) => { if (path) await supabase.storage.from('chat-media').remove([path]) }

export function AdminScreen({ me }: { me: Me }) {
  const isAdmin = me.role === 'admin'
  const [tab, setTab] = useState<'reports' | 'users' | 'messages' | 'settings' | 'log'>('reports')
  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [user, setUser] = useState<string | null>(null)
  useEffect(() => { rpc<Record<string, number>>('admin_stats').then(setStats).catch(() => {}) }, [tab])

  return (
    <section className="page">
      {!OPERATOR_READY && isAdmin && <div className="note warn">Заполните данные оператора в src/operator.ts — они подставляются в юридические документы.</div>}
      {stats && (
        <div className="stats">
          <div><b>{stats.users}</b><span>участников</span></div>
          <div><b>{stats.messages_24h}</b><span>сообщ./сутки</span></div>
          <div><b>{stats.reports_new}</b><span>жалоб</span></div>
          <div><b>{stats.nc_in_circulation}</b><span>NC в обороте</span></div>
        </div>
      )}
      <div className="tabs">
        {([['reports', 'Жалобы'], ['users', 'Люди'], ['messages', 'Чат'], ...(isAdmin ? [['settings', 'Настройки'], ['log', 'Журнал']] : [])] as [typeof tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'reports' && <Reports me={me} onUser={setUser} />}
      {tab === 'users' && <Users onUser={setUser} />}
      {tab === 'messages' && <Messages />}
      {tab === 'settings' && isAdmin && <Settings />}
      {tab === 'log' && isAdmin && <Log />}
      {user && <UserSheet id={user} me={me} onClose={() => setUser(null)} />}
    </section>
  )
}

// ───────── Жалобы ─────────
type Report = {
  id: number; category: string; comment: string | null; status: string; decision: string | null; resolution_note: string | null; created_at: string
  reporter: string; target_id: string; target: string; message_id: number | null; message_status: string | null; snapshot: string | null; has_media: boolean
}

function Reports({ me, onUser }: { me: Me; onUser: (id: string) => void }) {
  const [filter, setFilter] = useState<'new' | 'all'>('new')
  const [list, setList] = useState<Report[] | null>(null)
  const [act, setAct] = useState<{ r: Report; decision: string } | null>(null)
  const load = useCallback(() => rpc<Report[]>('admin_list_reports', { p_status: filter, p_limit: 100 }).then(setList).catch(() => setList([])), [filter])
  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="tabs small">
        <button className={filter === 'new' ? 'on' : ''} onClick={() => setFilter('new')}>Новые</button>
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Все</button>
      </div>
      {!list ? <Empty text="Загрузка…" /> : list.length === 0 ? <Empty text="Жалоб нет" /> : list.map((r) => (
        <div key={r.id} className="card-row">
          <div className="between"><b>{catLabel(r.category)}</b><span className={'chip st-' + r.status}>{r.status === 'new' ? 'новая' : r.decision ?? r.status}</span></div>
          <div className="muted small">#{r.id} · {fmtDate(r.created_at)} · от {r.reporter} на <button className="link" onClick={() => onUser(r.target_id)}>{r.target}</button></div>
          {r.snapshot && <blockquote className="quote">{r.snapshot}</blockquote>}
          {r.has_media && <span className="chip">есть фото</span>}
          {r.message_status && r.message_status !== 'visible' && <span className="chip">сообщение: {r.message_status}</span>}
          {r.comment && <p className="small">Комментарий: {r.comment}</p>}
          {r.resolution_note && <p className="small muted">Решение: {r.resolution_note}</p>}
          {r.status === 'new' && (
            <div className="actions wrap">
              <button className="btn small" onClick={() => setAct({ r, decision: 'reject' })}>Отклонить</button>
              <button className="btn small" onClick={() => setAct({ r, decision: 'warn' })}>Предупредить</button>
              {r.message_id && <button className="btn small danger" onClick={() => setAct({ r, decision: 'delete_message' })}>Удалить сообщение</button>}
              <button className="btn small" onClick={() => setAct({ r, decision: 'mute' })}>Мут</button>
              <button className="btn small danger" onClick={() => setAct({ r, decision: 'ban' })}>Бан</button>
            </div>
          )}
        </div>
      ))}
      {act && <ResolveSheet me={me} {...act} onClose={() => setAct(null)} onDone={() => { setAct(null); load() }} />}
    </>
  )
}

const DECISION: Record<string, string> = { reject: 'Отклонить жалобу', warn: 'Предупредить', delete_message: 'Удалить сообщение', mute: 'Запретить писать', ban: 'Заблокировать' }

function ResolveSheet({ me, r, decision, onClose, onDone }: { me: Me; r: Report; decision: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [hours, setHours] = useState(decision === 'mute' ? '24' : me.role === 'moderator' ? '72' : '')
  const { run, busy } = useAction()
  const needNote = decision !== 'reject'
  const submit = async () => {
    const path = await run(() => rpc<string | null>('admin_resolve_report', { p_id: r.id, p_decision: decision, p_note: note || null, p_hours: hours ? Number(hours) : null }), 'Готово')
    if (path !== undefined) { await removeFile(path); onDone() }
  }
  return (
    <Sheet title={DECISION[decision]} kicker={`Жалоба #${r.id} · ${r.target}`} onClose={onClose}>
      {(decision === 'mute' || decision === 'ban') && (
        <label className="field">Часов {decision === 'ban' && me.role === 'admin' ? '(пусто = навсегда)' : ''}
          <input className="input" type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
      )}
      <label className="field">{needNote ? 'Причина (увидит пользователь / попадёт в журнал)' : 'Комментарий (необязательно)'}
        <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button className="btn primary block" disabled={busy || (needNote && !note.trim())} onClick={submit}>Подтвердить</button>
    </Sheet>
  )
}

// ───────── Пользователи ─────────
type UserRow = { id: string; display_name: string; username: string | null; telegram_id: number | null; role: string; status: string; banned_until: string | null; muted_until: string | null; balance: number; violations: number; created_at: string }

function Users({ onUser }: { onUser: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<UserRow[] | null>(null)
  useEffect(() => {
    const t = setTimeout(() => rpc<UserRow[]>('admin_search_users', { p_q: q, p_limit: 50 }).then(setList).catch(() => setList([])), 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <>
      <input className="input" placeholder="Имя, @username, Telegram ID или UUID" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list ? <Empty text="Загрузка…" /> : list.map((u) => (
        <button key={u.id} className="card-row btn-like" onClick={() => onUser(u.id)}>
          <div className="between"><b>{u.display_name}</b><span className={'chip st-' + u.status}>{u.status}{u.role !== 'user' ? ' · ' + u.role : ''}</span></div>
          <span className="muted small">{u.username ? '@' + u.username + ' · ' : ''}{u.telegram_id ?? '—'} · {u.balance} NC · нарушений: {u.violations}</span>
        </button>
      ))}
    </>
  )
}

type UserFull = UserRow & { first_name: string | null; last_name: string | null; bio: string; ban_reason: string | null; mute_reason: string | null; report_blocked: boolean; reports_against: number; messages: number; violations: { action: string; reason: string | null; at: string }[]; ledger: { id: number; amount: number; kind: string; note: string | null; at: string }[] }

function UserSheet({ id, me, onClose }: { id: string; me: Me; onClose: () => void }) {
  const [u, setU] = useState<UserFull | null>(null)
  const [action, setAction] = useState('warn')
  const [hours, setHours] = useState('24')
  const [reason, setReason] = useState('')
  const [delta, setDelta] = useState('')
  const [why, setWhy] = useState('')
  const { run, busy } = useAction()
  const load = useCallback(() => rpc<UserFull>('admin_get_user', { p_id: id }).then(setU), [id])
  useEffect(() => { load() }, [load])

  const doAction = async () => {
    const ok = await run(async () => { await rpc('admin_user_action', { p_user: id, p_action: action, p_hours: ['ban', 'mute'].includes(action) && hours ? Number(hours) : null, p_reason: reason || null }); return true }, 'Выполнено')
    if (ok) { setReason(''); load() }
  }
  const adjust = async () => {
    const ok = await run(async () => { await rpc('admin_adjust_balance', { p_user: id, p_delta: Number(delta), p_reason: why }); return true }, 'Баланс изменён')
    if (ok) { setDelta(''); setWhy(''); load() }
  }

  return (
    <Sheet title={u?.display_name ?? '…'} kicker="Пользователь" onClose={onClose}>
      {!u ? <Empty text="Загрузка…" /> : (
        <>
          <div className="kv">
            <span>Telegram</span><b>{u.username ? '@' + u.username + ' · ' : ''}{u.telegram_id ?? '—'}</b>
            <span>Имя в Telegram</span><b>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</b>
            <span>Статус</span><b>{u.status}{u.banned_until ? ' до ' + fmtDate(u.banned_until) : ''}{u.ban_reason ? ' — ' + u.ban_reason : ''}</b>
            <span>Мут</span><b>{u.muted_until && new Date(u.muted_until) > new Date() ? 'до ' + fmtDate(u.muted_until) : 'нет'}</b>
            <span>Баланс</span><b>{u.balance} NC</b>
            <span>Сообщений / жалоб на него</span><b>{u.messages} / {u.reports_against}</b>
            <span>Отклонённых его жалоб</span><b>{(u as any).reports_rejected}{u.report_blocked ? ' (жалобы запрещены)' : ''}</b>
          </div>

          {u.role !== 'admin' && id !== me.id && (
            <>
              <h4>Действие</h4>
              <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="warn">Предупредить</option><option value="mute">Запретить писать</option><option value="unmute">Снять мут</option>
                <option value="ban">Заблокировать</option><option value="unban">Разблокировать</option>
                <option value="report_block">Запретить жалобы</option><option value="report_unblock">Разрешить жалобы</option>
              </select>
              {['ban', 'mute'].includes(action) && <input className="input" type="number" min={1} placeholder={action === 'ban' && me.role === 'admin' ? 'Часов (пусто = навсегда)' : 'Часов'} value={hours} onChange={(e) => setHours(e.target.value)} />}
              <input className="input" placeholder="Причина" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn primary block" disabled={busy} onClick={doAction}>Применить</button>
            </>
          )}

          {me.role === 'admin' && (
            <>
              <h4>Корректировка баланса</h4>
              <input className="input" type="number" placeholder="+100 или −50" value={delta} onChange={(e) => setDelta(e.target.value)} />
              <input className="input" placeholder="Причина (обязательно, попадёт в журнал)" value={why} onChange={(e) => setWhy(e.target.value)} />
              <button className="btn block" disabled={busy || !delta || why.trim().length < 5} onClick={adjust}>Изменить баланс</button>
            </>
          )}

          <h4>История нарушений и действий</h4>
          {u.violations.length === 0 ? <p className="muted small">Пусто</p> : u.violations.map((v, i) => (
            <div key={i} className="row"><span><b>{v.action}</b><small className="muted">{v.reason ?? ''}</small></span><small className="muted">{fmtDate(v.at)}</small></div>
          ))}
          <h4>Операции Nurcoin</h4>
          {u.ledger.length === 0 ? <p className="muted small">Пусто</p> : u.ledger.map((l) => (
            <div key={l.id} className="row"><span><b>{l.kind}</b><small className="muted">{l.note ?? ''} · {fmtDate(l.at)}</small></span><b className={l.amount > 0 ? 'plus' : 'minus'}>{l.amount > 0 ? '+' : ''}{l.amount}</b></div>
          ))}
        </>
      )}
    </Sheet>
  )
}

// ───────── Сообщения ─────────
type AdminMsg = { id: number; user_id: string; author: string; status: string; status_reason: string | null; created_at: string; pinned: boolean; media_path: string | null; media_removed: boolean; body: string }

function Messages() {
  const [list, setList] = useState<AdminMsg[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [act, setAct] = useState<{ m: AdminMsg; kind: 'msg' | 'media' } | null>(null)
  const { run } = useAction()
  const load = useCallback(async () => {
    const m = await rpc<AdminMsg[]>('admin_list_messages', { p_limit: 60 })
    setList(m)
    const paths = m.filter((x) => x.media_path && !x.media_removed).map((x) => x.media_path!)
    if (paths.length) signedUrls(paths).then(setUrls)
  }, [])
  useEffect(() => { load().catch(() => setList([])) }, [load])

  const pin = async (m: AdminMsg) => { await run(async () => { await rpc('admin_pin_message', { p_id: m.id, p_pin: !m.pinned }); return true }); load() }

  return (
    <>
      {!list ? <Empty text="Загрузка…" /> : list.map((m) => (
        <div key={m.id} className="card-row">
          <div className="between"><b>{m.author}</b><span className="muted small">#{m.id} · {fmtDate(m.created_at)} · {m.status}{m.status_reason ? ' (' + m.status_reason + ')' : ''}</span></div>
          <p>{m.body || <span className="muted">—</span>}</p>
          {m.media_path && !m.media_removed && urls[m.media_path] && <img className="photo" src={urls[m.media_path]} alt="" />}
          {m.media_removed && <span className="chip">фото удалено</span>}
          <div className="actions wrap">
            {m.status === 'visible' && <button className="btn small" onClick={() => pin(m)}>{m.pinned ? 'Открепить' : 'Закрепить'}</button>}
            {m.media_path && !m.media_removed && <button className="btn small danger" onClick={() => setAct({ m, kind: 'media' })}>Удалить фото</button>}
            {m.status !== 'deleted' && <button className="btn small danger" onClick={() => setAct({ m, kind: 'msg' })}>Удалить</button>}
          </div>
        </div>
      ))}
      {act && <DeleteSheet {...act} onClose={() => setAct(null)} onDone={() => { setAct(null); load() }} />}
    </>
  )
}

function DeleteSheet({ m, kind, onClose, onDone }: { m: AdminMsg; kind: 'msg' | 'media'; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const { run, busy } = useAction()
  const go = async () => {
    const fn = kind === 'msg' ? 'admin_delete_message' : 'admin_delete_media'
    const path = await run(() => rpc<string | null>(fn, { p_id: m.id, p_reason: reason }), 'Удалено')
    if (path !== undefined) { await removeFile(path); onDone() }
  }
  return (
    <Sheet title={kind === 'msg' ? 'Удалить сообщение' : 'Удалить фото'} kicker={`#${m.id} · ${m.author}`} onClose={onClose}>
      <input className="input" placeholder="Причина (в журнал)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn danger block" disabled={busy || !reason.trim()} onClick={go}>Удалить</button>
    </Sheet>
  )
}

// ───────── Настройки (только admin) ─────────
type Col = { key: string; label: string; type: 'text' | 'number' | 'bool' | 'select'; options?: string[] }

function TableEditor({ table, cols, defaults, canDelete, order = 'id' }: { table: string; cols: Col[]; defaults: Record<string, unknown>; canDelete?: boolean; order?: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [draft, setDraft] = useState<Record<string, unknown>>(defaults)
  const { run, busy } = useAction()
  const load = useCallback(() => supabase.from(table).select('*').order(order).then(({ data }) => setRows(data ?? [])), [table, order])
  useEffect(() => { load() }, [load])
  const pick = (r: any) => Object.fromEntries(cols.map((c) => [c.key, r[c.key]]))
  const set = (i: number, k: string, v: unknown) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  const input = (c: Col, val: any, on: (v: unknown) => void) =>
    c.type === 'bool' ? <input type="checkbox" checked={!!val} onChange={(e) => on(e.target.checked)} />
    : c.type === 'select' ? <select className="input" value={val ?? ''} onChange={(e) => on(e.target.value)}>{c.options!.map((o) => <option key={o}>{o}</option>)}</select>
    : <input className="input" type={c.type === 'number' ? 'number' : 'text'} value={val ?? ''} onChange={(e) => on(c.type === 'number' ? Number(e.target.value) : e.target.value)} />

  const save = async (r: any) => { await run(async () => { const { error } = await supabase.from(table).update(pick(r)).eq('id', r.id); if (error) throw error; return true }, 'Сохранено'); load() }
  const add = async () => { const ok = await run(async () => { const { error } = await supabase.from(table).insert(draft); if (error) throw error; return true }, 'Добавлено'); if (ok) { setDraft(defaults); load() } }
  const remove = async (r: any) => { await run(async () => { const { error } = await supabase.from(table).delete().eq('id', r.id); if (error) throw error; return true }); load() }

  return (
    <div className="editor">
      {rows.map((r, i) => (
        <div key={r.id} className="edit-row">
          {cols.map((c) => <label key={c.key}><small className="muted">{c.label}</small>{input(c, r[c.key], (v) => set(i, c.key, v))}</label>)}
          <div className="actions"><button className="btn small" disabled={busy} onClick={() => save(r)}>Сохранить</button>{canDelete && <button className="btn small danger" onClick={() => remove(r)}>×</button>}</div>
        </div>
      ))}
      <div className="edit-row new">
        {cols.map((c) => <label key={c.key}><small className="muted">{c.label}</small>{input(c, draft[c.key], (v) => setDraft((d) => ({ ...d, [c.key]: v })))}</label>)}
        <div className="actions"><button className="btn small primary" disabled={busy} onClick={add}>Добавить</button></div>
      </div>
    </div>
  )
}

const SETTING_KEYS: [string, string, 'number' | 'bool'][] = [
  ['slow_mode_seconds', 'Медленный режим, сек между сообщениями', 'number'],
  ['max_message_len', 'Макс. длина сообщения', 'number'],
  ['media_min_account_minutes', 'Фото разрешены через N минут после регистрации', 'number'],
  ['links_allowed', 'Разрешить ссылки (не рекомендуется)', 'bool'],
  ['chat_enabled', 'Чат включён', 'bool'],
]

function ChatSettings() {
  const [s, setS] = useState<Record<string, string>>({})
  const { run, busy } = useAction()
  const load = () => supabase.from('chat_settings').select('key,value').then(({ data }) => setS(Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))))
  useEffect(() => { load() }, [])
  const save = (key: string, value: string) => run(async () => { const { error } = await supabase.from('chat_settings').upsert({ key, value, updated_at: new Date().toISOString() }); if (error) throw error; return true }, 'Сохранено').then(load)
  return (
    <div className="editor">
      {SETTING_KEYS.map(([k, label, t]) => (
        <div key={k} className="edit-row">
          <label><small className="muted">{label}</small>
            {t === 'bool' ? <input type="checkbox" checked={s[k] === 'true'} onChange={(e) => save(k, String(e.target.checked))} />
              : <input className="input" type="number" value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} onBlur={(e) => save(k, e.target.value)} />}
          </label>
        </div>
      ))}
      <label className="field">Правила чата (показываются участникам)
        <textarea className="input" rows={8} value={s.rules_text ?? ''} onChange={(e) => setS({ ...s, rules_text: e.target.value })} />
      </label>
      <button className="btn primary" disabled={busy} onClick={() => save('rules_text', s.rules_text ?? '')}>Сохранить правила</button>
      <p className="muted small">Версия политики: {s.policy_version}. Её повышение заставит всех участников принять условия заново (делается вручную в базе).</p>
    </div>
  )
}

function Settings() {
  const [sec, setSec] = useState('chat')
  return (
    <>
      <div className="tabs small wrap">
        {[['chat', 'Чат'], ['gifts', 'Подарки'], ['promo', 'Продвижение'], ['packs', 'Пакеты NC'], ['words', 'Слова']].map(([k, l]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}>{l}</button>)}
      </div>
      {sec === 'chat' && <ChatSettings />}
      {sec === 'gifts' && <TableEditor table="gifts" cols={[{ key: 'emoji', label: 'Значок', type: 'text' }, { key: 'title', label: 'Название', type: 'text' }, { key: 'price', label: 'Цена NC', type: 'number' }, { key: 'sort', label: 'Порядок', type: 'number' }, { key: 'enabled', label: 'Вкл', type: 'bool' }]} defaults={{ emoji: '🎁', title: '', price: 50, sort: 10, enabled: true }} />}
      {sec === 'promo' && <TableEditor table="promo_options" cols={[{ key: 'kind', label: 'Тип', type: 'select', options: ['top', 'highlight'] }, { key: 'title', label: 'Название', type: 'text' }, { key: 'price', label: 'Цена NC', type: 'number' }, { key: 'duration_minutes', label: 'Минут', type: 'number' }, { key: 'enabled', label: 'Вкл', type: 'bool' }]} defaults={{ kind: 'top', title: '', price: 50, duration_minutes: 60, enabled: true }} />}
      {sec === 'packs' && <TableEditor table="nc_packs" cols={[{ key: 'nc_amount', label: 'NC', type: 'number' }, { key: 'price_kop', label: 'Цена, копеек', type: 'number' }, { key: 'enabled', label: 'Вкл', type: 'bool' }]} defaults={{ nc_amount: 100, price_kop: 9900, enabled: true }} />}
      {sec === 'words' && <TableEditor table="banned_words" canDelete cols={[{ key: 'pattern', label: 'Слово / основа', type: 'text' }, { key: 'category', label: 'Категория', type: 'select', options: ['profanity', 'adult', 'drugs', 'gambling', 'fraud', 'extremism', 'other'] }, { key: 'strict', label: 'Внутри слов', type: 'bool' }, { key: 'active', label: 'Вкл', type: 'bool' }]} defaults={{ pattern: '', category: 'profanity', strict: false, active: true }} />}
    </>
  )
}

function Log() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => { rpc<any[]>('admin_get_log', { p_limit: 150 }).then(setRows).catch(() => setRows([])) }, [])
  return !rows ? <Empty text="Загрузка…" /> : (
    <div className="list">
      {rows.map((r) => (
        <div key={r.id} className="row col"><b>{r.action}</b><small className="muted">{fmtDate(r.at)}{r.reason ? ' · ' + r.reason : ''}</small></div>
      ))}
    </div>
  )
}

import { Activity, ArrowUp, Bell, ChevronDown, ChevronLeft, Folder, House, MessageCircle, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { Stage } from './kit/stage'
import { Window } from './kit/window'
import { Collapse } from './kit/motion/Collapse'
import { Icon } from './kit/parts/Icon'
import type { Act } from './kit/act'
import { AppMark, DraftActions, P, useDark, type Send } from './shared'
import { strings } from './strings'
import './hero.css'

// The product's chat screen: sidebar, top bar, one white conversation card.
// Beats: a new mail lands in the dotz chat, dotz posts a summary with the reply
// draft, and a thin decision card docks above the composer. The cursor presses
// 보내기, the card says 보냈어요 on itself and leaves, and the draft's tag turns
// to 보냈어요 in place. The three added items leave together (newest first) and
// the loop begins on the same finished chat it opened on.

type S = { mail: boolean; summary: boolean; draft: boolean; dock: boolean; send: Send }

const initial: S = { mail: false, summary: false, draft: false, dock: false, send: 'idle' }
const poster: S = { mail: true, summary: true, draft: true, dock: false, send: 'done' }

async function script(a: Act<S>) {
  await a.wait(700)
  a.put({ mail: true })
  await a.wait(1100)
  a.put({ summary: true })
  await a.wait(1300)
  a.put({ draft: true, dock: true })
  await a.wait(1500)
  await a.click({ at: 'send', x: 0.55, y: 0.6 })
  a.put({ send: 'busy' })
  await a.wait(800)
  a.put({ send: 'done' })
  await a.move({ wide: { x: 900, y: 470 }, compact: { x: 320, y: 470 } })
  await a.wait(900)
  a.put({ dock: false })
  await a.wait(2000)
  a.put({ draft: false })
  await a.wait(70)
  a.put({ summary: false })
  await a.wait(70)
  a.put({ mail: false })
  await a.wait(700)
  a.put({ send: 'idle' })
}

const ic = { size: 18, strokeWidth: 1.75, absoluteStrokeWidth: true, 'aria-hidden': true } as const
const NAV = [
  { icon: <House {...ic} /> },
  { icon: <MessageCircle {...ic} />, on: true },
  { icon: <Folder {...ic} /> },
  { icon: <Activity {...ic} /> },
  { icon: <SlidersHorizontal {...ic} /> },
]

function Sidebar() {
  const t = strings().hero
  return (
    <div className="hz-side">
      <div className="hz-brand">
        <AppMark size={18} />
        dotz
        <ChevronDown className="hz-caret" size={14} aria-hidden />
      </div>
      <nav className="hz-nav">
        {NAV.map((n, i) => (
          <span key={i} className="hz-ni" data-on={n.on || undefined}>
            {n.icon}
            {t.nav[i]}
          </span>
        ))}
      </nav>
      <div className="hz-use">
        {t.usage}<span className="hz-use__bar"><i /></span><span>{t.usageValue}</span>
      </div>
    </div>
  )
}

export default function HeroScene() {
  const dark = useDark()
  const { hero: t, tags } = strings()
  return (
    <Stage
      className="dz hz"
      width={1000}
      height={600}
      compact={{ below: 600, width: 358, height: 560 }}
      fill
      theme={dark ? 'dark' : 'light'}
      initial={initial}
      poster={poster}
      script={script}
      play="loop"
      cursor={{ at: { wide: { x: 900, y: 470 }, compact: { x: 320, y: 470 } } }}
    >
      {(s, _rect, layout) => (
        <Window title="dotz" className="hz-win">
          <div className="hz-app">
            {layout === 'wide' && <Sidebar />}
            <div className="hz-main">
              <div className="hz-bar">
                <ChevronLeft className="hz-back" size={layout === 'wide' ? 15 : 20} aria-hidden />
                <h2>{layout === 'wide' ? t.title : 'dotz'}</h2>
                <span className="hz-cmdk"><Search size={15} aria-hidden /><span>{t.command}</span><kbd>⌘K</kbd></span>
                <span className="hz-bell"><Bell size={18} strokeWidth={1.75} aria-hidden /><span className="hz-bd">1</span></span>
              </div>
              <div className="hz-cv">
                {layout === 'wide' && <div className="hz-cvh"><b>dotz</b><span>{t.idle}</span></div>}
                <div className="hz-thread">
                  <div className="hz-msg hz-me">
                    <span className="hz-bub"><P>{t.ask}</P></span>
                    <span className="hz-mm">{t.askAt}</span>
                  </div>
                  <div className="hz-msg">
                    <span className="hz-mm"><b>dotz</b> · {t.ackAt}</span>
                    <P className="hz-text">{t.ack}</P>
                  </div>
                  <Collapse open={s.mail} reveal="drop" from="below">
                    <div className="hz-sys">
                      <Icon name="mail" size={13} />
                      <span>{t.mail}</span>
                    </div>
                  </Collapse>
                  <Collapse open={s.summary} reveal="drop" from="below">
                    <div className="hz-msg">
                      <span className="hz-mm"><b>dotz</b> · {t.summaryAt}</span>
                      <P className="hz-text">{t.summary}</P>
                    </div>
                  </Collapse>
                  <Collapse open={s.draft} reveal="drop" from="below">
                    <div className="hz-q">
                      <div className="hz-q__hd">
                        <span className="hz-mm">{t.draftFor}</span>
                        <span className="dz-swap">
                          <span className="dz-tag dz-tag--warn" data-off={s.send === 'done' || undefined}>{tags.review}</span>
                          <span className="dz-tag dz-tag--ok" data-off={s.send !== 'done' || undefined}>{tags.sent}</span>
                        </span>
                      </div>
                      <P className="hz-q__body">{t.draftBody}</P>
                    </div>
                  </Collapse>
                </div>
                <Collapse open={s.dock} reveal="drop" from="below">
                  <div className="hz-dock">
                    <div className="hz-dock__q">
                      <span className="dz-tag dz-tag--warn">{tags.review}</span>
                      <P className="hz-dock__t">{t.dock}</P>
                    </div>
                    <DraftActions send={s.send} at={t.sentAt} />
                  </div>
                </Collapse>
                <div className="hz-cmp">
                  <div className="hz-box">
                    <Plus size={18} strokeWidth={1.75} aria-hidden />
                    <span className="hz-ph">{t.composer}</span>
                    <span className="hz-send"><ArrowUp size={16} strokeWidth={2} aria-hidden /></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Window>
      )}
    </Stage>
  )
}

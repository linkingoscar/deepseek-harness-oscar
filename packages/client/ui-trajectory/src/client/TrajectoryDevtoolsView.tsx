import { useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ContextView } from './ContextView.tsx'
import { TrajectoryView, type TrajectoryViewInjected } from './TrajectoryView.tsx'
import css from './TrajectoryDevtoolsView.module.css'

type Mode = 'trajectory' | 'context'
type Props = ConvViewProps & InjectFace<TrajectoryViewInjected> & PropsLocale<'trajectory'>

/** Keep the existing Trajectory tab stable while adding a sibling debugger mode. */
export function TrajectoryDevtoolsView(props: Props) {
  const [mode, setMode] = useState<Mode>('trajectory')
  return (
    <div className={css.root}>
      <div className={css.switcher} role="group" aria-label={props.t('context.switcher')}>
        <button
          type="button"
          aria-pressed={mode === 'trajectory'}
          className={mode === 'trajectory' ? css.active : undefined}
          onClick={() => { setMode('trajectory') }}
        >
          {props.t('view.trajectory')}
        </button>
        <button
          type="button"
          aria-pressed={mode === 'context'}
          className={mode === 'context' ? css.active : undefined}
          onClick={() => { setMode('context') }}
        >
          {props.t('view.context')}
        </button>
      </div>
      <div className={css.body}>
        {mode === 'trajectory'
          ? <TrajectoryView {...props} />
          : <ContextView {...props} />}
      </div>
    </div>
  )
}

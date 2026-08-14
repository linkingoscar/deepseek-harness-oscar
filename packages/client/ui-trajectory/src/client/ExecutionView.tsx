import { useMemo } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CodeRunExecutionAccounting } from '@deepseek-ai/dsh-tools/execution-accounting'
import { EMPTY_TRAJECTORY_SNAPSHOT } from './trajectory-snapshot-builder.ts'
import css from './ContextView.module.css'

function count(value: number): string {
  return value.toLocaleString('en-US')
}

function byteLabel(value: number): string {
  return `${count(value)} B`
}

function incomplete(run: CodeRunExecutionAccounting): boolean {
  return run.unsettled > 0 || run.orphanSettles > 0
}

/** Durable Code Mode execution debugger over the currently loaded Trajectory window. */
export function ExecutionView({
  useSession,
  t,
}: ConvViewProps & PropsLocale<'trajectory'>) {
  const source = useSession(snapshot =>
    (snapshot.views.get('trajectory') ?? EMPTY_TRAJECTORY_SNAPSHOT).executionAccounting ?? [])
  const runs = useMemo(
    () => [...source].sort((left, right) => left.firstSeq - right.firstSeq),
    [source],
  )

  return (
    <main className={css.root} aria-label={t('execution.title')}>
      <header className={css.header}>
        <div>
          <h2 className={css.title}>{t('execution.title')}</h2>
          <p className={css.subtitle}>{t('execution.subtitle')}</p>
        </div>
        <span className={css.requestCount}>{runs.length} {t('execution.runs')}</span>
      </header>

      {runs.length === 0
        ? <p className={css.empty}>{t('execution.empty')}</p>
        : <div className={css.list}>
          {runs.map(run => (
            <details className={css.request} key={String(run.parentCallId)}>
              <summary className={css.summary}>
                <div className={css.identity}>
                  <span className={css.requestName}>{t('execution.run')} {String(run.parentCallId)}</span>
                  <span className={css.location}>seq {run.firstSeq}–{run.lastSeq} · {count(run.dispatchWindowMs)} ms</span>
                  {incomplete(run) && <span className={css.change}>{t('execution.incomplete')}</span>}
                </div>
                <dl className={css.metrics}>
                  <div><dt>{t('execution.dispatches')}</dt><dd>{run.settled}/{run.started}</dd></div>
                  <div><dt>{t('execution.failed')}</dt><dd>{count(run.failed)}</dd></div>
                  <div><dt>{t('execution.peak')}</dt><dd>{count(run.peakInFlight)}</dd></div>
                  <div><dt>{t('execution.delivered')}</dt><dd>{byteLabel(run.deliveredValueBytes)}</dd></div>
                  <div><dt>{t('execution.unknown')}</dt><dd>{count(run.unmeasuredDeliveredValues)}</dd></div>
                  <div><dt>{t('execution.incomplete')}</dt><dd>{run.unsettled} / {run.orphanSettles}</dd></div>
                </dl>
              </summary>
              <div className={css.details}>
                <section className={css.section}>
                  <h3>{t('execution.byTool')}</h3>
                  <div className={css.toolList}>
                    {Object.entries(run.byTool).map(([name, tool]) => (
                      <div className={css.tool} key={name}>
                        <div className={css.toolHeading}>
                          <strong>{name}</strong>
                          <span>{tool.settled}/{tool.started} · {byteLabel(tool.deliveredValueBytes)}</span>
                        </div>
                        <p>
                          {t('execution.failed')} {tool.failed} · {t('execution.unknown')} {tool.unmeasuredDeliveredValues}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </details>
          ))}
        </div>}
    </main>
  )
}

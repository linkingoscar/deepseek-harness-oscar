import { useMemo } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { contextRequestRows, type PromptChangeKind } from './context-model.ts'
import { EMPTY_TRAJECTORY_SNAPSHOT } from './trajectory-snapshot-builder.ts'
import css from './ContextView.module.css'

function count(value: number): string {
  return value.toLocaleString('en-US')
}

function changeLabel(
  kind: PromptChangeKind,
  t: PropsLocale<'trajectory'>['t'],
): string {
  switch (kind) {
    case 'initial': return t('context.changeInitial')
    case 'system': return t('context.changeSystem')
    case 'tools': return t('context.changeTools')
    case 'system-and-tools': return t('context.changeSystemAndTools')
    case 'inherited': return t('context.changeInherited')
  }
}

/**
 * Request-by-request prompt-envelope debugger over the bounded Trajectory
 * request-inspection window. It renders reconstructed facts only; no token
 * attribution is inferred from character counts.
 */
export function ContextView({
  useSession,
  t,
}: ConvViewProps & PropsLocale<'trajectory'>) {
  const requests = useSession(snapshot =>
    (snapshot.views.get('trajectory') ?? EMPTY_TRAJECTORY_SNAPSHOT).requests)
  const rows = useMemo(() => contextRequestRows(requests), [requests])

  return (
    <main className={css.root} aria-label={t('context.title')}>
      <header className={css.header}>
        <div>
          <h2 className={css.title}>{t('context.title')}</h2>
          <p className={css.subtitle}>{t('context.subtitle')}</p>
        </div>
        <span className={css.requestCount}>
          {rows.length} {t('context.requests')}
        </span>
      </header>

      {rows.length === 0
        ? <p className={css.empty}>{t('context.empty')}</p>
        : (
          <div className={css.list}>
            {rows.map((row) => {
              const largest = row.footprint.largestTools[0]
              return (
                <details className={css.request} key={row.startSeq}>
                  <summary className={css.summary}>
                    <div className={css.identity}>
                      <span className={css.requestName}>
                        {t('context.request')} #{row.requestNumber}
                      </span>
                      <span className={css.location}>
                        {t('context.turn')} {row.turn} · {t('context.step')} {row.step}
                      </span>
                      <span className={css.change} data-change={row.promptChange}>
                        {changeLabel(row.promptChange, t)}
                      </span>
                    </div>
                    <dl className={css.metrics}>
                      <div>
                        <dt>{t('context.system')}</dt>
                        <dd>{count(row.footprint.systemChars)} {t('context.chars')}</dd>
                      </div>
                      <div>
                        <dt>{t('context.toolSchemas')}</dt>
                        <dd>
                          {row.footprint.toolCount} {t('context.tools')} · {' '}
                          {count(row.footprint.toolSchemaChars)} {t('context.chars')}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('context.largestTool')}</dt>
                        <dd>
                          {largest === undefined
                            ? '—'
                            : `${largest.name} · ${count(largest.chars)} ${t('context.chars')}`}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('context.reportedInput')}</dt>
                        <dd>
                          {row.inputTokens === null
                            ? t('context.notReported')
                            : `${count(row.inputTokens)} tok`}
                        </dd>
                      </div>
                    </dl>
                  </summary>

                  <div className={css.details}>
                    <section className={css.section}>
                      <h3>{t('context.systemPrompt')}</h3>
                      {row.prompt.system === ''
                        ? <p className={css.muted}>{t('context.emptySystem')}</p>
                        : <pre className={css.prompt}>{row.prompt.system}</pre>}
                    </section>
                    <section className={css.section}>
                      <h3>{t('context.toolCatalog')}</h3>
                      {row.tools.length === 0
                        ? <p className={css.muted}>{t('context.noTools')}</p>
                        : (
                          <div className={css.toolList}>
                            {row.tools.map((tool, index) => (
                              <div className={css.tool} key={`${tool.name}:${index}`}>
                                <div className={css.toolHeading}>
                                  <strong>{tool.name}</strong>
                                  <span>{count(tool.chars)} {t('context.chars')}</span>
                                </div>
                                {tool.description !== '' && (
                                  <p>{tool.description}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                    </section>
                  </div>
                </details>
              )
            })}
          </div>
        )}
    </main>
  )
}

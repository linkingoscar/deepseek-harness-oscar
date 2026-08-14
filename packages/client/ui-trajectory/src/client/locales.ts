/** `trajectory` namespace dictionaries (view labels + toolbar/context strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'trajectory'

/** The trajectory dictionary key set (the source of truth for both locales). */
export type TrajectoryKey =
  | 'view.trajectory'
  | 'view.context'
  | 'view.execution'
  | 'toolbar.aria'
  | 'toolbar.duration'
  | 'toolbar.useActualDuration'
  | 'toolbar.useEqualWidth'
  | 'toolbar.actualTime'
  | 'toolbar.turns'
  | 'toolbar.expandTurns'
  | 'toolbar.collapseTurns'
  | 'toolbar.calls'
  | 'toolbar.expandCalls'
  | 'toolbar.collapseCalls'
  | 'toolbar.search'
  | 'toolbar.searchPlaceholder'
  | 'context.switcher'
  | 'context.title'
  | 'context.subtitle'
  | 'context.requests'
  | 'context.empty'
  | 'context.request'
  | 'context.turn'
  | 'context.step'
  | 'context.changeInitial'
  | 'context.changeSystem'
  | 'context.changeTools'
  | 'context.changeSystemAndTools'
  | 'context.changeInherited'
  | 'context.system'
  | 'context.toolSchemas'
  | 'context.tools'
  | 'context.largestTool'
  | 'context.reportedInput'
  | 'context.notReported'
  | 'context.chars'
  | 'context.systemPrompt'
  | 'context.emptySystem'
  | 'context.toolCatalog'
  | 'context.noTools'
  | 'execution.title'
  | 'execution.subtitle'
  | 'execution.runs'
  | 'execution.empty'
  | 'execution.run'
  | 'execution.dispatches'
  | 'execution.failed'
  | 'execution.peak'
  | 'execution.delivered'
  | 'execution.unknown'
  | 'execution.incomplete'
  | 'execution.byTool'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The trajectory/context view labels and their browser-only strings. */
    'trajectory': TrajectoryKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<TrajectoryKey, string> = {
  'view.trajectory': '轨迹',
  'view.context': '上下文',
  'view.execution': '执行',
  'toolbar.aria': '轨迹工具栏',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': '实际时间',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': '搜索轨迹',
  'toolbar.searchPlaceholder': '搜索',
  'context.switcher': '轨迹调试器模式',
  'context.title': '上下文调试器',
  'context.subtitle': '按请求比较可重建的 system prompt 与工具 schema 体积；字符数不估算 token。',
  'context.requests': '个请求',
  'context.empty': '当前已加载窗口中没有可检查的模型请求。',
  'context.request': '请求',
  'context.turn': '轮次',
  'context.step': '步骤',
  'context.changeInitial': '初始 prompt',
  'context.changeSystem': 'system 已变更',
  'context.changeTools': 'tools 已变更',
  'context.changeSystemAndTools': 'system + tools 已变更',
  'context.changeInherited': '沿用上一请求',
  'context.system': 'System',
  'context.toolSchemas': '工具 Schema',
  'context.tools': '个工具',
  'context.largestTool': '最大工具',
  'context.reportedInput': '请求输入',
  'context.notReported': '未报告',
  'context.chars': '字符',
  'context.systemPrompt': 'System Prompt',
  'context.emptySystem': '此请求没有 system prompt。',
  'context.toolCatalog': '工具目录',
  'context.noTools': '此请求没有模型可见工具。',
  'execution.title': '执行调试器',
  'execution.subtitle': '从持久化 Code Mode dispatch 事件重建执行事实；缺失的旧版字节证据保持为未知。',
  'execution.runs': '次运行',
  'execution.empty': '当前已加载窗口中没有 Code Mode 执行证据。',
  'execution.run': 'run_code',
  'execution.dispatches': 'Settled / Started',
  'execution.failed': '失败',
  'execution.peak': '峰值并发',
  'execution.delivered': '交付字节',
  'execution.unknown': '未知字节结果',
  'execution.incomplete': 'Unsettled / Orphan',
  'execution.byTool': '按工具',
}

/** English dictionary. */
export const en: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Trajectory',
  'view.context': 'Context',
  'view.execution': 'Execution',
  'toolbar.aria': 'Trajectory toolbar',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': 'Actual time',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': 'Search trajectory',
  'toolbar.searchPlaceholder': 'Search',
  'context.switcher': 'Trajectory debugger mode',
  'context.title': 'Context debugger',
  'context.subtitle': 'Compare reconstructed system-prompt and tool-schema footprint by request; character counts do not estimate tokens.',
  'context.requests': 'requests',
  'context.empty': 'No inspectable model requests are present in the currently loaded window.',
  'context.request': 'Request',
  'context.turn': 'Turn',
  'context.step': 'Step',
  'context.changeInitial': 'Initial prompt',
  'context.changeSystem': 'System changed',
  'context.changeTools': 'Tools changed',
  'context.changeSystemAndTools': 'System + tools changed',
  'context.changeInherited': 'Inherited',
  'context.system': 'System',
  'context.toolSchemas': 'Tool schemas',
  'context.tools': 'tools',
  'context.largestTool': 'Largest tool',
  'context.reportedInput': 'Request input',
  'context.notReported': 'Not reported',
  'context.chars': 'chars',
  'context.systemPrompt': 'System Prompt',
  'context.emptySystem': 'No system prompt in this request.',
  'context.toolCatalog': 'Tool catalog',
  'context.noTools': 'No model-visible tools in this request.',
  'execution.title': 'Execution debugger',
  'execution.subtitle': 'Reconstruct Code Mode execution facts from durable dispatch events; missing legacy byte evidence stays unknown.',
  'execution.runs': 'runs',
  'execution.empty': 'No Code Mode execution evidence is present in the currently loaded window.',
  'execution.run': 'run_code',
  'execution.dispatches': 'Settled / Started',
  'execution.failed': 'Failed',
  'execution.peak': 'Peak in flight',
  'execution.delivered': 'Delivered bytes',
  'execution.unknown': 'Unknown-byte values',
  'execution.incomplete': 'Unsettled / Orphan',
  'execution.byTool': 'By tool',
}

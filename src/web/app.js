// Passiton — SPA Application
// Complete rewrite based on new UI design

const API = ''  // same origin
const AUTH_TOKEN_KEY = 'turing-jwt'
const THEME_KEY = 'turing-theme'
const OPS_POSITION_KEY = 'turing-ops-position'

const PROVIDER_PRESETS = {
  anthropic: {
    label: 'Anthropic',
    adapter: 'anthropic-api',
    baseUrl: '',
    models: [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 snapshot' },
    ],
  },
  openai: {
    label: 'OpenAI',
    adapter: 'openai-api',
    baseUrl: '',
    models: [
    { value: 'gpt-5.5', label: 'GPT-5.5' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    ],
  },
  deepseek: {
    label: 'DeepSeek',
    adapter: 'deepseek-api',
    baseUrl: '',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    ],
  },
  qwen: {
    label: 'Qwen (DashScope)',
    adapter: 'qwen-api',
    baseUrl: '',
    models: [
      { value: 'qwen-plus', label: 'Qwen Plus' },
      { value: 'qwen-max', label: 'Qwen Max' },
      { value: 'qwen-turbo', label: 'Qwen Turbo' },
      { value: 'qwen-long', label: 'Qwen Long' },
    ],
  },
  moonshot: {
    label: 'Moonshot (Kimi)',
    adapter: 'moonshot-api',
    baseUrl: '',
    models: [
      { value: 'moonshot-v1-32k', label: 'Moonshot v1 32k' },
      { value: 'moonshot-v1-128k', label: 'Moonshot v1 128k' },
      { value: 'kimi-k2', label: 'Kimi K2' },
    ],
  },
  zhipu: {
    label: 'Zhipu',
    adapter: 'zhipu-api',
    baseUrl: '',
    models: [
    { value: 'glm-5.1', label: 'GLM-5.1' },
    { value: 'glm-5', label: 'GLM-5' },
    { value: 'glm-5-turbo', label: 'GLM-5-Turbo' },
    { value: 'glm-4.7', label: 'GLM-4.7' },
    { value: 'glm-4.7-flashx', label: 'GLM-4.7-FlashX' },
    { value: 'glm-4.7-flash', label: 'GLM-4.7-Flash' },
    { value: 'glm-4.6', label: 'GLM-4.6' },
    { value: 'glm-4.5-air', label: 'GLM-4.5-Air' },
    { value: 'glm-4.5-airx', label: 'GLM-4.5-AirX' },
    ],
  },
  custom: {
    label: 'Custom OpenAI-compatible',
    adapter: 'custom-api',
    baseUrl: '',
    models: [
    { value: '', label: 'Provider default' },
    { value: 'gpt-5.5', label: 'GPT-5.5 compatible' },
    { value: 'gpt-5.4', label: 'GPT-5.4 compatible' },
    { value: 'gpt-4.1', label: 'GPT-4.1 compatible' },
    ],
  },
}

// ── i18n ──────────────────────────────────────────────────────────────────────
const LANG_KEY = 'passiton_lang'
const LEGACY_LANG_KEY = 'turing_lang'

const MESSAGES = {
  en: {
    // Navigation
    'nav.sessions': 'Sessions',
    'nav.tasks': 'Tasks',
    'nav.workflows': 'Workflows',
    'nav.settings': 'Settings',
    'nav.apiDocs': 'API Docs',

    // Settings — tabs
    'settings.tab.apiAssistants': 'API Assistants',
    'settings.tab.providerKeys': 'Provider Keys',
    'settings.tab.agents': 'Agents',
    'settings.tab.diagnostics': 'Diagnostics',
    'settings.tab.apiDocs': 'API Docs',
    'settings.tab.general': 'General',

    // Settings — API Assistants
    'settings.agents.title': 'API Assistants',
    'settings.agents.desc': 'Manage your AI model connections',
    'settings.agents.add': '+ Add Assistant',
    'settings.agents.empty': 'No API assistants configured',
    'settings.agents.verify': 'Verify',
    'settings.agents.edit': 'Edit',
    'settings.agents.delete': 'Delete',

    // Settings — Provider Keys
    'settings.keys.title': 'Provider Keys',
    'settings.keys.desc': 'Manage keys used by API assistants and sessions',
    'settings.keys.add': '+ Add Key',
    'settings.keys.empty': 'No provider keys stored',

    // Settings — Local CLI Agents
    'settings.localCli.title': 'Local CLI Agents',
    'settings.localCli.desc': 'Discovered on this machine; add the ones you want to use in sessions',
    'settings.localCli.empty': 'No local CLI agents available',
    'settings.localCli.emptyCustom': 'Nothing was auto-discovered on this machine. Add any CLI agent by command and arguments.',
    'settings.localCli.addCustom': '+ Add custom agent',
    'settings.localCli.add': 'Add',
    'settings.localCli.diagnose': 'Diagnose',
    'settings.localCli.priority': 'Priority',
    'settings.localCli.priorityHelp': 'Lower runs first',
    'settings.localCli.moveUp': 'Move up',
    'settings.localCli.moveDown': 'Move down',

    // Settings — Agents tab extras
    'settings.agents.workspacesHint': 'Security boundary: directories CLI agents may operate in',
    'settings.diagnostics.title': 'Diagnostics',
    'settings.diagnostics.desc': 'Check deployment and CLI agent runtime status',
    'settings.diagnostics.refresh': 'Refresh',
    'settings.diagnostics.deployment': 'Deployment',
    'settings.diagnostics.notChecked': 'not checked',
    'settings.diagnostics.run': 'Run',

    // Settings — API Docs
    'settings.apiDocs.title': 'Session HTTP API',

    // Settings — General
    'settings.general.title': 'General Settings',
    'settings.general.maxTurns': 'Default Max Turns',
    'settings.general.mode': 'Default Mode',
    'settings.general.mode.collaborate': 'Collaboration',
    'settings.general.mode.discuss': 'Discuss',
    'settings.general.mode.review': 'Review',
    'settings.general.mode.freeform': 'Freeform',
    'settings.general.workspaces': 'Allowed Workspaces',
    'settings.general.workspacesPlaceholder': '/home/me/projects\n/Users/me/Projects',
    'settings.general.save': 'Save Settings',
    'settings.general.language': 'Language',
    'settings.general.language.en': 'English',
    'settings.general.language.zh': 'Chinese',

    // Agent diagnostics modal
    'modal.agentDiagnostics.title': 'Agent Diagnostics',
    'modal.agentDiagnostics.running': 'Running checks…',
    'modal.agentDiagnostics.runningDesc': 'Checking the command, version, authentication, and a real model round-trip. This may take up to 45 seconds.',
    'modal.agentDiagnostics.failed': 'Diagnosis failed',
    'modal.agentDiagnostics.ready': 'Agent is ready',
    'modal.agentDiagnostics.notReady': 'Agent is not ready',
    'modal.agentDiagnostics.commandCheck': 'Command found',
    'modal.agentDiagnostics.versionCheck': 'Version check',
    'modal.agentDiagnostics.modelCheck': 'Real model call',
    'modal.agentDiagnostics.passed': 'Passed',
    'modal.agentDiagnostics.notRun': 'Not run',
    'modal.agentDiagnostics.details': 'Technical details',

    // Edit Local CLI Agent modal
    'modal.localCli.edit.title': 'Edit Local CLI Agent',
    'modal.customCli.add.title': 'Add Custom CLI Agent',
    'modal.customCli.desc': 'Run any local CLI command. The {prompt} token is replaced with the task prompt.',
    'modal.customCli.commandPlaceholder': '/usr/local/bin/aider or aider',
    'modal.customCli.argsHelp': 'One argument per line. Include {prompt} where the task prompt should be inserted.',
    'modal.customCli.argsPlaceholder': '--message\n{prompt}',
    'modal.customCli.envHelp': 'Optional KEY=VALUE lines.',
    'modal.customCli.timeoutHelp': 'Optional idle timeout in milliseconds.',

    // Add/Edit Assistant modal
    'modal.agent.add': 'Add Assistant',
    'modal.agent.edit': 'Edit Assistant',
    'modal.agent.desc': 'Configure an API-backed model.',
    'modal.agent.baseUrl': 'Base URL',
    'modal.agent.providerKey': 'Provider Key',
    'modal.agent.keyRequired': 'Required',
    'modal.agent.keyOptional': 'Optional override',

    // Add Provider Key modal
    'modal.key.title': 'Add Provider Key',
    'modal.key.desc': 'Stored encrypted in the local key vault.',
    'modal.key.namePlaceholder': 'Work key',

    // Common form labels
    'common.name': 'Name',
    'common.provider': 'Provider',
    'common.model': 'Model',
    'common.adapter': 'Adapter',
    'common.command': 'Command',
    'common.args': 'Args',
    'common.timeout': 'Timeout (ms)',
    'common.env': 'Environment',
    'common.apiKey': 'API Key',
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.save': 'Save',

    // Status labels
    'status.ready': 'Available',
    'status.unverified': 'Unverified',
    'status.discovered': 'Discovered',
    'status.no_key': 'No Key',
    'status.invalid': 'Invalid',

    // Key source labels
    'keySource.vault': 'saved key',
    'keySource.assistant': 'agent key',
    'keySource.global': 'global config',

    // Badge labels
    'badge.linked': 'linked',
    'badge.ok': 'ok',
    'badge.unknown': 'unknown',

    // Toast messages
    'toast.settingsSaved': 'Settings saved successfully',
    'toast.assistantSaved': 'Assistant saved',
    'toast.assistantDeleted': 'Assistant deleted',
    'toast.keyAdded': 'Provider key added',
    'toast.keyDeleted': 'Provider key deleted',
    'toast.localCliAdded': '"{name}" has been added to configured agents',
    'toast.localCliSaved': '"{name}" saved',
    'toast.localCliRemoved': '"{name}" removed',
    'toast.agentValidationFailed': 'Agent was saved but validation failed.',
    'toast.languageChanged': 'Language switched to {lang}',

    // Confirm dialogs
    'confirm.deleteAgent.title': 'Delete Assistant',
    'confirm.deleteAgent.message': 'Delete assistant "{name}"?',
    'confirm.deleteAgent.confirm': 'Delete',
    'confirm.deleteKey.title': 'Delete API Key',
    'confirm.deleteKey.message': 'Delete this API key?',
    'confirm.deleteKey.confirm': 'Delete',
    'confirm.deleteLocalCli.title': 'Remove Local CLI Agent',
    'confirm.deleteLocalCli.message': 'Remove local CLI agent "{name}" from sessions?',
    'confirm.deleteLocalCli.confirm': 'Remove',

    // Session status labels
    'session.status.active': 'Active',
    'session.status.paused': 'Paused',
    'session.status.done': 'Completed',
    'session.status.error': 'Error',
    'session.status.cancelled': 'Cancelled',

    // Sessions — list page
    'sessions.title': 'Sessions',
    'sessions.newSession': '+ New Session',
    'sessions.stat.active': 'Active Sessions',
    'sessions.stat.activeSub': 'running right now',
    'sessions.stat.completed': 'Completed Today',
    'sessions.stat.completedSub': '↑ vs yesterday',
    'sessions.stat.avgTurns': 'Avg Turns',
    'sessions.stat.avgTurnsSub': 'across all sessions',
    'sessions.stat.activeAgents': 'Active Agents',
    'sessions.stat.activeAgentsSub': 'providers configured',
    'sessions.recentTitle': 'Recent Sessions',
    'sessions.searchPlaceholder': 'Search sessions...',
    'sessions.loading': 'Loading…',
    'sessions.back': '← Back',
    'sessions.turns': '{count} turns',
    'sessions.delete': 'Delete',

    // Tasks — list page
    'tasks.title': 'Tasks',
    'tasks.newTask': '+ New Task',
    'tasks.stat.running': 'Running Tasks',
    'tasks.stat.runningSub': 'running right now',
    'tasks.stat.queued': 'Queued',
    'tasks.stat.queuedSub': 'waiting to start',
    'tasks.stat.completed': 'Completed',
    'tasks.stat.completedSub': 'lead-agent tasks',
    'tasks.stat.failed': 'Failed',
    'tasks.stat.failedSub': 'need attention',
    'tasks.recentTitle': 'Recent Tasks',
    'tasks.empty': 'No tasks yet. Create your first one!',
    'tasks.loadMore': 'Load more tasks',
    'tasks.loading': 'Loading\u2026',
    'tasks.runningElapsed': 'running {duration}',

    // Tasks — detail page
    'task.back': '\u2190 Back',
    'task.askOps': 'Ask Ops',
    'task.stop': '\u25a0 Stop',
    'task.restart': '\u21bb Restart',
    'task.feedbackRerun': '\u270e Feedback & Rerun',
    'task.notFound': 'Task not found',
    'task.section.prompt': 'Prompt',
    'task.section.result': 'Result',
    'task.section.fullOutput': 'Full Output',
    'task.section.errorTitle': 'Task error',
    'task.info': 'Task Info',
    'task.info.id': 'Task ID',
    'task.info.agent': 'Agent',
    'task.info.status': 'Status',
    'task.info.created': 'Created',
    'task.info.started': 'Started',
    'task.info.finished': 'Finished',
    'task.info.cwd': 'CWD',
    'task.creationParams': 'Creation Params',
    'task.liveOutput': 'Live Agent Output',
    'task.liveOutputWaiting': 'Waiting for agent output\u2026',

    // New Task modal
    'newTask.title': 'New Task',
    'newTask.desc': 'Assign one lead agent to run the workflow.',
    'newTask.noAgents': 'No assistants configured yet.',
    'newTask.addOneFirst': 'Add one first',
    'newTask.agent': 'Agent',
    'newTask.workingDir': 'Working Directory',
    'newTask.workingDirPlaceholder': '/path/to/project',
    'newTask.prompt': 'Prompt',
    'newTask.promptPlaceholder': 'Describe the task\u2026',
    'newTask.systemPrompt': 'System Prompt',
    'newTask.systemPromptPlaceholder': 'Optional override',
    'newTask.context': 'Context',
    'newTask.contextRules': 'Rules / Constraints',
    'newTask.contextBackground': 'Background',
    'newTask.contextFiles': 'Files',
    'newTask.contextFilesPlaceholder': 'docs/brief.md, src/index.ts',
    'newTask.create': 'Create',
    'newTask.cwdRequiresFilesystem': 'Tasks with cwd require a filesystem-capable local CLI agent',

    // Task feedback modal
    'taskFeedback.title': 'Feedback & Rerun',
    'taskFeedback.desc': 'Create a new task based on the prompt and result of the current task.',
    'taskFeedback.feedbackLabel': 'Feedback',
    'taskFeedback.feedbackPlaceholder': 'What should the agent change or try next?',
    'taskFeedback.createNew': 'Create New Task',
    'taskFeedback.creating': 'Creating\u2026',

    // Task — workspace warnings
    'task.ws.preexistingOnly': 'Workspace already had uncommitted files before this task.',
    'task.ws.viewFiles': 'View {count} preexisting file(s)',
    'task.ws.preexistingExtra': 'Also had {count} preexisting file(s)',
    'task.ws.changedUnfinished': 'Task changed {count} file(s) before failing.',
    'task.ws.changedUnfinishedSimple': 'Workspace has {count} changed file(s) after this failed task.',
    'task.ws.viewChanges': 'View changes',
    'task.ws.checkWorkspace': 'Task failed. Check workspace {cwd} before rerunning.',

    // Tasks
    'task_title': 'Tasks',
    'task_new': '+ New Task',
    'task_stat_running': 'Running Tasks',
    'task_stat_running_sub': 'running right now',
    'task_stat_queued': 'Queued',
    'task_stat_queued_sub': 'waiting to start',
    'task_stat_completed': 'Completed',
    'task_stat_completed_sub': 'lead-agent tasks',
    'task_stat_failed': 'Failed',
    'task_stat_failed_sub': 'need attention',
    'task_recent_title': 'Recent Tasks',
    'task_empty': 'No tasks yet. Create your first one!',
    'task_running_elapsed': 'running {duration}',
    'task_load_more': 'Load more tasks',
    'task_loading': 'Loading…',
    'task_not_found': 'Task not found',
    'task_untitled': 'Untitled task',
    'task_back': '← Back',
    'task_ask_ops': 'Ask Ops',
    'task_stop': '■ Stop',
    'task_restart': '↻ Restart',
    'task_feedback_rerun': '✎ Feedback & Rerun',
    'task_status_running': 'Running',
    'task_status_queued': 'Queued',
    'task_status_done': 'Completed',
    'task_status_error': 'Failed',
    'task_status_cancelled': 'Cancelled',
    'task_section_prompt': 'PROMPT',
    'task_section_result': 'RESULT',
    'task_section_full_output': 'FULL OUTPUT',
    'task_section_error_title': 'Task error',
    'task_info': 'TASK INFO',
    'task_info_id': 'Task ID',
    'task_info_agent': 'Agent',
    'task_info_status': 'Status',
    'task_info_created': 'Created',
    'task_info_started': 'Started',
    'task_info_finished': 'Finished',
    'task_info_cwd': 'CWD',
    'task_commits_title': 'COMMITS DURING THIS TASK',
    'task_live_output': 'Live Output',
    'task_live_output_waiting': 'Waiting for output…',
    'task_creation_params': 'Creation Params',
    'task_agent': 'Agent',
    'task_cwd': 'CWD',
    'task_prompt': 'Prompt',
    'task_system_prompt': 'System Prompt',
    'task_context_rules': 'Rules',
    'task_context_text': 'Text',
    'task_context_unnamed_file': 'unnamed file',
    'task_workspace_preexisting_only': 'Workspace already had uncommitted files before this task.',
    'task_workspace_view_files': 'View {count} preexisting file(s)',
    'task_workspace_preexisting_extra': 'Also had {count} preexisting file(s)',
    'task_workspace_changed_unfinished': 'Task changed {count} file(s) before failing.',
    'task_workspace_changed_unfinished_simple': 'Workspace has {count} changed file(s) after this failed task.',
    'task_workspace_view_changes': 'View changes',
    'task_workspace_check': 'Task failed. Check workspace {cwd} before rerunning.',
    'task_status_processing': 'Processing…',
    'task_status_reading': 'Reading {file}…',
    'task_status_modifying': 'Modifying {file}…',
    'task_status_executing': 'Executing {cmd}…',
    'task_status_analyzing': 'Analyzing…',

    // New Task modal
    'task_modal_title': 'New Task',
    'task_modal_desc': 'Assign one lead agent to run the workflow.',
    'task_modal_no_agents': 'No assistants configured yet.',
    'task_modal_add_one': 'Add one first',
    'task_modal_auto_agent': 'Auto (highest priority)',
    'task_modal_working_dir': 'Working Directory',
    'task_modal_working_dir_placeholder': '/path/to/project',
    'task_modal_prompt_placeholder': 'Describe the task...',
    'task_modal_context': 'Context',
    'task_modal_rules': 'Rules / Constraints',
    'task_modal_background': 'Background',
    'task_modal_files': 'Files',
    'task_modal_files_placeholder': 'docs/brief.md, src/index.ts',
    'task_modal_system_prompt_placeholder': 'Optional override',
    'task_modal_create': 'Create',
    'task_modal_cwd_requires_filesystem': 'Tasks with cwd require a filesystem-capable local CLI agent',

    // Task feedback modal
    'task_feedback_title': 'Feedback & Rerun',
    'task_feedback_desc': 'Create a new task from this result plus your feedback.',
    'task_feedback_label': 'Feedback',
    'task_feedback_placeholder': 'What should the agent change or try next?',
    'task_feedback_create_new': 'Create New Task',
    'task_feedback_creating': 'Creating…',
    'handoff_button': 'Continue with another agent',
    'handoff_title': 'Continue Task',
    'handoff_desc': 'Create a new task that continues from this stopped or failed attempt.',
    'handoff_agent': 'Agent',
    'handoff_no_agents': 'No compatible task agents.',
    'handoff_create': 'Continue',
    'handoff_creating': 'Creating…',
    'handoff_source': 'Continued from',
    'handoff_continued_from': 'Continued from {id}',

    // Sessions — onboarding
    'sessions.onboarding.ready': 'Ready to Go',
    'sessions.onboarding.readyDesc': 'Ready with <strong>{count}</strong> agent(s). Start your first session!',
    'sessions.onboarding.manageAgents': 'Manage Agents',
    'sessions.onboarding.welcome': 'Welcome to Passiton',
    'sessions.onboarding.welcomeDesc': 'Connect an AI model to get started. Pick your path:',
    'sessions.onboarding.apiModel': 'API Model (Fastest)',
    'sessions.onboarding.apiModelDesc': 'Add a provider key — no install needed. Supports Anthropic, OpenAI, Zhipu, DeepSeek, Qwen, Moonshot.',
    'sessions.onboarding.addApiKey': 'Add API Key',
    'sessions.onboarding.localCli': 'Local CLI Agent',
    'sessions.onboarding.localCliDesc': 'Installed Codex / Claude Code / Gemini CLI / OpenCode? Make sure they\'re on your PATH and we\'ll auto-discover them.',
    'sessions.onboarding.viewDiscovered': 'View Discovered Agents',
    'sessions.onboarding.settingsHint': 'You can add or remove agents and keys in Settings anytime.',
    'sessions.onboarding.unverifiedTitle': 'Agents Not Verified',
    'sessions.onboarding.unverifiedDesc': 'Found <strong>{apiCount}</strong> API agent(s) and <strong>{cliCount}</strong> CLI agent(s), but none are confirmed working yet.',
    'sessions.onboarding.unverifiedHint': 'Common causes: not logged in, expired credentials, lapsed subscription, or wrong binary path. Re-test or check in Settings.',
    'sessions.onboarding.retest': 'Re-test',
    'sessions.onboarding.goToSettings': 'Go to Settings',

    // Session detail — header & actions
    'session.askOps': 'Ask Ops',
    'session.export': 'Export',
    'session.extend': '+5m',
    'session.pause': '⏸ Pause',
    'session.resume': '▶ Resume',
    'session.retry': '↻ Retry from Error',
    'session.stop': '■ Stop',
    'session.waitingOutput': 'Waiting for output…',
    'session.idle': 'Idle',
    'session.injectPlaceholder': 'Inject a message into this session…',
    'session.send': 'Send',
    'session.rawToggleHide': 'Hide raw output',
    'session.rawToggleShow': 'Show raw output',
    'session.scrollTop': 'Scroll to top',
    'session.scrollBottom': 'Scroll to bottom',
    'session.copy': 'Copy',
    'session.noMessages': 'No messages yet',

    // Session detail — panel
    'session.info': 'Session Info',
    'session.idLabel': 'Session ID',
    'session.agentA': 'Agent A',
    'session.agentB': 'Agent B',
    'session.mode': 'Mode',
    'session.template': 'Template',
    'session.turnsLabel': 'Turns',
    'session.statusLabel': 'Status',
    'session.permission': 'Permission',
    'session.created': 'Created',
    'session.cwd': 'CWD',
    'session.progress': 'Progress',
    'session.turnOf': 'Turn {round} of {max}',
    'session.errorTitle': 'Session error',
    'session.lastOutput': 'Last Agent Output',
    'session.start': 'Start',
    'session.turn': 'Turn {round}',

    // Session — artifacts
    'session.artifact.noSummary': 'No summary',
    'session.artifact.title': 'Artifacts',
    'session.artifact.fileChanges': '📄 File Changes',
    'session.artifact.summary': '📋 Summary',
    'session.artifact.copySummary': 'Copy Summary',
    'session.artifact.collapseDiff': 'Collapse full diff',
    'session.artifact.viewDiff': 'View full diff',

    // Session — step card
    'session.step.collapse': 'Collapse details',
    'session.step.expand': 'Expand details',

    // Session — toast
    'session.toast.summaryCopied': 'Summary copied',
    'session.toast.copyFailed': 'Copy failed',

    // Session — confirm dialogs
    'session.confirm.stop.title': 'Stop Session',
    'session.confirm.stop.message': 'Stop this session now?',
    'session.confirm.stop.confirm': 'Stop',
    'session.confirm.delete.title': 'Delete Session',
    'session.confirm.delete.message': 'Delete this session permanently?',
    'session.confirm.delete.confirm': 'Delete',

    // Session — toasts
    'session.toast.timeoutExtended': 'Timeout extended +{n}m',
    'session.toast.cwdRequiresFilesystem': 'Sessions with cwd require Agent B to be a filesystem-capable local CLI agent',

    // Session — creation details
    'session.creationParams': 'Creation Params',
    'session.maxTurnsLabel': 'Max Turns',
    'session.approve': 'Approve',
    'session.initialPrompt': 'Initial Prompt',

    // Session — live status helpers
    'session.status.processing': 'Processing…',
    'session.status.reading': 'Reading {file}…',
    'session.status.modifying': 'Modifying {file}…',
    'session.status.executing': 'Executing {cmd}…',
    'session.status.analyzing': 'Analyzing…',
    'session.status.roundDone': 'Round complete',

    // New Session modal
    'newSession.title': 'New Session',
    'newSession.choosePreset': 'Choose a scenario preset.',
    'newSession.desc': 'Create an assistant collaboration session.',
    'newSession.noAgents': 'No API assistants configured yet.',
    'newSession.addOneFirst': 'Add one first',
    'newSession.templateBadge': 'Template: {name}',
    'newSession.agentA': 'Agent A',
    'newSession.agentB': 'Agent B',
    'newSession.agentBHint': 'executor; needs filesystem for cwd',
    'newSession.mode': 'Mode',
    'newSession.mode.collaborate': 'Collaboration',
    'newSession.mode.discuss': 'Discuss',
    'newSession.mode.review': 'Review',
    'newSession.mode.freeform': 'Freeform',
    'newSession.maxTurns': 'Max Turns',
    'newSession.systemPromptA': 'Agent A System Prompt',
    'newSession.systemPromptB': 'Agent B System Prompt',
    'newSession.workingDir': 'Working Directory',
    'newSession.workingDirPlaceholder': '/path/to/project',
    'newSession.permissionMode': 'Permission mode',
    'newSession.permissionSafe': 'Safe',
    'newSession.permissionTrusted': 'Trusted · skip CLI approvals',
    'newSession.prompt': 'Prompt',
    'newSession.promptPlaceholder': 'Describe the session…',
    'newSession.context': 'Context',
    'newSession.contextRules': 'Rules / Constraints',
    'newSession.contextBackground': 'Background',
    'newSession.contextFiles': 'Files',
    'newSession.contextFilesPlaceholder': 'src/web/app.js, src/web/style.css',
    'newSession.approveMode': 'Approve mode',
    'newSession.back': 'Back',
    'newSession.create': 'Create',

    // Workflows
    'wf_title': 'Workflows',
    'wf_new': '+ New Workflow',
    'wf_recent': 'Recent Workflows',
    'wf_empty': 'No workflows yet. Create your first one!',
    'wf_untitled': 'Untitled workflow',
    'wf_steps': '{count} steps',
    'wf_created': 'Created {time}',
    'wf_loading': 'Loading…',
    'wf_load_more': 'Load more workflows',
    'wf_not_found': 'Workflow not found',
    'wf_back': '← Back',
    'wf_ask_ops': 'Ask Ops',
    'wf_pause': '⏸ Pause',
    'wf_resume': '▶ Resume',
    'wf_delete': 'Delete',
    'wf_status_pending': 'Pending',
    'wf_status_active': 'Active',
    'wf_status_paused': 'Paused',
    'wf_status_done': 'Completed',
    'wf_status_error': 'Error',
    'wf_status_stopped': 'Stopped',
    'wf_step': 'Step {number}',
    'wf_step_title': 'Step {number}: {title}',
    'wf_rounds': '{current}{max} rounds',
    'wf_rounds_max': ' / {max}',
    'wf_depends_on': 'Depends on Step {steps}',
    'wf_last_output': 'Last output: {status}',
    'wf_approve_save': '✓ Approve and save',
    'wf_execute_step': '✓ Run Step {number}',
    'wf_rerun_step': '↻ Rerun this step',
    'wf_manual_artifacts': '◎ Backfill images from main process',
    'wf_request_changes': '✎ Request upstream changes',
    'wf_output': 'OUTPUT',
    'wf_versions': 'Versions {count}',
    'wf_copy': 'Copy',
    'wf_generated_files': 'Generated Files [{count}]',
    'wf_hide_conversation': '▾ Hide Conversation',
    'wf_view_conversation': '▸ View Full Conversation',
    'wf_live_status_busy': 'AI is processing...',
    'wf_live_status_ready': 'Ready for feedback',
    'wf_live_status_modifying': 'AI is editing...',
    'wf_live_title': 'Keep editing the current artifact',
    'wf_live_draft': 'Current draft',
    'wf_history_count': '{count} historical versions',
    'wf_live_empty_output': 'This step has no reviewable output yet.',
    'wf_live_empty_thread': 'Say what you want changed, and AI will update the current draft.',
    'wf_live_placeholder': 'Example: make the opening faster, and rewrite the third sentence more naturally...',
    'wf_speech_unsupported': 'Speech recognition is not supported in this browser',
    'wf_voice_input': 'Voice input',
    'wf_send_modify': 'Send and edit',
    'wf_live_footer': 'Each send saves the current version first; downstream steps reset when artifacts change.',
    'wf_end_review': 'End review',
    'wf_approve_current': 'Approve current version',
    'wf_execute_current': 'Run current step',
    'wf_terminal_copy': 'COPY',
    'wf_generated_files_upper': 'GENERATED_FILES',
    'wf_content_upper': 'CONTENT',
    'wf_file_role_file': 'File',
    'wf_file_role_storyboard': 'Storyboard image',
    'wf_file_role_character': 'Character reference',
    'wf_file_role_prompt': 'Generation prompt',
    'wf_file_role_script': 'Shooting script',
    'wf_file_role_reference': 'Reference asset',
    'wf_file_role_command': 'Video generation command',
    'wf_file_role_image': 'Image asset',
    'wf_file_role_video': 'Video file',
    'wf_file_role_text': 'Text file',
    'wf_file_missing': 'File missing',
    'wf_file_checking': 'Checking',
    'wf_copied': 'Copied',
    'wf_copy_failed': 'Copy failed',
    'wf_versions_title': 'Version History',
    'wf_versions_empty': 'No version history yet',
    'wf_referenced_files': 'Referenced Files [{count}]',
    'wf_no_messages': 'No messages yet',
    'wf_turn': 'Turn {round}',
    'wf_timeline': 'Timeline',
    'wf_timeline_created': 'Created',
    'wf_timeline_updated': 'Updated',
    'wf_modal_title': 'New Workflow',
    'wf_modal_desc': 'Create a multi-step agent pipeline.',
    'wf_modal_close': 'Close',
    'wf_modal_no_agents': 'No API assistants configured yet.',
    'wf_modal_add_one': 'Add one first',
    'wf_template': 'Template',
    'wf_custom_workflow': 'Custom workflow',
    'wf_template_mine': 'mine',
    'wf_pipeline_name': 'Pipeline name',
    'wf_pipeline_placeholder': 'Release workflow',
    'wf_input': 'Workflow input',
    'wf_input_placeholder': 'Paste the reference video notes, source copy, or brief for this run...',
    'wf_start_from_step': 'Start from step',
    'wf_start_from_step_hint': 'Steps before this number are kept in the workflow and marked as manually completed.',
    'wf_steps_title': 'Steps',
    'wf_add_step': '+ Add Step',
    'wf_cancel': 'Cancel',
    'wf_save_template': 'Save as Template',
    'wf_delete_template': 'Delete Template',
    'wf_create': 'Create',
    'wf_remove': 'Remove',
    'wf_step_name': 'Step name',
    'wf_step_name_placeholder': 'Adapt copy',
    'wf_node_type': 'Node Type',
    'wf_primary_agent': 'Primary Agent',
    'wf_inputs': 'Inputs',
    'wf_output_files': 'Output Files',
    'wf_required_sections': 'Required Sections',
    'wf_required_sections_placeholder': 'Adapted copy, adaptation notes, self-check',
    'wf_advanced': 'Advanced',
    'wf_prompt': 'Prompt',
    'wf_prompt_placeholder': 'Describe this step...',
    'wf_working_dir': 'Working Directory',
    'wf_output_dir': 'Output Directory',
    'wf_pause_before_step': 'Pause before this step and require manual approval',
    'wf_depends_on_label': 'Depends on',
    'wf_input_prefix': 'Input for this run:',
    'wf_pipeline_name_required': 'Pipeline name is required',
    'wf_template_saved': 'Template saved',
    'wf_template_deleted': 'Template deleted',
    'wf_confirm_rerun_title': 'Rerun Step',
    'wf_confirm_rerun_message': 'Rerun {title}? Artifacts after this step will be reset.',
    'wf_confirm_rerun_current': 'current step',
    'wf_confirm_rerun_confirm': 'Rerun',
    'wf_speech_failed': 'Speech recognition failed: {error}',
    'wf_insert_message_title': 'Insert Message: {title}',
    'wf_current_step': 'current step',
    'wf_message_content': 'Message content',
    'wf_message_placeholder': 'Add instructions or change requests for this step...',
    'wf_message_hint': 'Submitting writes a human message to this step and resumes it; downstream steps reset by dependency.',
    'wf_send': 'Send',
    'wf_manual_title': 'Backfill Images from Main Process: {title}',
    'wf_local_paths': 'Local file paths',
    'wf_manual_hint': 'After Codex main process generates images and saves them locally, paste paths here; submit validates the files, marks this step complete, and activates downstream steps.',
    'wf_result_summary': 'Result summary',
    'wf_result_summary_placeholder': 'Example: Codex main process generated storyboard and character turnaround images',
    'wf_manual_submit': 'Backfill and complete this step',
    'wf_request_changes_title': 'Request Upstream Artifact Changes',
    'wf_target_step': 'Step to change',
    'wf_request_changes_hint': 'You can roll back and edit any artifact before the current step; the current version is saved before submitting.',
    'wf_change_request': 'Change request',
    'wf_change_placeholder': 'Explain what failed and what you want changed...',
    'wf_submit_changes': 'Submit changes',
    'wf_confirm_delete_title': 'Delete Workflow',
    'wf_confirm_delete_message': 'Delete this workflow permanently?',
    'wf_confirm_delete_confirm': 'Delete',
    'wf_node_video_parse': 'Parse video',
    'wf_node_copy_adapt': 'Adapt copy',
    'wf_node_storyboard_script': 'Generate storyboard script',
    'wf_node_image_generate': 'Generate visual assets',
    'wf_node_video_command': 'Prepare video command',
    'wf_node_video_generate': 'Generate video',
    'wf_node_human_review': 'Human review',
    'wf_node_custom': 'Custom',
    'wf_sections_video_parse': 'video copy/transcript, topic brief, reusable structure',
    'wf_sections_copy_adapt': 'source input, adapted copy, adaptation notes, self-check',
    'wf_sections_storyboard_script': 'storyboard',
    'wf_sections_video_command': 'commands, input files, output path',

    // Ops panel
    'ops_intro': 'I can check platform issues, explain why tasks are stuck, and suggest fixes.',
    'ops_title': 'Platform Steward',
    'ops_model_label': 'Model',
    'ops_model_missing': 'No Ops LLM available. Configure one here.',
    'ops_model_using': 'Using {model}',
    'ops_model_fallback': 'Fallback: {model}',
    'ops_model_edit': 'Edit',
    'ops_model_clear': 'Clear',
    'ops_model_save': 'Save',
    'ops_model_verify': 'Verify',
    'ops_model_adapter': 'Adapter',
    'ops_model_model': 'Model name',
    'ops_model_base_url': 'Base URL',
    'ops_model_api_key': 'API key',
    'ops_model_keep_key': 'Leave blank to keep current key',
    'ops_model_saved': 'Ops model saved',
    'ops_model_cleared': 'Ops model cleared',
    'ops_global_check': 'Global check',
    'ops_current_page_check': 'Check current page',
    'ops_global_question': 'What is wrong with the platform right now?',
    'ops_user_role': 'You',
    'ops_diagnosing': 'Diagnosing...',
    'ops_placeholder': 'Ask: why is this task stuck?',
    'ops_send': 'Send',
    'ops_current_target_question': 'Check whether the current {kind} has issues',
    'ops_current_page_question': 'Check whether the current page has issues: {title}',
    'ops_current_page': 'current page',
    'ops_diagnose_failed': 'Diagnosis failed: {message}',
    'ops_answer_source': 'Answered by {source}',
    'ops_done': 'Diagnosis complete.',
    'ops_critical': 'Critical: {count}',
    'ops_warning': 'Warnings: {count}',
    'ops_info': 'Info: {count}',
    'ops_priority': 'Priority fixes:',
    'ops_issue_target': '({kind} {id})',
    'ops_recommendation': 'Recommendation: {text}',
    'ops_llm_missing': 'LLM unavailable: {error}',
    'ops_confirm_execute': '{label}\n\n{description}\n\nConfirm execution?',
    'ops_action_failed': 'Action failed: {message}',
    'ops_action_task_done': 'Executed {action}, Task: {id}',
    'ops_action_session_done': 'Executed {action}, Session: {id}',
    'ops_action_workflow_done': 'Executed {action}, Workflow: {id}',
    'ops_action_done': 'Executed {action}.',

    // Landing page
    'landing_nav_features': 'Features',
    'landing_nav_architecture': 'Architecture',
    'landing_nav_sessions': 'Sessions',
    'landing_nav_get_started': 'Get Started',
    'landing_badge': 'Local-first open source',
    'landing_hero_title_prefix': 'Pass tasks between',
    'landing_hero_title_highlight': 'your AI agents',
    'landing_hero_sub': 'Run Passiton on your machine with your CLI agents and API keys. When one agent hits quota, times out, or stops, hand the task to another with workspace state attached.',
    'landing_hero_get_started': 'Start locally',
    'landing_hero_sign_in': 'Sign In',
    'landing_arch_title': 'How it works',
    'landing_arch_sub': 'Agent A ↔ Passiton ↔ Agent B — local routing for multi-agent work',
    'landing_arch_center_sub': 'Routing · handoff · state',
    'landing_zhipu_api': 'Zhipu API',
    'landing_features_title': 'Why Passiton',
    'landing_features_sub': 'A local control plane for agents you already use',
    'landing_feature_orchestration_title': 'Agent handoff',
    'landing_feature_orchestration_body': 'Continue failed or stopped tasks with another ready agent, including prior output and workspace state when available.',
    'landing_feature_keys_title': 'Use your own keys',
    'landing_feature_keys_body': 'Connect Anthropic, OpenAI, Zhipu, and other providers directly. Keep provider choice and model access under your control.',
    'landing_feature_billing_title': 'Free and open source',
    'landing_feature_billing_body': 'No hosted meter or subscription. Run it locally, inspect the code, and pay only your own providers when you use API models.',
    'landing_cta_title': 'Run your first local task',
    'landing_cta_sub': 'Install, add a discovered agent, and create a task from the local web UI.',
    'landing_cta_button': 'Open Passiton',
    'landing_footer': '© 2026 Passiton. All rights reserved.',

    // Login page
    'login_tagline': 'Agent Sessions Platform',
    'login_intro': 'Sign in with your existing local account.',
    'login_email': 'Email',
    'login_password': 'Password',
    'login_submit': 'Login',
    'login_local': 'Continue as Local User',

    // FormatTime relative labels
    'time.justNow': 'just now',
    'time.minAgo': '{n} min ago',
    'time.hrAgo': '{n} hr ago',
    'time.dayAgo': '{n} day ago',
    'time.daysAgo': '{n} days ago',
  },

  zh: {
    // Navigation
    'nav.sessions': 'Sessions',
    'nav.tasks': 'Tasks',
    'nav.workflows': 'Workflows',
    'nav.settings': 'Settings',
    'nav.apiDocs': 'API 文档',

    // Settings — tabs
    'settings.tab.apiAssistants': 'API 助手',
    'settings.tab.providerKeys': '供应商密钥',
    'settings.tab.agents': 'Agent',
    'settings.tab.diagnostics': '诊断',
    'settings.tab.apiDocs': 'API 文档',
    'settings.tab.general': '通用',

    // Settings — API Assistants
    'settings.agents.title': 'API 助手',
    'settings.agents.desc': '管理 AI 模型连接',
    'settings.agents.add': '+ 添加助手',
    'settings.agents.empty': '暂无 API 助手',
    'settings.agents.verify': '验证',
    'settings.agents.edit': '编辑',
    'settings.agents.delete': '删除',

    // Settings — Provider Keys
    'settings.keys.title': '供应商密钥',
    'settings.keys.desc': '管理 API 助手和会话使用的密钥',
    'settings.keys.add': '+ 添加密钥',
    'settings.keys.empty': '暂无供应商密钥',

    // Settings — Local CLI Agents
    'settings.localCli.title': '本地 CLI 代理',
    'settings.localCli.desc': '已在本机发现；添加你想在会话中使用的代理',
    'settings.localCli.empty': '暂无可用的本地 CLI 代理',
    'settings.localCli.emptyCustom': '本机没有自动发现代理。你可以用命令和参数添加任意 CLI 代理。',
    'settings.localCli.addCustom': '+ 添加自定义代理',
    'settings.localCli.add': '添加',
    'settings.localCli.diagnose': '诊断',
    'settings.localCli.priority': '优先级',
    'settings.localCli.priorityHelp': '数字越小越优先',
    'settings.localCli.moveUp': '上移',
    'settings.localCli.moveDown': '下移',

    // Settings — Agents tab extras
    'settings.agents.workspacesHint': '安全边界：CLI 代理可操作的目录范围',
    'settings.diagnostics.title': '诊断',
    'settings.diagnostics.desc': '检查部署和 CLI 代理运行状态',
    'settings.diagnostics.refresh': '刷新',
    'settings.diagnostics.deployment': '部署',
    'settings.diagnostics.notChecked': '未检查',
    'settings.diagnostics.run': '运行',

    // Settings — API Docs
    'settings.apiDocs.title': '会话 HTTP API',

    // Settings — General
    'settings.general.title': '通用设置',
    'settings.general.maxTurns': '默认最大轮次',
    'settings.general.mode': '默认模式',
    'settings.general.mode.collaborate': '协作',
    'settings.general.mode.discuss': '讨论',
    'settings.general.mode.review': '审查',
    'settings.general.mode.freeform': '自由',
    'settings.general.workspaces': '允许的工作区',
    'settings.general.workspacesPlaceholder': '/home/me/projects\n/Users/me/Projects',
    'settings.general.save': '保存设置',
    'settings.general.language': '语言',
    'settings.general.language.en': 'English',
    'settings.general.language.zh': '中文',

    // Agent diagnostics modal
    'modal.agentDiagnostics.title': '代理诊断',
    'modal.agentDiagnostics.running': '正在诊断…',
    'modal.agentDiagnostics.runningDesc': '正在检查命令、版本、认证并执行一次真实模型调用，最长可能需要 45 秒。',
    'modal.agentDiagnostics.failed': '诊断失败',
    'modal.agentDiagnostics.ready': 'Agent 已可用',
    'modal.agentDiagnostics.notReady': 'Agent 尚不可用',
    'modal.agentDiagnostics.commandCheck': '找到命令',
    'modal.agentDiagnostics.versionCheck': '版本检查',
    'modal.agentDiagnostics.modelCheck': '真实模型调用',
    'modal.agentDiagnostics.passed': '通过',
    'modal.agentDiagnostics.notRun': '未执行',
    'modal.agentDiagnostics.details': '技术详情',

    // Edit Local CLI Agent modal
    'modal.localCli.edit.title': '编辑本地 CLI 代理',
    'modal.customCli.add.title': '添加自定义 CLI 代理',
    'modal.customCli.desc': '运行任意本地 CLI 命令。{prompt} 会替换为任务提示词。',
    'modal.customCli.commandPlaceholder': '/usr/local/bin/aider 或 aider',
    'modal.customCli.argsHelp': '每行一个参数。必须包含 {prompt}，用于插入任务提示词。',
    'modal.customCli.argsPlaceholder': '--message\n{prompt}',
    'modal.customCli.envHelp': '可选，KEY=VALUE 每行一个。',
    'modal.customCli.timeoutHelp': '可选，毫秒级空闲超时。',

    // Add/Edit Assistant modal
    'modal.agent.add': '添加助手',
    'modal.agent.edit': '编辑助手',
    'modal.agent.desc': '配置 API 支持的模型。',
    'modal.agent.baseUrl': '基础 URL',
    'modal.agent.providerKey': '供应商密钥',
    'modal.agent.keyRequired': '必填',
    'modal.agent.keyOptional': '可选覆盖',

    // Add Provider Key modal
    'modal.key.title': '添加供应商密钥',
    'modal.key.desc': '加密存储在本地密钥库中。',
    'modal.key.namePlaceholder': '工作密钥',

    // Common form labels
    'common.name': '名称',
    'common.provider': '供应商',
    'common.model': '模型',
    'common.adapter': '适配器',
    'common.command': '命令',
    'common.args': '参数',
    'common.timeout': '超时 (毫秒)',
    'common.env': '环境变量',
    'common.apiKey': 'API 密钥',
    'common.close': '关闭',
    'common.cancel': '取消',
    'common.save': '保存',

    // Status labels
    'status.ready': '可用',
    'status.unverified': '未验证',
    'status.discovered': '已发现',
    'status.no_key': '缺 Key',
    'status.invalid': '不可用',

    // Key source labels
    'keySource.vault': '已保存密钥',
    'keySource.assistant': '代理密钥',
    'keySource.global': '全局配置',

    // Badge labels
    'badge.linked': '已关联',
    'badge.ok': '正常',
    'badge.unknown': '未知',

    // Toast messages
    'toast.settingsSaved': '设置保存成功',
    'toast.assistantSaved': '助手已保存',
    'toast.assistantDeleted': '助手已删除',
    'toast.keyAdded': '供应商密钥已添加',
    'toast.keyDeleted': '供应商密钥已删除',
    'toast.localCliAdded': '「{name}」已添加到已配置列表',
    'toast.localCliSaved': '「{name}」已保存',
    'toast.localCliRemoved': '「{name}」已移除',
    'toast.agentValidationFailed': '代理已保存但验证失败。',
    'toast.languageChanged': '语言已切换为 {lang}',

    // Confirm dialogs
    'confirm.deleteAgent.title': '删除助手',
    'confirm.deleteAgent.message': '删除助手「{name}」？',
    'confirm.deleteAgent.confirm': '删除',
    'confirm.deleteKey.title': '删除 API 密钥',
    'confirm.deleteKey.message': '删除此 API 密钥？',
    'confirm.deleteKey.confirm': '删除',
    'confirm.deleteLocalCli.title': '移除本地 CLI 代理',
    'confirm.deleteLocalCli.message': '从会话中移除本地 CLI 代理「{name}」？',
    'confirm.deleteLocalCli.confirm': '移除',

    // Session status labels
    'session.status.active': '进行中',
    'session.status.paused': '已暂停',
    'session.status.done': '已完成',
    'session.status.error': '错误',
    'session.status.cancelled': '已取消',

    // Sessions — list page
    'sessions.title': 'Sessions',
    'sessions.newSession': '+ 新建会话',
    'sessions.stat.active': '活跃会话',
    'sessions.stat.activeSub': '正在运行',
    'sessions.stat.completed': '今日完成',
    'sessions.stat.completedSub': '↑ 较昨日',
    'sessions.stat.avgTurns': '平均轮次',
    'sessions.stat.avgTurnsSub': '全部会话',
    'sessions.stat.activeAgents': '活跃 Agent',
    'sessions.stat.activeAgentsSub': '已配置的供应商',
    'sessions.recentTitle': '最近会话',
    'sessions.searchPlaceholder': '搜索会话…',
    'sessions.loading': '加载中…',
    'sessions.back': '← 返回',
    'sessions.turns': '{count} 轮',
    'sessions.delete': '删除',

    // Tasks
    'task_title': '任务',
    'task_new': '+ 新建任务',
    'task_stat_running': '运行中的任务',
    'task_stat_running_sub': '正在运行',
    'task_stat_queued': '排队中',
    'task_stat_queued_sub': '等待开始',
    'task_stat_completed': '已完成',
    'task_stat_completed_sub': '主 Agent 任务',
    'task_stat_failed': '失败',
    'task_stat_failed_sub': '需要处理',
    'task_recent_title': '最近任务',
    'task_empty': '暂无任务。创建第一个任务吧！',
    'task_running_elapsed': '运行 {duration}',
    'task_load_more': '加载更多任务',
    'task_loading': '加载中…',
    'task_not_found': '任务未找到',
    'task_untitled': '未命名任务',
    'task_back': '← 返回',
    'task_ask_ops': 'Ask Ops',
    'task_stop': '■ 停止',
    'task_restart': '↻ 重启',
    'task_feedback_rerun': '✎ 反馈并重跑',
    'task_status_running': '运行中',
    'task_status_queued': '排队中',
    'task_status_done': '已完成',
    'task_status_error': '失败',
    'task_status_cancelled': '已取消',
    'task_section_prompt': 'PROMPT',
    'task_section_result': '结果',
    'task_section_full_output': '完整输出',
    'task_section_error_title': '任务错误',
    'task_info': '任务信息',
    'task_info_id': '任务 ID',
    'task_info_agent': 'Agent',
    'task_info_status': '状态',
    'task_info_created': '创建于',
    'task_info_started': '开始于',
    'task_info_finished': '完成于',
    'task_info_cwd': '工作目录',
    'task_commits_title': '任务期间的提交',
    'task_live_output': '实时输出',
    'task_live_output_waiting': '等待输出…',
    'task_creation_params': '创建参数',
    'task_agent': 'Agent',
    'task_cwd': '工作目录',
    'task_prompt': '提示词',
    'task_system_prompt': '系统提示词',
    'task_context_rules': '规则',
    'task_context_text': '文本',
    'task_context_unnamed_file': '未命名文件',
    'task_workspace_preexisting_only': '工作区在此任务开始前已有未提交文件。',
    'task_workspace_view_files': '查看 {count} 个预先存在的文件',
    'task_workspace_preexisting_extra': '另有 {count} 个预先存在的文件',
    'task_workspace_changed_unfinished': '任务失败前修改了 {count} 个文件。',
    'task_workspace_changed_unfinished_simple': '此失败任务后工作区有 {count} 个已修改文件。',
    'task_workspace_view_changes': '查看变更',
    'task_workspace_check': '任务失败。重跑前请检查工作区 {cwd}。',
    'task_status_processing': '处理中…',
    'task_status_reading': '正在读取 {file}…',
    'task_status_modifying': '正在修改 {file}…',
    'task_status_executing': '正在执行 {cmd}…',
    'task_status_analyzing': '正在分析…',

    // New Task modal
    'task_modal_title': '新建任务',
    'task_modal_desc': '分配一个主 Agent 来运行工作流。',
    'task_modal_no_agents': '暂无已配置的助手。',
    'task_modal_add_one': '先添加一个',
    'task_modal_auto_agent': '自动（最高优先级）',
    'task_modal_working_dir': '工作目录',
    'task_modal_working_dir_placeholder': '/path/to/project',
    'task_modal_prompt_placeholder': '描述任务...',
    'task_modal_context': '上下文',
    'task_modal_rules': '规则 / 约束',
    'task_modal_background': '背景',
    'task_modal_files': '文件',
    'task_modal_files_placeholder': 'docs/brief.md, src/index.ts',
    'task_modal_system_prompt_placeholder': '可选覆盖',
    'task_modal_create': '创建',
    'task_modal_cwd_requires_filesystem': '设置工作目录需要支持文件系统的本地 CLI Agent',

    // Task feedback modal
    'task_feedback_title': '反馈并重跑',
    'task_feedback_desc': '基于这次结果和你的反馈创建一个新任务。',
    'task_feedback_label': '反馈',
    'task_feedback_placeholder': '希望 Agent 修改什么或下一步尝试什么？',
    'task_feedback_create_new': '创建新任务',
    'task_feedback_creating': '创建中…',
    'handoff_button': '换个 Agent 继续',
    'handoff_title': '继续任务',
    'handoff_desc': '基于这次停止或失败的尝试创建一个继续任务。',
    'handoff_agent': 'Agent',
    'handoff_no_agents': '没有兼容的任务 Agent。',
    'handoff_create': '继续',
    'handoff_creating': '创建中…',
    'handoff_source': '继续自',
    'handoff_continued_from': '继续自 {id}',

    // Sessions — onboarding
    'sessions.onboarding.ready': '一切就绪',
    'sessions.onboarding.readyDesc': '已有 <strong>{count}</strong> 个可用的 Agent。开始你的第一个会话吧。',
    'sessions.onboarding.manageAgents': '管理 Agent',
    'sessions.onboarding.welcome': '欢迎使用 Passiton',
    'sessions.onboarding.welcomeDesc': '开始前需要先连接一个 AI 模型。下面两条路任选其一：',
    'sessions.onboarding.apiModel': '用 API 模型（最快）',
    'sessions.onboarding.apiModelDesc': '填一个 Provider Key 即可，无需安装任何东西。支持 Anthropic、OpenAI、智谱、DeepSeek、Qwen、Moonshot。',
    'sessions.onboarding.addApiKey': '添加 API Key',
    'sessions.onboarding.localCli': '用本地 CLI Agent',
    'sessions.onboarding.localCliDesc': '已装好 Codex / Claude Code / Gemini CLI / OpenCode？确认它们在 PATH 里，系统会自动发现。',
    'sessions.onboarding.viewDiscovered': '查看已发现的 Agent',
    'sessions.onboarding.settingsHint': '在 Settings 页可以随时增删 Agent 和 Key。',
    'sessions.onboarding.unverifiedTitle': 'Agent 尚未验证可用',
    'sessions.onboarding.unverifiedDesc': '检测到 <strong>{apiCount}</strong> 个 API Agent、<strong>{cliCount}</strong> 个 CLI Agent，但没有一个确认能调通模型。',
    'sessions.onboarding.unverifiedHint': '常见原因：未登录、凭证失效、订阅过期或二进制路径不对。重新检测或去 Settings 检查配置。',
    'sessions.onboarding.retest': '重新检测',
    'sessions.onboarding.goToSettings': '去 Settings 检查',

    // Session detail — header & actions
    'session.askOps': 'Ask Ops',
    'session.export': '导出',
    'session.extend': '+5m',
    'session.pause': '⏸ 暂停',
    'session.resume': '▶ 恢复',
    'session.retry': '↻ 从错误中重试',
    'session.stop': '■ 停止',
    'session.waitingOutput': '等待输出…',
    'session.idle': '空闲',
    'session.injectPlaceholder': '向会话注入消息…',
    'session.send': '发送',
    'session.rawToggleHide': '隐藏原始输出',
    'session.rawToggleShow': '显示原始输出',
    'session.scrollTop': '跳到开头',
    'session.scrollBottom': '跳到结尾',
    'session.copy': '复制',
    'session.noMessages': '暂无消息',

    // Session detail — panel
    'session.info': '会话信息',
    'session.idLabel': '会话 ID',
    'session.agentA': 'Agent A',
    'session.agentB': 'Agent B',
    'session.mode': '模式',
    'session.template': '模板',
    'session.turnsLabel': '轮次',
    'session.statusLabel': '状态',
    'session.permission': '权限',
    'session.created': '创建于',
    'session.cwd': '工作目录',
    'session.progress': '进度',
    'session.turnOf': '第 {round} / {max} 轮',
    'session.errorTitle': '会话错误',
    'session.lastOutput': '最近 Agent 输出',
    'session.start': '开始',
    'session.turn': '第 {round} 轮',

    // Session — artifacts
    'session.artifact.noSummary': '暂无摘要',
    'session.artifact.title': '产出',
    'session.artifact.fileChanges': '📄 文件变更',
    'session.artifact.summary': '📋 摘要',
    'session.artifact.copySummary': '复制摘要',
    'session.artifact.collapseDiff': '收起完整 Diff',
    'session.artifact.viewDiff': '查看完整 Diff',

    // Session — step card
    'session.step.collapse': '收起详情',
    'session.step.expand': '展开详情',

    // Session — toast
    'session.toast.summaryCopied': '摘要已复制',
    'session.toast.copyFailed': '复制失败',

    // Session — confirm dialogs
    'session.confirm.stop.title': '停止会话',
    'session.confirm.stop.message': '确定要停止此会话？',
    'session.confirm.stop.confirm': '停止',
    'session.confirm.delete.title': '删除会话',
    'session.confirm.delete.message': '确定要永久删除此会话？',
    'session.confirm.delete.confirm': '删除',

    // Session — toasts
    'session.toast.timeoutExtended': '超时已延长 +{n}m',
    'session.toast.cwdRequiresFilesystem': '设置工作目录需要 Agent B 为支持文件系统的本地 CLI 代理',

    // Session — creation details
    'session.creationParams': '创建参数',
    'session.maxTurnsLabel': '最大轮次',
    'session.approve': '审批',
    'session.initialPrompt': '初始提示词',

    // Session — live status helpers
    'session.status.processing': '处理中…',
    'session.status.reading': '正在读取 {file}…',
    'session.status.modifying': '正在修改 {file}…',
    'session.status.executing': '正在执行 {cmd}…',
    'session.status.analyzing': '正在分析…',
    'session.status.roundDone': '已完成本轮输出',

    // New Session modal
    'newSession.title': '新建会话',
    'newSession.choosePreset': '选择一个场景预设。',
    'newSession.desc': '创建一个 AI 助手协作会话。',
    'newSession.noAgents': '暂无已配置的 API 助手。',
    'newSession.addOneFirst': '先添加一个',
    'newSession.templateBadge': '模板：{name}',
    'newSession.agentA': 'Agent A',
    'newSession.agentB': 'Agent B',
    'newSession.agentBHint': '执行者；需要文件系统支持',
    'newSession.mode': '模式',
    'newSession.mode.collaborate': '协作',
    'newSession.mode.discuss': '讨论',
    'newSession.mode.review': '审查',
    'newSession.mode.freeform': '自由',
    'newSession.maxTurns': '最大轮次',
    'newSession.systemPromptA': 'Agent A 系统提示词',
    'newSession.systemPromptB': 'Agent B 系统提示词',
    'newSession.workingDir': '工作目录',
    'newSession.workingDirPlaceholder': '/path/to/project',
    'newSession.permissionMode': '权限模式',
    'newSession.permissionSafe': '安全',
    'newSession.permissionTrusted': '信任 · 跳过 CLI 审批',
    'newSession.prompt': '提示词',
    'newSession.promptPlaceholder': '描述会话…',
    'newSession.context': '上下文',
    'newSession.contextRules': '规则 / 约束',
    'newSession.contextBackground': '背景',
    'newSession.contextFiles': '文件',
    'newSession.contextFilesPlaceholder': 'src/web/app.js, src/web/style.css',
    'newSession.approveMode': '审批模式',
    'newSession.back': '返回',
    'newSession.create': '创建',

    // Workflows
    'wf_title': 'Workflows',
    'wf_new': '+ 新建工作流',
    'wf_recent': '最近工作流',
    'wf_empty': '暂无工作流。创建第一个工作流吧！',
    'wf_untitled': '未命名工作流',
    'wf_steps': '{count} 步',
    'wf_created': '创建于 {time}',
    'wf_loading': '加载中…',
    'wf_load_more': '加载更多工作流',
    'wf_not_found': '工作流未找到',
    'wf_back': '← 返回',
    'wf_ask_ops': 'Ask Ops',
    'wf_pause': '⏸ 暂停',
    'wf_resume': '▶ 恢复',
    'wf_delete': '删除',
    'wf_status_pending': '待开始',
    'wf_status_active': '进行中',
    'wf_status_paused': '已暂停',
    'wf_status_done': '已完成',
    'wf_status_error': '错误',
    'wf_status_stopped': '已停止',
    'wf_step': 'Step {number}',
    'wf_step_title': 'Step {number}：{title}',
    'wf_rounds': '{current}{max} 轮',
    'wf_rounds_max': ' / {max}',
    'wf_depends_on': '依赖 Step {steps}',
    'wf_last_output': '最后输出：{status}',
    'wf_approve_save': '✓ 通过，确认保存',
    'wf_execute_step': '✓ 执行 Step {number}',
    'wf_rerun_step': '↻ 重跑本步骤',
    'wf_manual_artifacts': '◎ 主进程补图回填',
    'wf_request_changes': '✎ 要求修改上游产物',
    'wf_output': 'OUTPUT',
    'wf_versions': 'Versions {count}',
    'wf_copy': 'Copy',
    'wf_generated_files': 'Generated Files [{count}]',
    'wf_hide_conversation': '▾ Hide Conversation',
    'wf_view_conversation': '▸ View Full Conversation',
    'wf_live_status_busy': 'AI 正在处理...',
    'wf_live_status_ready': '可以继续反馈',
    'wf_live_status_modifying': 'AI 正在修改...',
    'wf_live_title': '围绕当前产物连续修改',
    'wf_live_draft': '当前草稿',
    'wf_history_count': '{count} 个历史版本',
    'wf_live_empty_output': '本步骤还没有可审阅的输出。',
    'wf_live_empty_thread': '说出你希望修改的地方，AI 会更新当前草稿。',
    'wf_live_placeholder': '例如：开头再快一点，第三句换成更生活化的表达...',
    'wf_speech_unsupported': '当前浏览器不支持语音识别',
    'wf_voice_input': '语音输入',
    'wf_send_modify': '发送并修改',
    'wf_live_footer': '每次发送前会自动保存当前版本；后续步骤会在产物变化后重置。',
    'wf_end_review': '结束审阅',
    'wf_approve_current': '通过当前版本',
    'wf_execute_current': '执行当前步骤',
    'wf_terminal_copy': 'COPY',
    'wf_generated_files_upper': 'GENERATED_FILES',
    'wf_content_upper': 'CONTENT',
    'wf_file_role_file': '文件',
    'wf_file_role_storyboard': '故事板分镜图',
    'wf_file_role_character': '角色参考图',
    'wf_file_role_prompt': '生成提示词',
    'wf_file_role_script': '拍摄脚本',
    'wf_file_role_reference': '参考素材',
    'wf_file_role_command': '视频生成命令',
    'wf_file_role_image': '图片素材',
    'wf_file_role_video': '视频文件',
    'wf_file_role_text': '文本文件',
    'wf_file_missing': '文件不存在',
    'wf_file_checking': '正在检查',
    'wf_copied': '已复制',
    'wf_copy_failed': '复制失败',
    'wf_versions_title': '版本记录',
    'wf_versions_empty': '暂无版本记录',
    'wf_referenced_files': 'Referenced Files [{count}]',
    'wf_no_messages': 'No messages yet',
    'wf_turn': 'Turn {round}',
    'wf_timeline': 'Timeline',
    'wf_timeline_created': 'Created',
    'wf_timeline_updated': 'Updated',
    'wf_modal_title': 'New Workflow',
    'wf_modal_desc': 'Create a multi-step agent pipeline.',
    'wf_modal_close': 'Close',
    'wf_modal_no_agents': 'No API assistants configured yet.',
    'wf_modal_add_one': 'Add one first',
    'wf_template': 'Template',
    'wf_custom_workflow': 'Custom workflow',
    'wf_template_mine': 'mine',
    'wf_pipeline_name': 'Pipeline name',
    'wf_pipeline_placeholder': 'Release workflow',
    'wf_input': 'Workflow input',
    'wf_input_placeholder': 'Paste the reference video notes, source copy, or brief for this run...',
    'wf_start_from_step': 'Start from step',
    'wf_start_from_step_hint': 'Steps before this number are kept in the workflow and marked as manually completed.',
    'wf_steps_title': 'Steps',
    'wf_add_step': '+ Add Step',
    'wf_cancel': 'Cancel',
    'wf_save_template': 'Save as Template',
    'wf_delete_template': 'Delete Template',
    'wf_create': 'Create',
    'wf_remove': 'Remove',
    'wf_step_name': 'Step name',
    'wf_step_name_placeholder': '改编文案',
    'wf_node_type': 'Node Type',
    'wf_primary_agent': 'Primary Agent',
    'wf_inputs': 'Inputs',
    'wf_output_files': 'Output Files',
    'wf_required_sections': 'Required Sections',
    'wf_required_sections_placeholder': '改编文案, 改编说明, 自检',
    'wf_advanced': 'Advanced',
    'wf_prompt': 'Prompt',
    'wf_prompt_placeholder': 'Describe this step...',
    'wf_working_dir': 'Working Directory',
    'wf_output_dir': 'Output Directory',
    'wf_pause_before_step': 'Pause before this step and require manual approval',
    'wf_depends_on_label': 'Depends on',
    'wf_input_prefix': '本次输入：',
    'wf_pipeline_name_required': 'Pipeline name is required',
    'wf_template_saved': 'Template saved',
    'wf_template_deleted': 'Template deleted',
    'wf_confirm_rerun_title': '重跑步骤',
    'wf_confirm_rerun_message': '重跑 {title}？该步骤之后的产物会被重置。',
    'wf_confirm_rerun_current': '当前步骤',
    'wf_confirm_rerun_confirm': '重跑',
    'wf_speech_failed': '语音识别失败：{error}',
    'wf_insert_message_title': '插入对话：{title}',
    'wf_current_step': '当前步骤',
    'wf_message_content': '消息内容',
    'wf_message_placeholder': '给这个步骤补充指令或修改意见...',
    'wf_message_hint': '提交后会写入该步骤的人类对话，并触发该步骤继续执行；其后续步骤会按依赖重置。',
    'wf_send': '发送',
    'wf_manual_title': '主进程补图回填：{title}',
    'wf_local_paths': '本地文件路径',
    'wf_manual_hint': '在 Codex 主进程生图并保存到本地后，把图片路径粘贴到这里；提交后会校验文件存在、标记本步骤完成，并自动激活下游步骤。',
    'wf_result_summary': '结果说明',
    'wf_result_summary_placeholder': '例如：已由 Codex 主进程生成分镜图和角色三视图',
    'wf_manual_submit': '回填并完成本步骤',
    'wf_request_changes_title': '要求修改上游产物',
    'wf_target_step': '要修改哪一步',
    'wf_request_changes_hint': '可回退并修改当前步骤之前的任意产物；提交前会自动保存该步骤当前版本。',
    'wf_change_request': '修改意见',
    'wf_change_placeholder': '说明哪里不过、希望怎么改...',
    'wf_submit_changes': '提交修改',
    'wf_confirm_delete_title': 'Delete Workflow',
    'wf_confirm_delete_message': 'Delete this workflow permanently?',
    'wf_confirm_delete_confirm': 'Delete',
    'wf_node_video_parse': '解析视频',
    'wf_node_copy_adapt': '改编文案',
    'wf_node_storyboard_script': '生成分镜脚本',
    'wf_node_image_generate': '生成视觉资产',
    'wf_node_video_command': '准备视频命令',
    'wf_node_video_generate': '生成视频',
    'wf_node_human_review': '人工审核',
    'wf_node_custom': '自定义',
    'wf_sections_video_parse': '视频文案/台词,选题 brief,可复用结构',
    'wf_sections_copy_adapt': '输入来源,改编文案,改编说明,自检',
    'wf_sections_storyboard_script': '分镜',
    'wf_sections_video_command': '命令,输入文件,输出路径',

    // Ops panel
    'ops_intro': '我可以检查平台异常、解释任务卡住原因，并给出修复建议。',
    'ops_title': '平台管家',
    'ops_model_label': '模型',
    'ops_model_missing': 'Ops LLM 未接入，可在此配置。',
    'ops_model_using': '使用 {model}',
    'ops_model_fallback': '回退：{model}',
    'ops_model_edit': '编辑',
    'ops_model_clear': '清除',
    'ops_model_save': '保存',
    'ops_model_verify': '验证',
    'ops_model_adapter': '适配器',
    'ops_model_model': '模型名',
    'ops_model_base_url': 'Base URL',
    'ops_model_api_key': 'API Key',
    'ops_model_keep_key': '留空则保留当前密钥',
    'ops_model_saved': 'Ops 模型已保存',
    'ops_model_cleared': 'Ops 模型已清除',
    'ops_global_check': '全局检查',
    'ops_current_page_check': '检查当前页',
    'ops_global_question': '现在平台有什么异常？',
    'ops_user_role': '你',
    'ops_diagnosing': '诊断中...',
    'ops_placeholder': '问：为什么这个任务卡住？',
    'ops_send': '发送',
    'ops_current_target_question': '检查当前 {kind} 是否异常',
    'ops_current_page_question': '检查当前页面是否有异常：{title}',
    'ops_current_page': '当前页面',
    'ops_diagnose_failed': '诊断失败：{message}',
    'ops_answer_source': '由 {source} 回答',
    'ops_done': '诊断完成。',
    'ops_critical': '严重：{count}',
    'ops_warning': '警告：{count}',
    'ops_info': '提示：{count}',
    'ops_priority': '优先处理：',
    'ops_issue_target': '（{kind} {id}）',
    'ops_recommendation': '建议：{text}',
    'ops_llm_missing': 'LLM 未接入：{error}',
    'ops_confirm_execute': '{label}\n\n{description}\n\n确认执行？',
    'ops_action_failed': '动作失败：{message}',
    'ops_action_task_done': '已执行 {action}，Task：{id}',
    'ops_action_session_done': '已执行 {action}，Session：{id}',
    'ops_action_workflow_done': '已执行 {action}，Workflow：{id}',
    'ops_action_done': '已执行 {action}。',

    // Landing page
    'landing_nav_features': 'Features',
    'landing_nav_architecture': 'Architecture',
    'landing_nav_sessions': 'Sessions',
    'landing_nav_get_started': 'Get Started',
    'landing_badge': '本地优先的开源工具',
    'landing_hero_title_prefix': '把任务传给',
    'landing_hero_title_highlight': '另一个 AI agent',
    'landing_hero_sub': 'Passiton 运行在你的机器上，使用你自己的 CLI agents 和 API keys。当某个 agent 额度耗尽、超时或中断时，把任务连同工作区状态交给另一个 agent 继续。',
    'landing_hero_get_started': '本地开始',
    'landing_hero_sign_in': 'Sign In',
    'landing_arch_title': '工作原理',
    'landing_arch_sub': 'Agent A ↔ Passiton ↔ Agent B —— 本地多 agent 路由',
    'landing_arch_center_sub': '路由 · 交接 · 状态',
    'landing_zhipu_api': '智谱 API',
    'landing_features_title': '为什么选择 Passiton',
    'landing_features_sub': '管理你已经在用的 agents',
    'landing_feature_orchestration_title': 'Agent handoff',
    'landing_feature_orchestration_body': '失败或停止的任务可交给另一个 ready agent 继续，并带上上一轮输出和可用的工作区状态。',
    'landing_feature_keys_title': '用自己的 Key',
    'landing_feature_keys_body': '自带 API Key，直接对接 Anthropic、OpenAI、智谱等主流提供商。不锁定供应商，数据不经代理 —— 完全掌控你的 AI 资产。',
    'landing_feature_billing_title': '免费开源',
    'landing_feature_billing_body': 'Passiton 没有计费层。你在本机运行它，代码可审计；使用 API 模型时只支付自己的 provider。',
    'landing_cta_title': '运行第一个本地任务',
    'landing_cta_sub': '安装后添加一个已发现的 agent，再从本地 Web UI 创建任务。',
    'landing_cta_button': '打开 Passiton',
    'landing_footer': '© 2026 Passiton. All rights reserved.',

    // Login page
    'login_tagline': 'Agent Sessions Platform',
    'login_intro': 'Sign in with your existing local account.',
    'login_email': 'Email',
    'login_password': 'Password',
    'login_submit': 'Login',
    'login_local': 'Continue as Local User',

    // FormatTime relative labels
    'time.justNow': '刚刚',
    'time.minAgo': '{n} 分钟前',
    'time.hrAgo': '{n} 小时前',
    'time.dayAgo': '{n} 天前',
    'time.daysAgo': '{n} 天前',
  },
}

function getCurrentLang() {
  let lang = localStorage.getItem(LANG_KEY)
  if (!lang) {
    lang = localStorage.getItem(LEGACY_LANG_KEY)
    if (lang) localStorage.setItem(LANG_KEY, lang)
  }
  return (lang === 'zh' || lang === 'en') ? lang : 'en'
}

function t(key, params = {}) {
  const lang = getCurrentLang()
  let text = MESSAGES[lang]?.[key] ?? MESSAGES.en?.[key] ?? key
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v))
  }
  return text
}

function setLanguage(lang) {
  const resolved = (lang === 'zh' || lang === 'en') ? lang : 'en'
  localStorage.setItem(LANG_KEY, resolved)
  document.documentElement.lang = resolved
  render()
}

// ── Global State ──────────────────────────────────────────────────────────────
const state = {
  user: null,
  sessions: [],
  tasks: [],
  pipelines: [],
  pipelinePageLimit: 20,
  pipelineListOffset: 0,
  pipelineListHasMore: false,
  pipelineListLoadingMore: false,
  taskPageLimit: 60,
  taskListOffset: 0,
  taskListHasMore: false,
  taskListLoadingMore: false,
  agents: [],
  agentDiagnosticsPending: new Set(),
  templates: [],
  pipelineTemplates: [],
  apiKeys: [],
  apiDocs: null,
  deployCheck: null,
  stats: null,
  config: null,
  currentView: 'sessions',
  currentSessionId: null,
  currentSession: null,
  currentTaskId: null,
  currentTask: null,
  currentPipelineId: null,
  currentPipeline: null,
  opsOpen: false,
  opsBusy: false,
  opsModel: null,
  opsModelEditing: false,
  opsMessages: [],
  opsLastReport: null,
  opsPosition: loadOpsPosition(),
  opsDragging: false,
  opsDragged: false,
  opsWalkTimer: null,
  opsWalkFrame: null,
  opsWalkTarget: null,
  taskRunningTimer: null,
  expandedWorkflowStep: null,
  liveReviewStep: null,
  liveReviewDrafts: new Map(),
  liveReviewPending: new Set(),
  liveReviewArtifacts: new Map(),
  liveReviewArtifactLoading: new Set(),
  workflowSpeechRecognition: null,
  workflowSpeechSessionId: null,
  currentMessages: [],
  currentSnapshots: [],
  ws: null,
  heartbeats: new Map(),
  streamDeltas: new Map(),
  streamRaw: new Map(),
  streamSteps: new Map(),
  streamStatus: new Map(),
  workflowFileAliases: new Map(),
  workflowNestedFiles: new Map(),
  workflowFileResolution: new Map(),
  expandedStepDetails: new Set(),
  expandedArtifactFiles: new Set(),
  autoFollowMessages: true,
  artifactFullDiffVisible: false,
  rawOutputVisible: false,
  streamFrame: null,
  viewToken: 0,
  sessionDetailController: null,
  taskDetailController: null,
  sessionsListController: null,
  tasksListController: null,
  pipelineDetailController: null,
  pipelinesListController: null,
  settingsController: null,
  rootLocalLoginAttempted: false,
}

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {
  '/': 'landing',
  '/sessions': 'sessions',
  '/session/:id': 'session',
  '/tasks': 'tasks',
  '/task/:id': 'task',
  '/workflows': 'workflows',
  '/workflow/:id': 'workflow',
  '/settings': 'settings',
  '/login': 'login',
}

function navigate(path) {
  history.pushState(null, '', path)
  render()
}

function render() {
  nextViewToken()
  const path = location.pathname
  if (path !== '/') state.rootLocalLoginAttempted = false

  // Abort in-flight detail/list fetches from the previous view so stale
  // responses can't render. The view-token guard is the primary defence;
  // aborting frees the network connection sooner.
  if (!path.startsWith('/session/')) { if (state.sessionDetailController) state.sessionDetailController.abort() }
  if (!path.startsWith('/task/')) { if (state.taskDetailController) state.taskDetailController.abort() }
  if (path !== '/sessions') { if (state.sessionsListController) state.sessionsListController.abort() }
  if (path !== '/tasks') { if (state.tasksListController) state.tasksListController.abort() }
  if (path !== '/tasks') stopTaskRunningTimer()
  if (!path.startsWith('/workflow/') && !path.startsWith('/workflows/')) { if (state.pipelineDetailController) state.pipelineDetailController.abort() }
  if (path !== '/workflows') { if (state.pipelinesListController) state.pipelinesListController.abort() }
  if (path !== '/settings') { if (state.settingsController) state.settingsController.abort() }

  // Auth check — remember the intended destination so the login flow can
  // restore it after (auto-)login instead of always defaulting to /sessions.
  if (path !== '/' && path !== '/landing' && path !== '/login' && !getValidAuthToken()) {
    state.pendingPath = path
    return navigate('/login')
  }

  // Route matching
  // Authenticated local users skip the marketing landing page and go straight
  // to their sessions, where the onboarding panel guides first-time setup.
  if ((path === '/' || path === '/landing') && getValidAuthToken()) {
    return navigate('/sessions')
  }
  if (path === '/' && !state.rootLocalLoginAttempted) {
    state.rootLocalLoginAttempted = true
    renderLocalLoginLoading()
    loginLocalUser('/sessions').catch(() => {
      if (location.pathname === '/' && !getValidAuthToken()) renderLanding()
    })
  } else if (path === '/' || path === '/landing') {
    renderLanding()
  } else if (path === '/login') {
    renderLogin()
  } else if (path === '/sessions') {
    renderSessions()
  } else if (path.startsWith('/session/')) {
    const id = path.split('/')[2]
    renderSession(id)
  } else if (path === '/tasks') {
    renderTasks()
  } else if (path.startsWith('/task/')) {
    const id = path.split('/')[2]
    renderTask(id)
  } else if (path === '/workflows') {
    renderWorkflows()
  } else if (path.startsWith('/workflow/') || path.startsWith('/workflows/')) {
    const id = path.split('/')[2]
    renderWorkflow(id)
  } else if (path === '/settings') {
    renderSettings()
  } else {
    navigate('/sessions')
  }
}

window.addEventListener('popstate', render)

// ── API Helpers ───────────────────────────────────────────────────────────────
function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

function getValidAuthToken() {
  const token = getAuthToken()
  if (!token) return null
  if (isJwtExpired(token)) {
    clearAuthToken()
    return null
  }
  return token
}

function getCurrentUser() {
  const token = getValidAuthToken()
  if (!token) return null
  try {
    const [, payload] = token.split('.')
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return {
      id: data.sub || '',
      email: data.email || 'unknown',
      initials: initialsFromEmail(data.email || 'U'),
    }
  } catch {
    return null
  }
}

function isJwtExpired(token) {
  try {
    const [, payload] = token.split('.')
    if (!payload) return true
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof data.exp === 'number' && data.exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

function setAuthToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
  connectWs()
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  if (state.ws) {
    state.ws.close()
    state.ws = null
  }
}

async function api(path, method = 'GET', body, options = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  const token = getValidAuthToken()
  if (token) opts.headers.Authorization = `Bearer ${token}`
  if (body !== undefined) opts.body = JSON.stringify(body)
  if (options.signal) opts.signal = options.signal

  let r
  try {
    r = await fetch(API + path, opts)
  } catch (err) {
    throw new Error(options.signal?.aborted ? 'aborted' : 'Cannot reach Passiton server')
  }

  const text = await r.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!r.ok) {
    if (r.status === 401 && !options.suppressUnauthorizedRedirect) {
      clearAuthToken()
      navigate('/login')
    }
    throw new Error(data?.error || `HTTP ${r.status}`)
  }

  return data
}

// ── Performance: view tokens, dedup, coalesced renders ────────────────────────
// Bumped on every render() so async loads can detect they're stale (user navigated
// away mid-fetch) and bail before mutating the DOM with old data.
function nextViewToken() {
  state.viewToken = (state.viewToken || 0) + 1
  return state.viewToken
}

// Coalesce a burst of render requests tagged `tag` into a single execution within
// one animation frame. Late callers overwrite the pending fn (latest-wins). Used
// for WebSocket-driven list re-renders so N session:updated events in one frame
// produce exactly one DOM update instead of N synchronous innerHTML rebuilds.
const coalescedRenders = new Map()
function scheduleCoalescedRender(tag, fn) {
  const existing = coalescedRenders.get(tag)
  if (existing) { existing.fn = fn; return }
  const entry = { fn }
  coalescedRenders.set(tag, entry)
  const run = () => {
    if (coalescedRenders.get(tag) !== entry) return
    coalescedRenders.delete(tag)
    try { entry.fn() } catch (err) { console.error('[render-coalesce]', err) }
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 16)
}

// In-flight dedup for detail GETs: rapid navigation/clicks that request the same
// resource reuse one promise. The promise is removed on settle so a later request
// (after completion) fires a fresh fetch.
const inflightDetails = new Map()
function dedupeDetail(key, factory) {
  const existing = inflightDetails.get(key)
  if (existing) return existing
  const p = factory().finally(() => inflightDetails.delete(key))
  inflightDetails.set(key, p)
  return p
}

function isAbortedErr(err) {
  return err?.message === 'aborted' || err?.name === 'AbortError'
}

// Route-gated, coalesced list re-renders for WebSocket bursts. State is mutated
// immediately (so data stays correct); only the DOM work is debounced to one
// frame, and skipped entirely when the user isn't viewing that list.
function scheduleSessionListRender() {
  if (location.pathname !== '/sessions') return
  scheduleCoalescedRender('session-list', () => {
    renderSessionStats()
    renderSessionCards()
  })
}

function scheduleTaskListRender() {
  if (location.pathname !== '/tasks') return
  scheduleCoalescedRender('task-list', () => {
    renderTaskStats()
    renderTaskCards()
  })
}

// Coalesced detail-panel renders for WebSocket bursts on the active detail view.
// State is already updated before these fire; we only debounce the DOM work so
// N events in one frame produce one header+panel (or header+content) rebuild.
function scheduleSessionDetailRender() {
  if (!state.currentSessionId || !location.pathname.startsWith('/session/')) return
  scheduleCoalescedRender('session-detail', () => {
    if (state.currentSessionId && location.pathname.startsWith('/session/')) {
      renderSessionHeader(state.currentSession)
      renderSessionPanel(state.currentSession)
    }
  })
}

function scheduleTaskDetailRender(forceContent) {
  if (!state.currentTaskId || !location.pathname.startsWith('/task/')) return
  scheduleCoalescedRender('task-detail', () => {
    if (state.currentTaskId && location.pathname.startsWith('/task/')) {
      renderTaskHeader(state.currentTask)
      if (forceContent) {
        renderTaskContent(state.currentTask)
      } else {
        updateTaskLiveOutput(state.currentTask)
      }
    }
  })
}

// Coalesced pipeline (workflow) list re-renders for WebSocket bursts. Mirrors
// scheduleSessionListRender/scheduleTaskListRender but for /workflows.
function scheduleWorkflowListRender() {
  if (location.pathname !== '/workflows') return
  scheduleCoalescedRender('workflow-list', () => {
    if (location.pathname === '/workflows') renderPipelineCards()
  })
}

// Coalesced workflow-detail renders for WebSocket bursts. State is already
// updated before this fires; we only debounce the DOM work so N events in one
// frame produce one header+steps+timeline rebuild.
function scheduleWorkflowDetailRender(forceHydrate) {
  if (!state.currentPipelineId) return
  const onDetail = location.pathname.startsWith('/workflow/') || location.pathname.startsWith('/workflows/')
  if (!onDetail) return
  scheduleCoalescedRender('workflow-detail', () => {
    if (!state.currentPipelineId || !(location.pathname.startsWith('/workflow/') || location.pathname.startsWith('/workflows/'))) return
    renderWorkflowHeader(state.currentPipeline)
    renderWorkflowSteps(state.currentPipeline)
    renderWorkflowTimeline(state.currentPipeline)
    if (forceHydrate) hydrateWorkflowFileReferences(state.currentPipeline)
  })
}

// Coalesce rapid renderSessionMessages calls (e.g. a burst of message:step
// WebSocket events) into one innerHTML rebuild per animation frame.
function scheduleSessionMessagesRender() {
  if (!state.currentSessionId) return
  scheduleCoalescedRender('session-messages', () => {
    if (state.currentSessionId) renderSessionMessages()
  })
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark'
  document.documentElement.setAttribute('data-theme', saved)
}

function toggleTheme() {
  const html = document.documentElement
  const current = html.getAttribute('data-theme')
  const next = current === 'dark' ? 'light' : 'dark'
  html.setAttribute('data-theme', next)
  localStorage.setItem(THEME_KEY, next)
  updateThemeButton()
}

function updateThemeButton() {
  const btn = document.querySelector('.theme-toggle')
  if (!btn) return
  const theme = document.documentElement.getAttribute('data-theme')
  btn.textContent = theme === 'dark' ? '🌙' : '☀️'
}

function renderUserMenu() {
  const user = getCurrentUser()
  return `
    <div class="user-menu">
      <button class="avatar" onclick="window.toggleUserMenu()" title="${escapeAttr(user?.email || 'Account')}">${escapeHtml(user?.initials || 'U')}</button>
      <div class="user-menu-popover" id="user-menu-popover">
        <div class="user-menu-email">${escapeHtml(user?.email || 'unknown')}</div>
        <button onclick="window.logout()">Logout</button>
      </div>
    </div>
  `
}

function renderSidebar(active) {
  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="logo-icon">P</div>
        <span>Passiton</span>
      </div>
      <nav class="sidebar-nav">
        <a href="/sessions" class="${active === 'sessions' ? 'active' : ''}">
          <span class="nav-icon">◉</span> ${t('nav.sessions')}
        </a>
        <a href="/tasks" class="${active === 'tasks' ? 'active' : ''}">
          <span class="nav-icon">▣</span> ${t('nav.tasks')}
        </a>
        <a href="/workflows" class="${active === 'workflows' ? 'active' : ''}">
          <span class="nav-icon">⛓</span> ${t('nav.workflows')}
        </a>
        <a href="/settings" class="${active === 'settings' ? 'active' : ''}">
          <span class="nav-icon">⚙</span> ${t('nav.settings')}
        </a>
      </nav>
      <div class="sidebar-footer">
        Passiton v0.1.0
        <a href="/api/docs" target="_blank" rel="noopener" style="display: block; font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">${t('nav.apiDocs')}</a>
      </div>
    </aside>
    ${renderOpsWidget()}
  `
}

function renderOpsWidget() {
  const open = state.opsOpen
  const pos = clampOpsPosition(state.opsPosition)
  const alignX = pos.x < window.innerWidth / 2 ? 'align-left' : 'align-right'
  const alignY = pos.y < 360 ? 'drop-down' : 'drop-up'
  const messages = state.opsMessages.length
    ? state.opsMessages
    : [{ from: 'ops', content: t('ops_intro') }]
  return `
    <div class="ops-widget ${open ? 'open' : ''} ${alignX} ${alignY}" id="ops-widget" style="--ops-x: ${pos.x}px; --ops-y: ${pos.y}px;">
      <button class="ops-fab" onpointerdown="window.beginOpsDrag(event)" title="Passiton Ops">
        <span class="ops-mascot" aria-hidden="true">
          <span class="ops-mascot-head">
            <span class="ops-mascot-eye left"></span>
            <span class="ops-mascot-eye right"></span>
          </span>
          <span class="ops-mascot-body">
            <span class="ops-mascot-arm left"></span>
            <span class="ops-mascot-arm right"></span>
          </span>
          <span class="ops-mascot-leg left"></span>
          <span class="ops-mascot-leg right"></span>
        </span>
        <span class="ops-fab-label">Ops</span>
      </button>
      <section class="ops-panel ${open ? 'open' : ''}" id="ops-panel">
        <div class="ops-header">
          <div>
            <div class="ops-kicker">TURING OPS</div>
            <h3>${t('ops_title')}</h3>
          </div>
          <button class="icon-btn" onclick="window.toggleOps()">×</button>
        </div>
        <div class="ops-quick-actions">
          <button onclick="window.askOps(${jsString(t('ops_global_question'))})">${t('ops_global_check')}</button>
          <button onclick="window.askOpsForCurrent()">${t('ops_current_page_check')}</button>
        </div>
        ${renderOpsModelSettings()}
        <div class="ops-thread" id="ops-thread">
          ${messages.map(message => `
          <div class="ops-message ${message.from === 'user' ? 'user' : 'ops'}">
            <div class="ops-message-role">${message.from === 'user' ? t('ops_user_role') : 'Ops'}</div>
            <div class="ops-message-body">${renderMarkdownCached(message.content || '')}</div>
            ${renderOpsMessageActions(message)}
          </div>
        `).join('')}
          ${state.opsBusy ? `<div class="ops-message ops"><div class="ops-message-role">Ops</div><div class="ops-message-body">${t('ops_diagnosing')}</div></div>` : ''}
        </div>
        <form class="ops-composer" onsubmit="window.submitOpsQuestion(event)">
          <textarea id="ops-input" rows="2" placeholder="${escapeAttr(t('ops_placeholder'))}"></textarea>
          <button class="btn btn-primary btn-sm" type="submit" ${state.opsBusy ? 'disabled' : ''}>${t('ops_send')}</button>
        </form>
      </section>
    </div>
  `
}

function renderOpsModelSettings() {
  const model = state.opsModel
  const editing = state.opsModelEditing || (!model?.configured && !model?.effective)
  const current = model?.model || model?.provider || model?.adapter || ''
  const status = model?.configured
    ? t('ops_model_using', { model: current || 'Ops model' })
    : model?.effective === 'fallback'
      ? t('ops_model_fallback', { model: current || model.name || 'API Assistant' })
      : t('ops_model_missing')
  if (!editing) {
    return `
      <div class="ops-model-bar">
        <div>
          <div class="ops-model-label">${t('ops_model_label')}</div>
          <div class="ops-model-current">${escapeHtml(status)}</div>
        </div>
        <div class="ops-model-actions">
          <button type="button" onclick="window.editOpsModel()">${t('ops_model_edit')}</button>
          ${model?.configured ? `<button type="button" onclick="window.clearOpsModel()">${t('ops_model_clear')}</button>` : ''}
        </div>
      </div>
    `
  }
  const provider = providerPresetForAgent(model)
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom
  const selectedModel = model?.model || defaultModelForProvider(provider)
  return `
    <form class="ops-model-form" onsubmit="window.saveOpsModel(event)">
      <div class="ops-model-form-head">
        <span>${escapeHtml(status)}</span>
        ${model?.configured || model?.effective ? `<button type="button" onclick="window.cancelOpsModelEdit()">×</button>` : ''}
      </div>
      <div class="ops-model-grid">
        <label>
          <span>${t('ops_model_adapter')}</span>
          <select class="input" name="provider" id="ops-model-provider" onchange="window.updateOpsModelProviderOptions()">
            ${providerPresetOptions(provider)}
          </select>
        </label>
        <label>
          <span>${t('ops_model_model')}</span>
          <span id="ops-model-model-control">${modelControl(provider, selectedModel)}</span>
        </label>
        <label>
          <span>${t('ops_model_base_url')}</span>
          <input class="input" name="baseUrl" id="ops-model-base-url" value="${escapeAttr(model?.baseUrl || preset.baseUrl)}">
        </label>
        <label>
          <span>${t('ops_model_api_key')}</span>
          <input class="input" name="apiKey" type="password" autocomplete="new-password" ${model?.configured ? '' : 'required'} placeholder="${escapeAttr(model?.configured ? t('ops_model_keep_key') : '')}">
        </label>
      </div>
      <div class="ops-model-submit">
        <button class="btn btn-secondary btn-sm" type="submit" name="verify" value="1">${t('ops_model_verify')}</button>
        <button class="btn btn-primary btn-sm" type="submit">${t('ops_model_save')}</button>
      </div>
    </form>
  `
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWs() {
  if (state.ws) return
  const token = getValidAuthToken()
  if (!token || location.protocol === 'file:') return

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`

  state.ws = new WebSocket(wsUrl)

  state.ws.onopen = () => {
    console.log('[ws] connected')
  }

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      handleWsEvent(msg)
    } catch (err) {
      console.error('[ws] parse error:', err)
    }
  }

  state.ws.onclose = () => {
    console.log('[ws] disconnected')
    state.ws = null
    setTimeout(connectWs, 3000)
  }

  state.ws.onerror = (err) => {
    console.error('[ws] error:', err)
  }
}

function handleWsEvent(event) {
  console.log('[ws] event:', event.type)

  switch (event.type) {
    case 'init':
      state.sessions = event.payload || []
      scheduleSessionListRender()
      break
    case 'session:created':
    case 'session:updated':
    case 'session:error':
    case 'session:done':
    case 'session:paused':
    case 'session:resumed':
      applySessionUpdate(event.payload)
      break
    case 'task:created':
    case 'task:updated':
    case 'task:error':
    case 'task:done':
      applyTaskUpdate(event.payload)
      break
    case 'session:deleted':
      removeSessionFromList(event.payload.id)
      if (state.currentSessionId === event.payload.id) {
        navigate('/sessions')
      }
      break
    case 'pipeline:created':
    case 'pipeline:updated':
      applyPipelineUpdate(event.payload)
      break
    case 'message:delta':
      handleMessageDelta(event.payload)
      break
    case 'message:step':
      handleMessageStep(event.payload)
      break
    case 'message:new':
      if (event.payload.from !== 'human') {
        state.liveReviewPending.delete(event.payload.sessionId)
        state.streamDeltas.delete(event.payload.sessionId)
      }
      if (state.currentSessionId === event.payload.sessionId) {
        clearStreamingDelta(event.payload.sessionId)
        setStreamStatus(event.payload.sessionId, t('session.status.roundDone'))
        upsertCurrentMessage(event.payload)
        renderSessionMessages()
        scheduleSessionDetailRender()
      }
      {
        const workflowDetail = findCurrentWorkflowSessionDetail(event.payload.sessionId)
        if (workflowDetail) {
          workflowDetail.messages = workflowDetail.messages || []
          const index = workflowDetail.messages.findIndex(message => message.id === event.payload.id)
          if (index >= 0) {
            workflowDetail.messages[index] = event.payload
          } else {
            workflowDetail.messages.push(event.payload)
          }
          invalidateWorkflowStepCache()
          scheduleWorkflowDetailRender()
        }
      }
      break
    case 'heartbeat':
      state.heartbeats.set(event.sessionId, event)
      updateHeartbeat(event)
      break
  }
}

function applySessionUpdate(session) {
  if (!session?.id) return
  const index = state.sessions.findIndex(item => item.id === session.id)
  if (index >= 0) {
    state.sessions[index] = { ...state.sessions[index], ...session }
  } else {
    state.sessions.unshift(session)
  }

  if (state.currentSessionId === session.id) {
    state.currentSession = { ...(state.currentSession || {}), ...session }
    scheduleSessionDetailRender()
  }

  const workflowDetail = findCurrentWorkflowSessionDetail(session.id)
  if (workflowDetail) {
    Object.assign(workflowDetail, session)
    invalidateWorkflowStepCache()
    scheduleWorkflowDetailRender()
  }

  scheduleSessionListRender()
}

function applyPipelineUpdate(pipeline) {
  if (!pipeline?.id) return
  const index = state.pipelines.findIndex(item => item.id === pipeline.id)
  if (index >= 0) {
    state.pipelines[index] = { ...state.pipelines[index], ...pipeline }
  } else {
    state.pipelines.unshift(pipeline)
  }

  if (state.currentPipelineId === pipeline.id) {
    state.currentPipeline = { ...(state.currentPipeline || {}), ...pipeline }
    invalidateWorkflowStepCache()
    scheduleWorkflowDetailRender(true)
  }

  scheduleWorkflowListRender()
}

function applyTaskUpdate(task) {
  if (!task?.id) return
  const index = state.tasks.findIndex(item => item.id === task.id)
  if (index >= 0) {
    state.tasks[index] = { ...state.tasks[index], ...task }
  } else {
    state.tasks.unshift(task)
  }

  if (state.currentTaskId === task.id) {
    const prev = state.currentTask || {}
    state.currentTask = { ...prev, ...task }
    // Re-render the heavy markdown content only when one of the markdown-bearing
    // fields actually changed. Status-only updates (queued→running→done) just
    // need the header badge, not a full prompt/result/output re-parse.
    const contentChanged =
      task.prompt !== undefined && task.prompt !== prev.prompt ||
      task.result !== undefined && task.result !== prev.result ||
      task.output !== undefined && task.output !== prev.output ||
      task.errorMessage !== undefined && task.errorMessage !== prev.errorMessage ||
      task.workspaceState !== undefined && task.workspaceState !== prev.workspaceState
    scheduleTaskDetailRender(contentChanged)
  }

  scheduleTaskListRender()
}

function removeSessionFromList(id) {
  if (!id) return
  state.sessions = state.sessions.filter(session => session.id !== id)
  scheduleSessionListRender()
}

function handleMessageDelta(payload) {
  if (!payload?.sessionId || !payload.content) return

  const existing = state.streamDeltas.get(payload.sessionId) || {
    sessionId: payload.sessionId,
    content: '',
    from: payload.from || 'assistant',
  }
  existing.content += payload.content
  existing.from = payload.from || existing.from
  state.streamDeltas.set(payload.sessionId, existing)
  state.streamRaw.set(payload.sessionId, (state.streamRaw.get(payload.sessionId) || '') + payload.content)
  setStreamStatus(payload.sessionId, summarizeRawStatus(payload.content))
  if (state.currentSessionId === payload.sessionId) scheduleStreamingRender()
  if (isCurrentWorkflowSession(payload.sessionId)) {
    if (state.liveReviewStep === payload.sessionId) {
      updateWorkflowLiveReviewStream(payload.sessionId)
    } else {
      invalidateWorkflowStepCache(payload.sessionId)
      scheduleWorkflowDetailRender()
    }
  }
}

function handleMessageStep(payload) {
  if (!payload?.sessionId || !payload.step) return
  const steps = state.streamSteps.get(payload.sessionId) || []
  const last = steps[steps.length - 1]
  const step = {
    ...payload.step,
    id: `${Date.now()}-${steps.length}`,
    detail: payload.step.detail || '',
  }
  if (last && last.type === step.type && last.summary === step.summary) return
  steps.push(step)
  state.streamSteps.set(payload.sessionId, steps)
  setStreamStatus(payload.sessionId, step.summary)
  if (state.currentSessionId === payload.sessionId) scheduleSessionMessagesRender()
  if (isCurrentWorkflowSession(payload.sessionId)) {
    if (state.liveReviewStep === payload.sessionId) {
      updateWorkflowLiveReviewStream(payload.sessionId)
    } else {
      invalidateWorkflowStepCache(payload.sessionId)
      scheduleWorkflowDetailRender()
    }
  }
}

function setStreamStatus(sessionId, status) {
  if (!sessionId || !status) return
  state.streamStatus.set(sessionId, status)
  if (state.currentSessionId === sessionId) updateSessionStatusLine()
}

function scheduleStreamingRender() {
  if (state.streamFrame) return
  state.streamFrame = requestAnimationFrame(() => {
    state.streamFrame = null
    renderStreamingDelta()
  })
}

function renderStreamingDelta() {
  updateSessionStatusLine()
  updateRawOutput()

  const messagesContainer = document.getElementById('messages-container')
  if (messagesContainer && state.autoFollowMessages) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
}

function clearStreamingDelta(sessionId) {
  state.streamDeltas.delete(sessionId)
  const node = document.getElementById('streaming-message')
  if (node) node.remove()
}

function resetSessionStream(sessionId) {
  state.streamDeltas.delete(sessionId)
  state.streamRaw.delete(sessionId)
  state.streamSteps.delete(sessionId)
  state.streamStatus.delete(sessionId)
  state.expandedStepDetails = new Set([...state.expandedStepDetails].filter(key => !key.startsWith(`${sessionId}:`)))
  state.expandedArtifactFiles = new Set()
  state.artifactFullDiffVisible = false
}

function upsertCurrentMessage(message) {
  const index = state.currentMessages.findIndex(item => item.id === message.id)
  if (index >= 0) {
    state.currentMessages[index] = message
  } else {
    state.currentMessages.push(message)
  }
}

function updateHeartbeat(hb) {
  // Update progress indicators if on session page
  if (state.currentSessionId === hb.sessionId) {
    setStreamStatus(hb.sessionId, summarizeRawStatus(hb.lastOutput))
    const progressAgent = document.getElementById('progress-agent')
    const progressElapsed = document.getElementById('progress-elapsed')
    const progressOutput = document.getElementById('progress-output')

    if (progressAgent) progressAgent.textContent = hb.agent
    if (progressElapsed) progressElapsed.textContent = `${Math.floor(hb.elapsed / 1000)}s`
    if (progressOutput) progressOutput.textContent = hb.lastOutput || t('session.status.processing')
  }
  if (isCurrentWorkflowSession(hb.sessionId)) {
    setStreamStatus(hb.sessionId, summarizeRawStatus(hb.lastOutput || t('task_status_processing')))
    if (state.liveReviewStep === hb.sessionId) {
      updateWorkflowLiveReviewStream(hb.sessionId)
    } else {
      renderWorkflowSteps(state.currentPipeline)
    }
  }
}

function isCurrentWorkflowSession(sessionId) {
  return Boolean(state.currentPipeline?.sessions?.some(step => step.sessionId === sessionId))
}

function findCurrentWorkflowSessionDetail(sessionId) {
  return state.currentPipeline?.sessionDetails?.find(session => session.id === sessionId)
}

// ── Data Loading ──────────────────────────────────────────────────────────────
async function loadSessions(signal) {
  try {
    state.sessions = await api('/api/sessions?limit=60', 'GET', undefined, signal ? { signal } : undefined)
  } catch (err) {
    if (isAbortedErr(err)) throw err
    console.error('Failed to load sessions:', err)
  }
}

async function loadTasks(signal, options = {}) {
  const pageLimit = options.limit ?? state.taskPageLimit
  try {
    const params = new URLSearchParams()
    params.set('limit', String(pageLimit))
    if (options.offset != null) params.set('offset', String(options.offset))
    const result = await api(`/api/tasks?${params.toString()}`, 'GET', undefined, signal ? { signal } : undefined)
    if (options.append && Array.isArray(state.tasks)) {
      const existing = new Set(state.tasks.map((t) => t.id))
      const fresh = result.filter((t) => !existing.has(t.id))
      state.tasks = state.tasks.concat(fresh)
      state.taskListOffset += result.length
    } else {
      state.tasks = result
      state.taskListOffset = result.length
    }
    state.taskListHasMore = result.length >= pageLimit
  } catch (err) {
    if (isAbortedErr(err)) throw err
    console.error('Failed to load tasks:', err)
    if (!options.append) state.tasks = []
  }
}

async function loadPipelines(signal, options = {}) {
  const pageLimit = options.limit ?? state.pipelinePageLimit
  try {
    const params = new URLSearchParams()
    params.set('limit', String(pageLimit))
    if (options.offset != null) params.set('offset', String(options.offset))
    const result = await api(`/api/pipelines?${params.toString()}`, 'GET', undefined, signal ? { signal } : undefined)
    if (options.append && Array.isArray(state.pipelines)) {
      const existing = new Set(state.pipelines.map((p) => p.id))
      const fresh = result.filter((p) => !existing.has(p.id))
      state.pipelines = state.pipelines.concat(fresh)
      state.pipelineListOffset += result.length
    } else {
      state.pipelines = result
      state.pipelineListOffset = result.length
    }
    state.pipelineListHasMore = result.length >= pageLimit
  } catch (err) {
    if (isAbortedErr(err)) throw err
    console.error('Failed to load pipelines:', err)
    if (!options.append) state.pipelines = []
  }
}

async function loadAgents(signal) {
  try {
    state.agents = await api('/api/agents', 'GET', undefined, signal ? { signal } : undefined)
  } catch (err) {
    if (isAbortedErr(err)) throw err
    console.error('Failed to load agents:', err)
  }
}

async function loadTemplates() {
  try {
    state.templates = await api('/api/templates')
  } catch (err) {
    console.error('Failed to load templates:', err)
    state.templates = []
  }
}

async function loadPipelineTemplates() {
  try {
    state.pipelineTemplates = await api('/api/pipeline-templates')
  } catch (err) {
    console.error('Failed to load pipeline templates:', err)
    state.pipelineTemplates = []
  }
}

async function loadApiKeys(signal) {
  try {
    state.apiKeys = await api('/api/keys', 'GET', undefined, signal ? { signal } : undefined)
  } catch (err) {
    if (isAbortedErr(err)) throw err
    console.error('Failed to load API keys:', err)
    state.apiKeys = []
  }
}

async function loadOpsModel(signal, refresh = false) {
  try {
    state.opsModel = await api(`/api/ops/model${refresh ? '?refresh=1' : ''}`, 'GET', undefined, signal ? { signal } : undefined)
  } catch (err) {
    if (isAbortedErr(err)) throw err
    state.opsModel = null
  }
}

async function loadStats() {
  try {
    state.stats = await api('/api/stats')
  } catch (err) {
    console.error('Failed to load stats:', err)
  }
}

async function loadConfig(signal) {
  try {
    state.config = await api('/api/config', 'GET', undefined, signal ? { signal } : undefined)
  } catch (err) {
    if (isAbortedErr(err)) throw err
    console.error('Failed to load config:', err)
  }
}

async function loadApiDocs(signal) {
  try {
    state.apiDocs = await api('/api/docs', 'GET', undefined, signal ? { signal } : undefined)
  } catch (err) {
    if (isAbortedErr(err)) throw err
    console.error('Failed to load API docs:', err)
    state.apiDocs = null
  }
}

async function loadDeployCheck(signal) {
  try {
    state.deployCheck = await api('/api/deploy/check', 'GET', undefined, signal ? { signal } : undefined)
  } catch (err) {
    if (isAbortedErr(err)) throw err
    console.error('Failed to load deploy check:', err)
    state.deployCheck = null
  }
}

async function loadSessionDetail(id) {
  if (state.currentSessionId !== id) return
  try {
    const controller = state.sessionDetailController
    const session = await dedupeDetail(`session:${id}`, () => api(`/api/sessions/${id}`, 'GET', undefined, controller ? { signal: controller.signal } : undefined))
    if (state.currentSessionId !== id) return
    state.currentSession = session
    state.currentMessages = session.messages || []
    resetSessionStream(id)
    renderSessionMessages()
    renderSessionPanel(session)
    renderSessionHeader(session)
  } catch (err) {
    if (isAbortedErr(err)) return
    console.error('Failed to load session detail:', err)
  }
}

// ── Render Functions ──────────────────────────────────────────────────────────
function renderLanding() {
  document.body.innerHTML = `
    <nav class="landing-nav">
      <div class="landing-brand">
        <div class="logo-icon">P</div>
        <span>Passiton</span>
      </div>
      <div class="landing-nav-links">
        <a href="#features">${t('landing_nav_features')}</a>
        <a href="#architecture">${t('landing_nav_architecture')}</a>
        <a href="/sessions">${t('landing_nav_sessions')}</a>
        <a href="/sessions" class="btn btn-primary btn-sm">${t('landing_nav_get_started')}</a>
        <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
      </div>
    </nav>

    <section class="hero">
      <div class="hero-badge fade-in-up">
        <span>✦</span> ${t('landing_badge')}
      </div>

      <h1 class="fade-in-up delay-1">
        ${t('landing_hero_title_prefix')}<br><span class="grad-text">${t('landing_hero_title_highlight')}</span>
      </h1>

      <p class="hero-sub fade-in-up delay-2">
        ${t('landing_hero_sub')}
      </p>

      <div class="hero-cta fade-in-up delay-3">
        <a href="/sessions" class="btn btn-primary pulse-glow">
          ${t('landing_hero_get_started')}
          <span>→</span>
        </a>
        <a href="/login" class="btn btn-secondary">
          ${t('landing_hero_sign_in')}
        </a>
      </div>
    </section>

    <section class="arch-section" id="architecture">
      <h2 class="fade-in-up">${t('landing_arch_title')}</h2>
      <p class="section-sub fade-in-up delay-1">${t('landing_arch_sub')}</p>

      <div class="arch-diagram fade-in-up delay-2">
        <div class="arch-col">
          <div class="arch-node">
            <div class="arch-icon" style="background: rgba(99,102,241,0.15);">🤖</div>
            <div class="arch-label">Claude</div>
            <div class="arch-sub">Anthropic API</div>
          </div>
          <div class="arch-node">
            <div class="arch-icon" style="background: rgba(34,197,94,0.15);">🧠</div>
            <div class="arch-label">GPT-4o</div>
            <div class="arch-sub">OpenAI API</div>
          </div>
        </div>

        <div class="arch-connector"></div>

        <div class="arch-center">
          <div class="arch-icon">⚡</div>
          <div class="arch-label">Passiton</div>
          <div class="arch-sub" style="color: var(--text-secondary); margin-top: 4px;">${t('landing_arch_center_sub')}</div>
        </div>

        <div class="arch-connector"></div>

        <div class="arch-col">
          <div class="arch-node">
            <div class="arch-icon" style="background: rgba(245,158,11,0.15);">💬</div>
            <div class="arch-label">GLM-4</div>
            <div class="arch-sub">${t('landing_zhipu_api')}</div>
          </div>
          <div class="arch-node">
            <div class="arch-icon" style="background: rgba(139,92,246,0.15);">🔮</div>
            <div class="arch-label">Gemini</div>
            <div class="arch-sub">Google API</div>
          </div>
        </div>
      </div>
    </section>

    <section class="features-section" id="features">
      <h2>${t('landing_features_title')}</h2>
      <p class="section-sub">${t('landing_features_sub')}</p>

      <div class="features-grid">
        <div class="feature-card fade-in-up delay-1">
          <div class="feature-icon" style="background: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15));">
            🔀
          </div>
          <h3>${t('landing_feature_orchestration_title')}</h3>
          <p>
            ${t('landing_feature_orchestration_body')}
          </p>
        </div>

        <div class="feature-card fade-in-up delay-2">
          <div class="feature-icon" style="background: linear-gradient(135deg, rgba(245,158,11,0.15), rgba(249,115,22,0.15));">
            🔑
          </div>
          <h3>${t('landing_feature_keys_title')}</h3>
          <p>
            ${t('landing_feature_keys_body')}
          </p>
        </div>

        <div class="feature-card fade-in-up delay-3">
          <div class="feature-icon" style="background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.15));">
            📊
          </div>
          <h3>${t('landing_feature_billing_title')}</h3>
          <p>
            ${t('landing_feature_billing_body')}
          </p>
        </div>
      </div>
    </section>

    <section class="cta-section">
      <h2 class="fade-in-up" style="margin-bottom: 16px;">
        ${t('landing_cta_title')}
      </h2>
      <p class="fade-in-up delay-1" style="color: var(--text-secondary); font-size: 1.05rem; margin-bottom: 36px;">
        ${t('landing_cta_sub')}
      </p>
      <div class="fade-in-up delay-2">
        <a href="/sessions" class="btn btn-primary" style="padding: 14px 36px; font-size: 1rem;">
          ${t('landing_cta_button')}
          <span>→</span>
        </a>
      </div>
    </section>

    <footer class="landing-footer">
      <p>${t('landing_footer')}</p>
    </footer>
  `
  updateThemeButton()
}

function renderLogin() {
  document.body.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="max-width: 420px; width: 100%;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-flex; align-items: center; gap: 10px; margin-bottom: 16px;">
            <div class="logo-icon" style="width: 36px; height: 36px; font-size: 1rem;">P</div>
            <h2 style="margin: 0;">Passiton</h2>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">${t('login_tagline')}</p>
        </div>

        <div style="margin-bottom: 24px; color: var(--text-secondary); font-size: 0.9rem;">
          ${t('login_intro')}
        </div>

        <form id="login-form" class="tab-panel active" onsubmit="window.handleLogin(event)">
          <div class="form-group">
            <label>${t('login_email')}</label>
            <input type="email" class="input" name="email" required autocomplete="email">
          </div>
          <div class="form-group">
            <label>${t('login_password')}</label>
            <input type="password" class="input" name="password" required minlength="8" autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center;">
            ${t('login_submit')}
          </button>
        </form>
        <button class="btn btn-secondary" style="width: 100%; justify-content: center; margin-top: 12px;" onclick="window.handleLocalLogin()">
          ${t('login_local')}
        </button>
      </div>
    </div>
  `
  updateThemeButton()
  setTimeout(() => {
    if (!getValidAuthToken() && typeof window.handleLocalLogin === 'function') {
      window.handleLocalLogin()
    }
  }, 0)
}

function renderLocalLoginLoading() {
  document.body.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center;">
      <p style="color: var(--text-muted);">${t('sessions.loading')}</p>
    </div>
  `
  updateThemeButton()
}

window.handleLogin = async function(e) {
  e.preventDefault()
  const form = e.target
  const fd = new FormData(form)
  const email = fd.get('email')
  const password = fd.get('password')

  try {
    const data = await api('/api/auth/login', 'POST', { email, password })
    setAuthToken(data.token)
    state.user = data.user
    const target = state.pendingPath || '/sessions'
    state.pendingPath = null
    navigate(target)
  } catch (err) {
    showToast(err.message)
  }
}

async function loginLocalUser(target = state.pendingPath || '/sessions') {
  const data = await api('/api/auth/local', 'POST', {}, { suppressUnauthorizedRedirect: true })
  setAuthToken(data.token)
  state.user = data.user
  state.pendingPath = null
  navigate(target)
}

window.handleLocalLogin = function() {
  return loginLocalUser().catch(err => showToast(err.message))
}

function renderSessions() {
  state.currentTaskId = null
  state.currentTask = null
  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('sessions')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <h2>${t('sessions.title')}</h2>
          </div>
          <div class="topbar-right">
            <button class="btn btn-primary btn-sm" onclick="window.showTemplateGalleryModal()">${t('sessions.newSession')}</button>
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content">
          <div class="stats-row">
            <div class="stat-card">
              <div class="label">${t('sessions.stat.active')}</div>
              <div class="stat-value grad-text" id="stat-active">0</div>
              <div class="stat-sub">${t('sessions.stat.activeSub')}</div>
            </div>
            <div class="stat-card">
              <div class="label">${t('sessions.stat.completed')}</div>
              <div class="stat-value" id="stat-done">0</div>
              <div class="stat-sub">${t('sessions.stat.completedSub')}</div>
            </div>
            <div class="stat-card">
              <div class="label">${t('sessions.stat.avgTurns')}</div>
              <div class="stat-value" id="stat-rounds">0</div>
              <div class="stat-sub">${t('sessions.stat.avgTurnsSub')}</div>
            </div>
            <div class="stat-card">
              <div class="label">${t('sessions.stat.activeAgents')}</div>
              <div class="stat-value" id="stat-agents">0</div>
              <div class="stat-sub">${t('sessions.stat.activeAgentsSub')}</div>
            </div>
          </div>

          <div id="view-sessions">
            <div class="flex-between mb-24">
              <h3>${t('sessions.recentTitle')}</h3>
              <input type="text" class="input" placeholder="${t('sessions.searchPlaceholder')}" style="width: 240px;">
            </div>
            <div id="session-cards" class="session-cards"></div>
          </div>
        </div>
      </div>
    </div>
  `

  updateThemeButton()
  loadSessionsData()
}

function renderTasks() {
  state.currentSessionId = null
  state.currentSession = null
  state.currentTaskId = null
  state.currentTask = null
  state.currentPipelineId = null
  state.currentPipeline = null
  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('tasks')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <h2>${t('task_title')}</h2>
          </div>
          <div class="topbar-right">
            <button class="btn btn-primary btn-sm" onclick="window.showNewTaskModal()">${t('task_new')}</button>
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content">
          <div class="stats-row">
            <div class="stat-card">
              <div class="label">${t('task_stat_running')}</div>
              <div class="stat-value grad-text" id="task-stat-running">0</div>
              <div class="stat-sub">${t('task_stat_running_sub')}</div>
            </div>
            <div class="stat-card">
              <div class="label">${t('task_stat_queued')}</div>
              <div class="stat-value" id="task-stat-queued">0</div>
              <div class="stat-sub">${t('task_stat_queued_sub')}</div>
            </div>
            <div class="stat-card">
              <div class="label">${t('task_stat_completed')}</div>
              <div class="stat-value" id="task-stat-done">0</div>
              <div class="stat-sub">${t('task_stat_completed_sub')}</div>
            </div>
            <div class="stat-card">
              <div class="label">${t('task_stat_failed')}</div>
              <div class="stat-value" id="task-stat-error">0</div>
              <div class="stat-sub">${t('task_stat_failed_sub')}</div>
            </div>
          </div>

          <div class="flex-between mb-24">
            <h3>${t('task_recent_title')}</h3>
          </div>
          <div id="task-cards" class="session-cards task-cards"></div>
        </div>
      </div>
    </div>
  `

  updateThemeButton()
  loadTasksData()
}

async function loadTasksData() {
  // Reset pagination state for a fresh list-page entry.
  state.taskListOffset = 0
  state.taskListHasMore = false
  state.taskListLoadingMore = false

  // Abort any previous in-flight list load and start a fresh one.
  if (state.tasksListController) state.tasksListController.abort()
  state.tasksListController = new AbortController()
  const myToken = state.viewToken
  const signal = state.tasksListController.signal

  try {
    await Promise.all([
      loadTasks(signal),
      loadAgents(),
    ])
  } catch (err) {
    if (isAbortedErr(err)) return
  }
  // Stale guard: user navigated away while the list was loading.
  if (state.viewToken !== myToken || location.pathname !== '/tasks') return
  renderTaskStats()
  renderTaskCards()
}

function renderTaskStats() {
  const running = document.getElementById('task-stat-running')
  const queued = document.getElementById('task-stat-queued')
  const done = document.getElementById('task-stat-done')
  const error = document.getElementById('task-stat-error')
  if (running) running.textContent = state.tasks.filter(task => task.status === 'running').length
  if (queued) queued.textContent = state.tasks.filter(task => task.status === 'queued').length
  if (done) done.textContent = state.tasks.filter(task => task.status === 'done').length
  if (error) error.textContent = state.tasks.filter(task => task.status === 'error').length
}

function renderTaskCards() {
  const container = document.getElementById('task-cards')
  if (!container) return
  if (state.tasks.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 40px;">${t('task_empty')}</p>`
    stopTaskRunningTimer()
    return
  }
  const cards = state.tasks.map(task => {
    const isRunning = task.status === 'running' && task.startedAt
    const startedMs = isRunning ? new Date(task.startedAt).getTime() : 0
    return `
    <a href="/task/${task.id}" class="card session-card task-card">
      <div class="session-card-header">
        <span class="session-card-title">${escapeHtml(taskTitle(task))}</span>
        <span class="badge ${taskBadgeClass(task.status)}">${escapeHtml(taskStatusLabel(task.status))}</span>
      </div>
      <div class="task-card-agent">${escapeHtml(agentLabel(task.agent))}</div>
      <div class="task-card-prompt">${escapeHtml(taskSubtitle(task))}</div>
      <div class="session-card-meta">
        ${isRunning
          ? `<span class="task-running-elapsed" data-task-start="${startedMs}">${t('task_running_elapsed', { duration: formatDuration(Date.now() - startedMs) })}</span>`
          : `<span>⏱ ${formatTime(task.updatedAt)}</span>`}
        ${task.cwd ? `<span>⌂ ${escapeHtml(task.cwd)}</span>` : ''}
      </div>
    </a>
  `}).join('')

  container.innerHTML = state.taskListHasMore
    ? `${cards}<div id="task-load-more" style="grid-column: 1 / -1;">${tasksLoadMoreButtonHtml()}</div>`
    : cards

  syncTaskRunningTimer()
}

function tasksLoadMoreButtonHtml() {
  const loading = state.taskListLoadingMore
  return `<button class="btn btn-ghost btn-sm" style="width: 100%; justify-content: center;" onclick="window.loadMoreTasks()" ${loading ? 'disabled' : ''}>${loading ? t('task_loading') : t('task_load_more')}</button>`
}

function renderTasksLoadMoreButton() {
  const el = document.getElementById('task-load-more')
  if (el) el.innerHTML = tasksLoadMoreButtonHtml()
}

// "Load more" handler for the tasks list page. Guarded against rapid
// double-clicks and aborted when the user navigates away. Older items are
// appended with id-based dedup so live (prepended) updates never produce
// duplicates.
async function loadMoreTasks() {
  if (state.taskListLoadingMore || !state.taskListHasMore) return
  if (location.pathname !== '/tasks') return
  state.taskListLoadingMore = true
  renderTasksLoadMoreButton()
  const myToken = state.viewToken
  try {
    await loadTasks(undefined, { offset: state.taskListOffset, append: true })
  } catch (err) {
    if (isAbortedErr(err)) return
  } finally {
    state.taskListLoadingMore = false
  }
  if (state.viewToken !== myToken || location.pathname !== '/tasks') return
  renderTaskCards()
}

async function loadSessionsData() {
  // Abort any previous in-flight list load and start a fresh one.
  if (state.sessionsListController) state.sessionsListController.abort()
  state.sessionsListController = new AbortController()
  const myToken = state.viewToken
  const signal = state.sessionsListController.signal

  try {
    await Promise.all([
      loadSessions(signal),
      loadAgents(),
      loadStats()
    ])
  } catch (err) {
    if (isAbortedErr(err)) return
  }
  // Stale guard: user navigated away while the list was loading.
  if (state.viewToken !== myToken || location.pathname !== '/sessions') return

  state.sessionsLoaded = true
  renderSessionStats()
  renderSessionCards()
}

// Check whether a timestamp falls on the same local calendar day as now,
// using the browser's timezone (not the server's).
function isSameLocalDay(timestamp) {
  if (!timestamp) return false
  const date = new Date(timestamp)
  const now = new Date()
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
}

function renderSessionStats() {
  const statActive = document.getElementById('stat-active')
  const statDone = document.getElementById('stat-done')
  const statRounds = document.getElementById('stat-rounds')
  const statAgents = document.getElementById('stat-agents')
  const sessions = state.sessions || []
  const active = sessions.filter(s => s.status === 'active').length
  const doneToday = sessions.filter(s => s.status === 'done' && isSameLocalDay(s.updatedAt)).length
  const totalRounds = sessions.reduce((sum, s) => sum + (Number(s.currentRound) || 0), 0)
  const avgRounds = sessions.length > 0 ? totalRounds / sessions.length : 0
  const configuredAgents = (state.agents || []).filter(a => a.status !== 'invalid' && a.status !== 'discovered').length

  if (statActive) statActive.textContent = active
  if (statDone) statDone.textContent = doneToday
  if (statRounds) statRounds.textContent = formatStatNumber(avgRounds)
  if (statAgents) statAgents.textContent = configuredAgents
}

/**
 * First-run onboarding. Shown in place of the empty sessions list. Adapts to the
 * agent landscape so a new user always has an obvious next step:
 *   - no agents at all       → "connect a model" (API key or CLI)
 *   - agents but none ready  → "verify your agents" (run diagnostics)
 *   - at least one ready     → "you're all set, start a session"
 * No backend endpoint is needed — it derives state from the existing /api/agents
 * status field (ready / unverified / discovered / invalid / no_key).
 */
function renderOnboardingPanel() {
  const agents = state.agents || []
  const ready = agents.filter((a) => a.status === 'ready')
  const present = agents.filter((a) => a.status !== 'invalid')
  const apiAgents = present.filter((a) => a.kind === 'api')
  const cliAgents = present.filter((a) => a.kind === 'local')

  if (ready.length > 0) {
    return `
      <div class="onboarding-panel">
        <div class="onboarding-icon">✓</div>
        <h3>${t('sessions.onboarding.ready')}</h3>
        <p>${t('sessions.onboarding.readyDesc', { count: ready.length })}</p>
        <div class="onboarding-actions">
          <button class="btn btn-primary" onclick="window.showTemplateGalleryModal()">${t('sessions.newSession')}</button>
          <a class="btn btn-ghost" href="/settings">${t('sessions.onboarding.manageAgents')}</a>
        </div>
      </div>
    `
  }

  if (present.length === 0) {
    return `
      <div class="onboarding-panel">
        <div class="onboarding-icon">→</div>
        <h3>${t('sessions.onboarding.welcome')}</h3>
        <p>${t('sessions.onboarding.welcomeDesc')}</p>
        <div class="onboarding-tiles">
          <div class="onboarding-tile">
            <div class="onboarding-tile-icon">🔑</div>
            <h4>${t('sessions.onboarding.apiModel')}</h4>
            <p>${t('sessions.onboarding.apiModelDesc')}</p>
            <button class="btn btn-primary btn-sm" onclick="window.navigate('/settings')">${t('sessions.onboarding.addApiKey')}</button>
          </div>
          <div class="onboarding-tile">
            <div class="onboarding-tile-icon">⌨️</div>
            <h4>${t('sessions.onboarding.localCli')}</h4>
            <p>${t('sessions.onboarding.localCliDesc')}</p>
            <a class="btn btn-secondary btn-sm" href="/settings">${t('sessions.onboarding.viewDiscovered')}</a>
          </div>
        </div>
        <p class="onboarding-hint">${t('sessions.onboarding.settingsHint')}</p>
      </div>
    `
  }

  // Agents exist but none verified-ready.
  const unverified = present.filter((a) => a.status === 'unverified' || a.status === 'discovered')
  const unverifiedList = unverified.length
    ? unverified.map((a) => `<li><span class="onboarding-agent-name">${escapeHtml(a.name)}</span><span class="onboarding-agent-status onboarding-agent-status--${a.status}">${statusLabel(a.status)}</span></li>`).join('')
    : ''
  return `
    <div class="onboarding-panel">
      <div class="onboarding-icon">!</div>
      <h3>${t('sessions.onboarding.unverifiedTitle')}</h3>
      <p>${t('sessions.onboarding.unverifiedDesc', { apiCount: apiAgents.length, cliCount: cliAgents.length })}</p>
      ${unverifiedList ? `<ul class="onboarding-agent-list">${unverifiedList}</ul>` : ''}
      <p class="onboarding-hint">${t('sessions.onboarding.unverifiedHint')}</p>
      <div class="onboarding-actions">
        <button class="btn btn-primary" onclick="window.refreshAgentsAndRender()">${t('sessions.onboarding.retest')}</button>
        <a class="btn btn-ghost" href="/settings">${t('sessions.onboarding.goToSettings')}</a>
      </div>
    </div>
  `
}

function statusLabel(status) {
  switch (status) {
    case 'ready': return t('status.ready')
    case 'unverified': return t('status.unverified')
    case 'discovered': return t('status.discovered')
    case 'no_key': return t('status.no_key')
    case 'invalid': return t('status.invalid')
    default: return status
  }
}

/**
 * Map an agent status to a badge color class. `unverified` (installed but not
 * confirmed callable — e.g. a lapsed subscription) is a warning, NOT an error:
 * the binary is there, it just hasn't passed a smoke test. Only `invalid`
 * (broken / misconfigured) is red.
 */
function statusBadgeClass(status) {
  switch (status) {
    case 'ready': return 'active'
    case 'unverified':
    case 'discovered':
    case 'no_key': return 'paused'
    default: return 'error'
  }
}

window.refreshAgentsAndRender = async function () {
  try {
    state.agents = await api('/api/agents?refresh=1')
  } catch (err) {
    console.error('refresh failed', err)
  }
  render()
}

function renderSessionCards() {
  const container = document.getElementById('session-cards')
  if (!container) return

  if (state.sessions.length === 0) {
    // Distinguish "still loading" from "genuinely empty". Only show the
    // onboarding panel once we've actually fetched the (empty) list — otherwise
    // users with existing sessions see a flash of onboarding on every load.
    container.innerHTML = state.sessionsLoaded
      ? renderOnboardingPanel()
      : `<p style="color: var(--text-muted); text-align: center; padding: 40px;">${t('sessions.loading')}</p>`
    return
  }

  container.innerHTML = state.sessions.map(session => {
    const statusDisplay = t('session.status.' + session.status)
    return `
    <a href="/session/${session.id}" class="card session-card">
      <div class="session-card-header">
        <span class="session-card-title">${escapeHtml(sessionTitle(session))}</span>
        <span class="badge badge-${session.status}">${statusDisplay}</span>
      </div>
      <div class="session-card-route">
        <span>${escapeHtml(session.mode || 'session')}</span>
        ${session.cwd ? `<span class="route-arrow">·</span><span>${escapeHtml(session.cwd)}</span>` : ''}
      </div>
      <div class="session-card-meta">
        <span>⟳ ${t('sessions.turns', { count: session.currentRound })}</span>
        <span>⏱ ${formatTime(session.updatedAt)}</span>
      </div>
    </a>
  `}).join('')
}

function renderWorkflows() {
  state.currentSessionId = null
  state.currentSession = null
  state.currentTaskId = null
  state.currentTask = null
  state.currentPipelineId = null
  state.currentPipeline = null
  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('workflows')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <h2>${t('wf_title')}</h2>
          </div>
          <div class="topbar-right">
            <button class="btn btn-primary btn-sm" onclick="window.showNewWorkflowModal()">${t('wf_new')}</button>
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content">
          <div class="flex-between mb-24">
            <h3>${t('wf_recent')}</h3>
          </div>
          <div id="pipeline-cards" class="session-cards workflow-cards"></div>
        </div>
      </div>
    </div>
  `

  updateThemeButton()
  loadWorkflowsData()
}

async function renderTask(id) {
  state.currentSessionId = null
  state.currentSession = null
  state.currentTaskId = id
  state.currentPipelineId = null
  state.currentPipeline = null

  // Abort any previous in-flight detail load and start a fresh one.
  if (state.taskDetailController) state.taskDetailController.abort()
  state.taskDetailController = new AbortController()
  const myToken = state.viewToken
  const signal = state.taskDetailController.signal

  let task = null
  try {
    task = await dedupeDetail(`task:${id}`, () => api(`/api/tasks/${id}`, 'GET', undefined, { signal }))
  } catch (err) {
    if (isAbortedErr(err)) return
    if (state.viewToken !== myToken || state.currentTaskId !== id) return
    document.body.innerHTML = `<div>${t('task_not_found')}</div>`
    return
  }
  // Stale guard: user navigated away before the fetch resolved.
  if (state.viewToken !== myToken || state.currentTaskId !== id) return
  state.currentTask = task

  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('tasks')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <a href="/tasks" class="btn btn-ghost btn-sm">${t('task_back')}</a>
            <h2>${escapeHtml(taskTitle(task))}</h2>
            <span id="task-status-badge" class="badge ${taskBadgeClass(task.status)}">${escapeHtml(taskStatusLabel(task.status))}</span>
          </div>
          <div class="topbar-right" id="task-actions">
            ${renderTaskActions(task)}
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content task-detail" id="task-content"></div>
      </div>
    </div>
  `

  renderTaskContent(task)
  updateThemeButton()
}

function renderTaskActions(task) {
  if (task.status === 'queued' || task.status === 'running') {
    return `
      <button class="btn btn-secondary btn-sm" onclick="window.askOpsForCurrent()">${t('task_ask_ops')}</button>
      <button class="btn btn-danger btn-sm" onclick="window.stopCurrentTask()">${t('task_stop')}</button>
    `
  }
  const handoffButton = (task.status === 'error' || task.status === 'stopped')
    ? `<button class="btn btn-primary btn-sm" onclick="window.showTaskHandoffModal()">${t('handoff_button')}</button>`
    : ''
  return `
    <button class="btn btn-secondary btn-sm" onclick="window.askOpsForCurrent()">${t('task_ask_ops')}</button>
    <button class="btn btn-secondary btn-sm" onclick="window.restartCurrentTask()">${t('task_restart')}</button>
    ${handoffButton}
    <button class="btn btn-primary btn-sm" onclick="window.showTaskFeedbackModal()">${t('task_feedback_rerun')}</button>
  `
}

function renderTaskHeader(task) {
  const badge = document.getElementById('task-status-badge')
  if (badge) {
    badge.className = `badge ${taskBadgeClass(task.status)}`
    badge.textContent = taskStatusLabel(task.status)
  }
  const actions = document.getElementById('task-actions')
  if (actions) {
    actions.innerHTML = `
      ${renderTaskActions(task)}
      <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
      ${renderUserMenu()}
    `
    updateThemeButton()
  }
}

function renderWorkspaceWarning(task) {
  const ws = task.workspaceState
  if (ws && ws.dirty !== undefined) {
    const hasNewData = ws.preexistingFileCount !== undefined || ws.preexistingFiles !== undefined

    if (hasNewData) {
      const hasAgentChanges = ws.changedFileCount > 0
      const hasPreexisting = (ws.preexistingFileCount ?? 0) > 0

      if (!hasAgentChanges && hasPreexisting) {
        const preexistingRows = (ws.preexistingFiles || []).map(f => `<li>${escapeHtml(f)}</li>`).join('')
        return `
          <section class="workspace-warning workspace-warning-neutral">
            <div class="workspace-warning-title">${t('task_workspace_preexisting_only')}</div>
            <details class="workspace-warning-files">
              <summary>${t('task_workspace_view_files', { count: ws.preexistingFileCount })}</summary>
              <ul class="workspace-warning-file-list">${preexistingRows}</ul>
            </details>
          </section>
        `
      }

      const fileRows = (ws.files || []).map(f => `<li>${escapeHtml(f)}</li>`).join('')
      let preexistingSection = ''
      if (hasPreexisting) {
        const preexistingRows = (ws.preexistingFiles || []).map(f => `<li>${escapeHtml(f)}</li>`).join('')
        preexistingSection = `
          <details class="workspace-warning-files workspace-warning-preexisting">
            <summary>${t('task_workspace_preexisting_extra', { count: ws.preexistingFileCount })}</summary>
            <ul class="workspace-warning-file-list">${preexistingRows}</ul>
          </details>
        `
      }
      return `
        <section class="workspace-warning">
          <div class="workspace-warning-title">${t('task_workspace_changed_unfinished', { count: ws.changedFileCount })}</div>
          <details class="workspace-warning-files">
            <summary>${t('task_workspace_view_changes')}</summary>
            <ul class="workspace-warning-file-list">${fileRows}</ul>
          </details>
          ${preexistingSection}
        </section>
      `
    }

    const fileRows = (ws.files || []).map(f => `<li>${escapeHtml(f)}</li>`).join('')
    return `
      <section class="workspace-warning">
        <div class="workspace-warning-title">${t('task_workspace_changed_unfinished_simple', { count: ws.changedFileCount })}</div>
        <details class="workspace-warning-files">
          <summary>${t('task_workspace_view_changes')}</summary>
          <ul class="workspace-warning-file-list">${fileRows}</ul>
        </details>
      </section>
    `
  }
  return `
    <section class="workspace-warning">
      <div class="workspace-warning-title">${t('task_workspace_check', { cwd: `<code class="workspace-warning-cwd">${escapeHtml(task.cwd)}</code>` })}</div>
    </section>
  `
}

function renderTaskCommits(task) {
  const commits = Array.isArray(task.gitCommits) ? task.gitCommits : []
  if (!commits.length) return ''
  const rows = commits.map((commit) => {
    const hash = String(commit.hash || '')
    const shortHash = hash.slice(0, 7)
    const committedAt = Number.isFinite(commit.committedAt) ? new Date(commit.committedAt).toLocaleString() : ''
    return `
      <li class="task-commit">
        <span class="task-commit-hash mono">${escapeHtml(shortHash)}</span>
        <span class="task-commit-subject">${escapeHtml(commit.subject || '')}</span>
        ${committedAt ? `<span class="task-commit-time">${escapeHtml(committedAt)}</span>` : ''}
      </li>
    `
  }).join('')
  return `
    <div class="divider"></div>
    <div class="label mb-8">${t('task_commits_title')}</div>
    <ul class="task-commit-list">${rows}</ul>
  `
}

function renderTaskContent(task) {
  const container = document.getElementById('task-content')
  if (!container || !task) return
  const showFullOutput = task.output && !sameTaskText(task.output, task.result)
  container.innerHTML = `
    <div class="task-main">
      ${task.status === 'error' && task.cwd ? renderWorkspaceWarning(task) : ''}
      <section class="card task-section">
        <div class="label mb-8">${t('task_section_prompt')}</div>
        <div class="task-copy">${renderMarkdownCached(task.prompt || '')}</div>
      </section>
      ${task.result ? `
        <section class="card task-section">
          <div class="label mb-8">${t('task_section_result')}</div>
          <div class="task-copy">${renderMarkdownCached(task.result)}</div>
        </section>
      ` : ''}
      ${showFullOutput ? `
        <section class="card task-section">
          <div class="label mb-8">${t('task_section_full_output')}</div>
          <div class="task-copy">${renderMarkdownCached(task.output)}</div>
        </section>
      ` : ''}
      ${task.errorMessage ? `
        <section class="error-box">
          <div class="error-title">${t('task_section_error_title')}</div>
          <div class="error-detail">${escapeHtml(task.errorMessage)}</div>
        </section>
      ` : ''}
    </div>
    <aside class="card task-meta">
      <div class="label mb-16">${t('task_info')}</div>
      <div class="panel-kv">
        <div class="panel-kv-row"><span class="kv-label">${t('task_info_id')}</span><span class="kv-value mono">${escapeHtml(task.id.slice(0, 12))}</span></div>
        <div class="panel-kv-row"><span class="kv-label">${t('task_info_agent')}</span><span class="kv-value">${escapeHtml(agentLabel(task.agent))}</span></div>
        <div class="panel-kv-row"><span class="kv-label">${t('task_info_status')}</span><span class="badge ${taskBadgeClass(task.status)}">${escapeHtml(taskStatusLabel(task.status))}</span></div>
        ${task.metadata?.continuedFromTaskId ? `<div class="panel-kv-row"><span class="kv-label">${t('handoff_source')}</span><span class="kv-value mono">${escapeHtml(String(task.metadata.continuedFromTaskId).slice(0, 8))}</span></div>` : ''}
        <div class="panel-kv-row"><span class="kv-label">${t('task_info_created')}</span><span class="kv-value">${new Date(task.createdAt).toLocaleString()}</span></div>
        ${task.startedAt ? `<div class="panel-kv-row"><span class="kv-label">${t('task_info_started')}</span><span class="kv-value">${new Date(task.startedAt).toLocaleString()}</span></div>` : ''}
        ${task.finishedAt ? `<div class="panel-kv-row"><span class="kv-label">${t('task_info_finished')}</span><span class="kv-value">${new Date(task.finishedAt).toLocaleString()}</span></div>` : ''}
        ${task.cwd ? `<div class="panel-kv-row"><span class="kv-label">${t('task_info_cwd')}</span><span class="kv-value mono">${escapeHtml(task.cwd)}</span></div>` : ''}
      </div>
      ${renderTaskCreationDetails(task)}
      ${renderTaskCommits(task)}
      ${task.status !== 'queued' && task.status !== 'running' ? `
        <div class="divider"></div>
        <div style="display: grid; gap: 10px;">
          <button class="btn btn-secondary btn-sm" style="width: 100%;" onclick="window.restartCurrentTask()">${t('task_restart')}</button>
          ${(task.status === 'error' || task.status === 'stopped') ? `<button class="btn btn-primary btn-sm" style="width: 100%;" onclick="window.showTaskHandoffModal()">${t('handoff_button')}</button>` : ''}
          <button class="btn btn-primary btn-sm" style="width: 100%;" onclick="window.showTaskFeedbackModal()">${t('task_feedback_rerun')}</button>
        </div>
      ` : ''}
      ${(task.lastAgentOutput || task.status === 'queued' || task.status === 'running') ? `
        <div class="divider"></div>
        <div class="label mb-8">${t('task_live_output')}</div>
        <pre id="task-live-output" class="code-block task-live-output">${escapeHtml(task.lastAgentOutput || t('task_live_output_waiting'))}</pre>
      ` : ''}
    </aside>
  `
  updateTaskLiveOutput(task)
}

function updateTaskLiveOutput(task) {
  const output = document.getElementById('task-live-output')
  if (!output || !task) return
  output.textContent = task.lastAgentOutput || t('task_live_output_waiting')
  output.scrollTop = output.scrollHeight
}

function sameTaskText(a, b) {
  if (!a || !b) return false
  return String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim()
}

async function loadWorkflowsData() {
  // Reset pagination state for a fresh list-page entry.
  state.pipelineListOffset = 0
  state.pipelineListHasMore = false
  state.pipelineListLoadingMore = false

  // Abort any previous in-flight list load and start a fresh one.
  if (state.pipelinesListController) state.pipelinesListController.abort()
  state.pipelinesListController = new AbortController()
  const myToken = state.viewToken
  const signal = state.pipelinesListController.signal

  try {
    await loadPipelines(signal)
  } catch (err) {
    if (isAbortedErr(err)) return
  }
  // Stale guard: user navigated away while the list was loading.
  if (state.viewToken !== myToken || location.pathname !== '/workflows') return
  renderPipelineCards()
}

// "Load more" handler for the workflows list page. Guarded against rapid
// double-clicks and aborted when the user navigates away. Older items are
// appended with id-based dedup so live (prepended) updates never produce
// duplicates.
async function loadMorePipelines() {
  if (state.pipelineListLoadingMore || !state.pipelineListHasMore) return
  if (location.pathname !== '/workflows') return
  state.pipelineListLoadingMore = true
  renderLoadMoreButton()
  const myToken = state.viewToken
  try {
    await loadPipelines(undefined, { offset: state.pipelineListOffset, append: true })
  } catch (err) {
    if (isAbortedErr(err)) return
  } finally {
    state.pipelineListLoadingMore = false
  }
  if (state.viewToken !== myToken || location.pathname !== '/workflows') return
  renderPipelineCards()
}

function renderPipelineCards() {
  const container = document.getElementById('pipeline-cards')
  if (!container) return

  if (state.pipelines.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 40px;">${t('wf_empty')}</p>`
    return
  }

  const cards = state.pipelines.map(pipeline => `
    <a href="/workflow/${pipeline.id}" class="card session-card workflow-card">
      <div class="session-card-header">
        <span class="session-card-title">${escapeHtml(pipeline.name || t('wf_untitled'))}</span>
        <span class="badge badge-${pipeline.status}">${escapeHtml(workflowStatusLabel(pipeline.status))}</span>
      </div>
      ${renderStepRail(pipeline.sessions || [])}
      <div class="session-card-meta">
        <span>${t('wf_steps', { count: (pipeline.sessions || []).length })}</span>
        <span>${t('wf_created', { time: formatTime(pipeline.createdAt) })}</span>
      </div>
    </a>
  `).join('')

  container.innerHTML = state.pipelineListHasMore
    ? `${cards}<div id="pipeline-load-more" style="grid-column: 1 / -1;">${loadMoreButtonHtml()}</div>`
    : cards
}

function loadMoreButtonHtml() {
  const loading = state.pipelineListLoadingMore
  return `<button class="btn btn-ghost btn-sm" style="width: 100%; justify-content: center;" onclick="window.loadMorePipelines()" ${loading ? 'disabled' : ''}>${loading ? t('wf_loading') : t('wf_load_more')}</button>`
}

function renderLoadMoreButton() {
  const el = document.getElementById('pipeline-load-more')
  if (el) el.innerHTML = loadMoreButtonHtml()
}

async function renderWorkflow(id) {
  if (state.currentPipelineId && state.currentPipelineId !== id) {
    stopWorkflowSpeechRecognition()
    state.liveReviewStep = null
  }
  state.currentSessionId = null
  state.currentSession = null
  state.currentPipelineId = id
  state.expandedWorkflowStep = state.expandedWorkflowStep || null

  // Abort any previous in-flight detail load and start a fresh one.
  if (state.pipelineDetailController) state.pipelineDetailController.abort()
  state.pipelineDetailController = new AbortController()
  const myToken = state.viewToken
  const signal = state.pipelineDetailController.signal

  let pipeline = null
  try {
    pipeline = await dedupeDetail(`pipeline:${id}`, () => api(`/api/pipelines/${id}`, 'GET', undefined, { signal }))
  } catch (err) {
    if (isAbortedErr(err)) return
    if (state.viewToken !== myToken || state.currentPipelineId !== id) return
    document.body.innerHTML = `<div>${t('wf_not_found')}</div>`
    return
  }
  // Stale guard: user navigated away before the fetch resolved.
  if (state.viewToken !== myToken || state.currentPipelineId !== id) return

  state.currentPipeline = pipeline
  state.workflowFileAliases = new Map()
  state.workflowNestedFiles = new Map()
  state.workflowFileResolution = new Map()
  invalidateWorkflowStepCache()

  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('workflows')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <a href="/workflows" class="btn btn-ghost btn-sm">${t('wf_back')}</a>
            <h2 id="workflow-title">${escapeHtml(pipeline.name || t('wf_untitled'))}</h2>
            <span id="workflow-status-badge" class="badge badge-${pipeline.status}">${escapeHtml(workflowStatusLabel(pipeline.status))}</span>
          </div>
          <div class="topbar-right" id="workflow-actions">
            ${renderWorkflowActions(pipeline)}
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content workflow-detail">
          <div class="workflow-map" id="workflow-steps"></div>
          <div class="workflow-timeline card" id="workflow-timeline"></div>
        </div>
      </div>
    </div>
  `

  renderWorkflowSteps(pipeline)
  renderWorkflowTimeline(pipeline)
  hydrateWorkflowFileReferences(pipeline)
  updateThemeButton()
}

function renderWorkflowActions(pipeline) {
  return `
    <button class="btn btn-secondary btn-sm" onclick="window.askOpsForCurrent()">${t('wf_ask_ops')}</button>
    ${pipeline.status === 'active' ? `<button class="btn btn-secondary btn-sm" onclick="window.pauseWorkflow()">${t('wf_pause')}</button>` : ''}
    ${pipeline.status === 'paused' ? `<button class="btn btn-primary btn-sm" onclick="window.resumeWorkflow()">${t('wf_resume')}</button>` : ''}
    <button class="btn btn-ghost btn-sm" onclick="window.deleteCurrentWorkflow()">${t('wf_delete')}</button>
  `
}

function renderWorkflowHeader(pipeline) {
  const title = document.getElementById('workflow-title')
  if (title) title.textContent = pipeline.name || t('wf_untitled')

  const badge = document.getElementById('workflow-status-badge')
  if (badge) {
    badge.className = `badge badge-${pipeline.status}`
    badge.textContent = workflowStatusLabel(pipeline.status)
  }

  const actions = document.getElementById('workflow-actions')
  if (actions) {
    actions.innerHTML = `
      ${renderWorkflowActions(pipeline)}
      <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
      ${renderUserMenu()}
    `
    updateThemeButton()
  }
}

function workflowStatusLabel(status) {
  return t(`wf_status_${status}`) || status
}

// ── Workflow detail: bounded memoization of per-step render ───────────────────
// renderWorkflowTimelineStep is the hot path on the /workflow/:id view: it runs
// artifact-file extraction, file-resolution lookups and markdown parsing for
// every step. On a WebSocket burst only the changed step's inputs differ, so we
// memoize each step's HTML string keyed by sessionId and reuse the cached value
// when a signature of its inputs is unchanged. The cache is bounded (LRU) and
// invalidated whenever workflow step/session data or file-resolution state
// changes (see invalidateWorkflowStepCache call sites).
const WORKFLOW_STEP_CACHE_MAX = 64
const workflowStepCache = new Map()

// Build a stable, cheap fingerprint of every input that affects a step's render.
// A missed dependency here would serve stale HTML, so this captures all state
// read by renderWorkflowTimelineStep / renderWorkflowLiveReview (status, rounds,
// messages, expanded/live-review flags, stream + heartbeat status, file
// resolution via hydrate-driven invalidation, and markdown-lib availability).
function workflowStepRenderSignature(step, session, index, totalSteps) {
  const sessionId = step?.sessionId || ''
  const messages = session?.messages || []
  const live = state.liveReviewStep === sessionId
  const lastAgent = [...messages].reverse().find(message => message.from !== 'human')
  const artifact = state.liveReviewArtifacts.get(sessionId)
  const messagesDigest = messages
    .map(message => `${message.id || ''}:${message.from || ''}:${message.round ?? ''}:${(message.content || '').length}`)
    .join('|')
  return [
    sessionId,
    step?.status || '', step?.title || '', step?.nodeType || '', step?.errorMessage || '',
    JSON.stringify(step?.contract || null),
    (step?.dependsOn || []).map(stepIndexBySessionId).join(','),
    session?.status || '', session?.currentRound ?? '', session?.maxRounds ?? '',
    session?.permissionMode || '', session?.errorType || '', session?.errorMessage || '',
    session?.lastAgentOutput || '', session?.cwd || '',
    (session?.versions || []).length,
    JSON.stringify(session?.artifacts || null),
    messages.length, messagesDigest,
    lastAgent?.id || '', lastAgent?.content || '',
    index, totalSteps,
    state.expandedWorkflowStep === sessionId ? '1' : '0',
    live ? '1' : '0',
    artifact ? `${artifact.path || ''}:${(artifact.content || '').length}` : '',
    live ? (state.liveReviewDrafts.get(sessionId) || '') : '',
    live ? (state.liveReviewPending.has(sessionId) ? '1' : '0') : '',
    live ? (state.streamDeltas.get(sessionId)?.content || '') : '',
    state.streamStatus.get(sessionId) || '',
    state.heartbeats.get(sessionId)?.lastOutput || '',
    typeof marked === 'undefined' ? '0' : '1',
  ].join('\u0001')
}

// Memoized wrapper around renderWorkflowTimelineStep. Unchanged steps reuse the
// cached HTML string; changed (or newly invalidated) steps recompute and refill
// the LRU slot. Keeping this wrapper next to the cache makes the contract local.
function renderWorkflowTimelineStepMemo(step, session, index, totalSteps) {
  const key = step?.sessionId || `idx-${index}`
  const sig = workflowStepRenderSignature(step, session, index, totalSteps)
  const cached = workflowStepCache.get(key)
  if (cached && cached.sig === sig) {
    workflowStepCache.delete(key)
    workflowStepCache.set(key, cached)
    return cached.html
  }
  const html = renderWorkflowTimelineStep(step, session, index, totalSteps)
  if (workflowStepCache.size >= WORKFLOW_STEP_CACHE_MAX) {
    const oldest = workflowStepCache.keys().next().value
    workflowStepCache.delete(oldest)
  }
  workflowStepCache.set(key, { sig, html })
  return html
}

// Invalidate cached step HTML. Called with a sessionId to drop a single step
// (e.g. a message:delta for that session) or with no argument to clear every
// step (broad changes: new pipeline load, pipeline/session update, message:new).
// File-resolution mutations (hydrateWorkflowFileReferences) also clear all,
// because resolution state affects every step's file rendering.
function invalidateWorkflowStepCache(sessionId) {
  if (sessionId != null) workflowStepCache.delete(sessionId)
  else workflowStepCache.clear()
}

function renderWorkflowSteps(pipeline) {
  const container = document.getElementById('workflow-steps')
  if (!container || !pipeline) return
  const steps = pipeline.sessions || []
  const details = pipeline.sessionDetails || []
  const detailsById = new Map(details.map(session => [session.id, session]))
  container.innerHTML = `
    <div class="workflow-timeline-view">
      ${steps.map((step, index) => renderWorkflowTimelineStepMemo(step, detailsById.get(step.sessionId), index, steps.length)).join('')}
    </div>
  `
}

function renderWorkflowTimelineStep(step, session, index, totalSteps) {
  const expanded = state.expandedWorkflowStep === step.sessionId
  const dependsOn = step.dependsOn || []
  const title = step.title || inferWorkflowStepTitle(session, index)
  const currentRound = Number(session?.currentRound) || 0
  const maxRounds = Number(session?.maxRounds) || 0
  const status = step.status === 'pending' ? 'pending' : (session?.status || step.status)
  const approvalDependencies = dependsOn.map(id => ({ id, index: stepIndexBySessionId(id) }))
  const messages = session?.messages || []
  const output = workflowOutputMessage(messages)
  const cleaned = output ? output.replace(/\[DONE\]/gi, '').trim() : ''
  const hostImageRequired = step.nodeType === 'image_generate' && /HOST_IMAGE_GENERATION_REQUIRED/.test(cleaned)
  const canResumeStep = step.status === 'active' && !hostImageRequired && (session?.status === 'paused' || session?.status === 'error' || session?.status === 'stopped')
  const canRequestChanges = step.status === 'active' && (session?.status === 'paused' || session?.status === 'stopped') && approvalDependencies.length > 0
  const canManualArtifacts = step.nodeType === 'image_generate' && status !== 'done'
  const runningStatus = status === 'active'
    ? (state.streamStatus.get(step.sessionId) || summarizeRawStatus(state.heartbeats.get(step.sessionId)?.lastOutput || t('task_status_processing')))
    : ''
  const errorTitle = session?.errorType || (status === 'error' ? 'step_error' : '')
  const errorDetail = status === 'error' ? (session?.errorMessage || step.errorMessage || '') : ''
  const isLast = index === totalSteps - 1

  const waitingForHumanApproval = /\u7b49\u5f85\u4eba\u5de5(?:\u786e\u8ba4|\u5ba1\u6838|\u56de\u590d|\u8f93\u5165)|\u8bf7\u56de\u590d[\u201c"'` ]*(?:OK|\u901a\u8fc7|\u786e\u8ba4\u4fdd\u5b58)/i.test(cleaned)
  const files = session ? workflowSessionArtifactFiles(session, cleaned, step) : cleaned ? workflowArtifactFiles(cleaned) : []
  const liveReviewOpen = state.liveReviewStep === step.sessionId

  return `
    <div class="timeline-step ${status}" data-step-id="${step.sessionId}">
      <div class="timeline-axis">
        <div class="timeline-node ${status}">
          <span class="node-number">${index + 1}</span>
        </div>
        ${!isLast ? '<div class="timeline-connector"></div>' : ''}
      </div>

      <div class="timeline-content">
        <div class="step-header">
          <div class="step-header-main">
            <h3 class="step-title">${escapeHtml(title)}</h3>
            <span class="step-badge status-${status}">${escapeHtml(workflowStatusLabel(status))}</span>
          </div>
          <div class="step-meta">
            <span class="meta-item">
              <span class="meta-icon">#</span>
              ${escapeHtml(t('wf_step_title', { number: index + 1, title }))}
            </span>
            <span class="meta-item">
              <span class="meta-icon">🔄</span>
              ${t('wf_rounds', { current: currentRound, max: maxRounds ? t('wf_rounds_max', { max: maxRounds }) : '' })}
            </span>
            <span class="meta-item ${session?.permissionMode === 'trusted' ? 'permission-trusted' : ''}">
              <span class="meta-icon">⚠</span>
              ${escapeHtml(session?.permissionMode || 'safe')}
            </span>
            ${step.nodeType ? `
              <span class="meta-item">
                <span class="meta-icon">◆</span>
                ${escapeHtml(workflowNodeTypeLabel(step.nodeType))}
              </span>
            ` : ''}
            ${step.contract?.outputs?.length ? `
              <span class="meta-item">
                <span class="meta-icon">↳</span>
                ${escapeHtml(step.contract.outputs.map(output => output.fileName).join(', '))}
              </span>
            ` : ''}
            ${dependsOn.length ? `
              <span class="meta-item">
                <span class="meta-icon">⛓</span>
                ${escapeHtml(t('wf_depends_on', { steps: dependsOn.map(id => stepIndexBySessionId(id) + 1).join(', ') }))}
              </span>
            ` : ''}
          </div>
        </div>

        ${runningStatus ? `
          <div class="step-running-status">
            <span class="running-spinner"></span>
            <span class="running-text">${escapeHtml(runningStatus)}</span>
          </div>
        ` : ''}

        ${errorDetail ? `
          <div class="step-error-status">
            <div class="step-error-title">⚠ ${escapeHtml(errorTitle)}</div>
            <div class="step-error-detail">${escapeHtml(errorDetail)}</div>
            ${session?.lastAgentOutput ? `<div class="step-error-last-output">${escapeHtml(t('wf_last_output', { status: summarizeRawStatus(session.lastAgentOutput) }))}</div>` : ''}
          </div>
        ` : ''}

        ${canResumeStep || canRequestChanges || step.sessionId ? `
          <div class="step-actions">
            ${canResumeStep ? `<button class="action-btn primary" onclick='window.approveWorkflowStep(${jsString(step.sessionId)}, ${waitingForHumanApproval})'>${waitingForHumanApproval ? t('wf_approve_save') : t('wf_execute_step', { number: index + 1 })}</button>` : ''}
            <button class="action-btn secondary" onclick='window.rerunWorkflowStep(${jsString(step.sessionId)}, ${jsString(t('wf_step_title', { number: index + 1, title }))})'>${t('wf_rerun_step')}</button>
            ${canManualArtifacts ? `<button class="action-btn secondary" onclick='window.openManualArtifactsModal(${jsString(step.sessionId)}, ${jsString(t('wf_step_title', { number: index + 1, title }))})'>${t('wf_manual_artifacts')}</button>` : ''}
            ${canRequestChanges ? `<button class="action-btn secondary" onclick='window.requestWorkflowStepChanges(${jsString(step.sessionId)}, ${jsString(t('wf_step', { number: index + 1 }))})'>${t('wf_request_changes')}</button>` : ''}
            <button class="action-btn live-review-trigger ${liveReviewOpen ? 'active' : ''}" onclick='window.toggleWorkflowLiveReview(${jsString(step.sessionId)})'>◉ Live Review</button>
          </div>
        ` : ''}

        ${liveReviewOpen ? renderWorkflowLiveReview(step, session, index, cleaned, waitingForHumanApproval, canResumeStep) : ''}

        ${cleaned ? `
          <div class="step-output">
            <div class="output-header">
              <span class="output-label">
                <span class="output-icon">▸</span>
                ${t('wf_output')}
              </span>
              <div class="output-actions">
                ${session?.versions?.length ? `<button class="output-copy" onclick='window.showWorkflowStepVersions(${jsString(session.id)})'>${t('wf_versions', { count: session.versions.length })}</button>` : ''}
                <button class="output-copy" onclick='window.copyWorkflowStepArtifact(${jsString(cleaned)})'>
                  <span>⎘</span> ${t('wf_copy')}
                </button>
              </div>
            </div>

            ${files.length ? `
              <div class="output-files">
                <div class="files-label">${t('wf_generated_files', { count: files.length })}</div>
                <div class="files-list">
                  ${files.map((file, idx) => renderWorkflowFileItem(file, session?.cwd || '', idx === files.length - 1 ? '└─' : '├─')).join('')}
                </div>
              </div>
            ` : ''}

            <div class="output-content">
              ${renderWorkflowMarkdown(cleaned, session?.cwd || '')}
            </div>
          </div>
        ` : ''}

        ${expanded ? `
          <div class="step-messages">
            <button class="messages-toggle" onclick='window.toggleWorkflowStep(${jsString(step.sessionId)})'>
              ${t('wf_hide_conversation')}
            </button>
            ${renderWorkflowStepMessages(session)}
          </div>
        ` : `
          <button class="messages-toggle collapsed" onclick='window.toggleWorkflowStep(${jsString(step.sessionId)})'>
            ${t('wf_view_conversation')}
          </button>
        `}
      </div>
    </div>
  `
}

function renderWorkflowLiveReview(step, session, index, currentOutput, waitingForHumanApproval, canResumeStep) {
  const sessionId = step.sessionId
  const messages = session?.messages || []
  const reviewMessages = messages.filter(message => message.round > 0).slice(-10)
  const artifact = state.liveReviewArtifacts.get(sessionId)
  const reviewContent = artifact?.content || currentOutput
  const draft = state.liveReviewDrafts.get(sessionId) || ''
  const pending = state.liveReviewPending.has(sessionId)
  const busy = pending || session?.status === 'active'
  const stream = state.streamDeltas.get(sessionId)?.content || ''
  const status = state.streamStatus.get(sessionId) || (busy ? t('wf_live_status_busy') : t('wf_live_status_ready'))
  const speechSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  return `
    <section class="live-review" data-live-review="${escapeAttr(sessionId)}">
      <div class="live-review-head">
        <div>
          <div class="live-review-kicker">LIVE REVIEW · STEP ${index + 1}</div>
          <h4>${t('wf_live_title')}</h4>
        </div>
        <div class="live-review-status ${busy ? 'busy' : ''}">
          <span class="live-review-status-dot"></span>
          <span data-live-review-status="${escapeAttr(sessionId)}">${escapeHtml(status)}</span>
        </div>
      </div>

      <div class="live-review-grid">
        <div class="live-review-draft">
          <div class="live-review-section-head">
            <span>${t('wf_live_draft')}${artifact?.path ? ` · ${escapeHtml(workflowFileName(artifact.path))}` : ''}</span>
            ${session?.versions?.length ? `<button type="button" onclick='window.showWorkflowStepVersions(${jsString(sessionId)})'>${t('wf_history_count', { count: session.versions.length })}</button>` : ''}
          </div>
          <div class="live-review-draft-body" data-live-review-output="${escapeAttr(sessionId)}">
            ${reviewContent
              ? renderWorkflowMarkdown(reviewContent, session?.cwd || '')
              : `<p class="live-review-empty">${t('wf_live_empty_output')}</p>`}
          </div>
        </div>

        <div class="live-review-chat">
          <div class="live-review-thread">
            ${reviewMessages.length ? reviewMessages.map(message => `
              <div class="live-review-message ${message.from === 'human' ? 'human' : 'agent'}">
                <div class="live-review-message-label">${message.from === 'human' ? t('ops_user_role') : escapeHtml(message.from || 'AI')}</div>
                <div class="live-review-message-body">${renderWorkflowMarkdown(message.content || '', session?.cwd || '')}</div>
              </div>
            `).join('') : `<p class="live-review-empty">${t('wf_live_empty_thread')}</p>`}
            <div class="live-review-stream ${stream ? 'visible' : ''}" data-live-review-stream="${escapeAttr(sessionId)}">${escapeHtml(stream)}</div>
          </div>

          <form class="live-review-composer" onsubmit='window.submitWorkflowLiveReview(event, ${jsString(sessionId)})'>
            <textarea
              class="live-review-input"
              rows="3"
              placeholder="${escapeAttr(t('wf_live_placeholder'))}"
              oninput='window.updateWorkflowLiveReviewDraft(${jsString(sessionId)}, this.value)'
              onkeydown='window.handleWorkflowLiveReviewKeydown(event, ${jsString(sessionId)})'
            >${escapeHtml(draft)}</textarea>
            <div class="live-review-composer-actions">
              <button
                type="button"
                class="live-review-voice"
                onclick='window.toggleWorkflowVoice(${jsString(sessionId)})'
                ${speechSupported ? '' : `disabled title="${escapeAttr(t('wf_speech_unsupported'))}"`}
              >
                <span data-live-review-mic="${escapeAttr(sessionId)}">●</span>
                ${t('wf_voice_input')}
              </button>
              <button type="submit" class="action-btn primary" ${pending ? 'disabled' : ''}>${t('wf_send_modify')}</button>
            </div>
          </form>
        </div>
      </div>

      <div class="live-review-footer">
        <span>${t('wf_live_footer')}</span>
        <div>
          <button type="button" class="action-btn secondary" onclick="window.closeWorkflowLiveReview()">${t('wf_end_review')}</button>
          ${canResumeStep ? `<button type="button" class="action-btn primary" onclick='window.approveWorkflowStep(${jsString(sessionId)}, ${waitingForHumanApproval})'>${waitingForHumanApproval ? t('wf_approve_current') : t('wf_execute_current')}</button>` : ''}
        </div>
      </div>
    </section>
  `
}

function updateWorkflowLiveReviewStream(sessionId) {
  const status = document.querySelector(`[data-live-review-status="${CSS.escape(sessionId)}"]`)
  const stream = document.querySelector(`[data-live-review-stream="${CSS.escape(sessionId)}"]`)
  const content = state.streamDeltas.get(sessionId)?.content || ''
  if (status) status.textContent = state.streamStatus.get(sessionId) || t('wf_live_status_modifying')
  if (stream) {
    stream.textContent = content
    stream.classList.toggle('visible', Boolean(content))
  }
}

function renderWorkflowStepCard(step, session, index) {
  // Keep old function for compatibility, redirect to timeline
  return renderWorkflowTimelineStep(step, session, index, 999)
}

function renderWorkflowStepArtifact(session) {
  const messages = session?.messages || []
  const output = workflowOutputMessage(messages)
  if (!output) return ''
  const cleaned = output.replace(/\[DONE\]/gi, '').trim()
  if (!cleaned) return ''
  const files = workflowSessionArtifactFiles(session, cleaned)
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })
  return `
    <div class="workflow-step-artifact">
      <div class="artifact-terminal-header">
        <div class="terminal-status">
          <span class="status-dot"></span>
          <span class="status-text">${t('wf_output')}</span>
          <span class="status-time">${timestamp}</span>
        </div>
        <button class="terminal-action" onclick='window.copyWorkflowStepArtifact(${jsString(cleaned)})'>
          <span class="action-icon">⎘</span>
          <span class="action-label">${t('wf_terminal_copy')}</span>
        </button>
      </div>
      ${files.length ? `
        <div class="artifact-files-panel">
          <div class="files-panel-header">
            <span class="panel-indicator">▸</span>
            <span class="panel-title">${t('wf_generated_files_upper')}</span>
            <span class="panel-count">[${files.length}]</span>
          </div>
          <div class="files-tree">
            ${files.map((file, idx) => renderWorkflowFileItem(file, session?.cwd || '', idx === files.length - 1 ? '└─' : '├─')).join('')}
          </div>
        </div>
      ` : ''}
      <div class="artifact-content-panel">
        <div class="content-panel-header">
          <span class="panel-indicator">▸</span>
          <span class="panel-title">${t('wf_content_upper')}</span>
        </div>
        <div class="content-display">${renderWorkflowMarkdown(cleaned, session?.cwd || '')}</div>
      </div>
    </div>
  `
}

function workflowOutputMessage(messages) {
  const outputs = [...messages].reverse().filter(msg => msg.from !== 'human' && msg.content)
  return outputs.find(msg => extractWorkflowArtifactFiles(msg.content).length)?.content || outputs[0]?.content
}

function extractWorkflowArtifactFiles(content) {
  const files = new Set()
  const extensions = 'md|txt|log|json|yaml|yml|csv|tsv|png|jpe?g|webp|gif|svg|mp4|mov|webm|wav|mp3|m4a|aac|flac|pdf|docx|xlsx|pptx|zip'
  const fileExtensionPattern = new RegExp('\\.(' + extensions + ')$', 'i')
  const patterns = [
    new RegExp('`([^`]+\\.(' + extensions + '))`', 'gi'),
    new RegExp('(^|[\\s(\\uFF08"\\\',])(/[^\\s`\'"<>\\uFF0C\\u3002\\uFF1B\\uFF1A\\uFF1B\\u3001)\\uFF09,=\\\\]+?\\.(' + extensions + '))(?=$|[\\s`\'"<>\\uFF0C\\u3002\\uFF1B\\uFF1A\\uFF1B\\u3001)\\uFF09,=\\\\])', 'gim'),
    new RegExp('(^|[\\s(\\uFF08"\\\'])([\\w.\\-/\\u4e00-\\u9fa5]+/[^\\s`\'"<>\\uFF0C\\u3002\\uFF1B\\uFF1A\\uFF1B\\u3001)\\uFF09]+\\.(' + extensions + '))(?=$|[\\s`\'"<>\\uFF0C\\u3002\\uFF1B\\uFF1A\\uFF1B\\u3001)\\uFF09])', 'gim'),
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const file = match.slice(1).map(value => (value || '').trim()).find(value => fileExtensionPattern.test(value))
      if (file && !/^https?:\/\//i.test(file)) files.add(file)
    }
  }
  const directories = []
  for (const match of String(content || '').matchAll(/(?:\u76ee\u5f55|\u8def\u5f84|\u6587\u4ef6\u5939|\u8f93\u51fa\u76ee\u5f55|\u4fdd\u5b58\u76ee\u5f55)\s*[\uFF1A:]\s*`?([^`\n]+\/)`?/gi)) {
    const dir = String(match[1] || '').trim()
    if (dir && !/^https?:\/\//i.test(dir)) directories.push(dir)
  }
  for (const dir of directories) {
    for (const file of [...files]) {
      if (!file.includes('/') && fileExtensionPattern.test(file)) files.add(`${dir}${file}`)
    }
  }
  const extracted = [...files]
  const absoluteNames = new Set(extracted.filter(file => file.startsWith('/')).map(file => workflowFileName(file)))
  return extracted.filter(file => file.startsWith('/') || file.includes('/') || !absoluteNames.has(file))
}

function workflowArtifactFiles(content) {
  const files = extractWorkflowArtifactFiles(content)
  const expanded = new Set(files)
  for (const file of files) {
    for (const nested of state.workflowNestedFiles.get(resolveWorkflowFilePath(file)) || []) expanded.add(nested)
  }
  return [...expanded]
}

function workflowSessionArtifactFiles(session, selectedContent = '', step = undefined) {
  const files = []
  const add = value => {
    const file = String(value || '').trim()
    if (!file) return
    if (!files.includes(file)) files.push(file)
  }
  const directFiles = content => extractWorkflowArtifactFiles(content || '')
  for (const file of directFiles(selectedContent || '')) add(file)
  const lastHumanTimestamp = Math.max(0, ...(session?.messages || []).filter(message => message.from === 'human').map(message => Number(message.timestamp) || 0))
  for (const message of session?.messages || []) {
    if (message.from === 'human') continue
    if ((Number(message.timestamp) || 0) < lastHumanTimestamp) continue
    for (const file of directFiles(message.content || '')) add(file)
  }
  const artifacts = session?.artifacts || {}
  for (const file of artifacts.generatedFiles || []) {
    add(file)
  }
  for (const changed of artifacts.filesChanged || []) {
    if (changed?.path) add(changed.path)
  }
  if (step?.nodeType === 'video_parse') {
    for (const file of [...files]) {
      for (const nested of state.workflowNestedFiles.get(resolveWorkflowFilePath(file)) || []) add(nested)
    }
  }
  const qualifiedNames = new Set(files.filter(file => String(file).startsWith('/') || String(file).includes('/')).map(file => workflowFileName(file)))
  const deduped = []
  const seen = new Set()
  const outputs = step?.contract?.outputs || []
  for (const file of files) {
    if (!String(file).startsWith('/') && !String(file).includes('/') && qualifiedNames.has(workflowFileName(file))) continue
    const resolved = resolveWorkflowFilePath(file)
    const resolution = state.workflowFileResolution.get(resolved) || state.workflowFileResolution.get(String(file))
    if (outputs.length && step?.nodeType !== 'video_parse' && !outputs.some(output => workflowFileMatchesOutput(resolved, output.fileName))) continue
    const key = resolution === 'exists' ? resolved : String(file)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(resolved)
  }
  return deduped
}

function workflowFileMatchesOutput(file, pattern) {
  const name = workflowFileName(file)
  const expected = String(pattern || '').trim()
  if (!expected) return true
  if (expected.startsWith('*.')) return name.toLowerCase().endsWith(expected.slice(1).toLowerCase())
  return name === expected || String(file).endsWith(`/${expected}`)
}

function workflowLiveReviewArtifactFile(step, session, selectedContent = '') {
  const textFilePattern = /\.(md|txt|log|json|ya?ml|csv|tsv)$/i
  const files = workflowSessionArtifactFiles(session, selectedContent, step).filter(file => textFilePattern.test(file))
  const outputs = step?.contract?.outputs || []
  return files.find(file => outputs.some(output => workflowFileMatchesOutput(file, output.fileName))) || files[0] || ''
}

async function hydrateWorkflowLiveReviewArtifact(step, session, selectedContent = '', force = false) {
  const sessionId = step?.sessionId
  if (!sessionId || state.liveReviewArtifactLoading.has(sessionId)) return
  if (!force && state.liveReviewArtifacts.has(sessionId)) return
  const file = workflowLiveReviewArtifactFile(step, session, selectedContent)
  if (!file) return

  state.liveReviewArtifactLoading.add(sessionId)
  try {
    const preview = await api('/api/files/preview', 'POST', {
      path: resolveWorkflowFilePath(file),
      cwd: session?.cwd || undefined,
    })
    state.liveReviewArtifacts.set(sessionId, {
      path: preview.path || resolveWorkflowFilePath(file),
      content: preview.content || '',
    })
    if (state.liveReviewStep === sessionId) renderWorkflowSteps(state.currentPipeline)
  } catch {
    state.liveReviewArtifacts.delete(sessionId)
  } finally {
    state.liveReviewArtifactLoading.delete(sessionId)
  }
}

async function hydrateWorkflowFileReferences(pipeline) {
  const sessionFiles = new Map()
  for (const session of pipeline.sessionDetails || []) {
    const files = new Set()
    for (const message of session.messages || []) {
      for (const file of extractWorkflowArtifactFiles(message.content || '')) {
        files.add(file)
      }
    }
    for (const changed of session.artifacts?.filesChanged || []) {
      if (changed?.path) files.add(changed.path)
    }
    for (const file of session.artifacts?.generatedFiles || []) {
      if (file) files.add(file)
    }
    if (files.size) sessionFiles.set(session, [...files])
  }

  let changed = false
  const markdownFiles = []
  await Promise.all([...sessionFiles].map(async ([session, files]) => {
    const cwd = session.cwd || ''
    try {
      const resolvedFiles = await api('/api/files/resolve', 'POST', { paths: files, cwd: cwd || undefined })
      const resolvedByName = new Map()
      for (const result of resolvedFiles) {
        state.workflowFileResolution.set(result.source, result.exists ? 'exists' : 'missing')
        if (!result.exists || !result.path) continue
        if (String(result.source).startsWith('/') || String(result.source).includes('/')) {
          state.workflowFileAliases.set(result.source, result.path)
        }
        state.workflowFileResolution.set(result.path, 'exists')
        const name = workflowFileName(result.path)
        const matches = resolvedByName.get(name) || []
        matches.push(result.path)
        resolvedByName.set(name, matches)
        if (/\.md$/i.test(result.path)) markdownFiles.push({ file: result.path, cwd })
      }
      for (const result of resolvedFiles) {
        if (result.exists || String(result.source).includes('/')) continue
        const matches = [...new Set(resolvedByName.get(workflowFileName(result.source)) || [])]
        if (matches.length !== 1) continue
        state.workflowFileAliases.set(result.source, matches[0])
        state.workflowFileResolution.set(result.source, 'exists')
      }
      changed = true
    } catch {
      for (const file of files) state.workflowFileResolution.set(file, 'missing')
    }
  }))

  await Promise.all(markdownFiles.map(async ({ file, cwd }) => {
    try {
      const preview = await api('/api/files/preview', 'POST', { path: file, cwd: cwd || undefined })
      const nestedSources = extractWorkflowArtifactFiles(preview.content || '')
      const resolvedNested = nestedSources.length
        ? await api('/api/files/resolve', 'POST', { paths: nestedSources, cwd: cwd || undefined, baseFile: file })
        : []
      const nested = []
      for (const result of resolvedNested) {
        state.workflowFileResolution.set(result.source, result.exists ? 'exists' : 'missing')
        if (!result.exists || !result.path) continue
        state.workflowFileAliases.set(result.source, result.path)
        state.workflowFileResolution.set(result.path, 'exists')
        nested.push(result.path)
      }
      state.workflowNestedFiles.set(file, nested)
      for (const match of String(preview.content || '').matchAll(/([^,\s\\]+)=([\w.-]+)/g)) {
        if (/\.(png|jpe?g|webp|gif|svg)$/i.test(match[1])) state.workflowFileAliases.set(match[2], match[1])
      }
      changed = true
    } catch {}
  }))
  if (changed && state.currentPipelineId === pipeline.id) {
    // File-resolution/alias/nested maps changed: every step's file rendering
    // may differ, so drop all cached step HTML before rebuilding.
    invalidateWorkflowStepCache()
    renderWorkflowSteps(state.currentPipeline)
    const openStep = pipeline.sessions?.find(step => step.sessionId === state.liveReviewStep)
    const openSession = pipeline.sessionDetails?.find(session => session.id === state.liveReviewStep)
    if (openStep && openSession) {
      const output = workflowOutputMessage(openSession.messages || '') || ''
      hydrateWorkflowLiveReviewArtifact(openStep, openSession, output, true)
    }
  }
}

function workflowFileName(file) {
  return String(file).split('/').pop() || String(file)
}

function workflowFileMeta(file) {
  const name = workflowFileName(file)
  const ext = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
  let role = t('wf_file_role_file')
  if (/storyboard/i.test(name)) role = t('wf_file_role_storyboard')
  else if (/\u4e09\u89c6\u56fe|\u89d2\u8272|\u540c\u4e8b|\u4eba\u7269/.test(file) && /^(png|jpe?g|webp|gif)$/i.test(ext)) role = t('wf_file_role_character')
  else if (/prompt/i.test(name)) role = t('wf_file_role_prompt')
  else if (/script/i.test(name)) role = t('wf_file_role_script')
  else if (/reference/i.test(name)) role = t('wf_file_role_reference')
  else if (/commands?|\u547d\u4ee4/i.test(file)) role = t('wf_file_role_command')
  else if (/^(png|jpe?g|webp|gif|svg)$/i.test(ext)) role = t('wf_file_role_image')
  else if (/^(mp4|mov|webm)$/i.test(ext)) role = t('wf_file_role_video')
  else if (/^(md|txt|log|json|ya?ml)$/i.test(ext)) role = t('wf_file_role_text')
  return { name, role }
}

function resolveWorkflowFilePath(file) {
  const value = String(file)
  const aliased = state.workflowFileAliases.get(value)
  if (aliased) return aliased
  if (value.includes('/')) return value
  const matches = new Set()
  for (const session of state.currentPipeline?.sessionDetails || []) {
    for (const message of session.messages || []) {
      for (const candidate of extractWorkflowArtifactFiles(message.content || '')) {
        if (candidate.includes('/') && workflowFileName(candidate) === value) matches.add(candidate)
      }
    }
  }
  return matches.size === 1 ? [...matches][0] : value
}

function renderWorkflowFileItem(file, cwd, prefix = '├─') {
  const resolvedFile = resolveWorkflowFilePath(file)
  const meta = workflowFileMeta(resolvedFile)
  const resolution = state.workflowFileResolution.get(resolvedFile) || state.workflowFileResolution.get(String(file))
  const clickable = resolution !== 'missing'
  return `
    <button class="file-item ${clickable ? '' : 'file-item-unavailable'}" ${clickable ? `onclick='window.previewWorkflowFile(${jsString(resolvedFile)}, ${jsString(cwd || '')})'` : 'disabled'}>
      <span class="file-tree">${prefix}</span>
      <span class="file-info">
        <span class="file-name">${escapeHtml(meta.name)}</span>
        <span class="file-role">${escapeHtml(clickable ? meta.role : resolution === 'missing' ? t('wf_file_missing') : t('wf_file_checking'))}</span>
        <span class="file-location">${escapeHtml(resolvedFile)}</span>
      </span>
      <span class="file-arrow">${clickable ? '→' : '—'}</span>
    </button>
  `
}

function inferWorkflowStepTitle(session, index) {
  const initial = (session?.messages || []).find(msg => msg.from === 'human' && Number(msg.round) === 0)?.content || ''
  const quoted = initial.match(/“([^”]{2,24})”/)
  if (quoted?.[1]) return quoted[1]
  const firstLine = initial.split('\n').map(line => line.trim()).find(Boolean)
  if (firstLine) return firstLine.slice(0, 24)
  return `Step ${index + 1}`
}

function sessionTitle(session) {
  const provided = String(session?.displayTitle || '').trim()
  if (provided) return provided
  const initial = (session?.messages || []).find(msg => msg.from === 'human' && Number(msg.round) === 0)?.content || ''
  const firstLine = initial.split('\n').map(line => line.trim()).find(Boolean)
  if (firstLine) return firstLine.length > 56 ? `${firstLine.slice(0, 56)}...` : firstLine
  const mode = session?.mode ? `${session.mode} session` : 'Untitled session'
  return session?.cwd ? `${mode} · ${session.cwd}` : mode
}

function taskTitle(task) {
  const firstLine = String(task?.prompt || '').split('\n').map(line => line.trim()).find(Boolean)
  if (!firstLine) return t('task_untitled')
  return firstLine.length > 72 ? `${firstLine.slice(0, 72)}...` : firstLine
}

function taskSubtitle(task) {
  const lines = String(task?.prompt || '').split('\n').map(line => line.trim()).filter(Boolean)
  const rest = lines.slice(1).join(' ')
  if (rest) return rest.length > 120 ? `${rest.slice(0, 120)}...` : rest
  return task?.result || task?.lastAgentOutput || ''
}

window.copyWorkflowStepArtifact = async function(content) {
  const ok = await copyText(content)
  showToast(ok ? t('wf_copied') : t('wf_copy_failed'), ok ? 'success' : 'error')
}

window.showWorkflowStepVersions = function(sessionId) {
  const session = findCurrentWorkflowSessionDetail(sessionId)
  const versions = session?.versions || []
  showModal(`
    <div class="modal-card file-preview-modal">
      <div class="modal-head">
        <h3>${t('wf_versions_title')}</h3>
        <button class="icon-btn" onclick="window.closeModal()">×</button>
      </div>
      ${versions.length ? versions.map((version, index) => `
        <div class="version-card">
          <div class="version-title">v${versions.length - index} · Round ${escapeHtml(version.round ?? '')} · ${escapeHtml(new Date(version.timestamp).toLocaleString())}</div>
          <div class="version-reason">${escapeHtml(version.reason || '')}</div>
          ${version.output ? `<div class="version-output">${renderWorkflowMarkdown(String(version.output).replace(/\[DONE\]/gi, '').trim(), session?.cwd || '')}</div>` : ''}
        </div>
      `).join('') : `<p class="muted">${t('wf_versions_empty')}</p>`}
    </div>
  `)
}

window.previewWorkflowFile = async function(filePath, cwd) {
  try {
    const file = await api('/api/files/preview', 'POST', { path: filePath, cwd: cwd || undefined })
    const isMarkdown = /\.md$/i.test(file.name || file.path || '')
    const isImage = /^image\//i.test(file.mimeType || '') && file.encoding === 'base64'
    const isVideo = /^video\//i.test(file.mimeType || '') && file.encoding === 'stream'
    const isAudio = /^audio\//i.test(file.mimeType || '') && file.encoding === 'stream'
    const nestedFiles = isMarkdown ? extractWorkflowArtifactFiles(file.content || '').filter(path => path !== file.path) : []
    const body = isImage
      ? `<img class="file-preview-image" src="data:${escapeAttr(file.mimeType)};base64,${escapeAttr(file.content || '')}" alt="${escapeAttr(file.name || filePath)}">`
      : isVideo
        ? `<video class="file-preview-video" src="${escapeAttr(file.streamUrl || '')}" controls preload="metadata"></video>`
      : isAudio
        ? `<audio class="file-preview-audio" src="${escapeAttr(file.streamUrl || '')}" controls preload="metadata"></audio>`
      : isMarkdown
        ? renderWorkflowMarkdown(file.content || '', cwd || '')
        : `<pre>${escapeHtml(file.content || '')}</pre>`
    showModal(`
      <div class="modal-card file-preview-modal">
        <div class="modal-head">
          <h3>${escapeHtml(file.name || filePath)}</h3>
          <button class="icon-btn" onclick="window.closeModal()">×</button>
        </div>
        <div class="file-preview-path">${escapeHtml(file.path || filePath)}</div>
        ${nestedFiles.length ? `
          <div class="output-files">
            <div class="files-label">${t('wf_referenced_files', { count: nestedFiles.length })}</div>
            <div class="files-list">
              ${nestedFiles.map((path, idx) => renderWorkflowFileItem(path, cwd || '', idx === nestedFiles.length - 1 ? '└─' : '├─')).join('')}
            </div>
          </div>
        ` : ''}
        <div class="file-preview-body">
          ${body}
        </div>
      </div>
    `)
  } catch (err) {
    showToast(err.message)
  }
}

function renderWorkflowStepMessages(session) {
  const messages = session?.messages || []
  if (!messages.length) {
    return `<div class="workflow-step-messages"><p style="color: var(--text-muted); text-align: center;">${t('wf_no_messages')}</p></div>`
  }
  return `
    <div class="workflow-step-messages">
      <div class="chat-stream">
        ${messages.map(msg => {
          const isFrom = msg.from !== 'human'
          const avatar = isFrom ? (msg.from || 'A').charAt(0).toUpperCase() : 'H'
          return `
            <div class="chat-msg ${isFrom ? 'from' : 'to'}">
              <div class="chat-avatar">${escapeHtml(avatar)}</div>
              <div>
                <div class="chat-bubble">${renderWorkflowMarkdown(msg.content || '', session?.cwd || '')}</div>
                <div class="chat-meta">
                  <span>${escapeHtml(msg.from || '')} · ${t('wf_turn', { round: msg.round ?? '' })}</span>
                </div>
              </div>
            </div>
          `
        }).join('')}
      </div>
    </div>
  `
}

function renderWorkflowTimeline(pipeline) {
  const container = document.getElementById('workflow-timeline')
  if (!container || !pipeline) return
  const steps = pipeline.sessions || []
  container.innerHTML = `
    <div class="flex-between mb-16">
      <h3>${t('wf_timeline')}</h3>
      <span class="badge badge-${pipeline.status}">${escapeHtml(workflowStatusLabel(pipeline.status))}</span>
    </div>
    <div class="workflow-log">
      <div><span>${t('wf_timeline_created')}</span><strong>${new Date(pipeline.createdAt).toLocaleString()}</strong></div>
      <div><span>${t('wf_timeline_updated')}</span><strong>${new Date(pipeline.updatedAt).toLocaleString()}</strong></div>
      ${steps.map((step, index) => `<div><span>${t('wf_step', { number: index + 1 })}</span><strong>${escapeHtml(workflowStatusLabel(step.status))}</strong></div>`).join('')}
    </div>
  `
}

function renderStepRail(steps) {
  const items = steps.length ? steps : [{ status: 'pending' }]
  return `
    <div class="step-rail">
      ${items.map((step, index) => `
        <span class="step-node step-${step.status}" title="${escapeAttr(t('wf_step_title', { number: index + 1, title: workflowStatusLabel(step.status) }))}"></span>
        ${index < items.length - 1 ? '<span class="step-arrow">→</span>' : ''}
      `).join('')}
    </div>
  `
}

function stepIndexBySessionId(sessionId) {
  return (state.currentPipeline?.sessions || []).findIndex(step => step.sessionId === sessionId)
}

function workflowRevisionTargets(currentStepIndex) {
  const steps = state.currentPipeline?.sessions || []
  return steps
    .slice(0, Math.max(0, currentStepIndex))
    .map((step, index) => ({ id: step.sessionId, index, title: step.title || t('wf_step', { number: index + 1 }) }))
    .filter(target => target.id)
}

function formatStatNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  if (Number.isInteger(number)) return String(number)
  return number.toFixed(1)
}

async function renderSession(id) {
  state.currentSessionId = id
  state.currentPipelineId = null
  state.currentPipeline = null

  // Abort any previous in-flight detail load and start a fresh one.
  if (state.sessionDetailController) state.sessionDetailController.abort()
  state.sessionDetailController = new AbortController()
  const myToken = state.viewToken
  const signal = state.sessionDetailController.signal

  // Load session data
  let session = null
  try {
    session = await dedupeDetail(`session:${id}`, () => api(`/api/sessions/${id}`, 'GET', undefined, { signal }))
  } catch (err) {
    if (isAbortedErr(err)) return
    if (state.viewToken !== myToken || state.currentSessionId !== id) return
    document.body.innerHTML = '<div>Session not found</div>'
    return
  }
  // Stale guard: user navigated away before the fetch resolved.
  if (state.viewToken !== myToken || state.currentSessionId !== id) return

  state.currentSession = session
  resetSessionStream(id)
  state.autoFollowMessages = true
  invalidateSessionMarkdownCache()

  const sessionStatusDisplay = t('session.status.' + session.status)

  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('sessions')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <a href="/sessions" class="btn btn-ghost btn-sm">${t('sessions.back')}</a>
            <h2>${escapeHtml(sessionTitle(session))}</h2>
            <span id="session-status-badge" class="badge badge-${session.status}">${sessionStatusDisplay}</span>
          </div>
          <div class="topbar-right" id="session-actions">
            ${renderSessionActions(session)}
            <button class="btn btn-ghost btn-sm" onclick="window.deleteCurrentSession()">${t('sessions.delete')}</button>
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="session-layout">
          <div class="session-chat">
            <div class="session-status-line" id="session-status-line">
              <span class="status-spinner"></span>
              <span id="session-live-status">${session.status === 'active' ? t('session.waitingOutput') : sessionStatusDisplay}</span>
            </div>
            <div class="session-chat-messages" id="messages-container">
              <div class="chat-stream" id="messages"></div>
            </div>
            <div class="message-scroll-controls" aria-label="Message navigation">
              <button class="scroll-jump-btn" onclick="window.scrollSessionMessages('top')" title="${t('session.scrollTop')}">↑</button>
              <button class="scroll-jump-btn" onclick="window.scrollSessionMessages('bottom')" title="${t('session.scrollBottom')}">↓</button>
            </div>
            <div class="raw-output-panel">
              <button class="raw-output-toggle" onclick="window.toggleRawOutput()">
                <span id="raw-output-toggle-label">${state.rawOutputVisible ? t('session.rawToggleHide') : t('session.rawToggleShow')}</span>
              </button>
              <pre class="raw-output ${state.rawOutputVisible ? 'visible' : ''}" id="raw-output"></pre>
            </div>
            <div class="session-chat-input">
              <div class="inject-bar">
                <input type="text" class="input" id="inject-input" placeholder="${t('session.injectPlaceholder')}">
                <button class="btn btn-primary btn-sm" onclick="window.injectMessage()">${t('session.send')}</button>
              </div>
            </div>
          </div>

          <div class="session-panel" id="session-panel-content"></div>
        </div>
      </div>
    </div>
  `

  state.currentMessages = session.messages || []
  renderSessionMessages()
  bindMessageScrollTracking()
  renderSessionPanel(session)
  updateThemeButton()
}

function renderSessionActions(session) {
  return `
    <button class="btn btn-secondary btn-sm" onclick="window.askOpsForCurrent()">${t('session.askOps')}</button>
    <button class="btn btn-secondary btn-sm" onclick="window.exportCurrentSession()">${t('session.export')}</button>
    ${session.status === 'active' ? `<button class="btn btn-secondary btn-sm" onclick="window.extendSessionTimeout()">${t('session.extend')}</button>` : ''}
    ${session.status === 'active' ? `<button class="btn btn-secondary btn-sm" onclick="window.pauseSession()">${t('session.pause')}</button>` : ''}
    ${session.status === 'paused' ? `<button class="btn btn-primary btn-sm" onclick="window.resumeSession()">${t('session.resume')}</button>` : ''}
    ${session.status === 'error' ? `<button class="btn btn-primary btn-sm" onclick="window.resumeSession()">${t('session.retry')}</button>` : ''}
    ${session.status === 'active' || session.status === 'paused' ? `<button class="btn btn-danger btn-sm" onclick="window.stopSession()">${t('session.stop')}</button>` : ''}
  `
}

function renderSessionHeader(session) {
  const badge = document.getElementById('session-status-badge')
  if (badge) {
    badge.className = `badge badge-${session.status}`
    badge.textContent = t('session.status.' + session.status)
  }

  const actions = document.getElementById('session-actions')
  if (actions) {
    actions.innerHTML = `
      ${renderSessionActions(session)}
      <button class="btn btn-ghost btn-sm" onclick="window.deleteCurrentSession()">${t('sessions.delete')}</button>
      <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
      ${renderUserMenu()}
    `
    updateThemeButton()
  }
}

function renderSessionPanel(session) {
  const panel = document.getElementById('session-panel-content')
  if (!panel || !session) return
  const progress = session.maxRounds ? Math.min(100, session.currentRound / session.maxRounds * 100) : 0
  panel.innerHTML = `
    <div class="panel-section">
      <div class="label mb-16">${t('session.info')}</div>
      <div class="panel-kv">
        <div class="panel-kv-row">
          <span class="kv-label">${t('session.idLabel')}</span>
          <span class="kv-value mono" style="font-size: 0.78rem;">${escapeHtml(session.id.slice(0, 12))}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">${t('session.agentA')}</span>
          <span class="kv-value">${escapeHtml(agentLabel(session.from))}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">${t('session.agentB')}</span>
          <span class="kv-value">${escapeHtml(agentLabel(session.to))}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">${t('session.mode')}</span>
          <span class="kv-value">${escapeHtml(session.mode)}</span>
        </div>
        ${session.templateId ? `<div class="panel-kv-row"><span class="kv-label">${t('session.template')}</span><span class="kv-value">${escapeHtml(session.templateId)}</span></div>` : ''}
        <div class="panel-kv-row">
          <span class="kv-label">${t('session.turnsLabel')}</span>
          <span class="kv-value">${session.currentRound} / ${session.maxRounds}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">${t('session.statusLabel')}</span>
          <span class="badge badge-${session.status}" style="margin: 0;">${t('session.status.' + session.status)}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">${t('session.permission')}</span>
          <span class="kv-value ${session.permissionMode === 'trusted' ? 'permission-trusted' : ''}">${escapeHtml(session.permissionMode || 'safe')}</span>
        </div>
        <div class="panel-kv-row">
          <span class="kv-label">${t('session.created')}</span>
          <span class="kv-value">${new Date(session.createdAt).toLocaleString()}</span>
        </div>
        ${session.cwd ? `<div class="panel-kv-row"><span class="kv-label">${t('session.cwd')}</span><span class="kv-value mono">${escapeHtml(session.cwd)}</span></div>` : ''}
      </div>
      ${renderSessionCreationDetails(session)}
    </div>

    <div class="divider"></div>

    <div class="panel-section">
      <div class="label mb-8">${t('session.progress')}</div>
      <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 8px;">${t('session.turnOf', { round: session.currentRound, max: session.maxRounds })}</p>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${progress}%;"></div>
      </div>
      ${renderRoundJumpList()}
    </div>

    ${session.errorMessage ? `
      <div class="divider"></div>
      <div class="error-box">
        <div class="error-title">${escapeHtml(session.errorType || t('session.errorTitle'))}</div>
        <div class="error-detail">${escapeHtml(session.errorMessage)}</div>
      </div>
    ` : ''}

    ${session.lastAgentOutput ? `
      <div class="divider"></div>
      <div class="panel-section">
        <div class="label mb-8">${t('session.lastOutput')}</div>
        <pre class="code-block">${escapeHtml(session.lastAgentOutput)}</pre>
      </div>
    ` : ''}
  `
}

function renderSessionMessages(options = {}) {
  const container = document.getElementById('messages')
  if (!container) return
  const { preserveScroll = false, forceScrollBottom = false } = options
  const messagesContainer = document.getElementById('messages-container')
  const previousScrollTop = messagesContainer?.scrollTop ?? 0
  const steps = state.streamSteps.get(state.currentSessionId) || []
  const artifactHtml = renderSessionArtifacts(state.currentSession)

  if (state.currentMessages.length === 0 && steps.length === 0 && !artifactHtml) {
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 40px;">${t('session.noMessages')}</p>`
    updateSessionStatusLine()
    updateRawOutput()
    return
  }

  const messagesHtml = state.currentMessages.map(msg => {
    const isFrom = msg.from !== 'human'
    const avatar = isFrom ? (msg.from.charAt(0).toUpperCase()) : 'H'
    return `
      <div class="chat-msg ${isFrom ? 'from' : 'to'}" id="message-${escapeAttr(msg.id)}" data-round="${escapeAttr(String(msg.round))}">
        <div class="chat-avatar">${avatar}</div>
        <div class="chat-content">
          <div class="chat-bubble">${renderMarkdownCached(msg.content)}</div>
          <div class="chat-meta">
            <span>${escapeHtml(msg.from)} · ${t('session.turn', { round: msg.round })} · ${new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <button class="msg-copy-btn" onclick='window.copyMessage(${jsString(msg.id)})' title="${t('session.copy')}">${t('session.copy')}</button>
          </div>
        </div>
      </div>
    `
  }).join('')

  const stepsHtml = steps.length ? `
    <div class="step-stream">
      ${steps.map((step, index) => renderStepCard(step, index, steps.length)).join('')}
    </div>
  ` : ''

  container.innerHTML = artifactHtml + messagesHtml + stepsHtml

  renderStreamingDelta()

  if (!messagesContainer) return
  if (preserveScroll) {
    messagesContainer.scrollTop = previousScrollTop
    return
  }
  if (forceScrollBottom || state.autoFollowMessages) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
}

function renderSessionArtifacts(session) {
  if (!session || session.status !== 'done' || !session.artifacts) return ''
  const artifacts = session.artifacts
  const files = Array.isArray(artifacts.filesChanged) ? artifacts.filesChanged : []
  const totalAdditions = files.reduce((sum, file) => sum + (Number(file.additions) || 0), 0)
  const totalDeletions = files.reduce((sum, file) => sum + (Number(file.deletions) || 0), 0)
  const hasGit = Boolean(artifacts.gitDiffFull || artifacts.gitDiffStat || files.length)
  const summary = artifacts.summary || t('session.artifact.noSummary')
  return `
    <section class="artifact-card">
      <div class="artifact-title">${t('session.artifact.title')}</div>
      ${hasGit ? `
        <div class="artifact-section">
          <div class="artifact-section-title">${t('session.artifact.fileChanges')} <span>(${files.length} files, +${totalAdditions} -${totalDeletions})</span></div>
          <div class="artifact-files">
            ${files.map(file => renderArtifactFile(file, artifacts.gitDiffFull || '')).join('')}
          </div>
        </div>
      ` : ''}
      <div class="artifact-section">
        <div class="artifact-section-title">${t('session.artifact.summary')}</div>
        <div class="artifact-summary">${escapeHtml(summary)}</div>
      </div>
      <div class="artifact-actions">
        <button class="btn btn-secondary btn-sm" onclick="window.copyArtifactSummary()">${t('session.artifact.copySummary')}</button>
        ${artifacts.gitDiffFull ? `<button class="btn btn-secondary btn-sm" onclick="window.toggleFullDiff()">${state.artifactFullDiffVisible ? t('session.artifact.collapseDiff') : t('session.artifact.viewDiff')}</button>` : ''}
      </div>
      ${state.artifactFullDiffVisible && artifacts.gitDiffFull ? `
        <pre class="artifact-diff"><code>${renderHighlightedDiff(artifacts.gitDiffFull)}</code></pre>
      ` : ''}
    </section>
  `
}

function renderArtifactFile(file, fullDiff) {
  const key = file.path || ''
  const expanded = state.expandedArtifactFiles.has(key)
  const fileDiff = expanded ? extractFileDiff(fullDiff, key) : ''
  return `
    <div class="artifact-file">
      <button class="artifact-file-row" onclick='window.toggleArtifactFile(${jsString(key)})'>
        <span class="artifact-file-path">${escapeHtml(file.path)}</span>
        <span class="artifact-file-counts"><span class="additions">+${Number(file.additions) || 0}</span> <span class="deletions">-${Number(file.deletions) || 0}</span></span>
      </button>
      ${expanded ? `<pre class="artifact-diff"><code>${renderHighlightedDiff(fileDiff || 'No diff for this file.')}</code></pre>` : ''}
    </div>
  `
}

function renderHighlightedDiff(diff) {
  if (typeof hljs !== 'undefined') {
    try {
      return hljs.highlight(diff, { language: 'diff', ignoreIllegals: true }).value
    } catch {
      return escapeHtml(diff)
    }
  }
  ensureMarkdownLibs().then((ok) => { if (ok) rerenderCurrentMarkdown() })
  return escapeHtml(diff)
}

function extractFileDiff(fullDiff, path) {
  if (!fullDiff || !path) return ''
  const blocks = fullDiff.split(/^diff --git /m).filter(Boolean).map(block => `diff --git ${block}`)
  return blocks.find(block => block.startsWith(`diff --git a/${path} b/${path}`) || block.includes(` b/${path}\n`)) || ''
}

function renderStepCard(step, index, total) {
  const isLast = index === total - 1
  const isDone = step.type === 'done' || !isLast || state.currentSession?.status !== 'active'
  const stateClass = step.type === 'done' ? 'done' : isDone ? 'complete' : 'active'
  const icon = isDone ? '✅' : stepIcon(step.type)
  const detailKey = `${state.currentSessionId}:${index}`
  const expanded = state.expandedStepDetails.has(detailKey)
  return `
    <div class="step-card ${stateClass} type-${escapeAttr(step.type)}" data-step-key="${escapeAttr(detailKey)}">
      <div class="step-icon">${icon}</div>
      <div class="step-body">
        <div class="step-summary">${escapeHtml(step.summary || '')}</div>
        ${step.detail ? `
          <button type="button" class="step-detail-toggle" data-step-toggle="${escapeAttr(detailKey)}" onclick="window.toggleStepDetail(${jsString(detailKey)})">${expanded ? t('session.step.collapse') : t('session.step.expand')}</button>
          <pre class="step-detail ${expanded ? 'visible' : ''}" data-step-detail="${escapeAttr(detailKey)}">${escapeHtml(step.detail)}</pre>
        ` : ''}
      </div>
    </div>
  `
}

function renderRoundJumpList() {
  const rounds = Array.from(new Set(state.currentMessages.map(msg => Number(msg.round)).filter(Number.isFinite))).sort((a, b) => a - b)
  if (!rounds.length) return ''
  return `
    <div class="round-jump-list">
      ${rounds.map(round => `<button type="button" class="round-jump-btn" onclick="window.scrollSessionRound(${round})">${round === 0 ? t('session.start') : t('session.turn', { round })}</button>`).join('')}
    </div>
  `
}

function stepIcon(type) {
  if (type === 'done') return '✅'
  if (type === 'read') return '📖'
  if (type === 'write') return '✏️'
  if (type === 'exec') return '⚡'
  if (type === 'think') return '🤔'
  return '•'
}

function summarizeRawStatus(content) {
  const text = (content || '').replace(/\s+/g, ' ').trim()
  if (!text) return t('task_status_processing')
  const file = extractUiFile(text)
  const command = extractUiCommand(text)
  if (/\b(read file|read_file|reading|read|cat|sed|rg|grep)\b/i.test(text)) return t('task_status_reading', { file: file || command || '' })
  if (/\b(write|edit|apply_patch|patch|wrote|modified|update file|create file|save)\b/i.test(text)) return t('task_status_modifying', { file: file || '' })
  if (/\b(bash|shell|exec|execute|run command|npm|pnpm|yarn|git|node|tsc|pytest|vitest|make)\b/i.test(text)) return t('task_status_executing', { cmd: command || text.slice(0, 50) })
  if (/thinking|analysis|plan|\u5206\u6790|\u8ba1\u5212/i.test(text)) return t('task_status_analyzing')
  return text.slice(0, 50)
}

function extractUiFile(text) {
  const quoted = text.match(/[`'"]([^`'"]+\.[\w.-]+)[`'"]/)
  if (quoted?.[1]) return quoted[1]
  const pathMatch = text.match(/(?:^|\s)((?:\.{1,2}\/|\/)?[\w@.-]+(?:\/[\w@.-]+)+\.[\w.-]+)/)
  if (pathMatch?.[1]) return pathMatch[1]
  const simple = text.match(/\b([\w@.-]+\.[A-Za-z0-9_-]{1,8})\b/)
  return simple?.[1]
}

function extractUiCommand(text) {
  const quoted = text.match(/(?:cmd|command|bash|exec|\u6267\u884c|\u8fd0\u884c)[^`'"]*[`'"]([^`'"]+)[`'"]/i)
  if (quoted?.[1]) return quoted[1].slice(0, 80)
  const match = text.match(/\b((?:npm|pnpm|yarn|git|node|npx|tsc|pytest|vitest|make|bash|sh|rg|sed|cat)\s+[^.;\n]{1,80})/i)
  return match?.[1]?.trim()
}

function updateSessionStatusLine() {
  const text = document.getElementById('session-live-status')
  const line = document.getElementById('session-status-line')
  if (!text || !line) return
  const status = state.streamStatus.get(state.currentSessionId)
    || (state.currentSession?.status === 'active' ? t('session.waitingOutput') : t('session.status.' + state.currentSession?.status) || t('session.idle'))
  text.textContent = status
  line.classList.toggle('idle', state.currentSession?.status !== 'active')
}

function updateRawOutput() {
  const raw = document.getElementById('raw-output')
  if (!raw) return
  raw.textContent = state.streamRaw.get(state.currentSessionId) || ''
}

function bindMessageScrollTracking() {
  const messagesContainer = document.getElementById('messages-container')
  if (!messagesContainer) return
  messagesContainer.addEventListener('scroll', () => {
    state.autoFollowMessages = isNearMessageBottom(messagesContainer)
  }, { passive: true })
}

function isNearMessageBottom(container) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < 80
}

window.scrollSessionMessages = function(position) {
  const messagesContainer = document.getElementById('messages-container')
  if (!messagesContainer) return
  if (position === 'top') {
    state.autoFollowMessages = false
    messagesContainer.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  state.autoFollowMessages = true
  messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' })
}

window.scrollSessionRound = function(round) {
  const messagesContainer = document.getElementById('messages-container')
  const target = document.querySelector(`.chat-msg[data-round="${round}"]`)
  if (!messagesContainer || !target) return
  state.autoFollowMessages = false
  messagesContainer.scrollTo({
    top: target.offsetTop - messagesContainer.offsetTop - 16,
    behavior: 'smooth',
  })
}

window.toggleStepDetail = function(key) {
  state.autoFollowMessages = false
  if (state.expandedStepDetails.has(key)) {
    state.expandedStepDetails.delete(key)
  } else {
    state.expandedStepDetails.add(key)
  }
  const expanded = state.expandedStepDetails.has(key)
  document.querySelectorAll('[data-step-detail]').forEach(node => {
    if (node.dataset.stepDetail === key) node.classList.toggle('visible', expanded)
  })
  document.querySelectorAll('[data-step-toggle]').forEach(node => {
    if (node.dataset.stepToggle === key) node.textContent = expanded ? t('session.step.collapse') : t('session.step.expand')
  })
}

window.toggleRawOutput = function() {
  state.rawOutputVisible = !state.rawOutputVisible
  const raw = document.getElementById('raw-output')
  const label = document.getElementById('raw-output-toggle-label')
  if (raw) raw.classList.toggle('visible', state.rawOutputVisible)
  if (label) label.textContent = state.rawOutputVisible ? t('session.rawToggleHide') : t('session.rawToggleShow')
  updateRawOutput()
}

window.toggleArtifactFile = function(path) {
  if (state.expandedArtifactFiles.has(path)) {
    state.expandedArtifactFiles.delete(path)
  } else {
    state.expandedArtifactFiles.add(path)
  }
  renderSessionMessages()
}

window.toggleFullDiff = function() {
  state.artifactFullDiffVisible = !state.artifactFullDiffVisible
  renderSessionMessages()
}

window.copyArtifactSummary = async function() {
  const summary = state.currentSession?.artifacts?.summary || ''
  if (!summary) return
  const ok = await copyText(summary)
  showToast(ok ? t('session.toast.summaryCopied') : t('session.toast.copyFailed'), ok ? 'success' : 'error')
}

window.pauseSession = async function() {
  if (!state.currentSessionId) return
  try {
    await api(`/api/sessions/${state.currentSessionId}/pause`, 'POST')
    renderSession(state.currentSessionId)
  } catch (err) {
    showToast(err.message)
  }
}

window.resumeSession = async function() {
  if (!state.currentSessionId) return
  try {
    await api(`/api/sessions/${state.currentSessionId}/resume`, 'POST')
    renderSession(state.currentSessionId)
  } catch (err) {
    showToast(err.message)
  }
}

window.stopSession = async function() {
  if (!state.currentSessionId) return
  if (!await confirmAction({
    title: t('session.confirm.stop.title'),
    message: t('session.confirm.stop.message'),
    confirmText: t('session.confirm.stop.confirm'),
    danger: true,
  })) return
  try {
    await api(`/api/sessions/${state.currentSessionId}/stop`, 'POST')
    navigate('/sessions')
  } catch (err) {
    showToast(err.message)
  }
}

window.injectMessage = async function() {
  if (!state.currentSessionId) return
  const input = document.getElementById('inject-input')
  if (!input || !input.value.trim()) return

  try {
    await api(`/api/sessions/${state.currentSessionId}/message`, 'POST', {
      content: input.value.trim()
    })
    input.value = ''
    loadSessionDetail(state.currentSessionId)
  } catch (err) {
    showToast(err.message)
  }
}

window.toggleOps = function() {
  state.opsOpen = !state.opsOpen
  updateOpsPanel()
  if (state.opsOpen) stopOpsWalker()
  else startOpsWalker()
  if (state.opsOpen) {
    loadOpsModel(undefined, true).then(updateOpsPanel).catch(() => {})
    setTimeout(() => document.getElementById('ops-input')?.focus(), 0)
  }
}

window.beginOpsDrag = function(event) {
  if (event.button !== 0) return
  const widget = document.getElementById('ops-widget')
  if (!widget) return
  event.preventDefault()
  stopOpsWalker()
  state.opsDragging = true
  state.opsDragged = false
  const start = clampOpsPosition(state.opsPosition)
  const drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: start.x,
    y: start.y,
  }
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  const onMove = moveEvent => {
    if (moveEvent.pointerId !== drag.pointerId) return
    const next = clampOpsPosition({
      x: drag.x + moveEvent.clientX - drag.startX,
      y: drag.y + moveEvent.clientY - drag.startY,
    })
    if (Math.abs(next.x - drag.x) > 4 || Math.abs(next.y - drag.y) > 4) state.opsDragged = true
    applyOpsPosition(next, true)
  }
  const onEnd = endEvent => {
    if (endEvent.pointerId !== drag.pointerId) return
    state.opsDragging = false
    event.currentTarget?.releasePointerCapture?.(event.pointerId)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
    if (state.opsDragged) {
      saveOpsPosition(state.opsPosition)
      if (!state.opsOpen) startOpsWalker(4000)
    } else {
      window.toggleOps()
    }
    setTimeout(() => { state.opsDragged = false }, 160)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onEnd)
  window.addEventListener('pointercancel', onEnd)
}

window.submitOpsQuestion = async function(event) {
  event.preventDefault()
  const input = document.getElementById('ops-input')
  const question = input?.value?.trim()
  if (!question) return
  input.value = ''
  await window.askOps(question)
}

window.askOpsForCurrent = async function() {
  const context = currentOpsContext()
  const question = context.target
    ? t('ops_current_target_question', { kind: context.target.kind })
    : t('ops_current_page_question', { title: context.page?.title || context.page?.path || t('ops_current_page') })
  await askOpsInternal(question, context.target, context.page)
}

window.askOps = async function(question) {
  await askOpsInternal(question, undefined, currentOpsPageContext())
}

async function askOpsInternal(question, target, page) {
  state.opsOpen = true
  state.opsMessages.push({ from: 'user', content: question })
  state.opsBusy = true
  updateOpsPanel()
  try {
    const report = await api('/api/ops/diagnose', 'POST', { question, target, page })
    state.opsLastReport = report
    state.opsMessages.push({ from: 'ops', content: formatOpsReport(report), actions: collectOpsActions(report) })
  } catch (err) {
    state.opsMessages.push({ from: 'ops', content: t('ops_diagnose_failed', { message: err.message }) })
  } finally {
    state.opsBusy = false
    updateOpsPanel()
  }
}

function currentOpsContext() {
  const page = currentOpsPageContext()
  if (state.currentTaskId) return { target: { kind: 'task', id: state.currentTaskId }, page }
  if (state.currentSessionId) return { target: { kind: 'session', id: state.currentSessionId }, page }
  if (state.currentPipelineId) return { target: { kind: 'workflow', id: state.currentPipelineId }, page }
  const path = location.pathname
  if (path.startsWith('/task/')) return { target: { kind: 'task', id: path.split('/')[2] }, page }
  if (path.startsWith('/session/')) return { target: { kind: 'session', id: path.split('/')[2] }, page }
  if (path.startsWith('/workflow/') || path.startsWith('/workflows/')) return { target: { kind: 'workflow', id: path.split('/')[2] }, page }
  return { page }
}

function currentOpsPageContext() {
  const main = document.querySelector('.main, main, #app') || document.body
  const heading = document.querySelector('h1, .page-title, .topbar h2, .header-title')?.textContent?.trim()
  const cards = Array.from(document.querySelectorAll('.stat-card, .metric-card, .task-card, .session-card, .workflow-card'))
    .slice(0, 12)
    .map((el) => el.textContent?.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return {
    path: location.pathname,
    title: heading || document.title || location.pathname,
    summary: cards.join('\n').slice(0, 2000),
    visibleText: main.textContent?.replace(/\s+/g, ' ').trim().slice(0, 4000),
  }
}

function updateOpsPanel() {
  const existing = document.getElementById('ops-widget')
  if (!existing) return
  const markup = renderOpsWidget()
  const wrapper = document.createElement('div')
  wrapper.innerHTML = markup
  existing.replaceWith(wrapper.querySelector('.ops-widget'))
  initOpsWidget()
  const thread = document.getElementById('ops-thread')
  if (thread) thread.scrollTop = thread.scrollHeight
}

window.editOpsModel = function() {
  state.opsModelEditing = true
  updateOpsPanel()
}

window.cancelOpsModelEdit = function() {
  state.opsModelEditing = false
  updateOpsPanel()
}

window.saveOpsModel = async function(event) {
  event.preventDefault()
  const fd = new FormData(event.target)
  const provider = String(fd.get('provider') || 'custom')
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom
  const body = compactObject({
    adapter: preset.adapter,
    model: String(fd.get('model') || '').trim() || undefined,
    baseUrl: String(fd.get('baseUrl') || '').trim() || undefined,
    apiKey: String(fd.get('apiKey') || '').trim() || undefined,
  })
  try {
    state.opsModel = await api('/api/ops/model', 'PUT', body)
    state.opsModelEditing = false
    updateOpsPanel()
    showToast(t('ops_model_saved'), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.clearOpsModel = async function() {
  try {
    state.opsModel = await api('/api/ops/model', 'DELETE')
    state.opsModelEditing = false
    updateOpsPanel()
    showToast(t('ops_model_cleared'), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.updateOpsModelProviderOptions = function() {
  const providerSelect = document.getElementById('ops-model-provider')
  const modelControlContainer = document.getElementById('ops-model-model-control')
  const baseUrlInput = document.getElementById('ops-model-base-url')
  const provider = providerSelect?.value || 'custom'
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom
  if (modelControlContainer) modelControlContainer.innerHTML = modelControl(provider, defaultModelForProvider(provider))
  if (baseUrlInput) baseUrlInput.value = preset.baseUrl
}

function loadOpsPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPS_POSITION_KEY) || 'null')
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return saved
  } catch {}
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth
  const height = typeof window === 'undefined' ? 800 : window.innerHeight
  return { x: Math.max(20, width - 96), y: Math.max(20, height - 104) }
}

function saveOpsPosition(pos) {
  localStorage.setItem(OPS_POSITION_KEY, JSON.stringify(clampOpsPosition(pos)))
}

function clampOpsPosition(pos) {
  const widgetWidth = 76
  const widgetHeight = 86
  const margin = 12
  const maxX = Math.max(margin, window.innerWidth - widgetWidth - margin)
  const maxY = Math.max(margin, window.innerHeight - widgetHeight - margin)
  return {
    x: Math.min(Math.max(pos?.x ?? maxX, margin), maxX),
    y: Math.min(Math.max(pos?.y ?? maxY, margin), maxY),
  }
}

function applyOpsPosition(pos, persist = false) {
  state.opsPosition = clampOpsPosition(pos)
  const widget = document.getElementById('ops-widget')
  if (widget) {
    widget.style.setProperty('--ops-x', `${state.opsPosition.x}px`)
    widget.style.setProperty('--ops-y', `${state.opsPosition.y}px`)
    widget.classList.toggle('align-left', state.opsPosition.x < window.innerWidth / 2)
    widget.classList.toggle('align-right', state.opsPosition.x >= window.innerWidth / 2)
    widget.classList.toggle('drop-down', state.opsPosition.y < 360)
    widget.classList.toggle('drop-up', state.opsPosition.y >= 360)
  }
  if (persist) saveOpsPosition(state.opsPosition)
}

function initOpsWidget() {
  if (!document.getElementById('ops-widget')) return
  applyOpsPosition(state.opsPosition)
  if (!state.opsOpen) startOpsWalker()
}

function startOpsWalker(delay = 1800) {
  if (state.opsOpen || state.opsDragging || state.opsWalkTimer) return
  state.opsWalkTimer = window.setTimeout(() => {
    state.opsWalkTimer = null
    walkOpsTo(randomOpsPosition())
  }, delay)
}

function stopOpsWalker() {
  if (state.opsWalkTimer) {
    clearTimeout(state.opsWalkTimer)
    state.opsWalkTimer = null
  }
  if (state.opsWalkFrame) {
    cancelAnimationFrame(state.opsWalkFrame)
    state.opsWalkFrame = null
  }
}

function randomOpsPosition() {
  // Constrain walk targets to a bottom-right safe zone so the mascot never
  // stops on top of main content (titles, panels, list rows). The zone spans
  // ~220px inward from the right and bottom viewport edges. Dragging still
  // works anywhere; after release the mascot walks back to this zone.
  const w = window.innerWidth
  const h = window.innerHeight
  const zone = 220
  const maxX = Math.max(12, w - 88)
  const maxY = Math.max(12, h - 98)
  const minX = Math.max(12, w - zone)
  const minY = Math.max(12, h - zone)
  return clampOpsPosition({
    x: minX + Math.random() * Math.max(0, maxX - minX),
    y: minY + Math.random() * Math.max(0, maxY - minY),
  })
}

function walkOpsTo(target) {
  if (state.opsOpen || state.opsDragging) return
  const from = clampOpsPosition(state.opsPosition)
  const to = clampOpsPosition(target)
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const duration = Math.min(3600, Math.max(1400, distance * 10))
  const start = performance.now()
  const step = now => {
    if (state.opsOpen || state.opsDragging) {
      state.opsWalkFrame = null
      return
    }
    const t = Math.min(1, (now - start) / duration)
    const eased = 0.5 - Math.cos(t * Math.PI) / 2
    applyOpsPosition({
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    })
    if (t < 1) state.opsWalkFrame = requestAnimationFrame(step)
    else {
      state.opsWalkFrame = null
      saveOpsPosition(state.opsPosition)
      startOpsWalker(2500 + Math.random() * 3500)
    }
  }
  state.opsWalkFrame = requestAnimationFrame(step)
}

function formatOpsReport(report) {
  if (report.directAnswer) return report.directAnswer
  if (report.answer) {
    const source = report.answerSource ? `\n\n_${t('ops_answer_source', { source: report.answerSource })}_` : ''
    return `${report.answer}${source}`
  }
  const counts = report.counts || {}
  const lines = [
    report.summary || t('ops_done'),
    '',
    `- ${t('ops_critical', { count: counts.critical || 0 })}`,
    `- ${t('ops_warning', { count: counts.warning || 0 })}`,
    `- ${t('ops_info', { count: counts.info || 0 })}`,
  ]
  const issues = report.issues || []
  if (issues.length) {
    lines.push('', t('ops_priority'))
    for (const issue of issues.slice(0, 5)) {
      const target = issue.target ? t('ops_issue_target', { kind: issue.target.kind, id: String(issue.target.id).slice(0, 8) }) : ''
      lines.push(`- [${issue.severity}] ${issue.title}${target}：${issue.detail}`)
      lines.push(`  ${t('ops_recommendation', { text: issue.recommendation })}`)
    }
  }
  if (report.answerError) {
    lines.push('', t('ops_llm_missing', { error: report.answerError }))
  }
  return lines.join('\n')
}

function collectOpsActions(report) {
  const actions = []
  for (const issue of report.issues || []) {
    for (const action of issue.actions || []) {
      if (!actions.some(item => item.id === action.id && item.target?.id === action.target?.id)) actions.push(action)
    }
  }
  return actions.slice(0, 4)
}

function renderOpsMessageActions(message) {
  const actions = message.actions || []
  if (!actions.length) return ''
  return `
    <div class="ops-actions">
      ${actions.map(action => `
        <button class="ops-action-btn ${action.risk === 'high' ? 'danger' : ''}" onclick='window.executeOpsAction(${jsString(JSON.stringify(action))})'>
          ${escapeHtml(action.label)}
        </button>
      `).join('')}
    </div>
  `
}

window.executeOpsAction = async function(actionJson) {
  const action = JSON.parse(actionJson)
  const label = action.label || action.id
  if (!confirm(t('ops_confirm_execute', { label, description: action.description || '' }))) return
  state.opsBusy = true
  updateOpsPanel()
  try {
    const result = await api('/api/ops/action', 'POST', {
      actionId: action.id,
      target: action.target,
      confirmed: true,
    })
    state.opsMessages.push({ from: 'ops', content: opsActionResultText(result) })
    if (result.task?.id) navigate(`/task/${result.task.id}`)
    else if (result.session?.id) navigate(`/session/${result.session.id}`)
  } catch (err) {
    state.opsMessages.push({ from: 'ops', content: t('ops_action_failed', { message: err.message }) })
  } finally {
    state.opsBusy = false
    updateOpsPanel()
  }
}

function opsActionResultText(result) {
  if (result.task?.id) return t('ops_action_task_done', { action: result.action, id: result.task.id })
  if (result.session?.id) return t('ops_action_session_done', { action: result.action, id: result.session.id })
  if (result.workflow?.id) return t('ops_action_workflow_done', { action: result.action, id: result.workflow.id })
  return t('ops_action_done', { action: result.action || 'ops action' })
}

window.extendSessionTimeout = async function() {
  if (!state.currentSessionId) return
  try {
    const result = await api(`/api/sessions/${state.currentSessionId}/extend-timeout`, 'POST')
    showToast(t('session.toast.timeoutExtended', { n: Math.round(result.extensionMs / 60000) }), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteCurrentSession = async function() {
  if (!state.currentSessionId) return
  if (!await confirmAction({
    title: t('session.confirm.delete.title'),
    message: t('session.confirm.delete.message'),
    confirmText: t('session.confirm.delete.confirm'),
    danger: true,
  })) return
  try {
    await api(`/api/sessions/${state.currentSessionId}`, 'DELETE')
    navigate('/sessions')
  } catch (err) {
    showToast(err.message)
  }
}

window.copyMessage = async function(id) {
  const msg = state.currentMessages.find(item => item.id === id)
  if (!msg) return
  await copyText(msg.content || '')
}

window.exportCurrentSession = function() {
  if (!state.currentSession) return
  const content = buildSessionExport(state.currentSession, state.currentMessages)
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `passiton-session-${state.currentSession.id}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function renderSettings() {
  // Abort any previous in-flight settings load (rapid re-navigation dedup).
  if (state.settingsController) state.settingsController.abort()
  state.settingsController = new AbortController()
  const myToken = state.viewToken
  const signal = state.settingsController.signal

  try {
    await Promise.all([
      loadConfig(signal),
      loadAgents(signal),
      loadApiKeys(signal),
      loadDeployCheck(signal),
    ])
  } catch (err) {
    if (isAbortedErr(err)) return
  }
  // Stale guard: user navigated away while settings data was loading.
  if (state.viewToken !== myToken || location.pathname !== '/settings') return

  const agentsTab = `<button class="tab-btn active" data-tab="local-cli" onclick="window.switchSettingsTab('local-cli')">${t('settings.tab.agents')}</button>`
  const agentsPanel = `
            <div id="tab-local-cli" class="tab-panel active" data-tab="local-cli">
              <div class="flex-between mb-24">
                <div>
                  <h3>${t('settings.localCli.title')}</h3>
                  <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">${t('settings.localCli.desc')}</p>
                </div>
                <div class="inline-actions">
                  <button class="btn btn-primary btn-sm" onclick="window.showCustomCliAgentModal()">${t('settings.localCli.addCustom')}</button>
                  <button class="btn btn-secondary btn-sm" onclick="window.refreshDiagnostics()">${t('settings.diagnostics.refresh')}</button>
                </div>
              </div>

              <div id="agents-deploy-check"></div>

              <div class="form-group">
                <label>${t('settings.general.workspaces')}</label>
                <textarea class="input" id="allowed-workspaces-input" rows="4" placeholder="${escapeAttr(t('settings.general.workspacesPlaceholder'))}">${escapeHtml((state.config?.policy?.allowedWorkspaces || []).join('\n'))}</textarea>
                <p style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">${t('settings.agents.workspacesHint')}</p>
              </div>
              <button class="btn btn-primary" onclick="window.saveAllowedWorkspaces()">${t('settings.general.save')}</button>

              <div class="agent-list" id="local-cli-list"></div>
            </div>
  `

  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSidebar('settings')}

      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <h2>${t('nav.settings')}</h2>
          </div>
          <div class="topbar-right">
            <button class="theme-toggle" onclick="window.toggleTheme()">🌙</button>
            ${renderUserMenu()}
          </div>
        </header>

        <div class="content">
          <div style="max-width: 860px;">
            <div class="tabs">
              ${agentsTab}
              <button class="tab-btn" data-tab="general" onclick="window.switchSettingsTab('general')">${t('settings.tab.general')}</button>
            </div>

            <div id="tab-agents" class="tab-panel" data-tab="agents">
              <div class="flex-between mb-24">
                <div>
                  <h3>${t('settings.agents.title')}</h3>
                  <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">${t('settings.agents.desc')}</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="window.showAgentModal()">${t('settings.agents.add')}</button>
              </div>

              <div class="agent-list" id="agents-list"></div>
            </div>

            <div id="tab-apikeys" class="tab-panel" data-tab="apikeys">
              <div class="flex-between mb-24">
                <div>
                  <h3>${t('settings.keys.title')}</h3>
                  <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">${t('settings.keys.desc')}</p>
                </div>
                <button class="btn btn-primary btn-sm" onclick="window.showApiKeyModal()">${t('settings.keys.add')}</button>
              </div>
              <div class="agent-list" id="api-keys-list"></div>
            </div>

            ${agentsPanel}

            <div id="tab-general" class="tab-panel" data-tab="general">
              <h3 class="mb-24">${t('settings.general.title')}</h3>

              <div class="form-group">
                <label>${t('settings.general.language')}</label>
                <select class="input" id="lang-input" onchange="window.changeLanguage(this.value)">
                  <option value="en" ${getCurrentLang() === 'en' ? 'selected' : ''}>${t('settings.general.language.en')}</option>
                  <option value="zh" ${getCurrentLang() === 'zh' ? 'selected' : ''}>${t('settings.general.language.zh')}</option>
                </select>
              </div>

              <div class="form-group">
                <label>${t('settings.general.maxTurns')}</label>
                <input type="number" class="input" value="${state.config?.defaults?.maxRounds || 20}" id="max-rounds-input">
              </div>

              <div class="form-group">
                <label>${t('settings.general.mode')}</label>
                <select class="input" id="mode-input">
                  <option value="collaborate" ${state.config?.defaults?.mode === 'collaborate' ? 'selected' : ''}>${t('settings.general.mode.collaborate')}</option>
                  <option value="discuss" ${state.config?.defaults?.mode === 'discuss' ? 'selected' : ''}>${t('settings.general.mode.discuss')}</option>
                  <option value="review" ${state.config?.defaults?.mode === 'review' ? 'selected' : ''}>${t('settings.general.mode.review')}</option>
                  <option value="freeform" ${state.config?.defaults?.mode === 'freeform' ? 'selected' : ''}>${t('settings.general.mode.freeform')}</option>
                </select>
              </div>

              <button class="btn btn-primary" onclick="window.saveGeneralSettings()">${t('settings.general.save')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  renderAgentsList()
  renderApiKeysList()
  renderLocalCliAgentsList()
  renderDiagnosticsPanel()
  updateThemeButton()
}

function renderAgentsList() {
  const container = document.getElementById('agents-list')
  if (!container) return
  const apiAgents = state.agents.filter(agent => agent.kind !== 'local')

  if (apiAgents.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 40px;">${t('settings.agents.empty')}</p>`
    return
  }

  container.innerHTML = apiAgents.map(agent => {
    const colors = ['#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#8b5cf6']
    const color = colors[Math.floor(Math.random() * colors.length)]
    const initial = agent.name.charAt(0).toUpperCase()
    const diagnosing = state.agentDiagnosticsPending.has(agent.name)

    return `
      <div class="agent-item">
        <div class="agent-icon" style="background: linear-gradient(135deg, ${color}, ${color}dd);">${initial}</div>
        <div class="agent-info">
          <div class="agent-name">${escapeHtml(agent.name)}</div>
          <div class="agent-model">${escapeHtml(agent.provider)} · ${escapeHtml(agent.model || agent.adapter)}${agent.keyMasked ? ` · ${escapeHtml(agent.keyMasked)}` : ''}</div>
          ${agent.error ? `<div class="agent-model" style="color: var(--red);">${escapeHtml(agent.error)}</div>` : ''}
        </div>
        <span class="badge badge-${statusBadgeClass(agent.status)}">${escapeHtml(statusLabel(agent.status))}</span>
        <div class="agent-actions">
          <button class="btn btn-ghost btn-sm" ${diagnosing ? 'disabled' : ''} onclick='window.showAgentDiagnostics(${jsString(agent.name)})'>${diagnosing ? t('modal.agentDiagnostics.running') : t('settings.agents.verify')}</button>
          <button class="btn btn-ghost btn-sm" onclick='window.showAgentModal(${jsString(agent.name)})'>${t('settings.agents.edit')}</button>
          <button class="btn btn-ghost btn-sm" style="color: var(--red);" onclick='window.deleteAgent(${jsString(agent.name)})'>${t('settings.agents.delete')}</button>
        </div>
      </div>
    `
  }).join('')
}

function renderApiKeysList() {
  const container = document.getElementById('api-keys-list')
  if (!container) return

  if (state.apiKeys.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 40px;">${t('settings.keys.empty')}</p>`
    return
  }

  container.innerHTML = state.apiKeys.map(key => `
    <div class="agent-item">
      <div class="agent-icon">${escapeHtml(providerIcon(key.provider))}</div>
      <div class="agent-info">
        <div class="agent-name">${escapeHtml(key.name)}</div>
        <div class="agent-model">
          ${escapeHtml(providerLabel(key.provider))} · <span class="key-masked">${escapeHtml(key.maskedKey)}</span>
          ${key.usedBy?.length ? ` · used by ${escapeHtml(key.usedBy.join(', '))}` : ''}
          ${key.source ? ` · ${escapeHtml(keySourceLabel(key.source))}` : ''}
        </div>
      </div>
      ${key.readOnly ? `<span class="badge badge-paused">${t('badge.linked')}</span>` : `<button class="btn btn-ghost btn-sm" style="color: var(--red);" onclick='window.deleteApiKey(${jsString(key.id)})'>${t('settings.agents.delete')}</button>`}
    </div>
  `).join('')
}

function renderLocalCliAgentsList() {
  const container = document.getElementById('local-cli-list')
  if (!container) return
  const localAgents = state.agents.filter(agent => agent.kind === 'local')
  const configuredAgents = sortAgentsByPriority(localAgents.filter(agent => agent.source === 'configured'))
  const discoveredAgents = sortAgentsByPriority(localAgents.filter(agent => agent.source !== 'configured'))
  const agents = [...configuredAgents, ...discoveredAgents]
  if (agents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>${t('settings.localCli.empty')}</p>
        <p>${t('settings.localCli.emptyCustom')}</p>
        <button class="btn btn-primary btn-sm" onclick="window.showCustomCliAgentModal()">${t('settings.localCli.addCustom')}</button>
      </div>
    `
    return
  }
  container.innerHTML = agents.map(agent => {
    const canAdd = agent.source === 'discovered'
    const canDelete = agent.source === 'configured'
    const badgeClass = statusBadgeClass(agent.status)
    const diagnosing = state.agentDiagnosticsPending.has(agent.name)
    return `
    <div class="agent-item">
      <div class="agent-icon">${escapeHtml(agent.name.charAt(0).toUpperCase())}</div>
      <div class="agent-info">
        <div class="agent-name">${escapeHtml(agent.name)}</div>
        <div class="agent-model">${escapeHtml(agent.adapter)} · ${escapeHtml(agent.command || '')}${agent.version ? ` · ${escapeHtml(agent.version)}` : ''}</div>
      </div>
      <span class="badge badge-${badgeClass}">${escapeHtml(statusLabel(agent.status))}</span>
      ${canDelete ? `
        <div class="priority-reorder">
          <button class="btn btn-ghost btn-sm priority-arrow" ${configuredAgents[0]?.name === agent.name ? 'disabled' : ''} aria-label="${escapeAttr(t('settings.localCli.moveUp'))}" title="${escapeAttr(t('settings.localCli.moveUp'))}" onclick='window.moveLocalCliAgentPriority(${jsString(agent.name)}, "up")'>&uarr;</button>
          <button class="btn btn-ghost btn-sm priority-arrow" ${configuredAgents[configuredAgents.length - 1]?.name === agent.name ? 'disabled' : ''} aria-label="${escapeAttr(t('settings.localCli.moveDown'))}" title="${escapeAttr(t('settings.localCli.moveDown'))}" onclick='window.moveLocalCliAgentPriority(${jsString(agent.name)}, "down")'>&darr;</button>
        </div>
      ` : ''}
      <div class="agent-actions">
        ${canAdd ? `<button class="btn btn-primary btn-sm" onclick='window.addLocalCliAgent(${jsString(agent.name)})'>${t('settings.localCli.add')}</button>` : ''}
        <button class="btn btn-ghost btn-sm" ${diagnosing ? 'disabled' : ''} onclick='window.showLocalCliAgentDiagnostics(${jsString(agent.name)})'>${diagnosing ? t('modal.agentDiagnostics.running') : t('settings.localCli.diagnose')}</button>
        ${canDelete ? `<button class="btn btn-ghost btn-sm" onclick='window.showLocalCliAgentModal(${jsString(agent.name)})'>${t('settings.agents.edit')}</button>` : ''}
        ${canDelete ? `<button class="btn btn-ghost btn-sm" style="color: var(--red);" onclick='window.deleteLocalCliAgent(${jsString(agent.name)})'>${t('settings.agents.delete')}</button>` : ''}
      </div>
    </div>
  `}).join('')
}

function localCliAgentUpdateBody(agent, priority) {
  return compactObject({
    name: agent.name,
    adapter: agent.adapter,
    command: agent.command,
    args: agent.args,
    timeout: agent.timeout,
    priority,
    env: agent.env,
  })
}

window.addLocalCliAgent = async function(name) {
  const agent = state.agents.find(item => item.kind === 'local' && item.name === name)
  if (!agent?.command) return
  try {
    state.config = await api('/api/config/agents', 'POST', {
      name: agent.name,
      adapter: agent.adapter,
      command: agent.command,
      args: agent.args,
      timeout: agent.timeout,
      env: agent.env,
    })
    await loadAgents()
    renderAgentsList()
    renderLocalCliAgentsList()
    const saved = state.agents.find(item => item.kind === 'local' && item.name === name)
    if (saved?.status === 'invalid') {
      window.showLocalCliAgentDiagnostics(name, t('toast.agentValidationFailed'))
    } else {
      showToast(t('toast.localCliAdded', { name }), 'success')
    }
  } catch (err) {
    showToast(err.message)
    window.showLocalCliAgentDiagnostics(name, err.message)
  }
}

window.moveLocalCliAgentPriority = async function(name, direction) {
  const configuredAgents = sortAgentsByPriority(state.agents.filter(agent => agent.kind === 'local' && agent.source === 'configured'))
  const fromIndex = configuredAgents.findIndex(agent => agent.name === name)
  const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1
  if (fromIndex < 0 || toIndex < 0 || toIndex >= configuredAgents.length) return

  const reorderedAgents = [...configuredAgents]
  ;[reorderedAgents[fromIndex], reorderedAgents[toIndex]] = [reorderedAgents[toIndex], reorderedAgents[fromIndex]]
  const updates = reorderedAgents
    .map((agent, index) => ({ agent, priority: index + 1 }))
    .filter(({ agent, priority }) => agentPriority(agent) !== priority)

  if (updates.length === 0) return

  try {
    const configs = await Promise.all(updates.map(({ agent, priority }) =>
      api(`/api/config/agents/${encodeURIComponent(agent.name)}`, 'PUT', localCliAgentUpdateBody(agent, priority))
    ))
    state.config = configs[configs.length - 1] || state.config
    await loadAgents()
    renderLocalCliAgentsList()
  } catch (err) {
    showToast(err.message)
  }
}

function renderDiagnosticsPanel() {
  const container = document.getElementById('agents-deploy-check')
  if (!container) return
  container.innerHTML = `
    <div class="agent-list" style="margin-bottom: 24px;">
      <div class="agent-item">
        <div class="agent-icon">D</div>
        <div class="agent-info">
          <div class="agent-name">${t('settings.diagnostics.deployment')}</div>
          <div class="agent-model">${state.deployCheck ? `pid ${escapeHtml(state.deployCheck.pid)} · ${escapeHtml(state.deployCheck.node)} · ${escapeHtml(state.deployCheck.durationMs)}ms` : t('settings.diagnostics.notChecked')}</div>
        </div>
        <span class="badge badge-${state.deployCheck?.ok ? 'active' : 'error'}">${state.deployCheck?.ok ? t('badge.ok') : t('badge.unknown')}</span>
      </div>
    </div>
  `
}

window.refreshDiagnostics = async function() {
  await loadDeployCheck()
  await loadAgents()
  renderDiagnosticsPanel()
  renderLocalCliAgentsList()
}

window.showLocalCliAgentDiagnostics = async function(name, preface = '') {
  return window.showAgentDiagnostics(name, preface)
}

function renderAgentDiagnosticResult(diagnostic) {
  const ready = diagnostic.healthy === true && (diagnostic.source !== 'configured' || diagnostic.smokeOk === true)
  const check = (label, value) => `
    <div class="agent-diagnostic-check ${value === true ? 'passed' : value === false ? 'failed' : 'pending'}">
      <span>${escapeHtml(label)}</span>
      <strong>${value === true ? t('modal.agentDiagnostics.passed') : value === false ? t('modal.agentDiagnostics.failed') : t('modal.agentDiagnostics.notRun')}</strong>
    </div>
  `
  return `
    <div class="agent-diagnostic-verdict ${ready ? 'ready' : 'not-ready'}">
      <strong>${ready ? t('modal.agentDiagnostics.ready') : t('modal.agentDiagnostics.notReady')}</strong>
      ${diagnostic.error ? `<p>${escapeHtml(diagnostic.error)}</p>` : ''}
    </div>
    <div class="agent-diagnostic-checks">
      ${check(t('modal.agentDiagnostics.commandCheck'), diagnostic.commandExecutable)}
      ${check(t('modal.agentDiagnostics.versionCheck'), diagnostic.versionOk)}
      ${check(t('modal.agentDiagnostics.modelCheck'), diagnostic.smokeOk)}
    </div>
    <details class="context-details">
      <summary>${t('modal.agentDiagnostics.details')}</summary>
      <pre class="code-block" style="white-space: pre-wrap; margin-top: 12px;">${escapeHtml(JSON.stringify(diagnostic, null, 2))}</pre>
    </details>
  `
}

window.showAgentDiagnostics = async function(name, preface = '') {
  if (state.agentDiagnosticsPending.has(name)) return
  state.agentDiagnosticsPending.add(name)
  renderAgentsList()
  renderLocalCliAgentsList()
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${t('modal.agentDiagnostics.title')}</h3>
          <p>${escapeHtml(name)}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      <div class="agent-diagnostic-progress" role="status">
        <span class="running-spinner"></span>
        <div>
          <strong>${t('modal.agentDiagnostics.running')}</strong>
          <p>${t('modal.agentDiagnostics.runningDesc')}</p>
        </div>
      </div>
    </div>
  `)
  try {
    const diagnostic = await api(`/api/agents/${encodeURIComponent(name)}/diagnostics?refresh=1`)
    await loadAgents()
    renderAgentsList()
    renderLocalCliAgentsList()
    showModal(`
      <div class="modal-card">
        <div class="modal-head">
          <div>
            <h3>${t('modal.agentDiagnostics.title')}</h3>
            <p>${escapeHtml(name)}</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
        </div>
        ${preface ? `<p style="color: var(--red); margin-bottom: 12px;">${escapeHtml(preface)}</p>` : ''}
        ${renderAgentDiagnosticResult(diagnostic)}
      </div>
    `)
  } catch (err) {
    showToast(err.message)
    showModal(`
      <div class="modal-card">
        <div class="modal-head">
          <div>
            <h3>${t('modal.agentDiagnostics.failed')}</h3>
            <p>${escapeHtml(name)}</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
        </div>
        <pre class="code-block" style="white-space: pre-wrap;">${escapeHtml(err.message)}</pre>
      </div>
    `)
  } finally {
    state.agentDiagnosticsPending.delete(name)
    renderAgentsList()
    renderLocalCliAgentsList()
  }
}

window.showLocalCliAgentModal = function(name) {
  const agent = state.agents.find(item => item.kind === 'local' && item.name === name)
  if (!agent) return
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${t('modal.localCli.edit.title')}</h3>
          <p>${escapeHtml(agent.name)} · ${escapeHtml(agent.adapter)}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      <form onsubmit='window.saveLocalCliAgent(event, ${jsString(agent.name)})'>
        <div class="form-row">
          <div class="form-group">
            <label>${t('common.name')}</label>
            <input class="input" name="name" required value="${escapeAttr(agent.name)}">
          </div>
          <div class="form-group">
            <label>${t('common.adapter')}</label>
            <input class="input" name="adapter" required value="${escapeAttr(agent.adapter)}">
          </div>
        </div>
        <div class="form-group">
          <label>${t('common.command')}</label>
          <input class="input" name="command" required value="${escapeAttr(agent.command || '')}">
        </div>
        <div class="form-group">
          <label>${t('common.args')}</label>
          <textarea class="input" name="args" rows="3">${escapeHtml((agent.args || []).join('\\n'))}</textarea>
        </div>
        <div class="form-group">
          <label>${t('common.timeout')}</label>
          <input class="input" name="timeout" type="number" min="1" value="${escapeAttr(agent.timeout || '')}">
        </div>
        <div class="form-group">
          <label>${t('common.env')}</label>
          <textarea class="input" name="env" rows="3" placeholder="KEY=value">${escapeHtml(envToLines(agent.env))}</textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('common.save')}</button>
        </div>
      </form>
    </div>
  `)
}

window.showCustomCliAgentModal = function() {
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${t('modal.customCli.add.title')}</h3>
          <p>${t('modal.customCli.desc')}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      <form onsubmit="window.saveCustomCliAgent(event)">
        <div class="form-group">
          <label>${t('common.name')}</label>
          <input class="input" name="name" required>
        </div>
        <div class="form-group">
          <label>${t('common.command')}</label>
          <input class="input" name="command" required placeholder="${escapeAttr(t('modal.customCli.commandPlaceholder'))}">
        </div>
        <div class="form-group">
          <label>${t('common.args')}</label>
          <textarea class="input" name="args" rows="4" required placeholder="${escapeAttr(t('modal.customCli.argsPlaceholder'))}"></textarea>
          <p class="form-help">${t('modal.customCli.argsHelp')}</p>
        </div>
        <div class="form-group">
          <label>${t('common.env')}</label>
          <textarea class="input" name="env" rows="3" placeholder="KEY=VALUE"></textarea>
          <p class="form-help">${t('modal.customCli.envHelp')}</p>
        </div>
        <div class="form-group">
          <label>${t('common.timeout')}</label>
          <input class="input" name="timeout" type="number" min="1">
          <p class="form-help">${t('modal.customCli.timeoutHelp')}</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('common.save')}</button>
        </div>
      </form>
    </div>
  `)
}

window.saveCustomCliAgent = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const name = String(fd.get('name') || '').trim()
  const args = String(fd.get('args') || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean)
  const body = compactObject({
    name,
    adapter: 'custom-cli',
    command: String(fd.get('command') || '').trim(),
    args,
    timeout: parseInt(fd.get('timeout')) || undefined,
    priority: parseInt(fd.get('priority')) || undefined,
    env: parseEnvLines(String(fd.get('env') || '')),
  })
  try {
    state.config = await api('/api/config/agents', 'POST', body)
    await loadAgents()
    closeModal()
    renderAgentsList()
    renderLocalCliAgentsList()
    showToast(t('toast.localCliAdded', { name }), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.saveLocalCliAgent = async function(e, originalName) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const args = String(fd.get('args') || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean)
  const body = compactObject({
    name: String(fd.get('name') || '').trim(),
    adapter: String(fd.get('adapter') || '').trim(),
    command: String(fd.get('command') || '').trim(),
    args,
    timeout: parseInt(fd.get('timeout')) || undefined,
    env: parseEnvLines(String(fd.get('env') || '')),
  })
  try {
    state.config = await api(`/api/config/agents/${encodeURIComponent(originalName)}`, 'PUT', body)
    await loadAgents()
    closeModal()
    renderLocalCliAgentsList()
    showToast(t('toast.localCliSaved', { name: originalName }), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteLocalCliAgent = async function(name) {
  if (!await confirmAction({
    title: t('confirm.deleteLocalCli.title'),
    message: t('confirm.deleteLocalCli.message', { name }),
    confirmText: t('confirm.deleteLocalCli.confirm'),
    danger: true,
  })) return
  try {
    state.config = await api(`/api/config/agents/${encodeURIComponent(name)}`, 'DELETE')
    state.agents = state.agents.map(agent => agent.name === name && agent.kind === 'local'
      ? { ...agent, source: 'discovered', status: 'discovered', args: undefined, timeout: undefined, env: undefined }
      : agent
    )
    renderAgentsList()
    renderLocalCliAgentsList()
    showToast(t('toast.localCliRemoved', { name }), 'success')
    loadAgents().then(() => {
      renderAgentsList()
      renderLocalCliAgentsList()
    }).catch((err) => showToast(err.message))
  } catch (err) {
    showToast(err.message)
  }
}

window.switchSettingsTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tab === tab)
  })
}

window.changeLanguage = function(lang) {
  const langLabel = lang === 'zh' ? t('settings.general.language.zh') : t('settings.general.language.en')
  setLanguage(lang)
  showToast(t('toast.languageChanged', { lang: langLabel }), 'success')
}

window.saveGeneralSettings = async function() {
  const maxRounds = parseInt(document.getElementById('max-rounds-input').value)
  const mode = document.getElementById('mode-input').value

  try {
    await api('/api/config', 'PUT', {
      defaults: { maxRounds, mode },
    })
    showToast(t('toast.settingsSaved'), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.saveAllowedWorkspaces = async function() {
  const allowedWorkspaces = String(document.getElementById('allowed-workspaces-input')?.value || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)

  try {
    await api('/api/config', 'PUT', {
      policy: { allowedWorkspaces },
    })
    showToast(t('toast.settingsSaved'), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.showTemplateGalleryModal = async function() {
  if (!state.templates.length) await loadTemplates()
  if (!state.agents.length) await loadAgents()

  const templates = [...state.templates].sort((a, b) => {
    if (a.id === 'custom') return 1
    if (b.id === 'custom') return -1
    return 0
  })
  const agentNotice = state.agents.length ? '' : `
    <div class="template-empty-agents">
      <span>${t('newSession.noAgents')}</span>
      <button class="btn btn-secondary btn-sm" onclick="window.closeModal(); window.navigate('/settings')">${t('newSession.addOneFirst')}</button>
    </div>
  `

  showModal(`
    <div class="modal-card template-modal">
      <div class="modal-head">
        <div>
          <h3>${t('newSession.title')}</h3>
          <p>${t('newSession.choosePreset')}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      ${agentNotice}
      <div class="template-grid">
        ${templates.map(template => `
          <button class="card template-card" type="button" onclick='window.showNewSessionModal(${jsString(template.id)})'>
            <div class="template-icon">${escapeHtml(template.icon || '⚙️')}</div>
            <div class="template-body">
              <div class="template-title">${escapeHtml(template.nameEn || template.name)}</div>
              <p>${escapeHtml(template.description || '')}</p>
              <div class="template-tags">${(template.tags || template.config?.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `)
}

window.showNewSessionModal = async function(templateId = 'custom') {
  if (!state.templates.length) await loadTemplates()
  if (!state.agents.length) await loadAgents()
  const template = state.templates.find(item => item.id === templateId) || state.templates.find(item => item.id === 'custom')
  const readyAgents = sortAgentsByPriority(state.agents.filter(agent => agent.status === 'ready'))
  const agents = readyAgents.length ? readyAgents : sortAgentsByPriority(state.agents)
  const defaultFrom = preferredAgentName(agents, template?.config?.preferredAdapters?.from)
  const defaultTo = preferredAgentName(agents, template?.config?.preferredAdapters?.to, defaultFrom)
  const optionHtml = (selected) => agentOptionHtml(agents, selected)
  const mode = template?.config?.mode || state.config?.defaults?.mode || 'collaborate'
  const maxRounds = template?.config?.maxRounds || state.config?.defaults?.maxRounds || 5
  const prompts = template?.config?.systemPrompts || { from: '', to: '' }
  const templateBadge = template && template.id !== 'custom'
    ? `<div class="template-selected-badge">${t('newSession.templateBadge', { name: escapeHtml(template.nameEn || template.name) })}</div>`
    : ''
  const noAgents = state.agents.length === 0

  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${t('newSession.title')}</h3>
          <p>${t('newSession.desc')}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      ${templateBadge}
      ${noAgents ? `
        <div class="template-empty-agents" style="margin-bottom: 20px;">
          <span>${t('newSession.noAgents')}</span>
          <button class="btn btn-secondary btn-sm" onclick="window.closeModal(); window.navigate('/settings')">${t('newSession.addOneFirst')}</button>
        </div>
      ` : ''}
      <form onsubmit="window.createSession(event)">
        <input type="hidden" name="templateId" value="${escapeAttr(template?.id || 'custom')}">
        <div class="form-row">
          <div class="form-group">
            <label>${t('newSession.agentA')}</label>
            <select class="input" name="from" required ${noAgents ? 'disabled' : ''}>${optionHtml(defaultFrom)}</select>
          </div>
          <div class="form-group">
            <label>${t('newSession.agentB')} <span class="field-hint">${t('newSession.agentBHint')}</span></label>
            <select class="input" name="to" required ${noAgents ? 'disabled' : ''}>${optionHtml(defaultTo)}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>${t('newSession.mode')}</label>
            <select class="input" name="mode">
              <option value="collaborate" ${mode === 'collaborate' ? 'selected' : ''}>${t('newSession.mode.collaborate')}</option>
              <option value="discuss" ${mode === 'discuss' ? 'selected' : ''}>${t('newSession.mode.discuss')}</option>
              <option value="review" ${mode === 'review' ? 'selected' : ''}>${t('newSession.mode.review')}</option>
              <option value="freeform" ${mode === 'freeform' ? 'selected' : ''}>${t('newSession.mode.freeform')}</option>
            </select>
          </div>
          <div class="form-group">
            <label>${t('newSession.maxTurns')}</label>
            <input class="input" type="number" name="maxRounds" min="1" value="${maxRounds}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>${t('newSession.systemPromptA')}</label>
            <textarea class="input" name="systemPromptFrom" rows="4">${escapeHtml(prompts.from)}</textarea>
          </div>
          <div class="form-group">
            <label>${t('newSession.systemPromptB')}</label>
            <textarea class="input" name="systemPromptTo" rows="4">${escapeHtml(prompts.to)}</textarea>
          </div>
        </div>
        <div class="form-group">
          <label>${t('newSession.workingDir')}</label>
          <input class="input" name="cwd" placeholder="${t('newSession.workingDirPlaceholder')}">
        </div>
        <div class="form-group">
          <label>${t('newSession.permissionMode')}</label>
          <select class="input" name="permissionMode">
            <option value="safe">${t('newSession.permissionSafe')}</option>
            <option value="trusted">${t('newSession.permissionTrusted')}</option>
          </select>
        </div>
        <div class="form-group">
          <label>${t('newSession.prompt')}</label>
          <textarea class="input" name="prompt" rows="5" required placeholder="${t('newSession.promptPlaceholder')}"></textarea>
        </div>
        <details class="context-details">
          <summary>${t('newSession.context')}</summary>
          <div class="form-group">
            <label>${t('newSession.contextRules')}</label>
            <textarea class="input" name="contextRules" rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>${t('newSession.contextBackground')}</label>
            <textarea class="input" name="contextText" rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>${t('newSession.contextFiles')}</label>
            <textarea class="input" name="contextFiles" rows="2" placeholder="${t('newSession.contextFilesPlaceholder')}"></textarea>
          </div>
        </details>
        <label class="check-row">
          <input type="checkbox" name="approveMode">
          <span>${t('newSession.approveMode')}</span>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.showTemplateGalleryModal()">${t('newSession.back')}</button>
          <button type="submit" class="btn btn-primary" ${noAgents ? 'disabled' : ''}>${t('newSession.create')}</button>
        </div>
      </form>
    </div>
  `)
}

window.createSession = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const context = buildContextFromForm(fd)
  const systemPromptFrom = String(fd.get('systemPromptFrom') || '').trim()
  const systemPromptTo = String(fd.get('systemPromptTo') || '').trim()
  const cwd = String(fd.get('cwd') || '').trim()
  const toName = String(fd.get('to') || '')
  if (cwd && !agentHasFilesystem(toName)) {
    showToast(t('session.toast.cwdRequiresFilesystem'))
    return
  }
  const body = {
    from: { adapter: fd.get('from') },
    to: { adapter: fd.get('to') },
    initialPrompt: String(fd.get('prompt') || '').trim(),
    template_id: String(fd.get('templateId') || '').trim() || undefined,
    mode: fd.get('mode') || state.config?.defaults?.mode || 'collaborate',
    maxRounds: parseInt(fd.get('maxRounds')) || state.config?.defaults?.maxRounds || 5,
    approveMode: fd.get('approveMode') === 'on',
    permissionMode: fd.get('permissionMode') || 'safe',
    cwd: cwd || undefined,
    context,
  }
  if (systemPromptFrom && systemPromptTo) {
    body.systemPrompts = { from: systemPromptFrom, to: systemPromptTo }
  }

  try {
    const session = await api('/api/sessions', 'POST', body)
    closeModal()
    navigate(`/session/${session.id}`)
  } catch (err) {
    showToast(err.message)
  }
}

window.showNewTaskModal = async function() {
  if (!state.agents.length) await loadAgents()
  const acceptedAgents = state.agents.filter(taskAgentAccepted)
  const readyAgents = acceptedAgents.filter(agent => agent.status === 'ready')
  const agents = sortAgentsByPriority(readyAgents.length ? readyAgents : acceptedAgents.filter(agent => agent.status === 'unverified'))
  const noAgents = agents.length === 0
  const options = `<option value="__auto__" selected>${t('task_modal_auto_agent')}</option>${agentOptionHtml(agents)}`

  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${t('task_modal_title')}</h3>
          <p>${t('task_modal_desc')}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      ${noAgents ? `
        <div class="template-empty-agents" style="margin-bottom: 20px;">
          <span>${t('task_modal_no_agents')}</span>
          <button class="btn btn-secondary btn-sm" onclick="window.closeModal(); window.navigate('/settings')">${t('task_modal_add_one')}</button>
        </div>
      ` : ''}
      <form onsubmit="window.createTask(event)">
        <div class="form-group">
          <label>${t('task_agent')}</label>
          <select class="input" name="agent" required ${noAgents ? 'disabled' : ''}>${options}</select>
        </div>
        <div class="form-group">
          <label>${t('task_modal_working_dir')}</label>
          <input class="input" name="cwd" placeholder="${t('task_modal_working_dir_placeholder')}">
        </div>
        <div class="form-group">
          <label>${t('task_prompt')}</label>
          <textarea class="input" name="prompt" rows="6" required placeholder="${t('task_modal_prompt_placeholder')}"></textarea>
        </div>
        <details class="context-details">
          <summary>${t('task_modal_context')}</summary>
          <div class="form-group">
            <label>${t('task_modal_rules')}</label>
            <textarea class="input" name="contextRules" rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>${t('task_modal_background')}</label>
            <textarea class="input" name="contextText" rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>${t('task_modal_files')}</label>
            <textarea class="input" name="contextFiles" rows="2" placeholder="${t('task_modal_files_placeholder')}"></textarea>
          </div>
        </details>
        <div class="form-group">
          <label>${t('task_system_prompt')}</label>
          <textarea class="input" name="systemPrompt" rows="4" placeholder="${t('task_modal_system_prompt_placeholder')}"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary" ${noAgents ? 'disabled' : ''}>${t('task_modal_create')}</button>
        </div>
      </form>
    </div>
  `)
}

window.createTask = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const cwd = String(fd.get('cwd') || '').trim()
  const agentName = String(fd.get('agent') || '')
  if (cwd && agentName !== '__auto__' && !agentHasFilesystem(agentName)) {
    showToast(t('task_modal_cwd_requires_filesystem'))
    return
  }
  const body = {
    agent: agentName === '__auto__' ? undefined : { adapter: agentName },
    prompt: String(fd.get('prompt') || '').trim(),
    cwd: cwd || undefined,
    context: buildContextFromForm(fd),
    systemPrompt: String(fd.get('systemPrompt') || '').trim() || undefined,
  }
  try {
    const task = await api('/api/tasks', 'POST', compactObject(body))
    closeModal()
    navigate(`/task/${task.id}`)
  } catch (err) {
    showToast(err.message)
  }
}

window.showTaskFeedbackModal = function() {
  const task = state.currentTask
  if (!task) return
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${t('task_feedback_title')}</h3>
          <p>${t('task_feedback_desc')}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      <form onsubmit="window.rerunTaskWithFeedback(event)">
        <div class="form-group">
          <label>${t('task_feedback_label')}</label>
          <textarea class="input" name="feedback" rows="7" required placeholder="${t('task_feedback_placeholder')}"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary" data-submit>${t('task_feedback_create_new')}</button>
        </div>
      </form>
    </div>
  `)
}

window.showTaskHandoffModal = async function() {
  const task = state.currentTask
  if (!task) return
  if (!state.agents.length) await loadAgents()
  const agents = sortAgentsByPriority(state.agents.filter(agent => taskAgentAccepted(agent) && (!task.cwd || agentHasFilesystem(agent.name))))
  const noAgents = agents.length === 0
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${t('handoff_title')}</h3>
          <p>${t('handoff_desc')}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      ${noAgents ? `<p style="color: var(--text-muted); margin-bottom: 16px;">${t('handoff_no_agents')}</p>` : ''}
      <form onsubmit="window.handoffCurrentTask(event)">
        <div class="form-group">
          <label>${t('handoff_agent')}</label>
          <select class="input" name="agent" required ${noAgents ? 'disabled' : ''}>${agentOptionHtml(agents, '', { includeStatus: true })}</select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary" data-submit ${noAgents ? 'disabled' : ''}>${t('handoff_create')}</button>
        </div>
      </form>
    </div>
  `)
}

window.handoffCurrentTask = async function(e) {
  e.preventDefault()
  const task = state.currentTask
  if (!task) return
  const submit = e.target.querySelector('[data-submit]')
  const fd = new FormData(e.target)
  const agent = String(fd.get('agent') || '')
  if (task.cwd && !agentHasFilesystem(agent)) {
    showToast(t('task_modal_cwd_requires_filesystem'))
    return
  }
  try {
    if (submit) {
      submit.disabled = true
      submit.textContent = t('handoff_creating')
    }
    const created = await api(`/api/tasks/${encodeURIComponent(task.id)}/handoff`, 'POST', {
      agent: { adapter: agent },
    })
    closeModal()
    state.tasks.unshift(created)
    navigate(`/task/${created.id}`)
  } catch (err) {
    showToast(err.message)
    if (submit) {
      submit.disabled = false
      submit.textContent = t('handoff_create')
    }
  }
}

window.rerunTaskWithFeedback = async function(e) {
  e.preventDefault()
  const task = state.currentTask
  if (!task) return
  const submit = e.target.querySelector('[data-submit]')
  const fd = new FormData(e.target)
  const feedback = String(fd.get('feedback') || '').trim()
  if (!feedback) return
  const previous = task.result || task.output || task.lastAgentOutput || task.errorMessage || ''
  const prompt = [
    '\u8bf7\u57fa\u4e8e\u4e0b\u9762\u7684\u539f\u59cb\u4efb\u52a1\u3001\u4e0a\u6b21\u8f93\u51fa\u548c\u4eba\u5de5\u53cd\u9988\uff0c\u91cd\u65b0\u5b8c\u6210\u4efb\u52a1\u3002',
    '',
    '## \u539f\u59cb\u4efb\u52a1',
    task.prompt || '',
    '',
    previous ? `## \u4e0a\u6b21\u8f93\u51fa\n${previous}\n` : '',
    '## \u4eba\u5de5\u53cd\u9988',
    feedback,
  ].filter(Boolean).join('\n')
  try {
    if (submit) {
      submit.disabled = true
      submit.textContent = t('task_feedback_creating')
    }
    const created = await api('/api/tasks', 'POST', compactObject({
      agent: { adapter: task.agent?.adapter },
      prompt,
      context: taskRerunContext(task.context),
      systemPrompt: task.systemPrompt,
      cwd: task.cwd,
    }))
    closeModal()
    state.tasks.unshift(created)
    navigate(`/task/${created.id}`)
  } catch (err) {
    showToast(err.message)
    if (submit) {
      submit.disabled = false
      submit.textContent = t('task_feedback_create_new')
    }
  }
}

window.restartCurrentTask = async function() {
  const task = state.currentTask
  if (!task) return
  try {
    const created = await api('/api/tasks', 'POST', compactObject({
      agent: { adapter: task.agent?.adapter },
      prompt: task.prompt,
      context: taskRerunContext(task.context),
      systemPrompt: task.systemPrompt,
      cwd: task.cwd,
      permissionMode: task.permissionMode,
    }))
    state.tasks.unshift(created)
    navigate(`/task/${created.id}`)
  } catch (err) {
    showToast(err.message)
  }
}

function taskRerunContext(context) {
  if (!context) return undefined
  const files = Array.isArray(context.files)
    ? context.files
      .map(file => typeof file === 'string' ? file : file?.path)
      .filter(Boolean)
    : undefined
  return compactObject({
    rules: context.rules,
    text: context.text,
    files: files?.length ? files : undefined,
  })
}

window.stopCurrentTask = async function() {
  if (!state.currentTaskId) return
  try {
    const task = await api(`/api/tasks/${state.currentTaskId}/stop`, 'POST')
    applyTaskUpdate(task)
  } catch (err) {
    showToast(err.message)
  }
}

window.loadMorePipelines = loadMorePipelines
window.loadMoreTasks = loadMoreTasks

window.showNewWorkflowModal = async function() {
  if (!state.config) await loadConfig()
  if (!state.agents.length) await loadAgents()
  if (!state.pipelineTemplates.length) await loadPipelineTemplates()
  const readyAgents = sortAgentsByPriority(state.agents.filter(agent => agent.status === 'ready'))
  const agents = readyAgents.length ? readyAgents : sortAgentsByPriority(state.agents)
  const noAgents = agents.length === 0
  const defaultFrom = agents[0]?.name || ''
  const defaultTo = agents[1]?.name || agents[0]?.name || ''

  showModal(`
    <div class="modal-card workflow-modal">
      <div class="modal-head">
        <div>
          <h3>${t('wf_modal_title')}</h3>
          <p>${t('wf_modal_desc')}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('wf_modal_close')}</button>
      </div>
      ${noAgents ? `
        <div class="template-empty-agents" style="margin-bottom: 20px;">
          <span>${t('wf_modal_no_agents')}</span>
          <button class="btn btn-secondary btn-sm" onclick="window.closeModal(); window.navigate('/settings')">${t('wf_modal_add_one')}</button>
        </div>
      ` : ''}
      <form onsubmit="window.createWorkflow(event)">
        <div class="form-group">
          <label>${t('wf_template')}</label>
          <select class="input" name="templateId" onchange="window.applyWorkflowTemplate(this.value)">
            <option value="">${t('wf_custom_workflow')}</option>
            ${state.pipelineTemplates.map(template => `
              <option value="${escapeAttr(template.id)}">${escapeHtml(template.nameEn || template.name)}${template.source === 'user' ? ` · ${t('wf_template_mine')}` : ''}</option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>${t('wf_pipeline_name')}</label>
          <input class="input" name="name" required placeholder="${escapeAttr(t('wf_pipeline_placeholder'))}">
        </div>
        <div class="form-group">
          <label>${t('wf_input')}</label>
          <textarea class="input" name="workflowInput" rows="4" placeholder="${escapeAttr(t('wf_input_placeholder'))}"></textarea>
        </div>
        <div class="form-group">
          <label>${t('wf_start_from_step')}</label>
          <input class="input" name="startAtStep" type="number" min="1" value="1">
          <small>${t('wf_start_from_step_hint')}</small>
        </div>
        <div class="workflow-editor-head">
          <h3>${t('wf_steps_title')}</h3>
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.addWorkflowStep()">${t('wf_add_step')}</button>
        </div>
        <div id="workflow-step-editor" class="workflow-step-editor" data-from="${escapeAttr(defaultFrom)}" data-to="${escapeAttr(defaultTo)}" data-count="0"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('wf_cancel')}</button>
          <button type="button" class="btn btn-secondary" onclick="window.saveWorkflowTemplate()">${t('wf_save_template')}</button>
          <button type="button" class="btn btn-danger" id="delete-workflow-template" style="display:none" onclick="window.deleteWorkflowTemplate()">${t('wf_delete_template')}</button>
          <button type="submit" class="btn btn-primary" ${noAgents ? 'disabled' : ''}>${t('wf_create')}</button>
        </div>
      </form>
    </div>
  `)
  const defaultTemplate = state.pipelineTemplates.find(template => /\u6296\u97f3\u89c6\u9891\u751f\u6210/.test(template.name))
  if (defaultTemplate) {
    const select = document.querySelector('select[name="templateId"]')
    if (select) select.value = defaultTemplate.id
    window.applyWorkflowTemplate(defaultTemplate.id)
  } else {
    window.addWorkflowStep()
    window.addWorkflowStep()
  }
}

window.addWorkflowStep = function(step = {}, options = {}) {
  const editor = document.getElementById('workflow-step-editor')
  if (!editor) return
  const index = Number(editor.dataset.count || '0')
  editor.dataset.count = String(index + 1)
  const defaultFrom = editor.dataset.from || ''
  const defaultTo = editor.dataset.to || defaultFrom
  const row = document.createElement('div')
  row.className = 'workflow-edit-step'
  row.draggable = true
  row.dataset.autoDefaultDependency = options.autoDefaultDependency === false ? 'false' : 'true'
  if (step.cwd) row.dataset.cwd = step.cwd
  if (step.context) row.dataset.context = JSON.stringify(step.context)
  row.innerHTML = renderWorkflowEditStep(index, step, defaultFrom, defaultTo)
  row.addEventListener('dragstart', event => {
    event.dataTransfer.setData('text/plain', String([...editor.children].indexOf(row)))
  })
  row.addEventListener('dragover', event => event.preventDefault())
  row.addEventListener('drop', event => {
    event.preventDefault()
    const from = Number(event.dataTransfer.getData('text/plain'))
    const rows = [...editor.children]
    const source = rows[from]
    if (!source || source === row) return
    editor.insertBefore(source, rows.indexOf(row) > from ? row.nextSibling : row)
    refreshWorkflowStepEditor()
  })
  editor.appendChild(row)
  refreshWorkflowStepEditor()
}

const WORKFLOW_NODE_TYPES = {
  video_parse: { labelKey: 'wf_node_video_parse', sectionsKey: 'wf_sections_video_parse', agent: 'codex', inputs: 'source-video', output: 'reference.md' },
  copy_adapt: { labelKey: 'wf_node_copy_adapt', sectionsKey: 'wf_sections_copy_adapt', agent: 'deepseek', inputs: 'reference.md', output: 'script-adapted.md' },
  storyboard_script: { labelKey: 'wf_node_storyboard_script', sectionsKey: 'wf_sections_storyboard_script', agent: 'codex', inputs: 'script-adapted.md', output: 'reference.md, script.md, prompt.txt' },
  image_generate: { labelKey: 'wf_node_image_generate', agent: 'codex', inputs: 'script.md,prompt.txt', output: 'storyboard-step4.png, character-hero-turnaround.png, character-director-turnaround.png', sections: '' },
  video_command: { labelKey: 'wf_node_video_command', sectionsKey: 'wf_sections_video_command', agent: 'codex', inputs: 'storyboard-step4.png, character-hero-turnaround.png, character-director-turnaround.png, prompt.txt', output: 'video-command.md' },
  video_generate: { labelKey: 'wf_node_video_generate', agent: 'codex', inputs: 'video-command.md', output: '*.mp4', sections: '' },
  human_review: { labelKey: 'wf_node_human_review', agent: 'codex', inputs: '*.mp4', output: '*.mp4', sections: '' },
  custom: { labelKey: 'wf_node_custom', agent: 'codex', inputs: '', output: '', sections: '' },
}

function workflowNodeTypeForStep(step) {
  if (step.nodeType) return step.nodeType
  const title = String(step.title || '')
  if (/\u89e3\u6790.*\u89c6\u9891/.test(title)) return 'video_parse'
  if (/\u6539\u7f16\u6587\u6848/.test(title)) return 'copy_adapt'
  if (/\u5206\u955c\u4e0e Prompt|\u5206\u955c\u811a\u672c/.test(title)) return 'storyboard_script'
  if (/\u89c6\u89c9\u8d44\u4ea7|\u5206\u955c\u56fe|\u89d2\u8272\u4e09\u89c6\u56fe/.test(title)) return 'image_generate'
  if (/\u547d\u4ee4/.test(title)) return 'video_command'
  if (/\u6267\u884c\u89c6\u9891|\u751f\u6210\u89c6\u9891/.test(title)) return 'video_generate'
  if (/\u5ba1\u6838|\u4fdd\u5b58/.test(title)) return 'human_review'
  return 'custom'
}

function workflowNodeTypeLabel(nodeType) {
  const item = WORKFLOW_NODE_TYPES[nodeType]
  return item?.labelKey ? t(item.labelKey) : (nodeType || '')
}

function workflowNodeTypeSections(nodeType) {
  const item = WORKFLOW_NODE_TYPES[nodeType]
  return item?.sectionsKey ? t(item.sectionsKey) : (item?.sections || '')
}

function preferredWorkflowAgent(nodeType, fallback = '') {
  const preferred = WORKFLOW_NODE_TYPES[nodeType]?.agent
  return state.agents.find(agent => agent.name.toLowerCase().includes(preferred))?.name || fallback || state.agents[0]?.name || ''
}

function renderWorkflowEditStep(index, step, defaultFrom, defaultTo) {
  const options = state.agents.map(agent => `<option value="${escapeAttr(agent.name)}">${escapeHtml(agent.name)} · ${escapeHtml(agent.model || agent.adapter)}</option>`).join('')
  const from = resolveWorkflowAgentName(step.from, step.fromAdapter, defaultFrom)
  const nodeType = workflowNodeTypeForStep(step)
  const preset = WORKFLOW_NODE_TYPES[nodeType]
  const to = resolveWorkflowAgentName(step.agent || step.to, step.toAdapter, preferredWorkflowAgent(nodeType, defaultTo), from)
  const mode = step.mode || 'collaborate'
  const maxRounds = step.maxRounds || state.config?.defaults?.maxRounds || 5
  const title = step.title || `Step ${index + 1}`
  const prompt = step.initialPrompt || ''
  const permissionMode = step.permissionMode || 'safe'
  const cwd = step.cwd || ''
  const outputDir = step.outputDir || ''
  const inputs = (step.contract?.inputs || (preset.inputs ? preset.inputs.split(',') : [])).join(', ')
  const firstOutput = step.contract?.outputs?.[0]
  const outputFile = step.contract?.outputs?.map(output => output.fileName).join(', ') || preset.output
  const presetSections = workflowNodeTypeSections(nodeType)
  const requiredSections = (firstOutput?.requiredSections || (presetSections ? presetSections.split(',') : [])).join(', ')
  return `
    <div class="workflow-edit-title">
      <span class="drag-handle">↕</span>
      <strong data-step-label>${t('wf_step', { number: index + 1 })}</strong>
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.removeWorkflowStep(this)">${t('wf_remove')}</button>
    </div>
    <div class="form-group">
      <label>${t('wf_step_name')}</label>
      <input class="input" name="title" required value="${escapeAttr(title)}" placeholder="${escapeAttr(t('wf_step_name_placeholder'))}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>${t('wf_node_type')}</label>
        <select class="input" name="nodeType" onchange="window.applyWorkflowNodeType(this)">
          ${Object.entries(WORKFLOW_NODE_TYPES).map(([value]) => `<option value="${value}" ${value === nodeType ? 'selected' : ''}>${escapeHtml(workflowNodeTypeLabel(value))}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>${t('wf_primary_agent')}</label>
        <select class="input" name="agent" required>${options.replace(`value="${escapeAttr(to)}"`, `value="${escapeAttr(to)}" selected`)}</select>
      </div>
    </div>
    <input type="hidden" name="from" value="${escapeAttr(from)}">
    <input type="hidden" name="mode" value="${escapeAttr(mode)}">
    <input type="hidden" name="maxRounds" value="${escapeAttr(String(maxRounds))}">
    <input type="hidden" name="permissionMode" value="${escapeAttr(permissionMode)}">
    <div class="form-row">
      <div class="form-group">
        <label>${t('wf_inputs')}</label>
        <input class="input" name="contractInputs" value="${escapeAttr(inputs)}" placeholder="reference.md">
      </div>
      <div class="form-group">
        <label>${t('wf_output_files')}</label>
        <input class="input" name="contractOutput" value="${escapeAttr(outputFile)}" placeholder="script.md, prompt.txt">
      </div>
    </div>
    <div class="form-group">
      <label>${t('wf_required_sections')}</label>
      <input class="input" name="contractSections" value="${escapeAttr(requiredSections)}" placeholder="${escapeAttr(t('wf_required_sections_placeholder'))}">
    </div>
    <details class="workflow-step-advanced">
      <summary>${t('wf_advanced')}</summary>
      <div class="form-group">
        <label>${t('wf_prompt')}</label>
        <textarea class="input" name="initialPrompt" rows="3" required placeholder="${escapeAttr(t('wf_prompt_placeholder'))}">${escapeHtml(prompt)}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${t('wf_working_dir')}</label>
          <input class="input" name="cwd" value="${escapeAttr(cwd)}" placeholder="/path/to/project">
        </div>
        <div class="form-group">
          <label>${t('wf_output_dir')}</label>
          <input class="input" name="outputDir" value="${escapeAttr(outputDir)}" placeholder="/path/to/save/outputs">
        </div>
      </div>
    </details>
    <label class="check-row">
      <input type="checkbox" name="approveMode" ${step.approveMode ? 'checked' : ''}>
      <span>${t('wf_pause_before_step')}</span>
    </label>
    <div class="form-group">
      <label>${t('wf_depends_on_label')}</label>
      <select class="input" name="dependsOn" multiple data-deps></select>
    </div>
  `
}

window.applyWorkflowNodeType = function(select) {
  const row = select.closest('.workflow-edit-step')
  const preset = WORKFLOW_NODE_TYPES[select.value] || WORKFLOW_NODE_TYPES.custom
  const agent = preferredWorkflowAgent(select.value)
  if (agent) row.querySelector('[name="agent"]').value = agent
  row.querySelector('[name="contractInputs"]').value = preset.inputs
  row.querySelector('[name="contractOutput"]').value = preset.output
  row.querySelector('[name="contractSections"]').value = workflowNodeTypeSections(select.value)
  if (/^Step \d+$/.test(row.querySelector('[name="title"]').value)) row.querySelector('[name="title"]').value = workflowNodeTypeLabel(select.value)
}

function resolveWorkflowAgentName(ref, preferredAdapter, fallback, avoidName) {
  if (ref?.adapter && state.agents.some(agent => agent.name === ref.adapter)) return ref.adapter
  return preferredAgentName(state.agents, preferredAdapter || ref?.adapter, avoidName) || fallback
}

window.applyWorkflowTemplate = function(templateId) {
  const template = state.pipelineTemplates.find(item => item.id === templateId)
  const editor = document.getElementById('workflow-step-editor')
  const nameInput = document.querySelector('form [name="name"]')
  const deleteButton = document.getElementById('delete-workflow-template')
  if (!editor) return
  editor.innerHTML = ''
  editor.dataset.count = '0'
  if (!template) {
    window.addWorkflowStep()
    window.addWorkflowStep()
    if (nameInput) nameInput.value = ''
    if (deleteButton) deleteButton.style.display = 'none'
    return
  }
  if (nameInput) nameInput.value = template.name
  template.steps.forEach(step => window.addWorkflowStep(step, { autoDefaultDependency: false }))
  if (deleteButton) deleteButton.style.display = template.source === 'user' ? '' : 'none'
  const rows = [...editor.querySelectorAll('.workflow-edit-step')]
  rows.forEach((row, index) => {
    const deps = row.querySelector('[data-deps]')
    const dependsOn = template.steps[index]?.dependsOn || []
    ;[...deps.options].forEach(option => {
      option.selected = dependsOn.includes(Number(option.value))
    })
  })
}

function collectWorkflowSteps(workflowInput = '') {
  const rows = [...document.querySelectorAll('#workflow-step-editor .workflow-edit-step')]
  return rows.map(row => {
    const dependsOn = [...row.querySelector('[name="dependsOn"]').selectedOptions]
      .map(option => Number(option.value))
      .filter(value => Number.isInteger(value))
    const initialPrompt = row.querySelector('[name="initialPrompt"]').value.trim()
    const inputs = row.querySelector('[name="contractInputs"]').value.split(',').map(value => value.trim()).filter(Boolean)
    const outputFiles = row.querySelector('[name="contractOutput"]').value.split(',').map(value => value.trim()).filter(Boolean)
    const requiredSections = row.querySelector('[name="contractSections"]').value.split(',').map(value => value.trim()).filter(Boolean)
    const promptWithInput = !dependsOn.length && workflowInput
      ? `${initialPrompt}\n\n${t('wf_input_prefix')}\n${workflowInput}`
      : initialPrompt
    return compactObject({
      from: { adapter: row.querySelector('[name="from"]').value },
      to: { adapter: row.querySelector('[name="agent"]').value },
      agent: { adapter: row.querySelector('[name="agent"]').value },
      title: row.querySelector('[name="title"]').value.trim(),
      nodeType: row.querySelector('[name="nodeType"]').value,
      contract: compactObject({
        inputs: inputs.length ? inputs : undefined,
        outputs: outputFiles.length ? outputFiles.map((fileName, index) => ({
          fileName,
          requiredSections: index === 0 && requiredSections.length ? requiredSections : undefined,
        })) : undefined,
      }),
      initialPrompt: promptWithInput,
      mode: row.querySelector('[name="mode"]').value,
      maxRounds: parseInt(row.querySelector('[name="maxRounds"]').value) || undefined,
      approveMode: row.querySelector('[name="approveMode"]').checked || undefined,
      permissionMode: row.querySelector('[name="permissionMode"]').value,
      cwd: row.querySelector('[name="cwd"]').value.trim() || undefined,
      outputDir: row.querySelector('[name="outputDir"]').value.trim() || undefined,
      context: row.dataset.context ? JSON.parse(row.dataset.context) : undefined,
      dependsOn: dependsOn.length ? dependsOn : undefined,
    })
  })
}

window.saveWorkflowTemplate = async function() {
  const nameInput = document.querySelector('form [name="name"]')
  const name = nameInput?.value.trim()
  if (!name) {
    showToast(t('wf_pipeline_name_required'))
    return
  }
  try {
    const template = await api('/api/pipeline-templates', 'POST', {
      name,
      steps: collectWorkflowSteps(),
    })
    state.pipelineTemplates.unshift(template)
    const select = document.querySelector('select[name="templateId"]')
    if (select) {
      select.insertAdjacentHTML('beforeend', `<option value="${escapeAttr(template.id)}">${escapeHtml(template.name)} · ${t('wf_template_mine')}</option>`)
      select.value = template.id
    }
    const deleteButton = document.getElementById('delete-workflow-template')
    if (deleteButton) deleteButton.style.display = ''
    showToast(t('wf_template_saved'))
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteWorkflowTemplate = async function() {
  const select = document.querySelector('select[name="templateId"]')
  const id = select?.value
  const template = state.pipelineTemplates.find(item => item.id === id)
  if (!template || template.source !== 'user') return
  try {
    await api(`/api/pipeline-templates/${id}`, 'DELETE')
    state.pipelineTemplates = state.pipelineTemplates.filter(item => item.id !== id)
    select.querySelector(`option[value="${CSS.escape(id)}"]`)?.remove()
    select.value = ''
    window.applyWorkflowTemplate('')
    showToast(t('wf_template_deleted'))
  } catch (err) {
    showToast(err.message)
  }
}

window.removeWorkflowStep = function(button) {
  const row = button.closest('.workflow-edit-step')
  if (row) row.remove()
  refreshWorkflowStepEditor()
}

function refreshWorkflowStepEditor() {
  const editor = document.getElementById('workflow-step-editor')
  if (!editor) return
  const rows = [...editor.querySelectorAll('.workflow-edit-step')]
  rows.forEach((row, index) => {
    row.querySelector('[data-step-label]').textContent = t('wf_step', { number: index + 1 })
    const deps = row.querySelector('[data-deps]')
    const selected = [...deps.selectedOptions].map(option => option.value)
    deps.innerHTML = rows.map((_, depIndex) => {
      if (depIndex >= index) return ''
      const shouldAutoDefault = row.dataset.autoDefaultDependency !== 'false'
      const defaultSelected = selected.includes(String(depIndex)) || (shouldAutoDefault && selected.length === 0 && depIndex === index - 1)
      return `<option value="${depIndex}" ${defaultSelected ? 'selected' : ''}>${t('wf_step', { number: depIndex + 1 })}</option>`
    }).join('')
  })
}

window.createWorkflow = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const workflowInput = String(fd.get('workflowInput') || '').trim()
  const startAtStep = parseInt(String(fd.get('startAtStep') || '1'), 10)
  const steps = collectWorkflowSteps(workflowInput)

  try {
    const pipeline = await api('/api/pipelines', 'POST', {
      name: String(fd.get('name') || '').trim(),
      steps,
      startAtStep: Number.isInteger(startAtStep) && startAtStep > 1 ? startAtStep : undefined,
      manualOutput: workflowInput || undefined,
    })
    closeModal()
    navigate(`/workflow/${pipeline.id}`)
  } catch (err) {
    showToast(err.message)
  }
}

window.toggleWorkflowStep = function(sessionId) {
  state.expandedWorkflowStep = state.expandedWorkflowStep === sessionId ? null : sessionId
  renderWorkflowSteps(state.currentPipeline)
}

window.resumeWorkflowStep = async function(sessionId) {
  try {
    await api(`/api/sessions/${sessionId}/resume`, 'POST')
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
}

window.approveWorkflowStep = async function(sessionId, waitingForHumanApproval) {
  if (!waitingForHumanApproval) return window.resumeWorkflowStep(sessionId)
  try {
    await api(`/api/sessions/${sessionId}/confirm`, 'POST')
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
}

window.rerunWorkflowStep = async function(sessionId, title) {
  if (!await confirmAction({
    title: t('wf_confirm_rerun_title'),
    message: t('wf_confirm_rerun_message', { title: title || t('wf_confirm_rerun_current') }),
    confirmText: t('wf_confirm_rerun_confirm'),
  })) return
  try {
    const pipeline = await api(`/api/sessions/${sessionId}/rerun`, 'POST')
    closeModal()
    applyPipelineUpdate(pipeline)
  } catch (err) {
    showToast(err.message)
  }
}

window.toggleWorkflowLiveReview = async function(sessionId) {
  if (state.liveReviewStep === sessionId) {
    window.closeWorkflowLiveReview()
    return
  }
  stopWorkflowSpeechRecognition()
  state.liveReviewStep = sessionId
  state.expandedWorkflowStep = sessionId
  renderWorkflowSteps(state.currentPipeline)
  const step = state.currentPipeline?.sessions?.find(item => item.sessionId === sessionId)
  const session = state.currentPipeline?.sessionDetails?.find(item => item.id === sessionId)
  if (step && session) {
    await hydrateWorkflowLiveReviewArtifact(step, session, workflowOutputMessage(session.messages || []) || '')
  }
  requestAnimationFrame(() => {
    const panel = document.querySelector(`[data-live-review="${CSS.escape(sessionId)}"]`)
    panel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    panel?.querySelector('.live-review-input')?.focus()
  })
}

window.closeWorkflowLiveReview = function() {
  stopWorkflowSpeechRecognition()
  state.liveReviewStep = null
  renderWorkflowSteps(state.currentPipeline)
}

window.updateWorkflowLiveReviewDraft = function(sessionId, value) {
  state.liveReviewDrafts.set(sessionId, value)
}

window.handleWorkflowLiveReviewKeydown = function(event, sessionId) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
}

window.submitWorkflowLiveReview = async function(event, sessionId) {
  event.preventDefault()
  const input = event.currentTarget.querySelector('.live-review-input')
  const content = String(input?.value || state.liveReviewDrafts.get(sessionId) || '').trim()
  if (!content || state.liveReviewPending.has(sessionId)) return

  stopWorkflowSpeechRecognition()
  state.liveReviewPending.add(sessionId)
  state.liveReviewArtifacts.delete(sessionId)
  state.liveReviewDrafts.set(sessionId, '')
  renderWorkflowSteps(state.currentPipeline)

  try {
    await api(`/api/sessions/${sessionId}/message`, 'POST', { content })
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
      const step = pipeline.sessions?.find(item => item.sessionId === sessionId)
      const session = pipeline.sessionDetails?.find(item => item.id === sessionId)
      if (step && session) {
        await hydrateWorkflowLiveReviewArtifact(step, session, workflowOutputMessage(session.messages || []) || '', true)
      }
    }
  } catch (err) {
    state.liveReviewPending.delete(sessionId)
    state.liveReviewDrafts.set(sessionId, content)
    renderWorkflowSteps(state.currentPipeline)
    showToast(err.message)
  }
}

window.toggleWorkflowVoice = function(sessionId) {
  if (state.workflowSpeechRecognition && state.workflowSpeechSessionId === sessionId) {
    stopWorkflowSpeechRecognition()
    return
  }

  stopWorkflowSpeechRecognition()
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SpeechRecognition) {
    showToast(t('wf_speech_unsupported'))
    return
  }

  const recognition = new SpeechRecognition()
  const base = String(state.liveReviewDrafts.get(sessionId) || '').trim()
  recognition.lang = 'zh-CN'
  recognition.continuous = true
  recognition.interimResults = true

  recognition.onstart = () => {
    state.workflowSpeechRecognition = recognition
    state.workflowSpeechSessionId = sessionId
    updateWorkflowVoiceButton(sessionId, true)
  }
  recognition.onresult = (event) => {
    let finalText = ''
    let interimText = ''
    for (let index = 0; index < event.results.length; index += 1) {
      const text = event.results[index][0]?.transcript || ''
      if (event.results[index].isFinal) finalText += text
      else interimText += text
    }
    const value = [base, finalText, interimText].filter(Boolean).join(' ').trim()
    state.liveReviewDrafts.set(sessionId, value)
    const input = document.querySelector(`[data-live-review="${CSS.escape(sessionId)}"] .live-review-input`)
    if (input) input.value = value
  }
  recognition.onerror = (event) => {
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      showToast(t('wf_speech_failed', { error: event.error }))
    }
  }
  recognition.onend = () => {
    if (state.workflowSpeechRecognition === recognition) {
      state.workflowSpeechRecognition = null
      state.workflowSpeechSessionId = null
    }
    updateWorkflowVoiceButton(sessionId, false)
  }
  recognition.start()
}

function updateWorkflowVoiceButton(sessionId, listening) {
  const indicator = document.querySelector(`[data-live-review-mic="${CSS.escape(sessionId)}"]`)
  const button = indicator?.closest('.live-review-voice')
  if (indicator) indicator.textContent = listening ? '■' : '●'
  if (button) button.classList.toggle('listening', listening)
}

function stopWorkflowSpeechRecognition() {
  const recognition = state.workflowSpeechRecognition
  const sessionId = state.workflowSpeechSessionId
  state.workflowSpeechRecognition = null
  state.workflowSpeechSessionId = null
  if (recognition) {
    try { recognition.stop() } catch { /* already stopped */ }
  }
  if (sessionId) updateWorkflowVoiceButton(sessionId, false)
}

window.openWorkflowStepMessage = function(sessionId, title) {
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <h3>${escapeHtml(t('wf_insert_message_title', { title: title || t('wf_current_step') }))}</h3>
        <button class="icon-btn" onclick="window.closeModal()">×</button>
      </div>
      <form onsubmit='window.submitWorkflowStepMessage(event, ${jsString(sessionId)})'>
        <div class="form-group">
          <label>${t('wf_message_content')}</label>
          <textarea class="input" name="content" rows="6" required placeholder="${escapeAttr(t('wf_message_placeholder'))}"></textarea>
          <small class="form-hint">${t('wf_message_hint')}</small>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('wf_cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('wf_send')}</button>
        </div>
      </form>
    </div>
  `)
}

window.submitWorkflowStepMessage = async function(event, sessionId) {
  event.preventDefault()
  const fd = new FormData(event.target)
  const content = String(fd.get('content') || '').trim()
  if (!content) return
  try {
    await api(`/api/sessions/${sessionId}/message`, 'POST', { content })
    closeModal()
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
}

window.openManualArtifactsModal = function(sessionId, title) {
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <h3>${escapeHtml(t('wf_manual_title', { title: title || t('wf_current_step') }))}</h3>
        <button class="icon-btn" onclick="window.closeModal()">×</button>
      </div>
      <form onsubmit='window.submitManualArtifacts(event, ${jsString(sessionId)})'>
        <div class="form-group">
          <label>${t('wf_local_paths')}</label>
          <textarea class="input" name="paths" rows="5" required placeholder="/absolute/path/to/image.png&#10;/absolute/path/to/another.png"></textarea>
          <small class="form-hint">${t('wf_manual_hint')}</small>
        </div>
        <div class="form-group">
          <label>${t('wf_result_summary')}</label>
          <input class="input" name="summary" placeholder="${escapeAttr(t('wf_result_summary_placeholder'))}">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('wf_cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('wf_manual_submit')}</button>
        </div>
      </form>
    </div>
  `)
}

window.submitManualArtifacts = async function(event, sessionId) {
  event.preventDefault()
  const fd = new FormData(event.target)
  const paths = String(fd.get('paths') || '').split(/\r?\n|,/).map(path => path.trim()).filter(Boolean)
  const summary = String(fd.get('summary') || '').trim()
  if (!paths.length) return
  try {
    await api(`/api/sessions/${sessionId}/manual-artifacts`, 'POST', { paths, summary })
    closeModal()
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
}

window.requestWorkflowStepChanges = function(sessionId, title) {
  const stepIndex = stepIndexBySessionId(sessionId)
  const targets = workflowRevisionTargets(stepIndex)
  const defaultTarget = targets.at(-1)?.id || sessionId
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <h3>${t('wf_request_changes_title')}</h3>
        <button class="icon-btn" onclick="window.closeModal()">×</button>
      </div>
      <form onsubmit='window.submitWorkflowStepChanges(event)'>
        <div class="form-group">
          <label>${t('wf_target_step')}</label>
          <select class="input" name="sessionId">
            ${targets.map(target => `
              <option value="${escapeAttr(target.id)}" ${target.id === defaultTarget ? 'selected' : ''}>
                ${escapeHtml(t('wf_step_title', { number: target.index + 1, title: target.title }))}
              </option>
            `).join('')}
          </select>
          <small class="form-hint">${t('wf_request_changes_hint')}</small>
        </div>
        <div class="form-group">
          <label>${t('wf_change_request')}</label>
          <textarea class="input" name="content" rows="6" required placeholder="${escapeAttr(t('wf_change_placeholder'))}"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('wf_cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('wf_submit_changes')}</button>
        </div>
      </form>
    </div>
  `)
}

window.submitWorkflowStepChanges = async function(event) {
  event.preventDefault()
  const fd = new FormData(event.target)
  const sessionId = String(fd.get('sessionId') || '').trim()
  const content = String(fd.get('content') || '').trim()
  if (!sessionId || !content) return
  try {
    await api(`/api/sessions/${sessionId}/message`, 'POST', { content })
    closeModal()
    if (state.currentPipelineId) {
      const pipeline = await api(`/api/pipelines/${state.currentPipelineId}`)
      applyPipelineUpdate(pipeline)
    }
  } catch (err) {
    showToast(err.message)
  }
}

window.pauseWorkflow = async function() {
  if (!state.currentPipelineId) return
  try {
    const pipeline = await api(`/api/pipelines/${state.currentPipelineId}/pause`, 'POST')
    applyPipelineUpdate(pipeline)
  } catch (err) {
    showToast(err.message)
  }
}

window.resumeWorkflow = async function() {
  if (!state.currentPipelineId) return
  try {
    const pipeline = await api(`/api/pipelines/${state.currentPipelineId}/resume`, 'POST')
    applyPipelineUpdate(pipeline)
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteCurrentWorkflow = async function() {
  if (!state.currentPipelineId) return
  if (!await confirmAction({
    title: t('wf_confirm_delete_title'),
    message: t('wf_confirm_delete_message'),
    confirmText: t('wf_confirm_delete_confirm'),
    danger: true,
  })) return
  try {
    await api(`/api/pipelines/${state.currentPipelineId}`, 'DELETE')
    state.pipelines = state.pipelines.filter(pipeline => pipeline.id !== state.currentPipelineId)
    navigate('/workflows')
  } catch (err) {
    showToast(err.message)
  }
}

window.showAgentModal = async function(name) {
  if (!state.apiKeys.length) await loadApiKeys()
  const existing = state.agents.find(agent => agent.name === name)
  const selectedProvider = providerPresetForAgent(existing)
  const selectedPreset = PROVIDER_PRESETS[selectedProvider]
  const selectedModel = existing?.model || defaultModelForProvider(selectedProvider)
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${existing ? t('modal.agent.edit') : t('modal.agent.add')}</h3>
          <p>${t('modal.agent.desc')}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      <form onsubmit='window.saveAgent(event, ${existing ? jsString(existing.name) : 'null'})'>
        <div class="form-row">
          <div class="form-group">
            <label>${t('common.name')}</label>
            <input class="input" name="name" required value="${escapeAttr(existing?.name || '')}">
          </div>
          <div class="form-group">
            <label>${t('common.provider')}</label>
            <select class="input" name="provider" id="agent-provider-select" required onchange="window.updateAgentProviderOptions()">
              ${providerPresetOptions(selectedProvider)}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>${t('common.model')}</label>
          <div id="agent-model-control">${modelControl(selectedProvider, selectedModel)}</div>
        </div>
        <div class="form-group">
          <label>${t('modal.agent.baseUrl')}</label>
          <input class="input" name="baseUrl" id="agent-base-url-input" value="${escapeAttr(existing?.baseUrl || selectedPreset.baseUrl)}" placeholder="${selectedProvider === 'custom' ? t('modal.agent.keyRequired') : t('modal.agent.keyOptional')}">
        </div>
        <div class="form-group">
          <label>${t('modal.agent.providerKey')}</label>
          <select class="input" name="keyId" id="agent-key-select" data-has-current-key="${existing?.hasKey ? 'true' : 'false'}" data-original-adapter="${escapeAttr(existing?.adapter || '')}">
            ${agentKeyOptions(selectedProvider, Boolean(existing?.hasKey))}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>${t('common.timeout')}</label>
            <input class="input" name="timeout" type="number" min="1" value="">
          </div>
          <div></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('common.save')}</button>
        </div>
      </form>
    </div>
  `)
}

window.saveAgent = async function(e, originalName) {
  e.preventDefault()
  const fd = new FormData(e.target)
  const preset = PROVIDER_PRESETS[String(fd.get('provider') || '')] || PROVIDER_PRESETS.custom
  const body = compactObject({
    name: String(fd.get('name') || '').trim(),
    adapter: preset.adapter,
    model: String(fd.get('model') || '').trim() || undefined,
    baseUrl: String(fd.get('baseUrl') || '').trim() || undefined,
    keyId: String(fd.get('keyId') || '').trim() || undefined,
    timeout: parseInt(fd.get('timeout')) || undefined,
  })

  try {
    state.agents = await api(originalName ? `/api/agents/${encodeURIComponent(originalName)}` : '/api/agents', originalName ? 'PUT' : 'POST', body)
    await loadApiKeys()
    closeModal()
    renderAgentsList()
    showToast(t('toast.assistantSaved'), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteAgent = async function(name) {
  if (!await confirmAction({
    title: t('confirm.deleteAgent.title'),
    message: t('confirm.deleteAgent.message', { name }),
    confirmText: t('confirm.deleteAgent.confirm'),
    danger: true,
  })) return
  try {
    state.agents = await api(`/api/agents/${encodeURIComponent(name)}`, 'DELETE')
    await loadApiKeys()
    renderAgentsList()
    showToast(t('toast.assistantDeleted'), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.showApiKeyModal = function() {
  showModal(`
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <h3>${t('modal.key.title')}</h3>
          <p>${t('modal.key.desc')}</p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.closeModal()">${t('common.close')}</button>
      </div>
      <form onsubmit="window.saveApiKey(event)">
        <div class="form-row">
          <div class="form-group">
            <label>${t('common.provider')}</label>
            <select class="input" name="provider">
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="zhipu">Zhipu</option>
            </select>
          </div>
          <div class="form-group">
            <label>${t('common.name')}</label>
            <input class="input" name="name" placeholder="${t('modal.key.namePlaceholder')}">
          </div>
        </div>
        <div class="form-group">
          <label>${t('common.apiKey')}</label>
          <input class="input" name="key" type="password" required autocomplete="new-password">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.closeModal()">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('common.save')}</button>
        </div>
      </form>
    </div>
  `)
}

window.saveApiKey = async function(e) {
  e.preventDefault()
  const fd = new FormData(e.target)
  try {
    const key = await api('/api/keys', 'POST', {
      provider: fd.get('provider'),
      name: String(fd.get('name') || '').trim() || undefined,
      key: String(fd.get('key') || '').trim(),
    })
    state.apiKeys.unshift(key)
    closeModal()
    renderApiKeysList()
    showToast(t('toast.keyAdded'), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

window.deleteApiKey = async function(id) {
  if (!await confirmAction({
    title: t('confirm.deleteKey.title'),
    message: t('confirm.deleteKey.message'),
    confirmText: t('confirm.deleteKey.confirm'),
    danger: true,
  })) return
  try {
    await api(`/api/keys/${encodeURIComponent(id)}`, 'DELETE')
    state.apiKeys = state.apiKeys.filter(key => key.id !== id)
    renderApiKeysList()
    showToast(t('toast.keyDeleted'), 'success')
  } catch (err) {
    showToast(err.message)
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function showModal(html) {
  closeModal()
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.id = 'modal-overlay'
  overlay.innerHTML = html
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeModal()
  })
  document.body.appendChild(overlay)
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay')
  if (overlay) overlay.remove()
}

window.closeModal = closeModal

function confirmAction({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    window.__resolveConfirmAction = (value) => {
      closeModal()
      resolve(Boolean(value))
      delete window.__resolveConfirmAction
    }
    showModal(`
      <div class="modal-card confirm-modal">
        <div class="modal-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(message)}</p>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="window.__resolveConfirmAction(false)">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" onclick="window.__resolveConfirmAction(true)">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `)
  })
}

function showToast(message, type = 'error') {
  const text = String(message || 'Something went wrong')
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    document.body.appendChild(container)
  }
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = text
  container.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('show'))
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.remove(), 250)
  }, 3000)
}

function buildContextFromForm(fd) {
  const rules = String(fd.get('contextRules') || '').trim()
  const text = String(fd.get('contextText') || '').trim()
  const filesRaw = String(fd.get('contextFiles') || '').trim()
  const files = filesRaw.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
  const context = {}
  if (rules) context.rules = rules
  if (text) context.text = text
  if (files.length) context.files = files
  return Object.keys(context).length ? context : undefined
}

function renderSessionCreationDetails(session) {
  const initialPrompt = sessionInitialPrompt()
  return `
    <div class="divider"></div>
    <details class="creation-details">
      <summary>${t('session.creationParams')}</summary>
      <div class="panel-kv creation-kv">
        <div class="panel-kv-row"><span class="kv-label">${t('session.agentA')}</span><span class="kv-value">${escapeHtml(agentLabel(session.from))}</span></div>
        <div class="panel-kv-row"><span class="kv-label">${t('session.agentB')}</span><span class="kv-value">${escapeHtml(agentLabel(session.to))}</span></div>
        <div class="panel-kv-row"><span class="kv-label">${t('session.mode')}</span><span class="kv-value">${escapeHtml(session.mode)}</span></div>
        <div class="panel-kv-row"><span class="kv-label">${t('session.maxTurnsLabel')}</span><span class="kv-value">${escapeHtml(session.maxRounds)}</span></div>
        <div class="panel-kv-row"><span class="kv-label">${t('session.approve')}</span><span class="kv-value">${session.approveMode ? 'on' : 'off'}</span></div>
        <div class="panel-kv-row"><span class="kv-label">${t('session.permission')}</span><span class="kv-value">${escapeHtml(session.permissionMode || 'safe')}</span></div>
        ${session.templateId ? `<div class="panel-kv-row"><span class="kv-label">${t('session.template')}</span><span class="kv-value">${escapeHtml(session.templateId)}</span></div>` : ''}
        ${session.cwd ? `<div class="panel-kv-row"><span class="kv-label">${t('session.cwd')}</span><span class="kv-value mono">${escapeHtml(session.cwd)}</span></div>` : ''}
      </div>
      ${renderPromptBlock(t('session.initialPrompt'), initialPrompt)}
      ${renderPromptBlock(t('newSession.systemPromptA'), session.systemPrompts?.from)}
      ${renderPromptBlock(t('newSession.systemPromptB'), session.systemPrompts?.to)}
      ${renderContextDetails(session.context)}
    </details>
  `
}

function renderTaskCreationDetails(task) {
  return `
    <div class="divider"></div>
    <details class="creation-details">
      <summary>${t('task_creation_params')}</summary>
      <div class="panel-kv creation-kv">
        <div class="panel-kv-row"><span class="kv-label">${t('task_agent')}</span><span class="kv-value">${escapeHtml(agentLabel(task.agent))}</span></div>
        ${task.cwd ? `<div class="panel-kv-row"><span class="kv-label">${t('task_cwd')}</span><span class="kv-value mono">${escapeHtml(task.cwd)}</span></div>` : ''}
      </div>
      ${renderPromptBlock(t('task_prompt'), task.prompt)}
      ${renderPromptBlock(t('task_system_prompt'), task.systemPrompt)}
      ${renderContextDetails(task.context)}
    </details>
  `
}

function renderPromptBlock(label, value) {
  if (!value) return ''
  return `
    <div class="creation-block">
      <div class="label mb-8">${escapeHtml(label)}</div>
      <div class="creation-copy">${renderMarkdown(String(value))}</div>
    </div>
  `
}

function sessionInitialPrompt() {
  return state.currentMessages.find(msg => msg.from === 'human' && Number(msg.round) === 0)?.content || ''
}

function renderContextDetails(context) {
  if (!context || !Object.keys(context).length) return ''
  const files = Array.isArray(context.files) ? context.files : []
  return `
    <details class="context-view" open>
      <summary>${t('task_modal_context')}</summary>
      ${context.rules ? `
        <div class="context-view-block">
          <div class="label mb-8">${t('task_context_rules')}</div>
          <div class="context-view-copy">${renderMarkdown(context.rules)}</div>
        </div>
      ` : ''}
      ${context.text ? `
        <div class="context-view-block">
          <div class="label mb-8">${t('task_context_text')}</div>
          <div class="context-view-copy">${renderMarkdown(context.text)}</div>
        </div>
      ` : ''}
      ${files.length ? `
        <div class="context-view-block">
          <div class="label mb-8">${t('task_modal_files')}</div>
          <div class="context-file-list">
            ${files.map(file => renderContextFile(file)).join('')}
          </div>
        </div>
      ` : ''}
    </details>
  `
}

function renderContextFile(file) {
  const path = typeof file === 'string' ? file : file?.path
  const content = typeof file === 'object' && file?.content ? String(file.content) : ''
  return `
    <details class="context-file-item">
      <summary class="mono">${escapeHtml(path || t('task_context_unnamed_file'))}</summary>
      ${content ? `<pre class="context-file-preview">${escapeHtml(content.slice(0, 2000))}${content.length > 2000 ? '\n...' : ''}</pre>` : ''}
    </details>
  `
}

// ── Lazy-load markdown/highlight libraries (only when a detail page needs them) ─
// A single shared promise prevents concurrent calls from injecting duplicate
// scripts or triggering duplicate rerenders. On failure we mark `failed` so
// subsequent calls fall back to plain text without retrying indefinitely.
const MD_LIBS = {
  loading: null,   // shared promise while loading
  loaded: false,   // set true on success
  failed: false,   // set true on failure — no retry
}

// Returns a Promise<boolean>: true if libs are (or became) available.
function ensureMarkdownLibs() {
  if (MD_LIBS.loaded) return Promise.resolve(true)
  if (MD_LIBS.failed) return Promise.resolve(false)
  if (MD_LIBS.loading) return MD_LIBS.loading
  MD_LIBS.loading = (async () => {
    const cssLink = document.createElement('link')
    cssLink.rel = 'stylesheet'
    cssLink.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css'
    document.head.appendChild(cssLink)
    await Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js'),
    ])
    MD_LIBS.loaded = true
    return true
  })().catch((err) => {
    console.error('[md-libs] failed to load:', err)
    MD_LIBS.loading = null
    MD_LIBS.failed = true
    return false
  })
  return MD_LIBS.loading
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(s)
  })
}

function rerenderCurrentMarkdown() {
  // Markdown libs just became available — clear the cache so cached fallback
  // HTML (plain <pre>) is replaced with properly rendered markdown.
  markdownCache.clear()
  const path = location.pathname
  if (path.startsWith('/session/') && state.currentSessionId) {
    renderSessionMessages()
  } else if (path.startsWith('/task/') && state.currentTask) {
    renderTaskContent(state.currentTask)
  } else if ((path.startsWith('/workflow/') || path.startsWith('/workflows/')) && state.currentPipeline) {
    renderWorkflowSteps(state.currentPipeline)
  }
}

// Bounded LRU cache for markdown→HTML conversion. Session messages and task
// content are re-parsed on every view refresh; caching avoids re-running marked
// + sanitize for unchanged text. Keyed by content string.
const MARKDOWN_CACHE_MAX = 300
const markdownCache = new Map()
function renderMarkdownCached(content) {
  if (content == null) content = ''
  const cached = markdownCache.get(content)
  if (cached !== undefined) {
    // Move to end (most-recently-used) for simple LRU eviction.
    markdownCache.delete(content)
    markdownCache.set(content, cached)
    return cached
  }
  const html = renderMarkdown(content)
  if (markdownCache.size >= MARKDOWN_CACHE_MAX) {
    // Evict oldest entry (first key in insertion-order Map).
    const oldest = markdownCache.keys().next().value
    markdownCache.delete(oldest)
  }
  markdownCache.set(content, html)
  return html
}

function invalidateSessionMarkdownCache() {
  markdownCache.clear()
}

function renderMarkdown(content) {
  if (typeof marked === 'undefined') {
    ensureMarkdownLibs().then((ok) => { if (ok) rerenderCurrentMarkdown() })
    return `<pre>${escapeHtml(content)}</pre>`
  }
  try {
    return `<div class="markdown-content">${sanitizeRenderedHtml(marked.parse(content), content)}</div>`
  } catch {
    return `<pre>${escapeHtml(content)}</pre>`
  }
}

function renderWorkflowMarkdown(content, cwd) {
  const html = renderMarkdown(content)
  const template = document.createElement('template')
  template.innerHTML = html
  const previewCode = file => {
    const resolved = resolveWorkflowFilePath(file)
    const resolution = state.workflowFileResolution.get(resolved) || state.workflowFileResolution.get(String(file))
    return resolution !== 'missing'
      ? `window.previewWorkflowFile(${jsString(resolved)}, ${jsString(cwd || '')}); return false`
      : ''
  }

  for (const anchor of template.content.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') || ''
    let file = ''
    try {
      const url = new URL(href, window.location.origin)
      file = decodeURIComponent(url.pathname)
    } catch {
      file = href
    }
    if (extractWorkflowArtifactFiles(file).length) {
      anchor.setAttribute('href', '#')
      anchor.removeAttribute('target')
      anchor.removeAttribute('rel')
      const handler = previewCode(file)
      if (handler) {
        anchor.setAttribute('onclick', handler)
        anchor.classList.add('workflow-inline-file')
      } else {
        anchor.removeAttribute('onclick')
        anchor.classList.add('workflow-inline-file-unavailable')
      }
    }
  }

  const references = extractWorkflowArtifactFiles(content)
    .map(file => ({ source: file, resolved: resolveWorkflowFilePath(file) }))
    .concat([...state.workflowFileAliases].map(([source, resolved]) => ({ source, resolved })))
    .sort((a, b) => b.source.length - a.source.length)
  if (!references.length) return template.innerHTML
  const referenceBySource = new Map(references.map(item => [item.source, item]))
  const referencePattern = new RegExp(references.map(item => item.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  const textNodes = []
  while (walker.nextNode()) textNodes.push(walker.currentNode)
  for (const node of textNodes) {
    if (node.parentElement?.closest('a, .workflow-inline-file')) continue
    const text = String(node.nodeValue)
    const matches = [...text.matchAll(referencePattern)]
    if (!matches.length) continue
    const fragment = document.createDocumentFragment()
    let offset = 0
    for (const match of matches) {
      if (match.index > offset) fragment.appendChild(document.createTextNode(text.slice(offset, match.index)))
      const reference = referenceBySource.get(match[0])
      const link = document.createElement('span')
      const handler = previewCode(reference?.resolved || match[0])
      link.className = handler ? 'workflow-inline-file' : 'workflow-inline-file-unavailable'
      if (handler) {
        link.setAttribute('role', 'button')
        link.setAttribute('tabindex', '0')
        link.setAttribute('onclick', handler)
      }
      link.textContent = match[0]
      fragment.appendChild(link)
      offset = match.index + match[0].length
    }
    if (offset < text.length) fragment.appendChild(document.createTextNode(text.slice(offset)))
    node.replaceWith(fragment)
  }
  return template.innerHTML
}

function sanitizeRenderedHtml(html, fallbackText) {
  const template = document.createElement('template')
  template.innerHTML = html
  const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'])
  let unsafeUrl = false

  for (const node of template.content.querySelectorAll('*')) {
    if (blockedTags.has(node.tagName)) {
      node.remove()
      continue
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name)
        continue
      }
      if ((name === 'href' || name === 'src') && !isSafeUrl(value)) {
        unsafeUrl = true
        break
      }
      if (name === 'href') {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer nofollow')
      }
    }
    if (unsafeUrl) break
  }

  return unsafeUrl ? `<pre>${escapeHtml(fallbackText)}</pre>` : template.innerHTML
}

function isSafeUrl(value) {
  if (!value) return false
  if (value.startsWith('#')) return true
  try {
    const url = new URL(value, window.location.origin)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)
  } catch {
    return false
  }
}

async function copyText(content) {
  try {
    await navigator.clipboard.writeText(content)
    return true
  } catch {
    const input = document.createElement('textarea')
    input.value = content
    input.setAttribute('readonly', '')
    input.style.position = 'absolute'
    input.style.left = '-9999px'
    document.body.appendChild(input)
    input.select()
    const ok = document.execCommand('copy')
    input.remove()
    return ok
  }
}

function buildSessionExport(session, messages) {
  const lines = [
    `# ${agentLabel(session.from)} -> ${agentLabel(session.to)}`,
    '',
    `- Session ID: ${session.id}`,
    `- Status: ${session.status}`,
    `- Mode: ${session.mode}`,
    `- Turns: ${session.currentRound}/${session.maxRounds}`,
    `- Exported At: ${new Date().toLocaleString()}`,
    '',
  ]

  let lastRound = null
  for (const msg of messages) {
    if (msg.round !== lastRound) {
      lines.push(`## Turn ${msg.round}`, '')
      lastRound = msg.round
    }
    lines.push(`### ${msg.from === 'human' ? 'you' : msg.from} · ${new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, '')
    lines.push(msg.content || '_empty_', '')
  }
  return lines.join('\n')
}

function agentLabel(agent) {
  return agent?.label || agent?.adapter || ''
}

function agentHasFilesystem(name) {
  const agent = state.agents.find(item => item.name === name || item.adapter === name)
  return agent ? agent.kind === 'local' : false
}

function taskAgentAccepted(agent) {
  return agent.status !== 'invalid' && agent.status !== 'no_key'
}

function agentPriority(agent) {
  return Number.isInteger(agent?.priority) ? agent.priority : 1000
}

function sortAgentsByPriority(agents) {
  return [...agents].sort((a, b) => agentPriority(a) - agentPriority(b) || (String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0))
}

function agentCapabilityLabel(agent) {
  return agent.kind === 'local' ? 'Filesystem' : 'No filesystem'
}

function agentOptionHtml(agents, selected = '', opts = {}) {
  return sortAgentsByPriority(agents).map(agent => `
    <option value="${escapeAttr(agent.name)}" ${agent.name === selected ? 'selected' : ''}>
      ${escapeHtml(agent.name)} · ${escapeHtml(agent.model || agent.adapter)}${opts.includeStatus ? ` · ${escapeHtml(statusLabel(agent.status))}` : ''} · ${agentCapabilityLabel(agent)}
    </option>
  `).join('')
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== ''))
}

function envToLines(env) {
  return Object.entries(env || {}).map(([key, value]) => `${key}=${value}`).join('\n')
}

function parseEnvLines(value) {
  const env = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return Object.keys(env).length ? env : undefined
}

function providerPresetOptions(selected) {
  return Object.entries(PROVIDER_PRESETS)
    .map(([value, preset]) => `<option value="${escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(preset.label)}</option>`)
    .join('')
}

function modelControl(provider, selected) {
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom
  if (provider === 'custom') {
    return `<input class="input" name="model" value="${escapeAttr(selected || '')}" placeholder="Enter model name">`
  }
  const selectedValue = preset.models.some(option => option.value === selected)
    ? selected
    : defaultModelForProvider(provider)
  return `
    <select class="input" name="model">
      ${preset.models.map(option => `<option value="${escapeAttr(option.value)}" ${option.value === selectedValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
    </select>
  `
}

function defaultModelForProvider(provider) {
  return (PROVIDER_PRESETS[provider]?.models || [])[0]?.value || ''
}

function providerPresetForAgent(agent) {
  if (!agent) return 'anthropic'
  if (agent.baseUrl?.includes('api.deepseek.com')) return 'deepseek'
  if (agent.baseUrl?.includes('dashscope.aliyuncs.com')) return 'qwen'
  if (agent.baseUrl?.includes('api.moonshot.cn')) return 'moonshot'
  if (agent.adapter === 'anthropic-api') return 'anthropic'
  if (agent.adapter === 'openai-api') return 'openai'
  if (agent.adapter === 'zhipu-api') return 'zhipu'
  if (agent.adapter === 'deepseek-api') return 'deepseek'
  if (agent.adapter === 'qwen-api') return 'qwen'
  if (agent.adapter === 'moonshot-api') return 'moonshot'
  return 'custom'
}

function agentKeyOptions(provider, hasCurrentKey) {
  const defaultOption = hasCurrentKey
    ? '<option value="">Keep current key</option>'
    : '<option value="">Select a saved Provider Key</option>'
  return defaultOption + providerKeyOptionsForProvider(provider)
}

function providerKeyOptionsForProvider(provider) {
  return state.apiKeys
    .filter(key => !key.readOnly && providerMatchesPreset(key.provider, provider))
    .map(key => `<option value="${escapeAttr(key.id)}">${escapeHtml(key.name)} · ${escapeHtml(providerLabel(key.provider))} · ${escapeHtml(key.maskedKey)}</option>`)
    .join('')
}

window.updateAgentProviderOptions = function() {
  const providerSelect = document.getElementById('agent-provider-select')
  const modelControlContainer = document.getElementById('agent-model-control')
  const baseUrlInput = document.getElementById('agent-base-url-input')
  const keySelect = document.getElementById('agent-key-select')
  const provider = providerSelect?.value || 'anthropic'
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom
  if (modelControlContainer) modelControlContainer.innerHTML = modelControl(provider, defaultModelForProvider(provider))
  if (baseUrlInput) {
    baseUrlInput.value = preset.baseUrl
    baseUrlInput.placeholder = provider === 'custom' ? 'Required' : 'Optional override'
  }
  if (keySelect) {
    const canKeepCurrentKey = keySelect.dataset.hasCurrentKey === 'true' && preset.adapter === keySelect.dataset.originalAdapter
    keySelect.innerHTML = agentKeyOptions(provider, canKeepCurrentKey)
  }
}

function providerMatchesPreset(keyProvider, provider) {
  if (provider === 'custom') return keyProvider === 'openai'
  return keyProvider === provider
}

function keySourceLabel(source) {
  return ({ vault: t('keySource.vault'), assistant: t('keySource.assistant'), global: t('keySource.global') })[source] || source
}

function preferredAgentName(agents, preferredAdapter, avoidName) {
  if (!agents.length) return ''
  const preferred = preferredAdapter ? agents.find(agent => agent.adapter === preferredAdapter && agent.name !== avoidName) : null
  if (preferred) return preferred.name
  const firstDifferent = agents.find(agent => agent.name !== avoidName)
  return (firstDifferent || agents[0]).name
}

function taskBadgeClass(status) {
  if (status === 'running') return 'badge-running'
  if (status === 'queued') return 'badge-queued'
  return `badge-${status}`
}

function taskStatusLabel(status) {
  return t(`task_status_${status}`) || status
}

function providerIcon(provider) {
  return ({ anthropic: 'A', openai: 'O', deepseek: 'D', zhipu: 'Z' })[provider] || '?'
}

function providerLabel(provider) {
  return ({ anthropic: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek', zhipu: 'Zhipu' })[provider] || provider
}

function initialsFromEmail(email) {
  const name = String(email).split('@')[0] || 'U'
  return name.split(/[._-]/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U'
}

function jsString(value) {
  return JSON.stringify(String(value))
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;')
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str == null ? '' : String(str)
  return div.innerHTML
}

function formatTime(timestamp) {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return t('time.justNow')
  if (minutes < 60) return t('time.minAgo', { n: minutes })
  if (hours < 24) return t('time.hrAgo', { n: hours })
  if (days <= 1) return t('time.dayAgo', { n: days })
  return t('time.daysAgo', { n: days })
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s.toString().padStart(2, '0')}s`
  return `${s}s`
}

function syncTaskRunningTimer() {
  const hasRunning = state.tasks.some(task => task.status === 'running' && task.startedAt)
  if (hasRunning && location.pathname === '/tasks') {
    if (!state.taskRunningTimer) {
      state.taskRunningTimer = setInterval(() => {
        if (location.pathname !== '/tasks') { stopTaskRunningTimer(); return }
        document.querySelectorAll('[data-task-start]').forEach(el => {
          const start = Number(el.dataset.taskStart)
          if (start) el.textContent = t('task_running_elapsed', { duration: formatDuration(Date.now() - start) })
        })
      }, 1000)
    }
  } else {
    stopTaskRunningTimer()
  }
}

function stopTaskRunningTimer() {
  if (state.taskRunningTimer) {
    clearInterval(state.taskRunningTimer)
    state.taskRunningTimer = null
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.toggleTheme = toggleTheme
window.navigate = navigate
window.toggleUserMenu = function() {
  document.getElementById('user-menu-popover')?.classList.toggle('open')
}
window.logout = function() {
  clearAuthToken()
  navigate('/login')
}

document.addEventListener('click', event => {
  if (!event.target.closest?.('.user-menu')) {
    document.getElementById('user-menu-popover')?.classList.remove('open')
  }
})

document.addEventListener('DOMContentLoaded', () => {
  initTheme()
  document.documentElement.lang = getCurrentLang()
  render()
  initOpsWidget()
  new MutationObserver(() => initOpsWidget()).observe(document.body, { childList: true })
  window.addEventListener('resize', () => {
    applyOpsPosition(state.opsPosition, true)
  })

  if (getAuthToken()) {
    connectWs()
    loadOpsModel().then(updateOpsPanel).catch(() => {})
  }
})

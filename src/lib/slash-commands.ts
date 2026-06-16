'use client';
import { useMemo } from 'react';
import { useT } from './i18n';
export {
  TELEGRAM_MENU_PRIORITY,
  REASONING_COMMAND_VALUES,
  REASONING_META_VALUES,
  applyPromptTemplate,
  extractSlashQuery,
  filterCommands,
  parseSlashSubmit,
  findSlashCommand,
  resolveSlashSubmit,
  priorityOfSlashCommand,
} from './slash-core';
export type {
  SlashCommand,
  SlashControl,
  SlashLocalAction,
  SlashUnsupportedMode,
  ParsedSlashCommand,
  SlashSubmitResolution,
} from './slash-core';
import type { SlashCommand } from './slash-core';
import { priorityOfSlashCommand } from './slash-core';

export function useLocalizedSlashCommands(): SlashCommand[] {
  const t = useT({
    zh: {
      catLocal: 'HermesDeck 本地', catControl: 'Composer 控制', catTelegram: 'Telegram / Gateway', catSnippet: 'Prompt snippet',
      localDesc: '本地执行，不发送给 LLM', controlDesc: '更新输入框下方的本轮设置，不发送给 LLM', unsupportedDesc: 'HermesDeck 暂未支持；请在 Telegram 使用',
      newLabel: '新建对话', newDesc: '开启全新本地会话',
      clearLabel: '清空消息', clearDesc: '清除当前会话消息（保留会话）',
      regenLabel: '重新生成', regenDesc: '重新回答上一条用户消息',
      stopLabel: '停止生成', stopDesc: '中止正在流式输出的响应',
      modelLabel: '选择模型', modelDesc: '用 /model <model-id> 设置本轮模型；无参数时打开模型选择器',
      reasoningLabel: '推理强度', reasoningDesc: '用 /reasoning high 等设置 reasoning effort；reset 恢复默认',
      helpLabel: '帮助', helpDesc: 'Telegram 帮助命令；Deck 暂未实现',
      statusLabel: '状态', resumeLabel: '恢复', sessionsLabel: '会话', debugLabel: '调试', restartLabel: '重启', updateLabel: '更新', commandsLabel: '命令列表', approveLabel: '批准', denyLabel: '拒绝', queueLabel: '队列', steerLabel: '引导', backgroundLabel: '后台任务', usageLabel: '用量', platformLabel: '平台', profileLabel: 'Profile', whoamiLabel: '当前身份', startLabel: '开始', topicLabel: '主题', undoLabel: '撤销', titleLabel: '标题', branchLabel: '分支', compressLabel: '压缩', rollbackLabel: '回滚', agentsLabel: 'Agents',
      summarizeLabel: '总结', summarizeDesc: 'Prompt snippet：总结上方对话或附件', summarizeTpl: '请总结上方内容,列出要点和结论。{cursor}',
      transEnLabel: '翻译为英文', transEnDesc: 'Prompt snippet：将下方文本翻译为英文', transEnTpl: '请将下面的文本翻译为自然、地道的英文:\n\n{cursor}',
      transZhLabel: '翻译为中文', transZhDesc: 'Prompt snippet：将下方文本翻译为中文', transZhTpl: '请将下面的内容翻译成自然、地道的中文：\n\n{cursor}',
      explainLabel: '解释代码', explainDesc: 'Prompt snippet：解释下方代码的工作方式', explainTpl: '请解释下方代码的工作方式,包括关键逻辑、可能的副作用以及性能特征:\n\n```\n{cursor}\n```',
      fixLabel: '修复 Bug', fixDesc: 'Prompt snippet：识别并修复代码中的 Bug', fixTpl: '下面的代码可能存在 Bug。请帮我找出问题并提供修复后的版本:\n\n```\n{cursor}\n```',
      testLabel: '编写测试', testDesc: 'Prompt snippet：为代码生成单元测试', testTpl: '请为下方代码编写单元测试,覆盖边界情况:\n\n```\n{cursor}\n```',
      deckLabel: 'HermesDeck 介绍', deckDesc: 'Prompt snippet：说明 HermesDeck 当前能力', deckTpl: '请介绍一下 HermesDeck 现在能做些什么。{cursor}',
      readmeLabel: 'README 草稿', readmeDesc: 'Prompt snippet：为本次会话起草 README 描述', readmeTpl: '请为本次会话起草一段 README 描述。{cursor}',
    },
    en: {
      catLocal: 'HermesDeck local', catControl: 'Composer control', catTelegram: 'Telegram / Gateway', catSnippet: 'Prompt snippet',
      localDesc: 'Runs locally; not sent to the LLM', controlDesc: 'Updates this turn’s composer setting; not sent to the LLM', unsupportedDesc: 'Not supported in HermesDeck yet; use Telegram',
      newLabel: 'New chat', newDesc: 'Open a fresh local conversation',
      clearLabel: 'Clear thread', clearDesc: 'Clear current messages (keep session)',
      regenLabel: 'Regenerate', regenDesc: 'Re-answer the last user message',
      stopLabel: 'Stop', stopDesc: 'Abort the in-flight stream',
      modelLabel: 'Select model', modelDesc: 'Use /model <model-id> to set the turn model; no args opens the picker',
      reasoningLabel: 'Reasoning effort', reasoningDesc: 'Use /reasoning high etc. to set effort; reset restores default',
      helpLabel: 'Help', helpDesc: 'Telegram help command; not implemented in Deck yet',
      statusLabel: 'Status', resumeLabel: 'Resume', sessionsLabel: 'Sessions', debugLabel: 'Debug', restartLabel: 'Restart', updateLabel: 'Update', commandsLabel: 'Command list', approveLabel: 'Approve', denyLabel: 'Deny', queueLabel: 'Queue', steerLabel: 'Steer', backgroundLabel: 'Background', usageLabel: 'Usage', platformLabel: 'Platform', profileLabel: 'Profile', whoamiLabel: 'Who am I', startLabel: 'Start', topicLabel: 'Topic', undoLabel: 'Undo', titleLabel: 'Title', branchLabel: 'Branch', compressLabel: 'Compress', rollbackLabel: 'Rollback', agentsLabel: 'Agents',
      summarizeLabel: 'Summarize', summarizeDesc: 'Prompt snippet: summarize conversation or attachments', summarizeTpl: 'Please summarize the content above, listing the key points and conclusions. {cursor}',
      transEnLabel: 'Translate to English', transEnDesc: 'Prompt snippet: translate the following text into English', transEnTpl: 'Please translate the following text into natural, idiomatic English:\n\n{cursor}',
      transZhLabel: 'Translate to Chinese', transZhDesc: 'Prompt snippet: translate the following text into Chinese', transZhTpl: '请将下面的内容翻译成自然、地道的中文：\n\n{cursor}',
      explainLabel: 'Explain code', explainDesc: 'Prompt snippet: explain how the code below works', explainTpl: 'Please explain how the code below works, including key logic, possible side effects, and performance characteristics:\n\n```\n{cursor}\n```',
      fixLabel: 'Fix bug', fixDesc: 'Prompt snippet: identify and fix bugs in code', fixTpl: 'The code below may contain a bug. Please help me find the issue and provide a fixed version:\n\n```\n{cursor}\n```',
      testLabel: 'Write tests', testDesc: 'Prompt snippet: generate unit tests', testTpl: 'Please write unit tests for the code below, covering edge cases:\n\n```\n{cursor}\n```',
      deckLabel: 'HermesDeck overview', deckDesc: 'Prompt snippet: summarize HermesDeck capabilities', deckTpl: 'Please summarize what HermesDeck can do right now. {cursor}',
      readmeLabel: 'README draft', readmeDesc: 'Prompt snippet: draft a README description', readmeTpl: 'Please draft a README description for this session. {cursor}',
    },
  });

  return useMemo<SlashCommand[]>(() => {
    const unsupported = (key: string, label: string, argHint?: string): SlashCommand => ({
      kind: 'unsupported', key, label, argHint, category: t.catTelegram,
      description: key === 'help' ? t.helpDesc : `${t.unsupportedDesc}: /${key}`,
      unsupportedMode: 'telegram',
    });
    const commands: SlashCommand[] = [
      { kind: 'unsupported', key: 'help', label: t.helpLabel, description: t.helpDesc, category: t.catTelegram, unsupportedMode: 'telegram' },
      { kind: 'local', key: 'new', label: t.newLabel, description: `${t.newDesc} · ${t.localDesc}`, category: t.catLocal, action: 'new' },
      { kind: 'local', key: 'stop', label: t.stopLabel, description: `${t.stopDesc} · ${t.localDesc}`, category: t.catLocal, action: 'stop' },
      unsupported('status', t.statusLabel), unsupported('resume', t.resumeLabel, '[session]'), unsupported('sessions', t.sessionsLabel),
      { kind: 'control', key: 'model', label: t.modelLabel, description: `${t.modelDesc} · ${t.controlDesc}`, category: t.catControl, control: 'model', argHint: '<model-id>' },
      unsupported('debug', t.debugLabel), unsupported('restart', t.restartLabel), unsupported('update', t.updateLabel), unsupported('commands', t.commandsLabel), unsupported('approve', t.approveLabel, '<id>'), unsupported('deny', t.denyLabel, '<id>'), unsupported('queue', t.queueLabel), unsupported('steer', t.steerLabel, '<text>'), unsupported('background', t.backgroundLabel),
      { kind: 'control', key: 'reasoning', label: t.reasoningLabel, description: `${t.reasoningDesc} · ${t.controlDesc}`, category: t.catControl, control: 'reasoning', argHint: '<none|minimal|low|medium|high|xhigh|reset>' },
      unsupported('usage', t.usageLabel), unsupported('platform', t.platformLabel), unsupported('profile', t.profileLabel, '[name]'), unsupported('whoami', t.whoamiLabel), unsupported('start', t.startLabel), unsupported('topic', t.topicLabel, '<topic>'),
      { kind: 'local', key: 'retry', aliases: ['regen'], label: t.regenLabel, description: `${t.regenDesc} · ${t.localDesc}`, category: t.catLocal, action: 'regen' },
      unsupported('undo', t.undoLabel), unsupported('title', t.titleLabel, '<title>'), unsupported('branch', t.branchLabel), unsupported('compress', t.compressLabel), unsupported('rollback', t.rollbackLabel), unsupported('agents', t.agentsLabel),
      { kind: 'local', key: 'clear', label: t.clearLabel, description: `${t.clearDesc} · ${t.localDesc}`, category: t.catLocal, action: 'clear' },
      { kind: 'local', key: 'regen', aliases: ['retry'], label: t.regenLabel, description: `${t.regenDesc} · ${t.localDesc}`, category: t.catLocal, action: 'regen' },
      { kind: 'snippet', key: 'summarize', label: t.summarizeLabel, description: t.summarizeDesc, category: t.catSnippet, template: t.summarizeTpl },
      { kind: 'snippet', key: 'translate-en', aliases: ['tr-en'], label: t.transEnLabel, description: t.transEnDesc, category: t.catSnippet, template: t.transEnTpl },
      { kind: 'snippet', key: 'translate-zh', aliases: ['tr-zh'], label: t.transZhLabel, description: t.transZhDesc, category: t.catSnippet, template: t.transZhTpl },
      { kind: 'snippet', key: 'explain', label: t.explainLabel, description: t.explainDesc, category: t.catSnippet, template: t.explainTpl },
      { kind: 'snippet', key: 'fix', label: t.fixLabel, description: t.fixDesc, category: t.catSnippet, template: t.fixTpl },
      { kind: 'snippet', key: 'test', label: t.testLabel, description: t.testDesc, category: t.catSnippet, template: t.testTpl },
      { kind: 'snippet', key: 'deck', label: t.deckLabel, description: t.deckDesc, category: t.catSnippet, template: t.deckTpl },
      { kind: 'snippet', key: 'readme', label: t.readmeLabel, description: t.readmeDesc, category: t.catSnippet, template: t.readmeTpl },
    ];
    return commands.sort((a, b) => priorityOfSlashCommand(a.key) - priorityOfSlashCommand(b.key));
  }, [t]);
}


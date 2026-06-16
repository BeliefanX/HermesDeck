/**
 * Slash command catalog. Triggered when the user types `/` at the start of
 * the composer (or after a newline). Two flavors:
 *
 * - `prompt` — inserts a template into the input, replacing the slash token.
 *   The user can keep typing context, attachments, etc. before sending.
 * - `action` — fires a control-plane action (new chat, regenerate, stop,
 *   clear current). The slash token is removed; nothing is inserted.
 */
import { useMemo } from 'react';
import { useT } from './i18n';

export type SlashAction = 'new' | 'clear' | 'regen' | 'stop';

export type SlashCommand =
  | {
      kind: 'prompt';
      key: string;
      label: string;
      description: string;
      template: string;
      /**
       * Marker inserted into the template that the caret should land on after
       * insertion. Strip from the visible text. Default: '{cursor}'.
       */
      cursorMarker?: string;
    }
  | {
      kind: 'action';
      key: string;
      label: string;
      description: string;
      action: SlashAction;
    };

/**
 * React hook that returns the slash-command catalog localized to the current
 * language. Components use this directly; there is no static catalog because
 * every label/description text is translatable.
 */
export function useLocalizedCommands(): SlashCommand[] {
  const t = useT({
    zh: {
      // action labels + descriptions
      newLabel: '新建对话',     newDesc: '开启全新本地会话',
      clearLabel: '清空消息',   clearDesc: '清除消息（保留会话）',
      regenLabel: '重新生成',   regenDesc: '重新回答上一条用户消息',
      stopLabel: '停止',         stopDesc: '中止正在流式输出的响应',
      // prompts
      summarizeLabel: '总结',
      summarizeDesc: '总结上方对话或附件',
      summarizeTpl: '请总结上方内容,列出要点和结论。{cursor}',

      transEnLabel: '翻译为英文',
      transEnDesc: '将下方文本翻译为英文',
      transEnTpl: '请将下面的文本翻译为自然、地道的英文:\n\n{cursor}',

      transZhLabel: '翻译为中文',
      transZhDesc: '将下方文本翻译为中文',
      transZhTpl: '请将下面的内容翻译成自然、地道的中文：\n\n{cursor}',

      explainLabel: '解释代码',
      explainDesc: '解释下方代码的工作方式',
      explainTpl: '请解释下方代码的工作方式,包括关键逻辑、可能的副作用以及性能特征:\n\n```\n{cursor}\n```',

      fixLabel: '修复 Bug',
      fixDesc: '识别并修复代码中的 Bug',
      fixTpl: '下面的代码可能存在 Bug。请帮我找出问题并提供修复后的版本:\n\n```\n{cursor}\n```',

      testLabel: '编写测试',
      testDesc: '为代码生成单元测试',
      testTpl: '请为下方代码编写单元测试,覆盖边界情况:\n\n```\n{cursor}\n```',

      refactorLabel: '重构代码',
      refactorDesc: '提升可读性与结构',
      refactorTpl: '请在保持行为不变的前提下,重构下方代码以提升可读性、命名和结构:\n\n```\n{cursor}\n```',

      docstringLabel: '添加注释',
      docstringDesc: '为代码添加注释或文档字符串',
      docstringTpl: '请为下方代码添加恰当的注释或文档字符串,仅在能真正提升清晰度的地方添加:\n\n```\n{cursor}\n```',

      improveLabel: '润色文本',
      improveDesc: '让下方文本更通顺',
      improveTpl: '请润色下方文本,使其在保持原意的同时读起来更清晰、自然:\n\n{cursor}',

      brainstormLabel: '头脑风暴',
      brainstormDesc: '围绕主题发散思路',
      brainstormTpl: '请围绕下方主题进行头脑风暴 —— 给出 5 至 8 个角度,每个附简短说明:\n\n{cursor}',

      planLabel: '拆解步骤',
      planDesc: '把目标拆为可执行步骤',
      planTpl: '请将下方目标拆解为清晰、可执行的分步计划:\n\n{cursor}',

      modelLabel: '模型选择',
      modelDesc: '说明如何选择本轮对话模型',
      modelTpl: '请说明当前对话的模型选择方式，以及如何根据任务选择合适模型。{cursor}',

      reasoningLabel: '推理强度',
      reasoningDesc: '说明如何选择本轮 reasoning effort',
      reasoningTpl: '请说明当前对话的推理强度（reasoning effort）选择方式，以及 low / medium / high 适合哪些任务。{cursor}',

      deckLabel: 'HermesDeck 介绍',
      deckDesc: '说明 HermesDeck 当前能力',
      deckTpl: '请介绍一下 HermesDeck 现在能做些什么。{cursor}',

      profileLabel: 'Profile 模型与工具集',
      profileDesc: '列出当前 Profile 的模型与工具集',
      profileTpl: '请列出当前 Profile 的模型与工具集。{cursor}',

      readmeLabel: 'README 草稿',
      readmeDesc: '为本次会话起草 README 描述',
      readmeTpl: '请为本次会话起草一段 README 描述。{cursor}',
    },
    en: {
      newLabel: 'New chat',     newDesc: 'Open a fresh local conversation',
      clearLabel: 'Clear thread', clearDesc: 'Clear messages (keep the session)',
      regenLabel: 'Regenerate', regenDesc: 'Re-answer the last user message',
      stopLabel: 'Stop',         stopDesc: 'Abort the in-flight streaming response',

      summarizeLabel: 'Summarize',
      summarizeDesc: 'Summarize the conversation or attachments above',
      summarizeTpl: 'Please summarize the content above, listing the key points and conclusions. {cursor}',

      transEnLabel: 'Translate to English',
      transEnDesc: 'Translate the following text into English',
      transEnTpl: 'Please translate the following text into natural, idiomatic English:\n\n{cursor}',

      transZhLabel: 'Translate to Chinese',
      transZhDesc: 'Translate the following text into Chinese',
      transZhTpl: '请将下面的内容翻译成自然、地道的中文：\n\n{cursor}',

      explainLabel: 'Explain code',
      explainDesc: 'Explain how the code below works',
      explainTpl: 'Please explain how the code below works, including key logic, possible side effects, and performance characteristics:\n\n```\n{cursor}\n```',

      fixLabel: 'Fix bug',
      fixDesc: 'Identify and fix bugs in the code',
      fixTpl: 'The code below may contain a bug. Please help me find the issue and provide a fixed version:\n\n```\n{cursor}\n```',

      testLabel: 'Write tests',
      testDesc: 'Generate unit tests for the code',
      testTpl: 'Please write unit tests for the code below, covering edge cases:\n\n```\n{cursor}\n```',

      refactorLabel: 'Refactor code',
      refactorDesc: 'Improve readability and structure',
      refactorTpl: 'Please refactor the code below to improve readability, naming, and structure while preserving behavior:\n\n```\n{cursor}\n```',

      docstringLabel: 'Add comments',
      docstringDesc: 'Add comments or docstrings',
      docstringTpl: 'Please add appropriate comments or docstrings to the code below, only where they add real clarity:\n\n```\n{cursor}\n```',

      improveLabel: 'Improve writing',
      improveDesc: 'Polish the text below',
      improveTpl: 'Please polish the text below so it reads more clearly and naturally, while keeping the original meaning:\n\n{cursor}',

      brainstormLabel: 'Brainstorm',
      brainstormDesc: 'Explore ideas around a topic',
      brainstormTpl: 'Please brainstorm around the topic below — give 5–8 angles, each with a short explanation:\n\n{cursor}',

      planLabel: 'Plan steps',
      planDesc: 'Break a goal into actionable steps',
      planTpl: 'Please break the goal below into a clear, actionable step-by-step plan:\n\n{cursor}',

      modelLabel: 'Model selection',
      modelDesc: 'Explain how to choose the model for this turn',
      modelTpl: 'Please explain how model selection works for this chat, and how to choose an appropriate model for a task. {cursor}',

      reasoningLabel: 'Reasoning effort',
      reasoningDesc: 'Explain how to choose reasoning effort for this turn',
      reasoningTpl: 'Please explain how reasoning effort works for this chat, and which tasks fit low / medium / high. {cursor}',

      deckLabel: 'HermesDeck overview',
      deckDesc: 'Summarize what HermesDeck can do right now',
      deckTpl: 'Please summarize what HermesDeck can do right now. {cursor}',

      profileLabel: 'Profile models & toolsets',
      profileDesc: 'List the active profile’s model and toolsets',
      profileTpl: 'Please list the active profile’s model and toolsets. {cursor}',

      readmeLabel: 'README draft',
      readmeDesc: 'Draft a README description for this session',
      readmeTpl: 'Please draft a README description for this session. {cursor}',
    },
  });

  return useMemo<SlashCommand[]>(() => [
    { kind: 'action', key: 'new',   label: t.newLabel,   description: t.newDesc,   action: 'new' },
    { kind: 'action', key: 'clear', label: t.clearLabel, description: t.clearDesc, action: 'clear' },
    { kind: 'action', key: 'regen', label: t.regenLabel, description: t.regenDesc, action: 'regen' },
    { kind: 'action', key: 'stop',  label: t.stopLabel,  description: t.stopDesc,  action: 'stop' },

    { kind: 'prompt', key: 'summarize',    label: t.summarizeLabel, description: t.summarizeDesc, template: t.summarizeTpl },
    { kind: 'prompt', key: 'translate-en', label: t.transEnLabel,   description: t.transEnDesc,   template: t.transEnTpl },
    { kind: 'prompt', key: 'translate-zh', label: t.transZhLabel,   description: t.transZhDesc,   template: t.transZhTpl },
    { kind: 'prompt', key: 'explain',      label: t.explainLabel,   description: t.explainDesc,   template: t.explainTpl },
    { kind: 'prompt', key: 'fix',          label: t.fixLabel,       description: t.fixDesc,       template: t.fixTpl },
    { kind: 'prompt', key: 'test',         label: t.testLabel,      description: t.testDesc,      template: t.testTpl },
    { kind: 'prompt', key: 'refactor',     label: t.refactorLabel,  description: t.refactorDesc,  template: t.refactorTpl },
    { kind: 'prompt', key: 'docstring',    label: t.docstringLabel, description: t.docstringDesc, template: t.docstringTpl },
    { kind: 'prompt', key: 'improve',      label: t.improveLabel,   description: t.improveDesc,   template: t.improveTpl },
    { kind: 'prompt', key: 'brainstorm',   label: t.brainstormLabel,description: t.brainstormDesc,template: t.brainstormTpl },
    { kind: 'prompt', key: 'plan',         label: t.planLabel,      description: t.planDesc,      template: t.planTpl },
    // Composer controls are pickers today, not slash-dispatched actions. Keep
    // them discoverable without pretending the template can change model state.
    { kind: 'prompt', key: 'model',        label: t.modelLabel,     description: t.modelDesc,     template: t.modelTpl },
    { kind: 'prompt', key: 'reasoning',    label: t.reasoningLabel, description: t.reasoningDesc, template: t.reasoningTpl },
    // Keep the empty-state quick-start prompts discoverable from the slash menu too.
    { kind: 'prompt', key: 'deck',         label: t.deckLabel,      description: t.deckDesc,      template: t.deckTpl },
    { kind: 'prompt', key: 'profile',      label: t.profileLabel,   description: t.profileDesc,   template: t.profileTpl },
    { kind: 'prompt', key: 'readme',       label: t.readmeLabel,    description: t.readmeDesc,    template: t.readmeTpl },
  ], [t]);
}

/** Strip the leading `/foo` token from the input. */
export function extractSlashQuery(text: string, caret: number): null | { start: number; end: number; query: string } {
  // Only trigger when the slash is at the start, or right after a newline.
  // The token runs from `/` to the next whitespace/newline.
  if (caret <= 0) return null;
  // Find the start of the current line.
  let lineStart = caret;
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart -= 1;
  // The line must begin with '/'.
  if (text[lineStart] !== '/') return null;
  // The token ends at the next whitespace OR at the caret OR end of string.
  let end = caret;
  // Token only counts up to the first whitespace within the line.
  for (let i = lineStart + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      end = i;
      break;
    }
    end = i + 1;
  }
  // If the caret is past the token (e.g. after a space), don't trigger.
  if (caret > end) return null;
  const query = text.slice(lineStart + 1, end);
  return { start: lineStart, end, query };
}

/** Filter commands whose key/label matches the prefix query (case-insensitive). */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  // Two passes: (1) prefix matches on key, (2) substring matches on label.
  const prefix = commands.filter((c) => c.key.toLowerCase().startsWith(q));
  const substr = commands.filter((c) => !prefix.includes(c) && (
    c.key.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
  ));
  return [...prefix, ...substr];
}

/**
 * Replace the slash token at [start, end) with the resolved template, and
 * return the new text plus the caret position the editor should jump to.
 *
 * If the template contains the cursor marker, the caret lands there and the
 * marker is stripped. Otherwise the caret lands at the end of the inserted
 * text.
 */
export function applyPromptTemplate(
  text: string,
  start: number,
  end: number,
  template: string,
  cursorMarker = '{cursor}',
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const idx = template.indexOf(cursorMarker);
  if (idx === -1) {
    const next = before + template + after;
    return { text: next, caret: (before + template).length };
  }
  const head = template.slice(0, idx);
  const tail = template.slice(idx + cursorMarker.length);
  const next = before + head + tail + after;
  return { text: next, caret: (before + head).length };
}

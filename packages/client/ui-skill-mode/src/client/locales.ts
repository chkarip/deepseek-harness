/**
 * `skill-mode` namespace dictionaries.
 *
 * The command description is registry-held text; it reads t() once at
 * registration and refreshes only on re-registration, not on locale change.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '进入或退出粘性技能模式',
  'option.loadError': '技能模式列表加载失败：{message}',
  'empty.modes': '当前会话没有可用的模式技能。',
  'search.placeholder': '筛选模式技能…',
  'search.aria': '筛选模式技能',
  'overlay.aria': '选择模式技能',
} satisfies Record<string, string>

/** English dictionary. */
export const en = {
  'command.description': 'Enter or leave a sticky skill mode',
  'option.loadError': 'Failed to load mode skills: {message}',
  'empty.modes': 'No mode skills are available in this session.',
  'search.placeholder': 'Filter mode skills…',
  'search.aria': 'Filter mode skills',
  'overlay.aria': 'Select a mode skill',
} satisfies Record<SkillModeKey, string>

/** The `skill-mode` namespace key set (derived from the zh source). */
export type SkillModeKey = keyof typeof zh

/** Locale namespace id for this plugin's dictionaries. */
export const NS = 'skill-mode'

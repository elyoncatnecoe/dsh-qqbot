/** 语音预设表 —— 指令、工具、人格套装共用同一份定义 */
export const VOICE_PRESETS = {
    stella: { voiceId: 'stella', semitones: 0, label: '海星（女声原声）' },
    shota: { voiceId: 'stella', semitones: 0.5, label: '正太' },
    loli: { voiceId: 'stella', semitones: 2, label: '萝莉' },
    neutral: { voiceId: 'stella', semitones: -3, label: '中性' },
    tide: { voiceId: 'tide', semitones: 0, label: '暗潮（男声原声）' },
    boy: { voiceId: 'tide', semitones: 3, label: '少年' },
    uncle: { voiceId: 'tide', semitones: -2, label: '大叔' },
};
/** 预设 id 列表（用于提示与校验） */
export const VOICE_PRESET_IDS = Object.keys(VOICE_PRESETS);
/** 小写归一后取预设；未知返回 undefined */
export function getVoicePreset(id) {
    if (typeof id !== 'string' || id === '')
        return undefined;
    return VOICE_PRESETS[id.trim().toLowerCase()];
}
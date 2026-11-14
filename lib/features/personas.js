/**
 * 人格套装 —— 一个套装同时决定：音色预设、形象图、人格 prompt。
 *
 * 内置两套；prompt 从包内 prompts/ 目录读取，{{name}} 占位符由配置里的名字替换
 * （默认 Deepseek，用户可改）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PERSONAS = {
    female: {
        id: 'female',
        label: '少女',
        voicePreset: 'loli',
        avatar: 'fine.png',
        promptFile: 'persona-female.md',
    },
    male: {
        id: 'male',
        label: '少年',
        voicePreset: 'tide',
        avatar: 'thinking.png',
        promptFile: 'persona-male.md',
    },
};
export const PERSONA_IDS = Object.keys(PERSONAS);
export function getPersona(id) {
    if (typeof id !== 'string' || id === '')
        return undefined;
    return PERSONAS[id.trim().toLowerCase()];
}
/** 包内表情目录（内置表情包套组；用户可用 sticker.dir 覆盖） */
export function bundledStickerDir() {
    return join(PKG_ROOT, 'assets', 'stickers');
}
/** 人格形象图的绝对路径 */
export function personaAvatarPath(persona) {
    return join(bundledStickerDir(), persona.avatar);
}
/** 读取人格 prompt，替换 {{name}} */
export function loadPersonaPrompt(persona, name) {
    const file = join(PKG_ROOT, 'prompts', persona.promptFile);
    try {
        const text = readFileSync(file, 'utf8');
        return text.replace(/\{\{name\}\}/g, name || 'Deepseek');
    }
    catch {
        return '';
    }
}
/** 人格展示用一行摘要（指令里列清单） */
export function personaSummary(persona) {
    return `${persona.label}（${persona.id}）· 音色 ${persona.voicePreset} · 形象 ${persona.avatar}`;
}
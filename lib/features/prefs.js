/**
 * 偏好存储 —— 每个会话（群/私聊）独立的音色与人格选择。
 *
 * 为什么不用宿主配置：音色/人格要能「群里换了不影响私聊」，属于对话内状态，
 * 而 cordis 配置是全局的。这里落盘到 PLUGIN_HOME/prefs.json，原子写。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PLUGIN_HOME } from '../shared/dirs.js';
const PREFS_PATH = resolve(PLUGIN_HOME, 'prefs.json');
function emptyState() {
    return { peers: {}, flags: {} };
}
function peerKey(scope, peerId) {
    return `${scope}:${peerId}`;
}
export class PrefsStore {
    path;
    state;
    constructor(path = PREFS_PATH) {
        this.path = path;
        this.state = this.load();
    }
    load() {
        try {
            if (!existsSync(this.path))
                return emptyState();
            const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
            return {
                peers: parsed && typeof parsed.peers === 'object' && parsed.peers !== null ? parsed.peers : {},
                flags: parsed && typeof parsed.flags === 'object' && parsed.flags !== null ? parsed.flags : {},
            };
        }
        catch {
            return emptyState();
        }
    }
    save() {
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            const tmp = `${this.path}.${process.pid}.tmp`;
            writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
            renameSync(tmp, this.path);
        }
        catch {
            try {
                unlinkSync(`${this.path}.${process.pid}.tmp`);
            }
            catch { /* ignore */ }
        }
    }
    /** 读某会话的偏好（可能为空对象） */
    peer(scope, peerId) {
        return this.state.peers[peerKey(scope, peerId)] ?? {};
    }
    /** 局部更新某会话偏好 */
    setPeer(scope, peerId, patch) {
        const key = peerKey(scope, peerId);
        this.state.peers[key] = { ...this.peer(scope, peerId), ...patch };
        this.save();
        return this.state.peers[key];
    }
    clearPeer(scope, peerId, field) {
        const key = peerKey(scope, peerId);
        const current = this.state.peers[key];
        if (!current)
            return;
        delete current[field];
        this.save();
    }
    /** 全局开关，例如 allowAnyone.voice */
    flag(name) {
        return this.state.flags[name] === true;
    }
    setFlag(name, value) {
        this.state.flags[name] = value === true;
        this.save();
    }
}
let singleton;
/** 进程内单例（重载后重新读盘） */
export function getPrefs() {
    singleton ??= new PrefsStore();
    return singleton;
}
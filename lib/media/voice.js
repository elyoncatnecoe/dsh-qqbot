/**
 * 语音合成 + 变调（服务端）。
 *
 * 平台 TTS 只提供 stella(女)/tide(男) 两个音色，输出 24kHz 单声道 16bit WAV。
 * 「中性音」= stella −3 半音，直接复用 dsh-voice-speaker 里那套纯 JS 的
 * WSOLA 时间伸缩 + 重采样（浏览器端原本算好参数，这里把同一套算法搬到 Node）。
 *
 * 不依赖 ffmpeg：本机没有可用的静态二进制，纯 JS 足够处理短语音。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MEDIA_ROOT } from './media-cleaner.js';
const TTS_URL = 'https://api.deepseek.com/v1/tools/tts';
/** 读取 DeepSeek API key：环境变量优先，其次 ~/.dsh/.credentials.yaml */
function resolveApiKey() {
    const fromEnv = process.env.DEEPSEEK_API_KEY;
    if (fromEnv)
        return fromEnv;
    try {
        const p = join(homedir(), '.dsh', '.credentials.yaml');
        const text = readFileSync(p, 'utf8');
        const m = text.match(/DEEPSEEK_API_KEY:\s*(\S+)/);
        if (m)
            return m[1].replace(/^["']|["']$/g, '');
    }
    catch { /* 没有就算了，调用方报错 */ }
    return '';
}
// ---------- WAV 编解码（16bit PCM，单/双声道） ----------
/** 解析 16bit PCM WAV；不支持格式返回 undefined */
export function decodeWav(buf) {
    if (buf.length < 44)
        return undefined;
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
        return undefined;
    let offset = 12;
    let fmt;
    let dataOffset = -1;
    let dataLength = 0;
    while (offset + 8 <= buf.length) {
        const id = buf.toString('ascii', offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        const body = offset + 8;
        if (id === 'fmt ') {
            fmt = {
                channels: buf.readUInt16LE(body + 2),
                sampleRate: buf.readUInt32LE(body + 4),
                bits: buf.readUInt16LE(body + 14),
            };
        }
        else if (id === 'data') {
            dataOffset = body;
            dataLength = Math.min(size, buf.length - body);
            break;
        }
        offset = body + size + (size % 2);
    }
    if (!fmt || dataOffset < 0 || fmt.bits !== 16)
        return undefined;
    const frames = Math.floor(dataLength / (2 * fmt.channels));
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
        // 多声道取平均，保持单声道输出
        let sum = 0;
        for (let c = 0; c < fmt.channels; c += 1)
            sum += buf.readInt16LE(dataOffset + (i * fmt.channels + c) * 2) / 32768;
        samples[i] = sum / fmt.channels;
    }
    return { samples, sampleRate: fmt.sampleRate };
}
/** 编码为 16bit 单声道 WAV */
export function encodeWav(samples, sampleRate) {
    const dataLength = samples.length * 2;
    const buf = Buffer.alloc(44 + dataLength);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(36 + dataLength, 4);
    buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(dataLength, 40);
    for (let i = 0; i < samples.length; i += 1) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
    }
    return buf;
}
// ---------- WSOLA 变调（与 dsh-voice-speaker 同算法） ----------
function wsolaStretch(x, S) {
    const N = 1024, overlap = N >> 1, tol = overlap >> 1;
    const corrLen = Math.min(256, overlap);
    const Hs = overlap, Ha = Hs / S;
    const win = new Float32Array(N);
    for (let i = 0; i < N; i += 1)
        win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const pad = tol + N, len = x.length;
    const xp = new Float32Array(len + 2 * pad);
    xp.set(x, pad);
    const outLen = Math.round(len * S);
    const out = new Float32Array(outLen + N + Hs), norm = new Float32Array(out.length);
    let prevTail = null;
    const nframes = Math.ceil(outLen / Hs) + 1;
    for (let i = 0; i < nframes; i += 1) {
        const ideal = pad + i * Ha;
        let off = Math.round(ideal);
        if (prevTail !== null) {
            const lo = Math.max(0, off - tol), hi = Math.min(xp.length - N, off + tol);
            if (hi >= lo) {
                let best = -Infinity, bestOff = lo;
                for (let o = lo; o <= hi; o += 1) {
                    let dot = 0, e = 0;
                    for (let j = 0; j < corrLen; j += 1) {
                        const v = xp[o + j];
                        dot += v * prevTail[j];
                        e += v * v;
                    }
                    const ncc = dot / Math.sqrt(e + 1e-9);
                    if (ncc > best) {
                        best = ncc;
                        bestOff = o;
                    }
                }
                off = bestOff;
            }
        }
        const opos = i * Hs;
        for (let j = 0; j < N; j += 1) {
            const idx = off + j;
            const v = idx < xp.length ? xp[idx] : 0;
            out[opos + j] += v * win[j];
            norm[opos + j] += win[j];
        }
        const tail = new Float32Array(corrLen);
        for (let j = 0; j < corrLen; j += 1) {
            const idx = off + overlap + j;
            tail[j] = idx < xp.length ? xp[idx] : 0;
        }
        prevTail = tail;
    }
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i += 1) {
        const n = norm[i];
        res[i] = n > 1e-8 ? out[i] / n : 0;
    }
    return res;
}
function resampleTo(x, targetLen) {
    const y = new Float32Array(targetLen);
    const ratio = (x.length - 1) / Math.max(1, targetLen - 1);
    for (let i = 0; i < targetLen; i += 1) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(i0 + 1, x.length - 1);
        const f = pos - i0;
        y[i] = x[i0] * (1 - f) + x[i1] * f;
    }
    return y;
}
/** 半音变调：先按比率时间伸缩，再重采样回原长（音高变化、节奏不变） */
export function pitchShift(samples, semitones) {
    if (!semitones)
        return samples;
    const r = Math.pow(2, semitones / 12);
    return resampleTo(wsolaStretch(samples, r), samples.length);
}
/**
 * 合成语音并落盘，返回 wav 绝对路径。
 *
 * 结果按「文本+音色+变调」哈希缓存，同句重复播报不重复计费。
 */
export async function synthesizeVoice(text, options) {
    const voiceId = options.voiceId || 'stella';
    const semitones = Number.isFinite(options.semitones) ? options.semitones : 0;
    const key = resolveApiKey();
    if (!key)
        throw new Error('语音合成失败：未找到 DEEPSEEK_API_KEY（环境变量或 ~/.dsh/.credentials.yaml）');
    const trimmed = String(text ?? '').trim();
    if (!trimmed)
        throw new Error('语音合成失败：文本为空');
    if (trimmed.length > (options.maxChars ?? 300)) {
        throw new Error(`语音合成失败：文本超过 ${options.maxChars ?? 300} 字，请先精简`);
    }
    mkdirSync(MEDIA_ROOT, { recursive: true });
    const digest = createHash('sha1').update(`${voiceId}|${semitones}|${trimmed}`).digest('hex').slice(0, 16);
    const outPath = join(MEDIA_ROOT, `voice-${digest}.wav`);
    if (existsSync(outPath))
        return { path: outPath, cached: true, semitones };
    const resp = await fetch(TTS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, voice_id: voiceId, format: 'wav' }),
    });
    if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        throw new Error(`语音合成失败：TTS HTTP ${resp.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
    }
    const raw = Buffer.from(await resp.arrayBuffer());
    const decoded = decodeWav(raw);
    if (!decoded)
        throw new Error('语音合成失败：返回的 WAV 无法解析');
    const shifted = pitchShift(decoded.samples, semitones);
    writeFileSync(outPath, encodeWav(shifted, decoded.sampleRate));
    return { path: outPath, cached: false, semitones };
}
'use strict';

/**
 * 语音播放：整包解码进内存，按 start / duration 截取。
 * 不用一百个小文件——Vorbis 每次起播有 20~50ms 解码延迟，连着说话会有杂音。
 * 代价是内存（3 分半单声道约 36MB），第一次要说话时才解码。
 */

window.PET_VOICE = (() => {
  const state = {
    ready: false,
    reason: '',
    ctx: null,
    buffer: null,
    lines: [],
    muted: false,
    playing: null,
    recent: [], // 最近播过的下标，避免连着重复同一句
  };

  const RECENT_KEEP = 12;

  function stop() {
    if (!state.playing) return;
    try {
      state.playing.onended = null;
      state.playing.stop();
    } catch {
      /* 已经结束了 */
    }
    state.playing = null;
  }

  async function init() {
    try {
      const info = await window.pet.voiceInfo();
      if (!info || !info.packUrl) {
        state.reason = '没有语音包';
        return state;
      }
      if (!info.linesUrl) {
        state.reason = '还没有标注好的字幕表';
        return state;
      }

      const [packRes, linesRes] = await Promise.all([
        fetch(info.packUrl),
        fetch(info.linesUrl),
      ]);
      if (!packRes.ok || !linesRes.ok) {
        state.reason = '语音文件读不出来';
        return state;
      }

      const [raw, json] = await Promise.all([packRes.arrayBuffer(), linesRes.json()]);
      const lines = (json && json.lines ? json.lines : []).filter(
        (l) => l && l.text && Number.isFinite(l.start) && l.dur > 0.2
      );
      if (!lines.length) {
        state.reason = '字幕表是空的';
        return state;
      }

      // 采样率用文件自己的，避免浏览器重采样出一次没必要的拷贝
      state.ctx = new AudioContext();
      state.buffer = await state.ctx.decodeAudioData(raw);
      state.lines = lines;
      state.ready = true;
      console.log(`[voice] 就绪：${lines.length} 句 / ${state.buffer.duration.toFixed(1)}s`);
    } catch (err) {
      state.reason = '解码失败：' + ((err && err.message) || err);
      console.error('[voice]', state.reason);
    }
    return state;
  }

  /** 挑一句没刚播过的；返回 null 表示这次不出声 */
  function pick() {
    if (!state.ready || state.muted || !state.lines.length) return null;

    let candidates = state.lines.map((_, i) => i).filter((i) => !state.recent.includes(i));
    if (!candidates.length) {
      state.recent = [];
      candidates = state.lines.map((_, i) => i);
    }

    const index = candidates[Math.floor(Math.random() * candidates.length)];
    state.recent.push(index);
    if (state.recent.length > RECENT_KEEP) state.recent.shift();

    const line = state.lines[index];
    return {
      text: line.text,
      dur: line.dur,
      play: () => {
        stop();
        if (!state.ctx || !state.buffer) return;
        // 浏览器可能把 AudioContext 停在 suspended，等用户第一次真的交互才肯出声
        if (state.ctx.state === 'suspended') state.ctx.resume().catch(() => {});

        const src = state.ctx.createBufferSource();
        src.buffer = state.buffer;
        src.connect(state.ctx.destination);
        src.onended = () => {
          if (state.playing === src) state.playing = null;
        };
        src.start(0, Math.max(0, line.start), Math.min(line.dur, state.buffer.duration));
        state.playing = src;
      },
    };
  }

  function setMuted(value) {
    state.muted = Boolean(value);
    if (state.muted) stop();
  }

  return {
    init,
    pick,
    stop,
    setMuted,
    // 调试与自动化用
    status: () => ({
      ready: state.ready,
      reason: state.reason,
      count: state.lines.length,
      muted: state.muted,
      ctx: state.ctx ? state.ctx.state : null,
      playing: Boolean(state.playing),
      rate: state.buffer ? state.buffer.sampleRate : null,
    }),
    get ready() {
      return state.ready;
    },
    get reason() {
      return state.reason;
    },
    get count() {
      return state.lines.length;
    },
    get muted() {
      return state.muted;
    },
  };
})();

'use strict';

/** 语音标注工具：逐段播放，人工打字幕。播放方式与运行时一致，听到什么桌面就是什么 */

const TRIM_STEP = 0.02; // 微调步长（秒）
const MIN_DUR = 0.15;

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const srcEl = document.getElementById('src');
const saveBtn = document.getElementById('save');

let segs = []; // { start, end, text }
let rows = []; // 与 segs 同下标，存的 DOM 引用
let selected = -1;
let dirty = false;

let ctx = null;
let buffer = null;
let source = null;
let playingIndex = -1;

/* ------------------------------------------------------------------ *
 * 状态栏
 * ------------------------------------------------------------------ */
function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function setDirty(value) {
  dirty = value;
  saveBtn.textContent = value ? '保存 •' : '保存';
}

function updateProgress() {
  const done = segs.filter((s) => s.text.trim()).length;
  progressEl.textContent = `已写字幕 ${done} / ${segs.length}（留空 = 不用这句）`;
}

/* ------------------------------------------------------------------ *
 * 播放
 * ------------------------------------------------------------------ */
function stop() {
  if (source) {
    try {
      source.onended = null;
      source.stop();
    } catch {
      /* 已经停了 */
    }
    source = null;
  }
  if (playingIndex >= 0 && rows[playingIndex]) rows[playingIndex].classList.remove('playing');
  playingIndex = -1;
}

function play(index) {
  if (!buffer || !segs[index]) return;
  stop();

  const s = segs[index];
  const start = Math.max(0, s.start);
  const dur = Math.max(MIN_DUR, Math.min(s.end, buffer.duration) - start);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.onended = () => {
    if (playingIndex === index) {
      playingIndex = -1;
      if (rows[index]) rows[index].classList.remove('playing');
      source = null;
    }
  };
  src.start(0, start, dur);

  source = src;
  playingIndex = index;
  if (rows[index]) rows[index].classList.add('playing');
}

/* ------------------------------------------------------------------ *
 * 选择与渲染
 * ------------------------------------------------------------------ */
function select(index, { playNow = false } = {}) {
  if (index < 0 || index >= segs.length) return;
  if (selected >= 0 && rows[selected]) rows[selected].classList.remove('sel');
  selected = index;
  const row = rows[index];
  if (row) {
    row.classList.add('sel');
    row.scrollIntoView({ block: 'nearest' });
  }
  setStatus(`#${String(index).padStart(3, '0')}  ${segs[index].start.toFixed(2)} → ${segs[index].end.toFixed(2)}s`);
  if (playNow) play(index);
}

function rowDom(seg, i) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.i = String(i);

  const playBtn = document.createElement('button');
  playBtn.className = 'play';
  playBtn.textContent = '▶';
  playBtn.title = '只播这一段';
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    select(i);
    play(i);
  });

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = String(i).padStart(3, '0');

  const time = document.createElement('span');
  time.className = 'time';

  const dur = document.createElement('span');
  dur.className = 'dur';

  const input = document.createElement('input');
  input.className = 'text';
  input.type = 'text';
  input.placeholder = '在这里写字幕…';
  input.value = seg.text;
  input.addEventListener('focus', () => select(i));
  input.addEventListener('input', () => {
    segs[i].text = input.value;
    setDirty(true);
    updateRowState(i);
    updateProgress();
  });
  // 打完一句按回车直接跳到下一句并播放，连续标注时手不用离开键盘
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (i + 1 < segs.length) {
        select(i + 1, { playNow: true });
        rows[i + 1]?.querySelector('.text')?.focus();
      }
    }
  });

  const mergeBtn = document.createElement('button');
  mergeBtn.className = 'merge';
  mergeBtn.textContent = '⇧';
  mergeBtn.title = '与上一段合并（同一次呼吸被切成两半时用）';
  mergeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mergeUp(i);
  });

  row.append(playBtn, idx, time, dur, input, mergeBtn);
  row.addEventListener('click', () => select(i));

  return row;
}

function paintRow(i) {
  const row = rows[i];
  const seg = segs[i];
  if (!row || !seg) return;
  row.querySelector('.time').textContent = `${seg.start.toFixed(2)}–${seg.end.toFixed(2)}`;
  row.querySelector('.dur').textContent = `${(seg.end - seg.start).toFixed(2)}s`;
  updateRowState(i);
}

function updateRowState(i) {
  const row = rows[i];
  const seg = segs[i];
  if (!row || !seg) return;
  const filled = seg.text.trim().length > 0;
  row.classList.toggle('empty', !filled);
  row.classList.toggle('filled', filled);
  const input = row.querySelector('.text');
  input.classList.toggle('done', filled);
  if (input.value !== seg.text) input.value = seg.text;
}

function render() {
  stop();
  listEl.textContent = '';
  rows = [];
  segs.forEach((seg, i) => {
    const row = rowDom(seg, i);
    listEl.appendChild(row);
    rows.push(row);
    paintRow(i);
  });
  updateProgress();
  if (segs.length) select(0);
  else setStatus('没有分段可标注');
}

/* ------------------------------------------------------------------ *
 * 编辑操作
 * ------------------------------------------------------------------ */
function mergeUp(i) {
  if (i <= 0) return;
  const prev = segs[i - 1];
  const cur = segs[i];
  prev.end = Math.max(prev.end, cur.end);
  prev.text = (prev.text + cur.text).trim();
  segs.splice(i, 1);
  setDirty(true);
  // 只有尾部的合并才需要重建 DOM，中途合并重建一次也无所谓，104 行很快
  render();
  select(Math.max(0, i - 1));
}

function trim(which, delta) {
  const seg = segs[selected];
  if (!seg) return;
  if (which === 'start') {
    seg.start = Math.max(0, Math.min(seg.end - MIN_DUR, seg.start + delta));
  } else {
    const limit = buffer ? buffer.duration : seg.end;
    seg.end = Math.min(limit, Math.max(seg.start + MIN_DUR, seg.end + delta));
  }
  setDirty(true);
  paintRow(selected);
  play(selected);
}

/* ------------------------------------------------------------------ *
 * 保存
 * ------------------------------------------------------------------ */
async function save() {
  const lines = segs
    .filter((s) => s.text.trim())
    .map((s) => ({ start: s.start, dur: s.end - s.start, text: s.text.trim() }));

  const res = await window.pet.voiceSave({ lines });
  if (res && res.ok) {
    setDirty(false);
    setStatus(`已保存 ${res.saved} 句 → ${res.path}`, 'ok');
  } else {
    setStatus(`保存失败：${(res && res.error) || '未知错误'}`, 'err');
  }
}

/* ------------------------------------------------------------------ *
 * 键盘
 * ------------------------------------------------------------------ */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
    return;
  }

  const inInput = e.target && e.target.classList && e.target.classList.contains('text');

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = selected + (e.key === 'ArrowDown' ? 1 : -1);
    select(next);
    if (inInput) rows[next]?.querySelector('.text')?.focus();
    return;
  }

  if (e.key === ' ' && !inInput) {
    e.preventDefault();
    if (playingIndex >= 0) stop();
    else play(selected);
    return;
  }

  if (e.key === 'Enter' && !inInput) {
    e.preventDefault();
    rows[selected]?.querySelector('.text')?.focus();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
(async () => {
  try {
    const info = await window.pet.voiceInfo();
    if (!info || !info.packUrl) {
      setStatus('assets/audio/ 里没有语音包，先按 assets/README.md 放进去', 'err');
      return;
    }
    srcEl.textContent = info.label;

    const loaded = await window.pet.voiceLoad();
    if (!loaded || !loaded.segments || !loaded.segments.length) {
      setStatus('没有分段表。先跑：python scripts/segment-voice.py assets/audio/amiya.ogg -o assets/audio/amiya.segments.json', 'err');
      return;
    }

    setStatus('解码语音包…');
    const res = await fetch(info.packUrl);
    const raw = await res.arrayBuffer();

    ctx = new AudioContext();
    buffer = await ctx.decodeAudioData(raw);
    setStatus(`已解码 ${buffer.duration.toFixed(1)}s / ${buffer.sampleRate}Hz`);

    // 已有字幕按起点时间对上，不按序号——重跑分段时序号会变，起点不会
    const old = loaded.lines || [];
    segs = loaded.segments.map((s) => {
      const hit = old.find((l) => Math.abs(l.start - s.start) < 0.25);
      return { start: s.start, end: s.end, text: hit ? hit.text : '' };
    });

    render();
    if (old.length) setStatus(`载入了已有字幕 ${old.filter((l) => l.text).length} 句，可以接着改`, 'ok');
    setDirty(false);

    // 给自动化验收看的
    window.__labelDiag = {
      decoded: Number(buffer.duration.toFixed(2)),
      sampleRate: buffer.sampleRate,
      segments: segs.length,
      existingLines: old.filter((l) => l.text).length,
      ctxState: ctx.state,
    };
  } catch (err) {
    setStatus(`启动失败：${(err && err.message) || err}`, 'err');
    console.error(err);
  }
})();

saveBtn.addEventListener('click', save);

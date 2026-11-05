#!/usr/bin/env python3
"""
把整包语音（一个长 ogg）切成单句片段。

为什么需要这个：游戏解包出来的语音是"一个角色一个文件"，几十分钟的音频
首尾相接，没有分隔标记。要按句播放，就得先找出每句的起止时间。

做法是最朴素的能量法：按 10ms 一帧算音量，静音的地方切开。
难点是阈值——句内的换气停顿（0.2~0.3s）和句间停顿（0.5s+）很接近，
所以先跑 --analyze 看一眼实际的间隔分布，再把 --gap 定在那个谷里。

用法：
    python scripts/segment-voice.py input.ogg --analyze
    python scripts/segment-voice.py input.ogg -o segments.json
    python scripts/segment-voice.py input.ogg -o segments.json --gap 0.45

依赖：soundfile + numpy（只用于这一步预处理，不参与运行时）
"""

import argparse
import json
import sys


def load_mono(path):
    import soundfile as sf
    import numpy as np

    data, sr = sf.read(path, dtype="float32", always_2d=True)
    # 多声道直接混成单声道：语音内容不需要立体声，混了还能省一半内存
    mono = data.mean(axis=1)
    return mono, sr


def frame_db(mono, sr, win=0.025, hop=0.01):
    import numpy as np

    w = max(1, int(sr * win))
    h = max(1, int(sr * hop))
    n = 1 + max(0, (len(mono) - w) // h)
    if n <= 0:
        return np.zeros(0, dtype="float32"), hop

    idx = np.arange(w)[None, :] + (np.arange(n) * h)[:, None]
    frames = mono[idx]
    rms = np.sqrt((frames.astype("float64") ** 2).mean(axis=1))
    db = 20.0 * np.log10(np.maximum(rms, 1e-9))
    return db.astype("float32"), h / sr


def speech_mask(db, floor_db):
    import numpy as np

    # 阈值取"底噪 + 12dB"：绝对阈值在有的录音里会把轻声全切掉
    thresh = max(floor_db + 12.0, -52.0)
    return db > thresh, thresh


def runs(mask):
    """把布尔数组压成 [(start_idx, end_idx_exclusive), ...]"""
    out = []
    start = None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def build_segments(db, frame_dur, gap, min_speech, pad, total):
    """先按静音切，再把间隔小于 gap 的相邻段合并，最后两端各留一点余量"""
    import numpy as np

    floor = float(np.percentile(db, 10))
    mask, thresh = speech_mask(db, floor)

    # 顺序很重要：先拿全部块去合并，合并完再丢碎片。
    # 反过来（先丢碎片）会把一个 0.2s 的杂音块删掉，它两侧的间隔因此连成一片，
    # 于是一句完整的话被硬拆成两段——实测多出 20 多段假句子。
    blocks = [(a * frame_dur, b * frame_dur) for a, b in runs(mask)]

    merged = []
    for a, b in blocks:
        if merged and a - merged[-1][1] < gap:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))

    out = []
    for a, b in merged:
        if b - a < min_speech:
            continue
        s = max(0.0, a - pad)
        e = min(total, b + pad)
        out.append({"start": round(s, 3), "end": round(e, 3), "dur": round(e - s, 3)})
    return out, thresh, floor


def analyze(db, frame_dur):
    import numpy as np

    floor = float(np.percentile(db, 10))
    mask, thresh = speech_mask(db, floor)

    print(f"总时长      {len(db) * frame_dur:.1f}s")
    print(f"音量分布    p10={floor:.1f}  p50={np.percentile(db,50):.1f}  "
          f"p90={np.percentile(db,90):.1f}  max={db.max():.1f} dB")
    print(f"语音阈值    {thresh:.1f} dB")

    gaps = []
    rs = runs(mask)
    for (a0, b0), (a1, _) in zip(rs, rs[1:]):
        gaps.append((a1 - b0) * frame_dur)
    print(f"非静音块    {len(rs)} 个，间隔 {len(gaps)} 处")

    # 间隔分布：这决定了 --gap 该取多少
    bins = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.5, 2.0, 99]
    print("\n间隔时长分布（谷底就是最佳切点）")
    prev = 0.0
    for b in bins:
        c = sum(1 for g in gaps if prev <= g < b)
        bar = "#" * min(60, c * 2)
        print(f"  {prev:>4.2f}~{b:<5.2f}s {c:>4}  {bar}")
        prev = b

    print("\n不同切点会得到多少段")
    for g in (0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.8):
        segs, _, _ = build_segments(db, frame_dur, g, 0.25, 0.05, len(db) * frame_dur)
        speech = sum(s["dur"] for s in segs)
        print(f"  --gap {g:<4} -> {len(segs):>3} 段，有声 {speech:>6.1f}s "
              f"(平均 {speech/max(len(segs),1):.2f}s/段)")


def main():
    ap = argparse.ArgumentParser(description="把整包语音按静音切成分句片段")
    ap.add_argument("input", help="输入音频（ogg/wav/mp3，能解码就行）")
    ap.add_argument("-o", "--out", help="输出 segments.json")
    ap.add_argument("--analyze", action="store_true", help="只打印间隔分布，不写文件")
    ap.add_argument("--gap", type=float, default=0.45, help="间隔超过多少秒就断开（默认 0.45）")
    ap.add_argument("--min-speech", type=float, default=0.25, help="短于多少秒的碎片丢弃（默认 0.25）")
    ap.add_argument("--pad", type=float, default=0.06, help="每段两端留的余量（默认 0.06）")
    args = ap.parse_args()

    try:
        mono, sr = load_mono(args.input)
    except ImportError:
        sys.exit("缺少依赖：pip install soundfile numpy")
    except Exception as err:
        sys.exit(f"读不了 {args.input}: {err}")

    db, frame_dur = frame_db(mono, sr)

    if args.analyze:
        analyze(db, frame_dur)
        return

    if not args.out:
        sys.exit("要么加 --analyze，要么用 -o 指定输出文件")

    segs, thresh, floor = build_segments(
        db, frame_dur, args.gap, args.min_speech, args.pad, len(mono) / sr
    )

    payload = {
        "source": args.input.replace("\\", "/").split("/")[-1],
        "sampleRate": sr,
        "duration": round(len(mono) / sr, 3),
        "gap": args.gap,
        "segments": segs,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"底噪 {floor:.1f} dB，阈值 {thresh:.1f} dB")
    print(f"切成 {len(segs)} 段，写入 {args.out}")
    print(f"最短 {min(s['dur'] for s in segs):.2f}s / 最长 {max(s['dur'] for s in segs):.2f}s")


if __name__ == "__main__":
    main()

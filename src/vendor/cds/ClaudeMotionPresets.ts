/**
 * Claude Design System (CDS) - Motion Engine & Physics Presets
 * 
 * 逆向溯源：提取自 /Applications/Claude.app ion-dist 及 Framer Motion 生产环境配置。
 * 遵循二阶阻尼谐振子物理公式：
 *   m * x'' + c * x' + k * (x - x_target) = 0
 *   阻尼比 ζ = c / (2 * sqrt(m * k))
 */

import { type Transition, type Variants } from "framer-motion";

// ============================================================================
// 1. 经典二阶阻尼谐振子数学求解器 (Damped Harmonic Oscillator)
// ============================================================================

export interface SpringParameters {
  stiffness: number; // k: 弹性刚度 (N/m)
  damping: number;   // c: 阻尼系数 (N·s/m)
  mass: number;      // m: 物体质量 (kg)
}

/**
 * 计算给定时间 t 下的归一化位移 (0 -> 1)
 */
export function calcDampedHarmonicOscillator(
  k: number,
  c: number,
  m: number,
  t: number
): number {
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(m * k));

  if (zeta < 1) {
    // 欠阻尼状态 (Underdamped, 存在微冲超调振荡)
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * w0 * t) *
        (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t))
    );
  } else if (Math.abs(zeta - 1) < 1e-4) {
    // 临界阻尼 (Critically damped, 最快无振荡收敛)
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  } else {
    // 过阻尼状态 (Overdamped, 无超调平滑慢收敛)
    const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
    return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
  }
}

// ============================================================================
// 2. 生产级 Framer Motion 物理预设矩阵 (Spring Presets)
// ============================================================================

/**
 * 预设 1: 麦克风按钮 / 语音状态条 (Mic & Voice Bar)
 * 特征：高频微弹，超调量 +8.8% (ζ = 0.612)。
 * 来源：`ion-dist/assets/v1/shared-8-PHXy9B6B.js` — `{type:"spring",stiffness:600,damping:30}`
 * 实测用途：麦克风按钮 mount/unmount 的 `scale/opacity` 出入场、语音状态
 *          `width:0→32` 展开、按钮 padding 形变、图形切换的 `popLayout`。
 */
export const SPRING_BOUNCY: Transition = {
  type: "spring",
  stiffness: 600,
  damping: 30,
  mass: 1.0,
};

/**
 * 预设 2: 手势拖拽回弹 (Drag Release) —— 不是入场动画
 * 特征：沉稳顺滑，超调量 +1.9% (ζ = 0.783)。
 * 来源：`ion-dist/assets/v1/c427176b2-DuM09fKk.js` — `{type:"spring",stiffness:320,damping:28}`
 * 实测用途：`animate(current.dx, target.dx, {...preset, velocity})` 与 `dy` 成对，
 *          拖动结束后按松手速度回弹到落位点；带 `prefers-reduced-motion`
 *          分支直接跳位（客户端 65 个文件均做此降级）。
 */
export const SPRING_SNAPPY: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 28,
  mass: 1.0,
};

/**
 * 预设 3: **非客户端提取，本项目自建**
 * 特征：明显两周期跳跃感，超调量 +19.5% (ζ = 0.462)。
 *
 * 客户端全量搜索无 `stiffness:380` / `damping:18`，故 `380/18` 不是 CDS 观测值。
 * 文档曾把客户端的 `{type:"spring",duration:.32,bounce:.15}`
 * （`shared-9-Co0ph6Xn.js`，听写/静息状态切换）标注为「或 `dur 0.32`」的等价写法，
 * 但按 framer-motion `tn()` 反解，该配置实际等价于
 * `stiffness≈244, damping≈26.6, ζ≈0.85`（超调仅 +0.6%），与 380/18 相差极大。
 * 如需还原该切换手感，请直接用 duration/bounce 形式，不要用本预设近似。
 *
 * 本预设仅用于补足「零过冲」与「高频微弹」之间的中段强弹性档位，
 * 借用前请确认符合你的设计意图，不要当作 Claude 观测值引用。
 */
export const SPRING_GENTLE: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 18,
  mass: 1.0,
};

/**
 * 预设 4: 文件查看器面板宽度 (File Viewer Panel Width)
 * 特征：绝对零过冲（过阻尼 ζ = 3.652）。
 * 来源：`ion-dist/assets/v1/c8ad300b7-07P9B-v4.js` — `{type:"spring",stiffness:1200,damping:80,mass:.1}`
 * 实测用途：`file_viewer` 面板展开时 `animate(width, 384, preset)` 将宽度从
 *          `initial` 弹到 `384`（常量 `jt=384`），关闭时弹回 `Pt().initial`；
 *          同一文件中 `kt=320` 是最小宽度、`At=480` 是默认宽度。
 */
export const SPRING_HEAVY_SNAP: Transition = {
  type: "spring",
  stiffness: 1200,
  damping: 80,
  mass: 0.1,
};

// ============================================================================
// 3. 原生 CSS 贝塞尔缓动曲线常量 (CSS Easing Constants)
// ============================================================================

export const CDS_EASING = {
  /** 消息气泡与药丸胶囊微弹入场 */
  OVERSHOOT: "cubic-bezier(0.34, 1.3, 0.64, 1)",
  /** 阴影、焦点微光、高斯模糊渐变 */
  EASE_OUT_EXPO: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** 抽屉面板滑入标准减速 */
  DECEL: "cubic-bezier(0.165, 0.84, 0.44, 1)",
  /** 瞬时按压缩放 */
  SHARP_PRESS: "cubic-bezier(0.32, 0.72, 0, 1)",
} as const;

// ============================================================================
// 4. 标准 Framer Motion 动画变体 (Reusable Motion Variants)
// ============================================================================

/** 消息上浮进入变体 */
export const motionMessageFadeUp: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: SPRING_SNAPPY,
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.18, ease: "easeIn" },
  },
};

/** 用户提问气泡弹出变体 */
export const motionUserBubbleEnter: Variants = {
  initial: { opacity: 0, scale: 0.94, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 450,
      damping: 24,
    },
  },
};

/** 弹出菜单 / Popover 浮层 */
export const motionPopover: Variants = {
  initial: { opacity: 0, scale: 0.95, y: 4 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: SPRING_SNAPPY,
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: 2,
    transition: { duration: 0.12, ease: "easeOut" },
  },
};

/** 模态对话框居中缩放进入 */
export const motionModalDialog: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 32,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: 6,
    transition: { duration: 0.15, ease: "easeInOut" },
  },
};

/** 字符模糊消解流式动画 (Grapheme Blur Reveal) */
export const motionGraphemeReveal: Variants = {
  initial: { opacity: 0, filter: "blur(6px)" },
  animate: {
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 0.35, ease: "easeOut" },
  },
};

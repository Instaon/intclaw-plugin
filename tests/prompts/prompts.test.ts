import { describe, it, expect } from 'vitest';
import { __testables } from '../../test';

const { buildMediaSystemPrompt } = __testables as any;

describe('buildMediaSystemPrompt', () => {
  it('returns non-empty string', () => {
    const s = buildMediaSystemPrompt();
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });

  it('returns identical string on multiple calls', () => {
    const a = buildMediaSystemPrompt();
    const b = buildMediaSystemPrompt();
    expect(a).toBe(b);
  });

  it('includes main section headers', () => {
    const s = buildMediaSystemPrompt();
    expect(s).toContain('## IntClaw图片和文件显示规则');
    expect(s).toContain('### 一、图片显示');
    expect(s).toContain('### 二、视频分享');
    expect(s).toContain('### 三、音频分享');
    expect(s).toContain('### 四、文件分享');
  });

  it('includes image rules: file://, local path, no curl, no escape', () => {
    const s = buildMediaSystemPrompt();
    expect(s).toContain('file://');
    expect(s).toMatch(/\/(tmp|Users\/)/);
    expect(s).toContain('curl');
    expect(s).toMatch(/转义|反斜杠/);
    expect(s).toContain('系统会自动上传到IntClaw');
  });

  it('includes video rules: INTCLAW_VIDEO, path, mp4, 20MB', () => {
    const s = buildMediaSystemPrompt();
    expect(s).toContain('[INTCLAW_VIDEO]');
    expect(s).toContain('[/INTCLAW_VIDEO]');
    expect(s).toContain('path');
    expect(s).toContain('mp4');
    expect(s).toContain('20MB');
    expect(s).toMatch(/时长|分辨率|封面/);
  });

  it('includes audio rules: INTCLAW_AUDIO, ogg/amr, 20MB', () => {
    const s = buildMediaSystemPrompt();
    expect(s).toContain('[INTCLAW_AUDIO]');
    expect(s).toContain('[/INTCLAW_AUDIO]');
    expect(s).toMatch(/ogg|amr/);
    expect(s).toContain('20MB');
    expect(s).toMatch(/音频|时长/);
  });

  it('includes file rules: INTCLAW_FILE, fileName, fileType, 20MB', () => {
    const s = buildMediaSystemPrompt();
    expect(s).toContain('[INTCLAW_FILE]');
    expect(s).toContain('[/INTCLAW_FILE]');
    expect(s).toMatch(/fileName|文件名/);
    expect(s).toMatch(/fileType|扩展名/);
    expect(s).toMatch(/20MB|文件过大/);
  });
});

/**
 * Тесты разбора состояния микрофона (mic-state.js).
 *
 * Что чинилось и что тут сторожится:
 *   - До выдачи разрешения Chrome возвращает audioinput с пустым deviceId.
 *     Старый popup.js читал это как «микрофона нет»: гасил переключатель,
 *     писал micEnabled:false и показывал «Не найден». Пути к запросу прав из
 *     попапа не оставалось вовсе — человек писал экран и получал немое видео.
 *   - Флаг micPermissionGranted в storage залипал: после «Разрешить в этот раз»
 *     он оставался true, прав уже не было, попап показывал «Готов».
 *   - Firefox не поддерживает permissions.query({name:'microphone'}) — там
 *     флаг из storage остаётся единственным источником, и он должен работать.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'mic-state.js'), 'utf8');

const sandbox = { self: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const evaluateMicState = sandbox.evaluateMicState;

// Снимок enumerateDevices() до выдачи разрешения: устройство видно, id скрыт.
const HIDDEN_MIC = [{ deviceId: '', kind: 'audioinput', label: '' }];
const NAMED_MIC = [{ deviceId: 'abc123', kind: 'audioinput', label: 'MacBook Pro Microphone' }];

describe('evaluateMicState', () => {
  it('пустой deviceId — это скрытое устройство, а не отсутствие микрофона', () => {
    const v = evaluateMicState({
      audioInputs: HIDDEN_MIC,
      storedGranted: false,
      permissionState: 'prompt',
    });
    expect(v.hardwareAvailable).toBe(true);
    expect(v.permissionGranted).toBe(false);
    expect(v.status).toBe('needs-permission');
    // Главное: попапу есть куда вести человека.
    expect(v.needsPrompt).toBe(true);
  });

  it('микрофона реально нет — запрос прав не предлагаем', () => {
    const v = evaluateMicState({ audioInputs: [], permissionState: 'prompt' });
    expect(v.hardwareAvailable).toBe(false);
    expect(v.needsPrompt).toBe(false);
    expect(v.status).toBe('no-hardware');
  });

  it('разрешение выдано — состояние «готов», запрос не нужен', () => {
    const v = evaluateMicState({
      audioInputs: NAMED_MIC,
      storedGranted: true,
      permissionState: 'granted',
    });
    expect(v.permissionGranted).toBe(true);
    expect(v.needsPrompt).toBe(false);
    expect(v.clearStoredFlag).toBe(false);
    expect(v.status).toBe('ready');
  });

  it('«Разрешить в этот раз» истекло: залипший флаг гасится ответом Permissions API', () => {
    const v = evaluateMicState({
      audioInputs: HIDDEN_MIC,
      storedGranted: true,
      permissionState: 'prompt',
    });
    expect(v.permissionGranted).toBe(false);
    expect(v.clearStoredFlag).toBe(true);
    expect(v.needsPrompt).toBe(true);
  });

  it('заблокировано в браузере — статус blocked, но страницу прав всё равно открываем', () => {
    const v = evaluateMicState({
      audioInputs: NAMED_MIC,
      storedGranted: false,
      permissionState: 'denied',
    });
    expect(v.status).toBe('blocked');
    expect(v.needsPrompt).toBe(true);
  });

  it('Firefox (permissions.query недоступен) — прав не знаем, запись не блокируем', () => {
    const v = evaluateMicState({
      audioInputs: HIDDEN_MIC,
      storedGranted: false,
      permissionState: null,
    });
    expect(v.permissionKnown).toBe(false);
    // needsPrompt=false — иначе Firefox упрётся в страницу прав, хотя микрофон
    // там спрашивает уже вкладка рекордера.
    expect(v.needsPrompt).toBe(false);
  });

  it('Chrome ответил prompt — отказ достоверный, прав спрашиваем', () => {
    const v = evaluateMicState({
      audioInputs: HIDDEN_MIC,
      storedGranted: false,
      permissionState: 'prompt',
    });
    expect(v.permissionKnown).toBe(true);
    expect(v.needsPrompt).toBe(true);
  });

  it('Firefox (permissions.query недоступен) — верим флагу из storage', () => {
    const granted = evaluateMicState({
      audioInputs: HIDDEN_MIC,
      storedGranted: true,
      permissionState: null,
    });
    expect(granted.permissionGranted).toBe(true);
    expect(granted.clearStoredFlag).toBe(false);
    expect(granted.status).toBe('ready');

    const notGranted = evaluateMicState({
      audioInputs: HIDDEN_MIC,
      storedGranted: false,
      permissionState: null,
    });
    expect(notGranted.permissionGranted).toBe(false);
  });

  it('enumerateDevices упал — считаем железо доступным, а не пропавшим', () => {
    const v = evaluateMicState({
      audioInputs: [],
      enumerateFailed: true,
      storedGranted: false,
      permissionState: 'prompt',
    });
    expect(v.hardwareAvailable).toBe(true);
    expect(v.needsPrompt).toBe(true);
  });
});

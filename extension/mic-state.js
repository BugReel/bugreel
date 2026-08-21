/**
 * mic-state.js — разбор состояния микрофона: есть ли железо, выдано ли
 * разрешение, надо ли открывать страницу запроса прав.
 *
 * Вынесено из popup.js отдельным файлом по двум причинам:
 *   1) логика тут чистая (на входе — снимок, на выходе — решение), её держит
 *      тест без эмуляции DOM;
 *   2) до разрешения Chrome отдаёт устройства с пустым deviceId, и это легко
 *      спутать с «микрофона нет» — ошибку удобнее сторожить в одном месте.
 *
 * Грузится классическим <script> в popup.html и через vm в тестах.
 */
(function (root) {
  'use strict';

  /**
   * @param {Object} input
   * @param {Array<{deviceId?: string}>} [input.audioInputs] — записи kind==='audioinput'
   *        из enumerateDevices(). До выдачи разрешения Chrome возвращает их с
   *        пустыми deviceId/label — устройство при этом есть.
   * @param {boolean} [input.enumerateFailed] — enumerateDevices() бросил.
   * @param {boolean} [input.storedGranted] — флаг micPermissionGranted из storage.
   * @param {'granted'|'prompt'|'denied'|null} [input.permissionState] — ответ
   *        navigator.permissions.query({name:'microphone'}); null — движок не
   *        поддерживает запрос (Firefox), тогда верим только флагу из storage.
   * @returns {{hardwareAvailable: boolean, permissionGranted: boolean,
   *            permissionKnown: boolean, needsPrompt: boolean,
   *            clearStoredFlag: boolean,
   *            status: 'ready'|'needs-permission'|'blocked'|'no-hardware'}}
   */
  function evaluateMicState(input) {
    const inputs = (input && input.audioInputs) || [];
    const permissionState = input && input.permissionState !== undefined
      ? input.permissionState
      : null;
    const storedGranted = !!(input && input.storedGranted);

    // enumerateDevices недоступен — считаем, что железо есть: лучше показать
    // запрос прав, чем соврать «микрофон не найден».
    const hardwareAvailable = (input && input.enumerateFailed)
      ? true
      : inputs.length > 0;

    let permissionGranted;
    let clearStoredFlag = false;

    if (permissionState === 'granted') {
      permissionGranted = true;
    } else if (permissionState === 'prompt' || permissionState === 'denied') {
      // Флаг в storage залипает: после «Разрешить в этот раз» он остаётся true,
      // а прав уже нет. Ответ Permissions API главнее — флаг гасим.
      permissionGranted = false;
      clearStoredFlag = storedGranted;
    } else {
      permissionGranted = storedGranted;
    }

    let status;
    if (!hardwareAvailable) status = 'no-hardware';
    else if (permissionGranted) status = 'ready';
    else if (permissionState === 'denied') status = 'blocked';
    else status = 'needs-permission';

    // Firefox о правах не отвечает: там «нет разрешения» — догадка по флагу, а не
    // факт. Отказывать в записи по догадке нельзя — микрофон в Firefox
    // запрашивается уже во вкладке рекордера.
    const permissionKnown = permissionState === 'granted'
      || permissionState === 'prompt'
      || permissionState === 'denied';

    return {
      hardwareAvailable,
      permissionGranted,
      permissionKnown,
      // Заблокированный в настройках Chrome микрофон тоже ведём на страницу
      // прав: там кнопка повторного запроса и подсказка про системные настройки.
      needsPrompt: hardwareAvailable && !permissionGranted && permissionKnown,
      clearStoredFlag,
      status,
    };
  }

  root.evaluateMicState = evaluateMicState;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { evaluateMicState };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

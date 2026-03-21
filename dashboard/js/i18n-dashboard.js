/**
 * BugReel Dashboard — Standalone i18n engine
 * No dependencies, no async — translations embedded inline.
 *
 * Usage in HTML:  <span data-i18n="key">Fallback</span>
 *                 <span data-i18n="key" data-i18n-attr="placeholder">Fallback</span>
 *                 <span data-i18n-html="key">Fallback HTML</span>
 *
 * Usage in JS:    const t = window.__dashboardI18n?.t || ((k, f) => f || k);
 *                 t('nav_recordings', 'Recordings')
 */
(function () {
  'use strict';

  const translations = {
    en: {
      // Brand
      brand_name: 'BugReel',

      // Navigation
      nav_recordings: 'Recordings',
      nav_analytics: 'Analytics',
      nav_guide: 'Guide',
      nav_cards: 'Cards',

      // Index page
      index_title: 'Recordings',
      index_desc: 'Screen recordings from QA team',
      filter_status: 'Status',
      filter_all_statuses: 'All statuses',
      filter_author: 'Author',
      filter_author_placeholder: 'Filter by author...',
      filter_search_placeholder: 'Search recordings...',
      filter_not_sent: 'Not sent to tracker',
      th_recording: 'Recording',
      th_author: 'Author',
      th_date: 'Date',
      th_status: 'Status',
      th_duration: 'Duration',
      no_recordings: 'No recordings found',
      failed_load_recordings: 'Failed to load recordings',
      showing: 'Showing',
      of: 'of',

      // Recording detail
      back_to_recordings: 'Back to recordings',
      key_moments: 'Key Moments',
      no_key_frames: 'No key frames',
      processing_recording: 'Processing recording...',
      extracting_audio: 'Extracting audio from video...',
      transcribing_speech: 'Transcribing speech...',
      analyzing_transcript: 'Analyzing transcript...',
      extracting_frames: 'Extracting key frames...',
      creating_card: 'Creating card...',
      done: 'Done',
      processing_error: 'Processing error',
      try_again: 'Try uploading the recording again',
      description: 'Description',
      transcript: 'Transcript',
      context: 'Context',
      no_analysis: 'No analysis data',
      no_transcript: 'No transcript',
      no_context: 'No context data captured. Update Chrome extension to capture URL events and console errors.',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      edit_description: 'Edit Description',
      title: 'Title',
      type: 'Type',
      copied: 'Copied',
      deleting: 'Deleting...',
      saving: 'Saving...',
      saved: 'Saved',
      extracting_frame: 'Extracting frame...',

      // Status labels
      status_uploaded: 'Uploaded',
      status_audio_extracted: 'Audio',
      status_transcribing: 'Transcribing',
      status_transcribed: 'Transcribed',
      status_analyzed: 'Analyzed',
      status_frames_extracted: 'Frames',
      status_compressing: 'Compressing',
      status_complete: 'Complete',
      status_error: 'Error',
      status_draft: 'Draft',
      status_scored: 'Scored',
      status_done: 'Done',

      // Card types
      type_bug: 'Bug',
      type_feature: 'Feature',
      type_enhancement: 'Enhancement',
      type_demo: 'Demo',

      // CS categories
      cs_easy: 'Easy',
      cs_medium: 'Medium',
      cs_hard: 'Hard',
      cs_critical: 'Critical',

      // Priority
      priority_low: 'Low',
      priority_medium: 'Medium',
      priority_high: 'High',
      priority_urgent: 'Urgent',

      // Analysis fields
      steps_to_reproduce: 'Steps to Reproduce',
      expected_result: 'Expected Result',
      actual_result: 'Actual Result',
      proposal: 'Proposal',
      use_case: 'Use Case',
      current_behavior: 'Current Behavior',
      proposed_change: 'Proposed Change',
      key_points: 'Key Points',
      details: 'Details',

      // Cards page
      cards_title: 'Cards Queue',
      cards_desc: 'Task cards generated from recordings',
      filter_priority: 'Priority',
      filter_all_priorities: 'All priorities',
      filter_assigned: 'Assigned to',
      filter_assigned_placeholder: 'Filter by assignee...',
      sort_by: 'Sort by',
      sort_date: 'Date',
      sort_cs: 'CS Score',
      sort_priority: 'Priority',
      no_cards: 'No cards found',
      failed_load_cards: 'Failed to load cards',
      untitled: 'Untitled',
      unassigned: 'Unassigned',

      // Analytics page
      analytics_title: 'Analytics',
      analytics_desc: 'Overview of recordings and processing',
      analytics_recordings: 'Recordings',
      analytics_exported: 'Exported to YT',
      analytics_processed: 'processed',
      analytics_pending: 'Pending Export',
      analytics_error_rate: 'Error Rate',
      analytics_errors: 'errors',
      analytics_by_type: 'By Type',
      analytics_bugs: 'Bugs',
      analytics_features: 'Features',
      analytics_enhancements: 'Enhancements',
      analytics_by_author: 'By Author',
      analytics_recent: 'Recent Activity',
      analytics_no_recordings: 'No recordings yet',
      analytics_no_activity: 'No activity yet',
      analytics_recorded: 'recorded',
      failed_load_analytics: 'Failed to load analytics',

      // View analytics
      views: 'Views',
      view_count: 'views',
      view_analytics: 'View Analytics',
      total_views: 'Total Views',
      unique_viewers: 'Unique Viewers',
      avg_watch_time: 'Avg Watch Time',
      no_views_yet: 'No views yet. Share the report link to start tracking.',
      views_last_30: 'Views — Last 30 Days',
      analytics_views: 'Views',
      analytics_total_views: 'Total Views',
      analytics_unique_viewers: 'Unique Viewers',
      analytics_avg_watch: 'Avg Watch Time',
      analytics_top_recordings: 'Top Recordings by Views',
      analytics_views_over_time: 'Views Over Time',

      // Report page
      report_download: 'Download',

      // Login page
      login_subtitle: 'Screen Recording QA Tool',
      login_placeholder: 'Enter password',
      login_btn: 'Sign in',
      login_signing_in: 'Signing in...',
      login_wrong_password: 'Wrong password',
      login_connection_error: 'Connection error',
      login_footer: 'Screen recording \u2192 AI analysis \u2192 YouTrack',

      // Guide page
      guide_title: 'BugReel',
      guide_intro: 'Record your screen, describe with your voice \u2014 AI creates the card. Review and send to your issue tracker.',
      guide_contents: 'Contents',
      guide_install: 'Install the extension',
      guide_recording: 'Recording',
      guide_link: 'Link to an issue',
      guide_review: 'Review and send',
      guide_batch: 'Batch testing',
      guide_tips: 'Tips',
      guide_faq: 'FAQ',

      // YouTrack panel
      yt_search_placeholder: 'Search by ID or title...',
      yt_all_projects: 'All projects',
      yt_all_unresolved: 'All unresolved',
      yt_all_incl_resolved: 'All (incl. resolved)',
      yt_create_new: 'Create new issue',
      yt_send: 'Send',
      yt_pending_export: 'Pending export',

      // Environment / Context
      env_environment: 'Environment',
      env_crm_profile: 'CRM Profile',
      env_pages_visited: 'Pages visited',
      env_console: 'Console',
      env_actions: 'Actions',

      // Settings page
      nav_settings: 'Settings',
      settings_title: 'Settings',
      settings_tracker: 'Tracker Integration',
      settings_tracker_desc: 'Connect your issue tracker to export bug reports directly',
      settings_tracker_type: 'Tracker Type',
      settings_tracker_none: 'None',
      settings_tracker_youtrack: 'YouTrack',
      settings_tracker_jira: 'Jira',
      settings_tracker_github: 'GitHub Issues',
      settings_tracker_linear: 'Linear',
      settings_tracker_webhook: 'Webhook',
      settings_tracker_url: 'Server URL',
      settings_tracker_token: 'API Token',
      settings_tracker_project: 'Project',
      settings_tracker_repo: 'Repository (owner/repo)',
      settings_tracker_webhook_url: 'Webhook URL',
      settings_tracker_webhook_secret: 'Secret (optional)',
      settings_test: 'Test Connection',
      settings_save: 'Save',
      settings_saving: 'Saving...',
      settings_saved: 'Settings saved',
      settings_testing: 'Testing...',
      settings_connected: 'Connected',
      settings_not_configured: 'Not configured',
      settings_test_success: 'Connection successful',
      settings_test_failed: 'Connection failed',
      settings_tracker_url_hint_youtrack: 'e.g. https://your-instance.youtrack.cloud',
      settings_tracker_url_hint_jira: 'e.g. https://your-domain.atlassian.net',
      settings_connect: 'Connect',
      settings_reconnect: 'Reconnect',
      settings_disconnect: 'Disconnect integration',
      settings_select_project: '— Select project —',
      settings_project_updated: 'Project updated',
      settings_connecting: 'Connecting...',

      // Misc
      no_recording_id: 'No recording ID in URL',
      card_not_found: 'Card not found',
    },
    ru: {
      // Brand
      brand_name: 'BugReel',

      // Navigation
      nav_recordings: 'Записи',
      nav_analytics: 'Аналитика',
      nav_guide: 'Руководство',
      nav_cards: 'Карточки',

      // Index page
      index_title: 'Записи',
      index_desc: 'Записи экрана',
      filter_status: 'Статус',
      filter_all_statuses: 'Все',
      filter_author: 'Автор',
      filter_author_placeholder: 'Фильтр по автору...',
      filter_search_placeholder: 'Поиск записей...',
      filter_not_sent: 'Не отправлено в трекер',
      th_recording: 'Запись',
      th_author: 'Автор',
      th_date: 'Дата',
      th_status: 'Статус',
      th_duration: 'Длительность',
      no_recordings: 'Записи не найдены',
      failed_load_recordings: 'Не удалось загрузить записи',
      showing: 'Показано',
      of: 'из',

      // Recording detail
      back_to_recordings: 'К записям',
      key_moments: 'Ключевые моменты',
      no_key_frames: 'Нет ключевых кадров',
      processing_recording: 'Обработка записи...',
      extracting_audio: 'Извлечение аудио из видео...',
      transcribing_speech: 'Транскрибирование...',
      analyzing_transcript: 'Анализ с помощью AI...',
      extracting_frames: 'Извлечение скриншотов...',
      creating_card: 'Создание карточки...',
      done: 'Готово',
      processing_error: 'Ошибка обработки',
      try_again: 'Попробуйте загрузить запись повторно',
      description: 'Описание',
      transcript: 'Транскрипт',
      context: 'Контекст',
      no_analysis: 'Нет данных анализа',
      no_transcript: 'Нет транскрипта',
      no_context: 'Контекстные данные не захвачены. Обновите расширение Chrome для захвата URL и ошибок консоли.',
      edit: 'Редактировать',
      save: 'Сохранить',
      cancel: 'Отмена',
      edit_description: 'Редактирование описания',
      title: 'Заголовок',
      type: 'Тип',
      copied: 'Скопировано',
      deleting: 'Удаление...',
      saving: 'Сохранение...',
      saved: 'Сохранено',
      extracting_frame: 'Извлечение кадра...',

      // Status labels
      status_uploaded: 'Загружено',
      status_audio_extracted: 'Аудио извлечено',
      status_transcribing: 'Транскрибируется',
      status_transcribed: 'Транскрибировано',
      status_analyzed: 'Проанализировано',
      status_frames_extracted: 'Кадры извлечены',
      status_compressing: 'Сжатие',
      status_complete: 'Готово',
      status_error: 'Ошибка',
      status_draft: 'Черновик',
      status_scored: 'Оценено',
      status_done: 'Готово',

      // Card types
      type_bug: 'Баг',
      type_feature: 'Запрос фичи',
      type_enhancement: 'Улучшение',
      type_demo: 'Демо',

      // CS categories
      cs_easy: 'Простая',
      cs_medium: 'Средняя',
      cs_hard: 'Сложная',
      cs_critical: 'Критическая',

      // Priority
      priority_low: 'Низкий',
      priority_medium: 'Средний',
      priority_high: 'Высокий',
      priority_urgent: 'Срочный',

      // Analysis fields
      steps_to_reproduce: 'Шаги воспроизведения',
      expected_result: 'Ожидаемое поведение',
      actual_result: 'Фактическое поведение',
      proposal: 'Предложение',
      use_case: 'Сценарий использования',
      current_behavior: 'Текущее поведение',
      proposed_change: 'Предлагаемое изменение',
      key_points: 'Ключевые моменты',
      details: 'Детали',

      // Cards page
      cards_title: 'Очередь карточек',
      cards_desc: 'Карточки задач из записей',
      filter_priority: 'Приоритет',
      filter_all_priorities: 'Все',
      filter_assigned: 'Назначено',
      filter_assigned_placeholder: 'Фильтр по исполнителю...',
      sort_by: 'Сортировка',
      sort_date: 'Дата',
      sort_cs: 'CS Score',
      sort_priority: 'Приоритет',
      no_cards: 'Карточки не найдены',
      failed_load_cards: 'Не удалось загрузить карточки',
      untitled: 'Без названия',
      unassigned: 'Не назначено',

      // Analytics page
      analytics_title: 'Аналитика',
      analytics_desc: 'Обзор записей и обработки',
      analytics_recordings: 'Записи',
      analytics_exported: 'Экспорт в YT',
      analytics_processed: 'обработано',
      analytics_pending: 'Ожидают экспорта',
      analytics_error_rate: 'Ошибки',
      analytics_errors: 'ошибок',
      analytics_by_type: 'По типу',
      analytics_bugs: 'Баги',
      analytics_features: 'Фичи',
      analytics_enhancements: 'Улучшения',
      analytics_by_author: 'По автору',
      analytics_recent: 'Последняя активность',
      analytics_no_recordings: 'Записей пока нет',
      analytics_no_activity: 'Активности пока нет',
      analytics_recorded: 'записал',
      failed_load_analytics: 'Не удалось загрузить аналитику',

      // View analytics
      views: 'Просмотры',
      view_count: 'просмотров',
      view_analytics: 'Аналитика просмотров',
      total_views: 'Всего просмотров',
      unique_viewers: 'Уникальных зрителей',
      avg_watch_time: 'Среднее время просмотра',
      no_views_yet: 'Пока нет просмотров. Поделитесь ссылкой на отчёт.',
      views_last_30: 'Просмотры за 30 дней',
      analytics_views: 'Просмотры',
      analytics_total_views: 'Всего просмотров',
      analytics_unique_viewers: 'Уникальных зрителей',
      analytics_avg_watch: 'Среднее время просмотра',
      analytics_top_recordings: 'Топ записей по просмотрам',
      analytics_views_over_time: 'Просмотры за период',

      // Report page
      report_download: 'Скачать',

      // Login page
      login_subtitle: 'Инструмент записи экрана для QA',
      login_placeholder: 'Введите пароль',
      login_btn: 'Войти',
      login_signing_in: 'Вход...',
      login_wrong_password: 'Неверный пароль',
      login_connection_error: 'Ошибка соединения',
      login_footer: 'Запись экрана \u2192 AI-анализ \u2192 YouTrack',

      // Guide page
      guide_title: 'BugReel',
      guide_intro: 'Записывайте экран, комментируйте голосом \u2014 AI создаст карточку. Проверьте и отправьте в трекер задач.',
      guide_contents: 'Содержание',
      guide_install: 'Установка расширения',
      guide_recording: 'Запись',
      guide_link: 'Привязка к задаче',
      guide_review: 'Проверка и отправка',
      guide_batch: 'Пакетное тестирование',
      guide_tips: 'Советы',
      guide_faq: 'FAQ',

      // YouTrack panel
      yt_search_placeholder: 'Поиск по ID или названию...',
      yt_all_projects: 'Все проекты',
      yt_all_unresolved: 'Все нерешённые',
      yt_all_incl_resolved: 'Все (вкл. решённые)',
      yt_create_new: 'Создать новую задачу',
      yt_send: 'Отправить',
      yt_pending_export: 'Ожидает экспорта',

      // Environment / Context
      env_environment: 'Окружение',
      env_crm_profile: 'Профиль CRM',
      env_pages_visited: 'Посещённые страницы',
      env_console: 'Консоль',
      env_actions: 'Действия',

      // Settings page
      nav_settings: 'Настройки',
      settings_title: 'Настройки',
      settings_tracker: 'Интеграция с трекером',
      settings_tracker_desc: 'Подключите трекер задач для экспорта баг-репортов',
      settings_tracker_type: 'Тип трекера',
      settings_tracker_none: 'Не подключен',
      settings_tracker_youtrack: 'YouTrack',
      settings_tracker_jira: 'Jira',
      settings_tracker_github: 'GitHub Issues',
      settings_tracker_linear: 'Linear',
      settings_tracker_webhook: 'Webhook',
      settings_tracker_url: 'URL сервера',
      settings_tracker_token: 'API-токен',
      settings_tracker_project: 'Проект',
      settings_tracker_repo: 'Репозиторий (owner/repo)',
      settings_tracker_webhook_url: 'URL вебхука',
      settings_tracker_webhook_secret: 'Секрет (необязательно)',
      settings_test: 'Проверить подключение',
      settings_save: 'Сохранить',
      settings_saving: 'Сохранение...',
      settings_saved: 'Настройки сохранены',
      settings_testing: 'Проверка...',
      settings_connected: 'Подключено',
      settings_not_configured: 'Не настроено',
      settings_test_success: 'Подключение успешно',
      settings_test_failed: 'Ошибка подключения',
      settings_tracker_url_hint_youtrack: 'напр. https://your-instance.youtrack.cloud',
      settings_tracker_url_hint_jira: 'напр. https://your-domain.atlassian.net',
      settings_connect: 'Подключить',
      settings_reconnect: 'Переподключить',
      settings_disconnect: 'Отключить интеграцию',
      settings_select_project: '— Выберите проект —',
      settings_project_updated: 'Проект обновлён',
      settings_connecting: 'Подключение...',

      // Misc
      no_recording_id: 'Нет ID записи в URL',
      card_not_found: 'Карточка не найдена',
    },
  };

  // Detect language: query param > localStorage > navigator.language > 'en'
  function detectLang() {
    // ?lang=ru query param
    const urlParams = new URLSearchParams(window.location.search);
    const paramLang = urlParams.get('lang');
    if (paramLang && translations[paramLang]) return paramLang;

    // localStorage
    const stored = localStorage.getItem('bugreel-lang');
    if (stored && translations[stored]) return stored;

    // navigator.language
    const navLang = (navigator.language || '').slice(0, 2).toLowerCase();
    if (translations[navLang]) return navLang;

    return 'en';
  }

  const lang = detectLang();
  const msgs = translations[lang] || translations.en;
  const fallbackMsgs = translations.en;

  /**
   * Translate a key. Returns translated string, or fallback, or key.
   */
  function t(key, fallback) {
    return msgs[key] || fallback || fallbackMsgs[key] || key;
  }

  /**
   * Apply translations to all data-i18n and data-i18n-html elements in the DOM.
   */
  function translatePage() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var attr = el.getAttribute('data-i18n-attr');
      var msg = t(key);
      if (msg !== key) {
        if (attr) {
          el.setAttribute(attr, msg);
        } else {
          el.textContent = msg;
        }
      }
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      var msg = t(key);
      if (msg !== key) {
        el.innerHTML = msg;
      }
    });
  }

  /**
   * Set language and reload.
   */
  function setLang(newLang) {
    localStorage.setItem('bugreel-lang', newLang);
    window.location.reload();
  }

  // Auto-translate on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', translatePage);
  } else {
    translatePage();
  }

  // Export
  window.__dashboardI18n = { t: t, translatePage: translatePage, lang: lang, setLang: setLang };
})();

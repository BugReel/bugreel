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
      delete: 'Delete',
      delete_recording: 'Delete recording',
      delete_confirm_text: 'Are you sure you want to delete',
      delete_warning: 'Video, frames, and all associated data will be permanently removed.',
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

      // Guide page — navigation & headings
      guide_title: 'BugReel',
      guide_intro: 'Record your screen, describe with your voice \u2014 AI creates the card. Review and send to your issue tracker.',
      guide_contents: 'Contents',
      guide_install: 'Install the extension',
      guide_recording: 'Recording',
      guide_review: 'Review & share',
      guide_tracker: 'Issue tracker',
      guide_tips: 'Tips',
      guide_faq: 'FAQ',
      // Guide page — section content (data-i18n-html keys omitted in en: HTML fallback used)

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

      // Branding
      settings_branding: 'Branding',
      settings_branding_desc: 'Custom name and logo on dashboard, embed player, and public pages. Leave empty for defaults.',
      settings_branding_name: 'Brand Name',
      settings_branding_name_hint: 'Displayed in header, page titles, and embed player',
      settings_branding_logo_url: 'Logo URL',
      settings_branding_logo_hint: 'PNG, SVG or JPG. Recommended height: 28-40px',
      settings_branding_logo_link: 'Logo Link URL',
      settings_branding_link_hint: 'Where clicking the logo navigates to',

      // Quota & Storage
      quota_storage_section: 'Storage & Subscription',
      quota_storage_section_desc: 'Current usage, plan limits, and subscription status',
      quota_storage: 'Storage',
      quota_recordings: 'Recordings',
      quota_retention: 'Retention',
      quota_retention_days: 'days',
      quota_retention_unlimited: 'Unlimited',
      quota_retention_warn: 'Old recordings auto-deleted',
      quota_retention_auto: 'Auto-deleted after this period',
      quota_unlimited: 'Unlimited',
      quota_used: 'used',
      quota_plan_free: 'Free',
      quota_plan_standard: 'Standard',
      quota_plan_pro: 'Pro',
      quota_plan_business: 'Business',
      quota_upgrade: 'Upgrade plan',
      quota_ai_transcriptions: 'AI Transcriptions',
      quota_ai_analyses: 'AI Analyses',
      quota_per_month: '/mo',
      quota_deletes_in: 'Deletes in {n}d',

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
      delete: 'Удалить',
      delete_recording: 'Удаление записи',
      delete_confirm_text: 'Вы уверены, что хотите удалить',
      delete_warning: 'Видео, кадры и все связанные данные будут удалены безвозвратно.',
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

      // Guide page — navigation & headings
      guide_title: 'BugReel',
      guide_intro: 'Записывайте экран, комментируйте голосом \u2014 AI создаст карточку. Проверьте и отправьте в трекер задач.',
      guide_contents: 'Содержание',
      guide_install: 'Установка расширения',
      guide_recording: 'Запись',
      guide_review: 'Просмотр и шеринг',
      guide_tracker: 'Трекер задач',
      guide_tips: 'Советы',
      guide_faq: 'FAQ',

      // Guide page — section content
      guide_s1_browser: 'Расширение работает в <strong>Chrome</strong> и <strong>Firefox</strong>. Выберите браузер:',
      guide_chrome_dl: 'Скачать для Chrome (ZIP)',
      guide_chrome_steps: '<li><strong>Распакуйте архив</strong> в любую папку</li><li>Откройте в Chrome: <code>chrome://extensions</code></li><li>Включите <strong>Режим разработчика</strong> (справа вверху)</li><li>Нажмите <strong>\u00abЗагрузить распакованное расширение\u00bb</strong></li><li>Выберите папку <code>extension</code> из архива</li><li>Закрепите расширение: иконка пазла \u2192 закрепить <span class="brand-name">BugReel</span></li>',
      guide_chrome_mic_note: '<strong>Микрофон \u2014 проверьте сразу после установки!</strong>После установки откройте расширение, включите <strong>Микрофон</strong> и убедитесь, что Chrome запросил разрешение. Если запроса не было (особенно на <strong>Windows</strong>) \u2014 перезапустите расширение: <code>chrome://extensions</code> \u2192 выключите <span class="brand-name">BugReel</span> \u2192 включите снова.<br><br><em>Перезапуск браузера не поможет \u2014 нужно перезапустить именно расширение (выкл/вкл).</em>',
      guide_firefox_dl: 'Скачать для Firefox (ZIP)',
      guide_firefox_steps: '<li><strong>Распакуйте архив</strong> в любую папку</li><li>Откройте в Firefox: <code>about:debugging#/runtime/this-firefox</code></li><li>Нажмите <strong>\u00abЗагрузить временное дополнение\u00bb</strong></li><li>Выберите файл <code>manifest.json</code> из распакованной папки</li><li>Расширение появится на панели \u2014 закрепите его (иконка пазла)</li>',
      guide_firefox_temp_note: '<strong>Временное расширение</strong>В Firefox расширение загружается как \u00abвременное\u00bb \u2014 оно будет удалено при перезапуске Firefox. После перезапуска нужно загрузить его снова через <code>about:debugging</code>.',
      guide_firefox_perms_title: 'Настройка разрешений (первый раз)',
      guide_firefox_perms_intro: 'При первой установке автоматически откроется <strong>страница настройки</strong>. Выполните 2 шага:',
      guide_firefox_step1_title: 'Шаг 1. Микрофон',
      guide_firefox_step1_text: 'Нажмите <strong>\u00abРазрешить микрофон\u00bb</strong> \u2192 дайте разрешение в диалоге браузера. После этого появится индикатор уровня \u2014 скажите что-нибудь, полоска должна реагировать.',
      guide_firefox_step2_title: 'Шаг 2. Запись экрана (macOS)',
      guide_firefox_step2_text: 'macOS требует отдельное разрешение для Firefox на запись экрана.',
      guide_firefox_step2_open: 'Откройте <strong>Системные настройки \u2192 Конфиденциальность и безопасность \u2192 Запись экрана</strong> и включите переключатель для Firefox:',
      guide_firefox_step2_restart: 'macOS попросит перезапустить Firefox \u2014 нажмите <strong>\u00abПерезапустить\u00bb</strong>:',
      guide_firefox_onetime_note: '<strong>Это настраивается один раз</strong>После перезапуска Firefox разрешения сохранятся. Повторная настройка не потребуется.',
      guide_firefox_diff_title: 'Отличия от Chrome',
      guide_firefox_diff_list: '<li><strong>Во время записи открывается вкладка \u00abRecorder\u00bb</strong> \u2014 не закрывайте её, пока идёт запись. Она автоматически уходит на задний план.</li><li><strong>Firefox показывает системный выбор источника</strong> (вкладка / окно / весь экран) \u2014 это нормально.</li><li><strong>Захват вкладки</strong> работает через общий диалог выбора (в Chrome это происходит автоматически).</li>',
      guide_preflight_title: 'Проверка перед работой',
      guide_preflight_text: 'Сделайте <strong>короткую тестовую запись</strong> (5\u201310 сек) со звуком и убедитесь, что голос записался. Это поможет не потерять первую рабочую запись.',
      guide_record_steps: '<li>Откройте страницу, которую тестируете</li><li>Нажмите на иконку <span class="brand-name">BugReel</span> в панели браузера</li><li>Выберите <strong>своё имя</strong> (Автор)</li><li>Источник: <strong>Вкладка</strong> или <strong>Экран</strong></li><li>Убедитесь, что <strong>Микрофон</strong> включён</li><li>Нажмите <strong>Начать запись</strong></li><li><strong>Комментируйте вслух</strong>, что делаете и что видите</li><li>Нажмите <strong>Стоп</strong> \u2014 видео загрузится автоматически</li>',
      guide_record_golden_note: '<strong>Главное правило: комментируйте вслух</strong>AI создаёт описание из вашего голоса. Чем конкретнее вы говорите \u2014 тем точнее карточка.<br><br><em>\u00abНажимаю сюда, не работает\u00bb</em> \u2014 плохо<br><em>\u00abНажимаю Сохранить в форме сотрудника, ожидаю сохранения, но форма зависает\u00bb</em> \u2014 хорошо',
      guide_review_intro: 'Когда обработка завершена (30\u201360 сек), на странице записи появится AI-карточка:',
      guide_review_steps: '<li>Проверьте <strong>заголовок</strong> и <strong>описание</strong> \u2014 отредактируйте при необходимости</li><li>Посмотрите <strong>скриншоты</strong> \u2014 добавьте ещё кликом по таймлайну</li><li>Нажмите <strong>Поделиться</strong> для копирования публичной ссылки</li><li>Или <strong>Embed</strong> для генерации iframe-кода</li>',
      guide_review_share_note: '<strong>Публичная ссылка</strong>Каждая запись получает уникальный URL. Любой с этой ссылкой может посмотреть видео, AI-карточку и скриншоты \u2014 без авторизации. Можно также защитить паролем.',
      guide_tracker_intro: 'Если подключён трекер задач (Настройки \u2192 Интеграция с трекером), можно отправлять AI-карточки напрямую:',
      guide_tracker_steps: '<li>Нажмите кнопку <strong>Трекер задач</strong> на странице записи</li><li>Найдите существующую задачу \u2014 или создайте новую</li><li>Проверьте AI-карточку \u2192 нажмите <strong>Отправить</strong></li>',
      guide_tracker_supported: 'Поддерживаемые трекеры: <strong>YouTrack</strong>, <strong>Jira</strong>, <strong>GitHub Issues</strong>, <strong>Linear</strong> и <strong>Webhook</strong>.',
      guide_tips_list: '<li><strong>1 запись = 1 задача.</strong> Три коротких видео лучше одного длинного.</li><li><strong>Показывайте путь.</strong> AI зафиксирует URL и навигацию.</li><li><strong>Ошибки консоли записываются автоматически.</strong> Не нужно открывать DevTools.</li><li><strong>Можно добавить скриншоты.</strong> Кликните по таймлайну в нужный момент.</li>',
      guide_faq_noaudio_q: 'Нет звука в записи',
      guide_faq_noaudio_a: '<li>Включён ли Микрофон в расширении? Двигается ли индикатор уровня (полоска)?</li><li><strong>Chrome:</strong> Chrome дал разрешение на микрофон? Если нет \u2014 перезапустите расширение: <code>chrome://extensions</code> \u2192 выкл/вкл <span class="brand-name">BugReel</span></li><li><strong>Firefox:</strong> Откройте настройку расширения (ссылка \u00abFirefox Setup\u00bb внизу попапа) и пройдите шаг 1.</li><li><strong>Windows:</strong> Chrome может не запросить микрофон автоматически. После перезапуска расширения откройте его снова и включите Микрофон \u2014 должен появиться запрос.</li>',
      guide_faq_slow_q: 'Обработка длится больше 3 минут',
      guide_faq_slow_a: 'Обновите страницу. Если статус \u00aberror\u00bb \u2014 запишите заново.',
      guide_faq_cantfind_q: 'Не могу найти задачу',
      guide_faq_cantfind_a: 'Сбросьте фильтры: Все пользователи + Все проекты + Все (вкл. решённые). Или введите ID в поиске.',
      guide_faq_edit_q: 'Можно редактировать карточку?',
      guide_faq_edit_a: 'Да, нажмите Редактировать \u2014 заголовок, тип, описание.',
      guide_faq_recorder_q: 'Firefox: зачем вкладка Recorder?',
      guide_faq_recorder_a: 'Firefox не поддерживает offscreen API (в отличие от Chrome). Запись экрана может работать только в активной вкладке. Вкладка \u00abRecorder\u00bb автоматически уходит на задний план после начала записи. <strong>Не закрывайте её</strong> \u2014 запись остановится.',
      guide_faq_disappeared_q: 'Firefox: расширение пропало после перезапуска',
      guide_faq_disappeared_a: 'Временные расширения в Firefox сбрасываются при перезапуске. Загрузите снова: <code>about:debugging</code> \u2192 \u00abЗагрузить временное дополнение\u00bb \u2192 выберите <code>manifest.json</code>.',

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

      // Branding
      settings_branding: 'Брендирование',
      settings_branding_desc: 'Название и логотип в дашборде, плеере и на публичных страницах. Оставьте пустым для значений по умолчанию.',
      settings_branding_name: 'Название',
      settings_branding_name_hint: 'Отображается в заголовке, титулах страниц и в плеере',
      settings_branding_logo_url: 'URL логотипа',
      settings_branding_logo_hint: 'PNG, SVG или JPG. Рекомендуемая высота: 28-40px',
      settings_branding_logo_link: 'Ссылка при клике на логотип',
      settings_branding_link_hint: 'Куда ведёт клик по логотипу',

      // Quota & Storage
      quota_storage_section: 'Хранилище и подписка',
      quota_storage_section_desc: 'Текущее использование, лимиты и статус подписки',
      quota_storage: 'Хранилище',
      quota_recordings: 'Записи',
      quota_retention: 'Хранение',
      quota_retention_days: 'дн.',
      quota_retention_unlimited: 'Безлимит',
      quota_retention_warn: 'Старые записи удаляются автоматически',
      quota_retention_auto: 'Автоудаление после этого периода',
      quota_unlimited: 'Безлимит',
      quota_used: 'использовано',
      quota_plan_free: 'Бесплатный',
      quota_plan_standard: 'Стандарт',
      quota_plan_pro: 'Про',
      quota_plan_business: 'Бизнес',
      quota_upgrade: 'Улучшить план',
      quota_ai_transcriptions: 'AI-транскрипции',
      quota_ai_analyses: 'AI-анализ',
      quota_per_month: '/мес',
      quota_deletes_in: 'Удалится через {n}д',

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

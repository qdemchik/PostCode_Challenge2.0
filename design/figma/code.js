/* Screen definitions for the Figma plugin. */
const width = 1440;
const height = 900;
const palette = {
  base: '#101827', sidebar: '#131E30', surface: '#19263A', inset: '#121D2E',
  line: '#344560', text: '#F1F5FC', sub: '#B3C1D7', faint: '#92A7C4',
  blue: '#9ABFFF', blueSurface: '#223A60', primary: '#ADC8FF', primaryText: '#0D2448',
  green: '#7EE2B5', greenSurface: '#153C35', amber: '#FFCF81', amberSurface: '#423322',
  red: '#FFB4B8', redSurface: '#472A35',
};
const barcode = 'IN261116000001';
const alternate = 'IN261116000002';
const container = '2611261140000001';
const otherContainer = '2611261140000004';
const documentId = '2611261140000008';
const nav = [
  ['desk', 'Рабочий стол', 'grid'], ['scan', 'Сборка', 'scan'], ['plan', 'План рейса', 'list'],
  ['containers', 'Ёмкости', 'box'], ['finish', 'Завершение', 'check'], ['review', 'Разбор', 'alert'],
  ['search', 'Поиск', 'search'], ['print', 'Печать', 'print'],
];
const iconPaths = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  scan: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5m4-7v8m4-8v8m4-8v8',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0l9 4 9-4m-9 4v10',
  check: 'M7 12l3 3 7-7M4 4h16v16H4z',
  alert: 'M12 3l10 17H2L12 3zm0 6v4m0 3h.1',
  search: 'M16 16l5 5M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  print: 'M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zm9-3h.1',
};

const box = (name, x, y, w, h, fill = 'surface', stroke = 'line', radius = 12, to) =>
  ({ type: 'box', name, x, y, w, h, fill, stroke, radius, to });
const text = (value, x, y, size = 15, tone = 'text', weight = 'Regular', w = 900) =>
  ({ type: 'text', name: value, value, x, y, size, tone, weight, w });
const icon = (name, x, y, tone = 'sub') => ({ type: 'icon', name, x, y, tone });
const line = (x, y, w) => box('Разделитель', x, y, w, 1, 'line', null, 0);

function button(label, x, y, w, to, style = 'primary') {
  const fill = style === 'primary' ? 'primary' : style === 'disabled' ? 'inset' : 'surface';
  const tone = style === 'primary' ? 'primaryText' : style === 'disabled' ? 'faint' : 'text';
  return [box(label, x, y, w, 44, fill, style === 'primary' ? null : 'line', 8, to),
    text(label, x + 14, y + 12, 14, tone, 'Medium', w - 22)];
}

function badge(label, x, y, w, tone = 'blue') {
  return [box(label, x, y, w, 28, tone + 'Surface', null, 6),
    text(label, x + 9, y + 6, 12, tone, 'Medium', w - 14)];
}

function field(label, value, x, y, w, options = {}) {
  return [
    text(label, x, y, 13, 'sub', 'Medium', w),
    box(label, x, y + 24, w, 46, 'inset', options.focus ? 'blue' : 'line', 8, options.to),
    text(value, x + 13, y + 37, 15, options.placeholder ? 'faint' : 'text', 'Regular', w - 22),
  ];
}

function note(title, detail, x, y, w, severity = 'blue') {
  return [
    box(title, x, y, w, 82, severity + 'Surface', null, 9),
    box('Маркер состояния', x, y + 10, 3, 62, severity, null, 1),
    text(title, x + 18, y + 13, 16, severity, 'Semi Bold', w - 34),
    text(detail, x + 18, y + 42, 14, 'text', 'Regular', w - 34),
  ];
}

function panel(title, x, y, w, h, content) {
  return [box(title, x, y, w, h), text(title, x + 20, y + 18, 17, 'text', 'Semi Bold', w - 40), ...content];
}

function table(x, y, w, columns, rows) {
  return [
    box('Шапка таблицы', x, y, w, 40, 'inset', null, 6),
    ...columns.map(([label, left, span]) => text(label, x + left, y + 11, 12, 'sub', 'Medium', span)),
    ...rows.flatMap((row, index) => [
      line(x, y + 91 + index * 52, w),
      ...row.map((value, col) => {
        const [, left, span] = columns[col];
        const [label, tone] = Array.isArray(value) ? value : [value, 'text'];
        return text(label, x + left, y + 56 + index * 52, 14, tone, 'Regular', span);
      }),
    ]),
  ];
}

function shell(active, title, subtitle, trip = 'Утренний рейс') {
  return [
    box('Навигация', 0, 0, 224, height, 'sidebar', null, 0),
    box('Знак рабочего места', 24, 23, 32, 32, 'primary', null, 8),
    icon('box', 29, 28, 'primaryText'),
    text('Исходящая почта', 68, 24, 15, 'text', 'Semi Bold', 146),
    text('ОПС 114000', 68, 45, 12, 'sub', 'Regular', 136),
    ...nav.flatMap(([key, label, symbol], index) => {
      const y = 103 + index * 49;
      return [
        box(label, 16, y, 192, 42, active === key ? 'blueSurface' : 'sidebar', null, 7, key),
        icon(symbol, 26, y + 10, active === key ? 'blue' : 'sub'),
        text(label, 60, y + 11, 14, active === key ? 'text' : 'sub', 'Medium', 140),
      ];
    }),
    text('РАБОЧИЙ РЕЙС', 256, 11, 12, 'sub', 'Semi Bold', 150),
    ...button('Без рейса', 256, 30, 104, 'desk', 'secondary'),
    box(trip, 368, 30, 176, 44, 'blueSurface', null, 8, 'plan'),
    text(trip, 382, 42, 14, 'text', 'Medium', 148),
    ...button('Новый рейс', 1014, 30, 112, undefined, 'secondary'),
    ...button('Переименовать', 1134, 30, 140, undefined, 'secondary'),
    ...button('План рейса', 1282, 30, 126, 'plan', 'secondary'),
    line(256, 86, 1152),
    text(title, 256, 103, 32, 'text', 'Bold', 1120),
    text(subtitle, 256, 154, 15, 'sub', 'Regular', 1120),
  ];
}

const screens = [
  {
    id: 'desk', name: '01 · Рабочий стол', nodes: [
      ...shell('desk', 'Рабочий стол', 'Подготовьте план отправки и начните сборку.'),
      ...panel('Текущий рейс', 256, 207, 728, 246, [
        text('Утренний рейс', 276, 277, 28, 'text', 'Bold', 530),
        text('2 отправления в плане · 1 уже вложено', 276, 325, 15, 'sub', 'Regular', 590),
        ...button('Начать сборку', 276, 382, 156, 'scan'),
        ...button('Открыть план рейса', 444, 382, 186, 'plan', 'secondary'),
      ]),
      ...panel('Проверить перед вывозом', 1008, 207, 400, 246, [
        text('Ожидает вложения', 1028, 272, 15, 'sub', 'Regular', 260),
        text('1', 1351, 267, 22, 'text', 'Bold', 42),
        text('На разборе', 1028, 318, 15, 'sub', 'Regular', 260),
        text('0', 1351, 313, 22, 'text', 'Bold', 42),
        ...button('Сводка готовности', 1028, 382, 185, 'finish', 'secondary'),
      ]),
      ...panel('Последняя операция', 256, 478, 1152, 156,
        table(276, 530, 1112, [['Время', 12, 140], ['ШПИ', 160, 250], ['Операция', 434, 300], ['Ёмкость', 774, 280]],
          [['10:14', barcode, 'Вложено', container]])),
    ],
  },
  {
    id: 'scan', name: '02 · Сборка / ввод ШПИ', nodes: [
      ...shell('scan', 'Сборка исходящей почты', 'Отсканируйте ШПИ или введите его вручную.'),
      ...panel('Найти отправление', 256, 207, 752, 257, [
        ...field('ШПИ отправления', barcode, 276, 271, 710, { focus: true, to: 'verify' }),
        ...button('Найти · Enter', 276, 365, 149, 'verify'),
        ...button('Быстрая сборка · вкл.', 437, 365, 196, 'fast', 'secondary'),
      ]),
      ...panel('Ёмкости рейса', 1032, 207, 376, 257, [
        text(container, 1052, 269, 19, 'text', 'Semi Bold', 316),
        text('Мешок · Заказная · 108980', 1052, 313, 14, 'sub', 'Regular', 316),
        text('12,4 / 32 кг', 1052, 343, 15, 'text', 'Medium', 316),
        ...button('Открыть ёмкости', 1052, 385, 171, 'containers', 'secondary'),
      ]),
      ...panel('Проверить исключение', 256, 488, 752, 134, [
        ...button('ШПИ из другого рейса', 276, 551, 210, 'wrong', 'secondary'),
        ...button('Неизвестный ШПИ', 500, 551, 188, 'missing', 'secondary'),
      ]),
    ],
  },
  {
    id: 'verify', name: '03 · Сборка / проверка данных', nodes: [
      ...shell('scan', 'Проверка отправления', barcode + ' · Возврат · источник: входящая почта'),
      ...panel('Данные отправления', 256, 207, 816, 487, [
        ...field('Получатель', 'Никитина Николай', 276, 268, 370),
        ...field('Населённый пункт', 'Московская область', 664, 268, 388),
        ...field('Адрес', 'пр. Мира, д. 72, кв. 168', 276, 360, 776),
        ...field('Индекс назначения', '140961', 276, 452, 370, { focus: true }),
        ...field('Масса, г', '19', 664, 452, 388),
        ...button('Подтвердить и вложить', 276, 620, 218, 'fast'),
        ...button('К сканированию', 508, 620, 164, 'scan', 'secondary'),
      ]),
      ...panel('Подбор ёмкости', 1096, 207, 312, 282, [
        ...badge('В плане рейса', 1116, 264, 110, 'green'),
        text('Направление ёмкости', 1116, 316, 13, 'sub', 'Regular', 269),
        text('108980', 1116, 339, 30, 'text', 'Bold', 270),
        text('Направление ф.23а · 108970', 1116, 398, 14, 'sub', 'Regular', 270),
      ]),
    ],
  },
  {
    id: 'fast', name: '04 · Сборка / вложено', nodes: [
      ...shell('scan', 'Быстрая сборка', 'Результат проверки появляется сразу после подтверждения.'),
      ...panel('Вложение подтверждено', 256, 207, 1152, 307, [
        ...badge('Вложено', 276, 265, 76, 'green'),
        text('Ёмкость для укладки', 276, 318, 17, 'sub', 'Medium', 650),
        text(container, 273, 352, 54, 'text', 'Bold', 900),
        text('Отправление ' + barcode + ' · 19 г', 276, 435, 15, 'sub', 'Regular', 900),
      ]),
      ...panel('Следующее отправление', 256, 538, 1152, 179, [
        ...field('ШПИ', 'Сканируйте или введите номер', 276, 601, 824, { focus: true, placeholder: true, to: 'scan' }),
        ...button('Продолжить', 1120, 625, 145, 'scan'),
      ]),
    ],
  },
  {
    id: 'wrong', name: '05 · Исключение / чужой рейс', nodes: [
      ...shell('scan', 'Проверка отправления', barcode + ' · Возврат · источник: входящая почта', 'Вечерний рейс'),
      ...note('ШПИ запланирован на «Утренний рейс»',
        'Переключите рабочий рейс или продолжите сборку со следующим отправлением.', 256, 207, 1152, 'red'),
      ...panel('Текущее отправление', 256, 313, 756, 232, [
        text(barcode, 276, 371, 28, 'text', 'Bold', 670),
        ...badge('Вложение заблокировано', 276, 422, 181, 'red'),
        ...button('К сканированию', 276, 472, 165, 'scan'),
        ...button('Открыть план рейса', 454, 472, 190, 'plan', 'secondary'),
      ]),
    ],
  },
  {
    id: 'missing', name: '06 · Исключение / ШПИ не найден', nodes: [
      ...shell('scan', 'Сборка исходящей почты', 'Проверьте ШПИ или отложите отправление на разбор.'),
      ...panel('Найти отправление', 256, 207, 1152, 325, [
        ...field('ШПИ отправления', 'IN000000000000', 276, 269, 764, { focus: true }),
        ...note('Отправление не найдено', 'Повторите скан или исправьте номер. На разборе сохранится причина.',
          276, 356, 1108, 'amber'),
        ...button('Отложить на разбор', 276, 462, 199, 'review'),
        ...button('Повторить поиск', 489, 462, 158, 'scan', 'secondary'),
      ]),
    ],
  },
  {
    id: 'plan', name: '07 · План рейса', nodes: [
      ...shell('plan', 'План рейса', 'Подготовьте список отправлений, которые должны уехать этим рейсом.'),
      ...panel('Включить отправление', 256, 207, 1152, 176, [
        ...field('ШПИ', 'Отсканируйте или введите номер', 276, 264, 734, { placeholder: true, focus: true }),
        ...button('Включить в план', 1028, 288, 173, 'plan'),
      ]),
      ...panel('Запланированные отправления', 256, 406, 1152, 240, [
        ...table(276, 460, 1112, [['ШПИ', 12, 245], ['Вид', 285, 215], ['Состояние', 550, 220], ['Ёмкость', 803, 240]],
          [[barcode, 'Письмо', ['Вложено', 'green'], container], [alternate, 'Посылка', ['Ожидает вложения', 'amber'], '—']]),
        ...button('К сборке', 276, 587, 120, 'scan', 'secondary'),
      ]),
    ],
  },
  {
    id: 'containers', name: '08 · Ёмкости / карточка', nodes: [
      ...shell('containers', 'Ёмкости', 'Проверьте состав и реквизиты тары перед закрытием.'),
      ...panel('Ёмкости рабочего рейса', 256, 207, 508, 282,
        table(276, 267, 468, [['Идентификатор', 10, 163], ['Напр.', 175, 72], ['Масса', 260, 76], ['Статус', 346, 120]],
          [[container, '108980', '12,4 кг', ['Открыта', 'blue']]])),
      ...panel('Карточка ёмкости', 788, 207, 620, 471, [
        text(container, 808, 267, 26, 'text', 'Bold', 560),
        text('Мешок · Заказная · направление 108980', 808, 324, 15, 'sub', 'Regular', 560),
        ...field('Номер тары', 'Т-01', 808, 367, 264),
        ...field('Номер пломбы', 'П-014', 1090, 367, 296),
        text('Масса брутто', 808, 466, 14, 'sub', 'Regular', 240),
        text('12,4 / 32 кг', 808, 497, 29, 'text', 'Semi Bold', 485),
        ...button('Закрыть ёмкость', 808, 600, 176, 'finish'),
        ...button('Изменить реквизиты', 998, 600, 192, 'containers', 'secondary'),
      ]),
    ],
  },
  {
    id: 'finish', name: '09 · Завершение / сводка и ф.23а', nodes: [
      ...shell('finish', 'Завершение', 'Оформите накладную и проверьте готовность выбранного рейса.'),
      ...panel('Сводка готовности', 256, 207, 1152, 250, [
        text('Запланировано', 276, 269, 14, 'sub', 'Medium', 224),
        text('2', 276, 302, 33, 'text', 'Bold', 100),
        text('Вложено по плану', 531, 269, 14, 'sub', 'Medium', 224),
        text('2 из 2', 531, 302, 33, 'green', 'Bold', 168),
        text('Закрытые ёмкости', 784, 269, 14, 'sub', 'Medium', 232),
        text('1', 784, 302, 33, 'text', 'Bold', 100),
        text('На разборе', 1044, 269, 14, 'sub', 'Medium', 224),
        text('0', 1044, 302, 33, 'text', 'Bold', 100),
        ...button('Сформировать ф.23а', 276, 383, 188, 'finish'),
        ...button('Открыть план', 478, 383, 149, 'plan', 'secondary'),
      ]),
      ...panel('Накладная ф.23а', 256, 481, 1152, 214, [
        ...table(276, 535, 1112, [['Номер', 12, 230], ['Направление', 262, 190], ['Ёмкости', 521, 160], ['Статус', 765, 290]],
          [[documentId, '108970', '1', ['Готово к вывозу', 'green']]]),
        ...button('Открыть документ', 276, 639, 173, 'paper', 'secondary'),
        ...button('Сверить и передать', 464, 639, 190, 'handover'),
      ]),
    ],
  },
  {
    id: 'paper', name: '10 · Документ / предпросмотр', nodes: [
      ...shell('print', 'Предпросмотр накладной', 'Ф.23а № ' + documentId + ' · Утренний рейс'),
      ...button('Печать / PDF', 256, 206, 149, 'paper'),
      ...button('Подтвердить бумажный экземпляр', 419, 206, 284, 'finish', 'secondary'),
      ...button('Центр печати', 718, 206, 149, 'print', 'secondary'),
      box('Лист ф.23а', 368, 276, 928, 504, 'text', null, 7),
      text('Накладная ф.23а', 408, 310, 27, 'primaryText', 'Bold', 780),
      text('№ ' + documentId, 408, 361, 19, 'primaryText', 'Medium', 780),
      text('ОПС 114000   ·   Направление 108970', 408, 405, 15, 'primaryText', 'Regular', 780),
      box('Шапка документа', 408, 457, 848, 42, 'primary', null, 4),
      text('Ёмкость', 422, 468, 14, 'primaryText', 'Semi Bold', 283),
      text('Вложений', 777, 468, 14, 'primaryText', 'Semi Bold', 190),
      text('Масса брутто', 1055, 468, 14, 'primaryText', 'Semi Bold', 175),
      text(container, 422, 523, 15, 'primaryText', 'Regular', 286),
      text('2', 777, 523, 15, 'primaryText', 'Regular', 190),
      text('12,4 кг', 1055, 523, 15, 'primaryText', 'Regular', 175),
      text('Сдал ____________________     Принял ____________________', 408, 633, 16, 'primaryText', 'Regular', 800),
      text('Учебный макет · синтетические данные', 408, 724, 13, 'primaryText', 'Regular', 700),
    ],
  },
  {
    id: 'print', name: '11 · Печать / ошибка и повтор', nodes: [
      ...shell('print', 'Центр печати', 'Очередь демо-заданий, их статусы и повтор после ошибки.'),
      ...note('Принтер недоступен', 'Проверьте подключение и повторите задание. Форму также можно открыть и сохранить в PDF.',
        256, 207, 1152, 'red'),
      ...panel('Задания печати', 256, 313, 1152, 305, [
        ...table(276, 370, 1112, [['Документ', 12, 227], ['Тип', 262, 155], ['Статус', 460, 197], ['Причина', 695, 300]],
          [[documentId, 'Ф.23а', ['Ошибка', 'red'], 'Принтер недоступен'],
            [container, 'Ярлык', ['Выполнено', 'green'], '—']]),
        ...button('Повторить задание', 276, 551, 183, 'finish'),
        ...button('Открыть документ', 471, 551, 173, 'paper', 'secondary'),
        ...button('Открыть ярлык', 657, 551, 153, 'label', 'secondary'),
      ]),
    ],
  },
  {
    id: 'handover', name: '12 · Передача / сверка', nodes: [
      ...shell('finish', 'Передача почты водителю', 'Ф.23а № ' + documentId + ' · 1 ёмкость · 2 отправления · 12,4 кг'),
      ...panel('Сверка ярлыков', 256, 207, 1152, 357, [
        ...field('Идентификатор ёмкости', container, 276, 264, 788, { focus: true }),
        ...button('Сверить', 1080, 288, 115, 'done'),
        ...note('Сверено 0 из 1', 'Отсканируйте ярлык, чтобы сверить ёмкость с накладной.', 276, 358, 1112),
        ...button('Подтвердить передачу', 276, 478, 220, null, 'disabled'),
      ]),
      ...panel('Места по накладной', 256, 588, 1152, 197,
        table(276, 641, 1112, [['Ёмкость', 12, 283], ['Направление', 321, 210], ['Масса', 604, 150], ['Сверка', 817, 275]],
          [[container, '108980', '12,4 кг', ['Ожидает сверки', 'amber']]])),
    ],
  },
  {
    id: 'done', name: '13 · Передача / сверено', nodes: [
      ...shell('finish', 'Передача почты водителю', 'Ф.23а № ' + documentId + ' · 1 ёмкость · 2 отправления · 12,4 кг'),
      ...note('Сверено 1 из 1', 'Состав совпадает с накладной, лишних ёмкостей нет.', 256, 207, 1152, 'green'),
      ...panel('Проверенный состав', 256, 313, 1152, 260, [
        ...table(276, 365, 1112, [['Ёмкость', 12, 283], ['Направление', 321, 210], ['Масса', 604, 150], ['Сверка', 817, 275]],
          [[container, '108980', '12,4 кг', ['Сверена', 'green']]]),
        ...button('Подтвердить передачу', 276, 504, 218, 'handed'),
      ]),
    ],
  },
  {
    id: 'handed', name: '14 · Передача / завершено', nodes: [
      ...shell('finish', 'Передача завершена', 'Ф.23а № ' + documentId + ' · Утренний рейс'),
      ...note('Передано водителю · 10:26 МСК', 'В истории сохранены время и состав передачи.', 256, 207, 1152, 'green'),
      ...panel('Переданные места', 256, 313, 1152, 252, [
        ...table(276, 365, 1112, [['Ёмкость', 12, 283], ['Направление', 321, 210], ['Масса', 604, 150], ['Сверка', 817, 275]],
          [[container, '108980', '12,4 кг', ['Сверена', 'green']]]),
        ...button('К завершению', 276, 493, 157, 'finish', 'secondary'),
      ]),
    ],
  },
  {
    id: 'review', name: '15 · Очередь разбора', nodes: [
      ...shell('review', 'Очередь разбора', 'Вернитесь к отложенным отправлениям, когда причина устранена.'),
      ...panel('Ожидает разбора · 2', 256, 207, 1152, 289, [
        ...table(276, 265, 1112, [['ШПИ', 12, 241], ['Причина', 275, 420], ['Отложено (МСК)', 760, 234]],
          [['IN000000000000', 'Отправление не найдено', '10:19'], ['IN261116000219', 'Несколько направлений по плану', '10:23']]),
        ...button('Вернуться к ШПИ', 276, 431, 177, 'missing'),
        ...button('К сборке', 468, 431, 115, 'scan', 'secondary'),
      ]),
    ],
  },
  {
    id: 'search', name: '16 · Поиск и история по ШПИ', nodes: [
      ...shell('search', 'Поиск и история', 'Найдите отправление, ёмкость или документ по реквизитам.'),
      ...panel('Параметры поиска', 256, 207, 1152, 171, [
        ...field('Идентификатор или реквизиты', barcode, 276, 265, 468, { focus: true }),
        ...field('Дата (МСК)', '26.11.2026', 758, 265, 205),
        ...field('Направление', '108980', 978, 265, 205),
        ...button('Найти', 1202, 289, 110, 'search'),
      ]),
      ...panel('История · ' + barcode, 256, 402, 1152, 300,
        table(276, 456, 1112, [['Время (МСК)', 12, 181], ['Действие', 225, 245], ['Детали', 505, 462], ['Исполнитель', 985, 113]],
          [['10:14', 'Вложено', container, 'Оператор'], ['10:13', 'Данные проверены', '—', 'Оператор'],
            ['10:12', 'Отправление найдено', 'Входящая почта', 'Оператор']])),
    ],
  },
  {
    id: 'mismatch', name: '17 · Передача / лишняя ёмкость', nodes: [
      ...shell('finish', 'Передача почты водителю', 'Ф.23а № ' + documentId + ' · Утренний рейс'),
      ...note('Ёмкость не входит в накладную', 'Передача заблокирована. Проверьте ярлык и состав рейса.',
        256, 207, 1152, 'red'),
      ...panel('Результат сверки', 256, 313, 1152, 279, [
        ...table(276, 366, 1112, [['Ёмкость', 12, 283], ['Результат', 321, 640]],
          [[container, ['Сверена', 'green']], [otherContainer, ['Лишняя ёмкость', 'red']]]),
        ...button('Убрать из сверки', 276, 522, 177, 'done', 'secondary'),
        ...button('Подтвердить передачу', 467, 522, 220, null, 'disabled'),
      ]),
    ],
  },
  {
    id: 'label', name: '18 · Ярлык ёмкости / предпросмотр', nodes: [
      ...shell('print', 'Предпросмотр ярлыка', 'Ёмкость ' + container + ' · Утренний рейс'),
      ...button('Печать / PDF', 256, 206, 149, 'label'),
      ...button('Подтвердить бумажный экземпляр', 419, 206, 284, 'finish', 'secondary'),
      box('Лист ярлыка', 466, 279, 718, 413, 'text', null, 7),
      text('Ярлык почтовой ёмкости', 500, 313, 24, 'primaryText', 'Bold', 630),
      text('Направление 108980', 500, 357, 31, 'primaryText', 'Bold', 630),
      text('ОПС 114000 · Мешок · Тара Т-01 · Пломба П-014', 500, 419, 15, 'primaryText', 'Regular', 630),
      text('2 отправления · 12,4 кг', 500, 456, 16, 'primaryText', 'Medium', 630),
      ...[2, 4, 6, 2, 6, 4, 2, 2, 4, 6, 2, 4, 4, 2, 6, 2, 4, 6, 2, 2, 6, 4, 2, 4].map(
        (barWidth, index) => box('Иллюстрация штрихкода', 500 + index * 9, 506, barWidth, 63, 'primaryText', null, 0)),
      text(container, 500, 582, 19, 'primaryText', 'Semi Bold', 515),
      text('Учебное изображение ярлыка', 500, 644, 12, 'primaryText', 'Regular', 515),
    ],
  },
];

function iconSvg(item) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">' +
    '<path fill="none" stroke="' + palette[item.tone] + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="' +
    iconPaths[item.name] + '"/></svg>';
}

async function createFigmaScreens() {
  const fonts = ['Regular', 'Medium', 'Semi Bold', 'Bold'];
  await Promise.all(fonts.map((style) => figma.loadFontAsync({ family: 'Inter', style })));
  const page = figma.createPage();
  page.name = 'Исходящая почта · ОПС 114000';
  await figma.setCurrentPageAsync(page);
  const frames = new Map();
  const links = [];
  const paint = (tone) => {
    const hex = palette[tone].slice(1);
    const channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
    return [{ type: 'SOLID', color: { r: channels[0], g: channels[1], b: channels[2] } }];
  };
  for (const [index, screen] of screens.entries()) {
    const frame = figma.createFrame();
    frame.name = screen.name;
    frame.resize(width, height);
    frame.x = (index % 4) * (width + 96);
    frame.y = Math.floor(index / 4) * (height + 110);
    frame.fills = paint('base');
    frame.clipsContent = true;
    frames.set(screen.id, frame);
    for (const item of screen.nodes) {
      let node;
      if (item.type === 'text') {
        node = figma.createText();
        node.fontName = { family: 'Inter', style: item.weight };
        node.fontSize = item.size;
        node.characters = item.value;
        node.fills = paint(item.tone);
        node.textAutoResize = 'HEIGHT';
        node.resize(item.w, node.height);
      } else if (item.type === 'icon') {
        node = figma.createNodeFromSvg(iconSvg(item));
      } else {
        node = figma.createRectangle();
        node.resize(item.w, item.h);
        node.cornerRadius = item.radius;
        node.fills = paint(item.fill);
        node.strokes = item.stroke ? paint(item.stroke) : [];
        if (item.to && item.to !== screen.id) links.push({ node, to: item.to });
      }
      frame.appendChild(node);
      node.name = item.name;
      node.x = item.x;
      node.y = item.y;
    }
  }
  await Promise.all(links.map(({ node, to }) => node.setReactionsAsync([{
    trigger: { type: 'ON_CLICK' },
    actions: [{ type: 'NODE', destinationId: frames.get(to).id, navigation: 'NAVIGATE', transition: null,
      preserveScrollPosition: false }],
  }])));
  page.selection = [frames.get('desk')];
  figma.viewport.scrollAndZoomIntoView(page.selection);
  figma.closePlugin('Создано экранов: ' + screens.length + '.');
}

if (typeof figma !== 'undefined') {
  createFigmaScreens().catch((error) => figma.closePlugin('Ошибка создания макетов: ' + error.message));
} else if (typeof document !== 'undefined') {
  location.replace('http://localhost:5173/');
} else {
  module.exports = { width, height, palette, screens };
}

# Требования к таре и взвешиванию

| Требование | Реализация | Проверка |
| --- | --- | --- |
| Справочные модели, совместимость вида с группой и масса брутто | [Справочник тары](../server/src/reference/packaging.ts), [подбор и перенос](../server/src/services/assignment.ts) | Точные границы 10 000 и 32 000 г, превышение на 1 г, смешанный мешок, переполнение |
| Отметки отправления и комбинации на ярлыке | [Правила](../server/src/reference/marks.ts), [карточка сборки](../web/src/pages/ScanPage.tsx), [изменение и аудит](../server/src/routes/shipments.ts) | [Табличные тесты](../server/test/containerMarks.test.ts), комбинированный ярлык |
| Вложение по двум матрицам и примечаниям | [Матрицы](../server/src/reference/containerNesting.ts), [маршруты API](../server/src/routes/containers.ts), [карточка ёмкости](../web/src/pages/ContainersPage.tsx) | Несовместимая пара, примечания 1 и 2, цикл, брутто, верхнеуровневое место в ф.23а |
| Справочные модели и восстановление старой сессии | `GET /api/reference/packaging`, [проверка реквизитов](../server/src/routes/containers.ts), [восстановление](../server/src/services/store.ts) | Список моделей, неверная пара, подстановка массы тары, сохранение ручной массы в старой сессии |
| Взвешивание, ручной ввод и источник массы | [Адаптер](../server/src/services/scale.ts), [допуск](../server/src/reference/weighing.ts), [печатные формы](../web/src/pages/PrintDocument.tsx) | Стабильность, недоступность, перегруз, допуск и запись источника с временем |

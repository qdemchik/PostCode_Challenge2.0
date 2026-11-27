import { Link, useSearchParams } from 'react-router-dom';

const steps = [
  { path: '/', title: 'Рабочий стол', hint: 'Сравните числа к отправке, вложено и осталось. Создайте рабочий рейс для демонстрации.' },
  { path: '/scan', title: 'Сборка', hint: 'Запустите демо-серию. Проверьте счётчик вложений и причину остановки на неизвестном ШПИ.' },
  { path: '/containers', title: 'Ёмкости', hint: 'Откройте ёмкость, покажите реквизиты, массу и отметки. Закройте ёмкость и откройте ярлык.' },
  { path: '/finish', title: 'Завершение', hint: 'Сформируйте ф.23а, подтвердите печать и готовность. Затем сверьте ярлыки перед передачей.' },
  { path: '/print', title: 'Печать', hint: 'Откройте очередь. Ошибка принтера оставляет задание доступным для повтора.' },
  { path: '/search', title: 'Поиск', hint: 'Найдите отправление по ШПИ и откройте историю обработки.' },
];

const stepUrl = (index: number) => `${steps[index].path}?tour=${index + 1}${index === 1 ? '&series=1' : ''}`;

export default function DemoTour() {
  const [params, setParams] = useSearchParams();
  const index = Number(params.get('tour')) - 1;
  const step = Number.isInteger(index) ? steps[index] : undefined;
  if (!step) return null;
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('tour');
    setParams(next);
  };
  return (
    <aside className="card stack demo-tour" aria-label="Демонстрационный тур">
      <strong>Шаг {index + 1} из {steps.length} · {step.title}</strong>
      <span>{step.hint}</span>
      <div className="flex">
        {index > 0 && <Link className="btn btn-ghost" to={stepUrl(index - 1)}>Назад</Link>}
        {index < steps.length - 1 && <Link className="btn btn-primary" to={stepUrl(index + 1)}>Далее</Link>}
        <button className="btn btn-ghost" onClick={close}>{index === steps.length - 1 ? 'Завершить тур' : 'Закрыть тур'}</button>
      </div>
    </aside>
  );
}

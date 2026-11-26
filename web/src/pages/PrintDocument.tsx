import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import type { Container, Waybill } from '../../../server/src/types/index';
import { api } from '../api/client';
import { printEvidenceLabel } from '../printEvidence';
import '../styles/print.css';

type Label = Pick<Container, 'directionId' | 'category' | 'kind' | 'packagingModel' |
  'packagingNumber' | 'sealNumber' | 'totalWeightGrams' | 'marks' | 'opsIndex' | 'createdAt' | 'labelPrinted' | 'labelPrintEvidence'> & {
  containerId: string;
  shipmentCount: number;
};

type Document =
  | { type: 'label'; data: Label }
  | { type: 'waybill'; data: Waybill & { containers: Container[] } };

const date = (value: string) => new Date(value).toLocaleString('ru-RU');
const mass = (grams: number) => `${grams.toLocaleString('ru-RU')} г`;

function Barcode({ value }: { value: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { format: 'CODE128', height: 50, displayValue: false });
  }, [value]);
  return <canvas ref={ref} className="document-barcode" role="img" aria-label={`Штрихкод ${value}`} />;
}

function LabelForm({ label }: { label: Label }) {
  return (
    <article className="paper-document paper-label">
      <h1>Ярлык почтовой ёмкости</h1>
      <div className="label-direction">Направление {label.directionId}</div>
      <p>{label.kind} · {label.category} · {label.packagingModel}</p>
      <dl className="document-details">
        <dt>ОПС отправления</dt><dd>{label.opsIndex}</dd>
        <dt>Номер тары</dt><dd>{label.packagingNumber || '—'}</dd>
        <dt>Номер пломбы</dt><dd>{label.sealNumber || '—'}</dd>
        <dt>Масса брутто</dt><dd>{mass(label.totalWeightGrams)}</dd>
        <dt>Вложений</dt><dd>{label.shipmentCount}</dd>
        <dt>Отметки</dt><dd>{label.marks.join(', ') || '—'}</dd>
        <dt>Создана</dt><dd>{date(label.createdAt)}</dd>
      </dl>
      <Barcode value={label.containerId} />
      <div className="document-number">{label.containerId}</div>
      <small>Учебный макет · синтетические данные</small>
    </article>
  );
}

function WaybillForm({ waybill }: { waybill: Extract<Document, { type: 'waybill' }>['data'] }) {
  return (
    <article className="paper-document">
      <h1>Накладная ф.23а</h1>
      <p className="document-number">№ {waybill.id}</p>
      {waybill.cancellation && <p><strong>АННУЛИРОВАНА</strong> · {waybill.cancellation.reason}</p>}
      {!!waybill.replacesWaybillIds?.length && <p>Взамен ф.23а № {waybill.replacesWaybillIds.join(', ')}</p>}
      <dl className="document-details">
        <dt>ОПС отправления</dt><dd>{waybill.opsIndex}</dd>
        <dt>Направления</dt><dd>{(waybill.directionIds ?? [waybill.directionId]).join(', ')}</dd>
        <dt>Сформирована</dt><dd>{date(waybill.createdAt)}</dd>
      </dl>
      <div className="document-table">
        <table>
          <thead><tr><th>ШИ ёмкости</th><th>Направление</th><th>Вид и категория</th><th>Пломба</th><th>Вложений</th><th>Масса брутто</th></tr></thead>
          <tbody>
            {waybill.containers.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td><td>{c.directionId}</td><td>{c.kind} · {c.category}</td>
                <td>{c.sealNumber || '—'}</td><td>{c.shipmentIds.length}</td><td>{mass(c.totalWeightGrams)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p><strong>Итого:</strong> {waybill.totalContainers} ёмк. · {waybill.totalShipments} отпр. · {mass(waybill.totalWeightGrams)}</p>
      <p>Сдал ____________________ Принял ____________________</p>
      <small>Учебный макет · синтетические данные</small>
    </article>
  );
}

export default function PrintDocument() {
  const { type, id } = useParams();
  const [document, setDocument] = useState<Document | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [paperPending, setPaperPending] = useState(false);

  useEffect(() => {
    let active = true;
    setDocument(null);
    setError('');
    setStatus('');
    setPaperPending(false);
    const load = async () => {
      if (!id || (type !== 'label' && type !== 'waybill')) {
        setError('Неизвестный вид документа.');
        return;
      }
      try {
        const next: Document = type === 'label'
          ? { type, data: await api.labelData(id) }
          : { type, data: await api.getWaybill(id) };
        if (active) setDocument(next);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : 'Не удалось открыть документ.');
      }
    };
    void load();
    return () => { active = false; };
  }, [type, id]);

  const submitPrintJob = async () => {
    if (!document || !id || busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api.print(document.type, id);
      setStatus('Демо-задание выполнено. Для бумажной копии или PDF откройте печать браузера.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось выполнить задание.');
    } finally {
      setBusy(false);
    }
  };

  const evidenceLabel = document?.type === 'label'
    ? printEvidenceLabel(document.data.labelPrintEvidence, document.data.labelPrinted)
    : document?.type === 'waybill' ? printEvidenceLabel(document.data.printEvidence, !!document.data.printedAt) : undefined;
  const cancelled = document?.type === 'waybill' && document.data.status === 'cancelled';

  const confirmPaper = async () => {
    if (!document || !id || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.confirmPaperPrint(document.type, id);
      setPaperPending(false);
      setStatus('Получение бумажного экземпляра подтверждено.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось подтвердить получение.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack document-preview">
      <div className="print-controls stack">
        <div className="flex">
          <Link className="btn btn-ghost" to="/print">Центр печати</Link>
          {document && !cancelled && (
            <>
              <button className="btn btn-primary" disabled={busy} onClick={() => {
                window.print();
                setPaperPending(true);
              }}>Печать / PDF</button>
              <button className="btn btn-ghost" disabled={busy} onClick={submitPrintJob}>
                {busy ? 'Отправка…' : 'Создать демо-задание'}
              </button>
            </>
          )}
        </div>
        {paperPending && (
          <div className="flex">
            <button className="btn btn-ghost" disabled={busy} onClick={() => void confirmPaper()}>
              Подтвердить бумажный экземпляр
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setPaperPending(false)}>Закрыть подтверждение</button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {evidenceLabel && !status && !cancelled && <p>{evidenceLabel}</p>}
        {status && <p role="status">{status}</p>}
        {!document && !error && <p role="status">Загрузка документа…</p>}
      </div>
      {document?.type === 'label' && <LabelForm label={document.data} />}
      {document?.type === 'waybill' && <WaybillForm waybill={document.data} />}
    </div>
  );
}

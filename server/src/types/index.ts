export type Origin = 'Приём' | 'Возврат' | 'Досылка почты';
export type Source = 'registration' | 'self_service' | 'portal' | 'incoming' | 'storage';
export type Classification = 'Внутренняя' | 'Международная';

export type ShipmentStatus =
  | 'pending'
  | 'found'
  | 'verified'
  | 'placed'
  | 'error';

export type ContainerStatus = 'open' | 'closed';
export type DocumentStatus = 'formed' | 'printed' | 'ready_for_dispatch' | 'error';

export type ContainerKind =
  | 'группа РПО'
  | 'контейнер'
  | 'мешок'
  | 'ящик'
  | 'коробка'
  | 'паллета'
  | 'мешок М'
  | 'газетная пачка';

export type ContainerCategory =
  | 'Заказная'
  | 'Страховая'
  | 'EMS'
  | 'Сборная'
  | 'Простая'
  | 'С ТМЦ'
  | 'С порожней тарой'
  | 'С печатью'
  | 'Со счетами и ДМ';

export interface Shipment {
  id: string;
  barcode: string;
  kind: string;
  kindNormalized: string;
  weightGrams: number;
  shortName: string;
  category: string;
  method: string;
  origin: Origin;
  source: Source;
  classification: Classification;
  destinationIndex: number;
  recipientName: string;
  address: string;
  city: string;
  countryCode: string;
  acceptedAt: string;
  storageExpiresAt: string;
  isEligibleForDispatch: boolean;
  directionContainer: string;
  directionWaybill: string;
  preAssignedContainerId: string | null;
  status: ShipmentStatus;
  containerId?: string;
  verifiedAt?: string;
  placedAt?: string;
  notes?: string;
  originalData?: Partial<Shipment>;
  errorCode?: string;
  errorMessage?: string;
}

export interface Container {
  id: string;
  directionId: string;
  waybillDirectionId: string;
  category: ContainerCategory;
  kind: ContainerKind;
  packagingModel: string;
  tareWeightGrams: number;
  maxWeightGrams: number;
  sealNumber?: string;
  packagingNumber?: string;
  shipmentIds: string[];
  totalWeightGrams: number;
  marks: string[];
  status: ContainerStatus;
  labelPrinted: boolean;
  createdAt: string;
  closedAt?: string;
  opsIndex: string;
  group: 'ПК' | 'ПО' | 'EMS';
}

export interface Waybill {
  id: string;
  directionId: string;
  containerIds: string[];
  status: DocumentStatus;
  createdAt: string;
  printedAt?: string;
  opsIndex: string;
  totalContainers: number;
  totalShipments: number;
  totalWeightGrams: number;
}

export interface PrintJob {
  id: string;
  type: 'label' | 'waybill';
  entityId: string;
  status: 'queued' | 'printing' | 'done' | 'error';
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
  retries: number;
}

export interface AuditEntry {
  id: string;
  entityType: 'shipment' | 'container' | 'waybill';
  entityId: string;
  action: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  userId: string;
  at: string;
}

export interface RouteDirection {
  id: string;
  name: string;
  waybillDirection: string;
}

export interface RouteRule {
  classification: string;
  kind: string;
  category: string;
  method: string;
  directionContainer: string;
  directionWaybill: string;
}

export interface AssignResult {
  ok: boolean;
  shipment?: Shipment;
  container?: Container;
  createdNew?: boolean;
  errorCode?: string;
  errorMessage?: string;
  actionHint?: string;
}

export interface SessionState {
  shipments: Record<string, Shipment>;
  containers: Record<string, Container>;
  waybills: Record<string, Waybill>;
  printJobs: PrintJob[];
  audit: AuditEntry[];
  demoFlags: {
    printerError: boolean;
    sourceDown: boolean;
  };
}

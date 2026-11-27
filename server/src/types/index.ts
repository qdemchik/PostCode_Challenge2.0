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
export type DocumentStatus = 'formed' | 'printed' | 'ready_for_dispatch' | 'handed_over' | 'cancelled' | 'error';
export type PrintEvidence = { source: 'paper' | 'demo'; at: string };

export type ContainerKind =
  | 'группа РПО'
  | 'группа ПТ'
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
  plannedTripId?: string;
  markFlags?: Partial<Record<ShipmentMark, boolean>>;
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
  mailRank?: string;
  acceptedAt: string;
  storageExpiresAt: string;
  isEligibleForDispatch: boolean;
  routingIssue?: 'ROUTE_NOT_FOUND' | 'ROUTE_AMBIGUOUS';
  routingDetails?: {
    rank: string;
    countryCode: string;
    candidates: { containerDirection: string; waybillDirection: string }[];
  };
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
export type ShipmentMark = 'careful' | 'thermal' | 'oversized' | 'government' | 'srm';

export interface Container {
  id: string;
  tripId?: string;
  directionId: string;
  waybillDirectionId: string;
  category: ContainerCategory;
  kind: ContainerKind;
  packagingModel: string;
  tareWeightGrams: number;
  tareSource?: 'reference' | 'manual';
  maxWeightGrams: number;
  massLimitOverrideGrams?: number;
  sealNumber?: string;
  packagingNumber?: string;
  shipmentIds: string[];
  parentContainerId?: string;
  childContainerIds?: string[];
  measuredWeightGrams?: number;
  weightEvidence?: { source: WeightSource; at: string };
  continuationContainerId?: string;
  totalWeightGrams: number;
  marks: string[];
  status: ContainerStatus;
  labelPrinted: boolean;
  labelPrintEvidence?: PrintEvidence;
  createdAt: string;
  closedAt?: string;
  opsIndex: string;
  group: 'ПК' | 'ПО' | 'EMS';
}
export type WeightSource = 'scale' | 'calculated' | 'manual';
export type ScaleMode = 'stable' | 'unstable' | 'offline' | 'overload';
export interface ScaleReading {
  grams: number;
  stable: boolean;
  unit: 'g';
  ts: string;
  calculatedGrams: number;
  toleranceGrams: number;
}

export interface Waybill {
  id: string;
  tripId?: string;
  directionId: string;
  directionIds?: string[];
  containerIds: string[];
  containerShipmentCounts?: Record<string, number>;
  status: DocumentStatus;
  createdAt: string;
  printedAt?: string;
  printEvidence?: PrintEvidence;
  readyAt?: string;
  handover?: { at: string; containerIds: string[] };
  cancellation?: { at: string; reason: string; containers: Container[] };
  replacesWaybillIds?: string[];
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

export const reviewReasons = ['NOT_FOUND', 'SOURCE_DOWN', 'ROUTE_NOT_FOUND', 'ROUTE_AMBIGUOUS', 'OVERWEIGHT', 'NOT_ELIGIBLE'] as const;
export type ReviewReason = typeof reviewReasons[number];

export interface ReviewItem {
  barcode: string;
  reason: ReviewReason;
  deferredAt: string;
  resolvedAt?: string;
  resolution?: 'assigned' | 'dismissed';
}

export interface DispatchSummary {
  waitingBarcodes: string[];
  reviewCounts: Partial<Record<ReviewReason, number>>;
  openContainerIds: string[];
  unprintedLabelIds: string[];
  undocumentedContainerIds: string[];
  unprintedWaybillIds: string[];
  unconfirmedWaybillIds: string[];
  tripPlan?: TripPlan;
}

export interface TripPlan {
  items: {
    barcode: string;
    kind: string;
    status: 'waiting' | 'review' | 'unavailable' | 'packed';
    containerId?: string;
  }[];
  outsidePlanBarcodes: string[];
}

export interface SessionState {
  packagingReferenceVersion: 1;
  trips: Record<string, DispatchTrip>;
  shipments: Record<string, Shipment>;
  containers: Record<string, Container>;
  waybills: Record<string, Waybill>;
  printJobs: PrintJob[];
  audit: AuditEntry[];
  reviewQueue: Record<string, ReviewItem>;
  demoFlags: {
    printerError: boolean;
    sourceDown: boolean;
    autoNestBags?: boolean;
    scaleMode?: ScaleMode;
    scaleErrorGrams?: number;
  };
}

export interface DispatchTrip {
  id: string;
  name: string;
  createdAt: string;
}

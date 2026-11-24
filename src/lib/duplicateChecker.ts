import type { Bill, StockMovement, Vendor } from './types';

export interface DuplicateConflict {
  type: 'bill' | 'movement';
  billNumber: string;
  vendorName: string;
  existingId: string;
  existingFileName?: string;
  existingStatus?: string;
  existingAmount?: number;
  existingDate?: string | null;
  isPostingAttempt?: boolean;
  message: string;
}

export function normalizeBillNumber(num: string | null | undefined): string {
  if (!num) return '';
  const trimmed = num.trim();
  if (trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'm' || trimmed.length < 2) return '';
  // Remove common invoice prefixes
  const withoutPrefix = trimmed.replace(/^(?:INV(?:OICE)?|BILL|QTN|QUOTATION|CHALLAN|DOC)[-_/#\s]*/i, '');
  // Keep only alphanumeric lowercase
  const clean = withoutPrefix.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  // Strip leading zeros unless it's just '0'
  return clean.replace(/^0+/, '') || clean;
}

export function normalizeVendorName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/^(?:m\/s\.?|messrs\.?|to|for)\s+/gi, '')
    .replace(/\b(?:thank\s+you\s+for\s+your\s+business|your\s+business)\b/gi, '')
    .replace(/\b(?:private|pvt|limited|ltd|corp|corporation|inc|incorporated|co|company|enterprises|international|rubber|industries|agency|suppliers?|traders?)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function areVendorsMatching(
  v1Name: string | null | undefined,
  v1Id: string | null | undefined,
  v1Gst: string | null | undefined,
  v2Name: string | null | undefined,
  v2Id: string | null | undefined,
  v2Gst: string | null | undefined
): boolean {
  // 1. Direct ID match
  if (v1Id && v2Id && v1Id === v2Id) return true;

  // 2. Direct GST match (GSTIN is unique per business in India)
  const cleanGst1 = (v1Gst || '').trim().toUpperCase();
  const cleanGst2 = (v2Gst || '').trim().toUpperCase();
  if (cleanGst1 && cleanGst2 && cleanGst1.length >= 10 && cleanGst1 === cleanGst2) return true;

  // 3. Name comparison
  const n1 = normalizeVendorName(v1Name);
  const n2 = normalizeVendorName(v2Name);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  if (n1.length >= 4 && n2.length >= 4) {
    if (n1.includes(n2) || n2.includes(n1)) return true;
  }
  return false;
}

export function findDuplicateInBills(
  currentBillId: string | null,
  targetBillNumber: string | null | undefined,
  targetVendorName: string | null | undefined,
  targetVendorId: string | null | undefined,
  targetGst: string | null | undefined,
  allBills: Bill[],
  vendorsList: Vendor[]
): DuplicateConflict | null {
  const normTargetNum = normalizeBillNumber(targetBillNumber);
  if (!normTargetNum) return null;

  const targetVendorObj = targetVendorId ? vendorsList.find((v) => v.id === targetVendorId) : null;
  const effectiveTargetVendorName = targetVendorName || targetVendorObj?.name || '';
  const effectiveTargetGst = targetGst || targetVendorObj?.gst_number || '';

  for (const b of allBills) {
    if (currentBillId && b.id === currentBillId) continue;
    if (!b.bill_number) continue;

    const normOtherNum = normalizeBillNumber(b.bill_number);
    if (normOtherNum !== normTargetNum) continue;

    // Bill number matches! Now check vendor match:
    const otherVendorObj = b.vendor || (b.vendor_id ? vendorsList.find((v) => v.id === b.vendor_id) : null);
    const otherVendorName = otherVendorObj?.name || '';
    const otherGst = otherVendorObj?.gst_number || '';

    // If both have vendor info, check if they match
    const vendorMatches = areVendorsMatching(
      effectiveTargetVendorName,
      targetVendorId,
      effectiveTargetGst,
      otherVendorName,
      b.vendor_id,
      otherGst
    );

    // If vendor matches, or if one of them is unnamed/supplier and bill number is identical
    const isVendorMatch = vendorMatches || (!effectiveTargetVendorName && !otherVendorName);

    if (isVendorMatch) {
      return {
        type: 'bill',
        billNumber: b.bill_number,
        vendorName: otherVendorName || effectiveTargetVendorName || 'Supplier',
        existingId: b.id,
        existingFileName: b.file_name,
        existingStatus: b.status,
        existingAmount: Number(b.amount || 0),
        existingDate: b.bill_date || b.created_at?.slice(0, 10),
        message: `Bill #${b.bill_number} from "${otherVendorName || 'Supplier'}" already exists as ${b.file_name} (Amount: ₹${Number(b.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })})`,
      };
    }
  }

  return null;
}

export function findDuplicateInMovements(
  targetBillNumber: string | null | undefined,
  targetVendorName: string | null | undefined,
  targetVendorId: string | null | undefined,
  allMovements: StockMovement[],
  vendorsList: Vendor[]
): DuplicateConflict | null {
  const normTargetNum = normalizeBillNumber(targetBillNumber);
  if (!normTargetNum) return null;

  const targetVendorObj = targetVendorId ? vendorsList.find((v) => v.id === targetVendorId) : null;
  const effectiveTargetVendorName = targetVendorName || targetVendorObj?.name || '';

  for (const m of allMovements) {
    if (!m.bill_number) continue;
    const normMovNum = normalizeBillNumber(m.bill_number);
    if (normMovNum !== normTargetNum) continue;

    const movVendorObj = m.vendor || (m.vendor_id ? vendorsList.find((v) => v.id === m.vendor_id) : null);
    const movVendorName = movVendorObj?.name || '';

    const vendorMatches = areVendorsMatching(
      effectiveTargetVendorName,
      targetVendorId,
      targetVendorObj?.gst_number,
      movVendorName,
      m.vendor_id,
      movVendorObj?.gst_number
    );

    if (vendorMatches || (!effectiveTargetVendorName && !movVendorName)) {
      return {
        type: 'movement',
        billNumber: m.bill_number,
        vendorName: movVendorName || effectiveTargetVendorName || 'Supplier',
        existingId: m.id,
        existingStatus: 'inward_received',
        existingDate: m.movement_date,
        message: `Material receipt for Bill #${m.bill_number} from "${movVendorName || 'Supplier'}" has already been received on ${m.movement_date}`,
      };
    }
  }

  return null;
}

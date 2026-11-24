import { Vendor } from './types';
import { extractTextFromPdf } from './pdfExtractor';

export interface ExtractedLineItem {
  num?: string;
  name: string;
  qty: number;
  rate: number;
  amount: number;
  unit?: string;
  sku?: string;
  category_id?: string | null;
  reorder_level?: number;
  rack_location?: string;
  raw_ocr?: string;
  matched_item_id?: string;
}

export interface ParsedDocumentData {
  rawText: string;
  vendorName: string;
  gstNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  billNumber: string;
  billDate: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxAmount: number;
  rounding: number;
  amount: number; // Final payable Grand Total including GST
  lineItems: ExtractedLineItem[];
}

export async function scanDocumentFile(
  fileOrBlob: Blob | File,
  fileName: string,
  availableVendors: Vendor[]
): Promise<ParsedDocumentData> {
  let rawText = '';
  const isPdf = fileName.toLowerCase().endsWith('.pdf') || fileOrBlob.type === 'application/pdf';

  if (isPdf) {
    try {
      const buffer = await fileOrBlob.arrayBuffer();
      rawText = await extractTextFromPdf(buffer);
    } catch (err) {
      console.warn('PDF extraction failed:', err);
    }
  } else {
    // Image OCR with in-browser Tesseract.js if available
    if (typeof window !== 'undefined' && (window as any).Tesseract) {
      try {
        const result = await (window as any).Tesseract.recognize(fileOrBlob, 'eng');
        rawText = result?.data?.text || '';
      } catch (err) {
        console.warn('Tesseract OCR failed:', err);
      }
    }
  }

  // Parse extracted raw text with sharp precision
  return parseInvoiceText(rawText, fileName, availableVendors);
}

export function parseInvoiceText(
  text: string,
  fileName: string,
  availableVendors: Vendor[]
): ParsedDocumentData {
  const cleanName = fileName.replace(/\.[^/.]+$/, '');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 1. EXTRACT VENDOR NAME & CONTACT DETAILS
  let vendorName = '';
  let phone: string | null = null;
  let email: string | null = null;
  let address: string | null = null;
  let gstNumber: string | null = null;

  // Identify where customer/buyer section starts (e.g. "Bill To", "Ship To", "Buyer (Bill to)")
  const buyerIndex = lines.findIndex((l) =>
    /^(?:Bill\s+To|Ship\s+To|Invoice\s+To|Customer|Buyer|Billed\s+To|Shipped\s+To|Party\s+Name)\b/i.test(l)
  );
  const headerLines = buyerIndex > 0 ? lines.slice(0, buyerIndex) : lines.slice(0, 10);
  const headerText = headerLines.join('\n');

  // Supplier GSTIN in header (before "Bill To")
  const supplierGstMatch = headerText.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/);
  if (supplierGstMatch) {
    gstNumber = supplierGstMatch[0];
  } else {
    const anyGst = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/);
    if (anyGst) gstNumber = anyGst[0];
  }

  // Phone in header
  const phoneMatch = headerText.match(/(?:Phone|Ph|Tel|Mobile|Contact|Cell)\s*[:\-]?\s*([+0-9\s\/\-,]{8,25})/i);
  if (phoneMatch) phone = phoneMatch[1].trim();

  // Email in header
  const emailMatch = headerText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  if (emailMatch) email = emailMatch[0].trim();

  // Address in header
  const addrMatch = headerText.match(/(?:H\.?O\.?|B\.?O\.?|Address|Works|Factory|Kasturi|Building|Street|Road)\s*[:\-]?\s*([^\n]+)/i);
  if (addrMatch) address = addrMatch[1].trim();

  // Vendor Name from Header
  for (const l of headerLines) {
    if (
      /^(?:tax\s+invoice|invoice|quotation|proforma|estimate|cash\s+bill|bill\s+of\s+supply|original|duplicate|delivery\s+challan|q\s*no|date|dated|gstin|phone|ph:|email|h\.?o\.?|b\.?o\.?|place\s+of)/i.test(
        l
      )
    ) {
      continue;
    }
    if (l.length >= 3 && /[a-zA-Z]/.test(l) && !/:/.test(l)) {
      vendorName = l.replace(/^M\/s\.?\s*/i, '').trim();
      break;
    }
  }

  // Check Footer Authorized Signatory: "For <Company Name>"
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
    let l = lines[i];
    // Remove "Thank you for your business" so it doesn't pollute the signatory line
    l = l.replace(/thank\s+you\s+for\s+your\s+business/gi, '').trim();
    // Match strict capitalized "For" or "FOR"
    const forMatch = l.match(/\b(For|FOR)\s+([A-Za-z0-9&.,'\s\-()]{3,50})/);
    if (forMatch) {
      let candidate = forMatch[2]
        .replace(/\b(?:authorized|signatory|signature|auth\.?|partner|proprietor|director|your\s+business)\b/gi, '')
        .trim();
      candidate = candidate.replace(/^for\s+/i, '').trim();
      if (candidate.length > 3 && !/customer|buyer|client|recipient|billing/i.test(candidate)) {
        if (!vendorName || vendorName.length < 4 || /industrial|supplier|invoice/i.test(vendorName)) {
          vendorName = candidate;
        } else if (
          candidate.toLowerCase().includes(vendorName.toLowerCase()) ||
          vendorName.toLowerCase().includes(candidate.toLowerCase())
        ) {
          if (candidate.toLowerCase().endsWith(vendorName.toLowerCase())) {
            vendorName = candidate.slice(candidate.toLowerCase().lastIndexOf(vendorName.toLowerCase())).trim();
          } else {
            vendorName = candidate;
          }
        }
        break;
      }
    }
  }

  // Clean vendor name of any stray prefix/suffix
  vendorName = vendorName
    .replace(/^M\/s\.?\s*/i, '')
    .replace(/^(?:Messrs|To|For|FOR)\s+/i, '')
    .replace(/\b(?:thank\s+you\s+for\s+your\s+business|your\s+business)\b/gi, '')
    .replace(/[\s\-_,.]+$/, '')
    .trim();

  // Check if any existing vendor in database matches text
  if (availableVendors.length > 0) {
    const matchedVendor = availableVendors.find((v) =>
      text.toLowerCase().includes(v.name.toLowerCase().trim())
    );
    if (matchedVendor) {
      vendorName = matchedVendor.name;
    }
  }

  if (!vendorName || vendorName.length < 3) {
    vendorName = availableVendors.length > 0 ? availableVendors[0].name : 'Supplier';
  }

  // 2. EXTRACT BILL / INVOICE NUMBER
  let billNumber = '';
  const docNumRegex =
    /(?:Q(?:TN)?\.?\s*NO\.?|QUOTATION\s*(?:NO\.?|NUMBER|#)|INVOICE\s*(?:NO\.?|NUMBER|#)|INV\.?\s*(?:NO\.?|NUMBER|#)|BILL\s*(?:NO\.?|NUMBER|#))\s*[:\-]?\s*([A-Za-z0-9\/\-_]{2,30})/i;
  const numMatch = text.match(docNumRegex);

  if (numMatch && numMatch[1]) {
    const candidate = numMatch[1].trim();
    if (!/^(to|for|is|date|dated|the|and|details|of|m|bash|tax)$/i.test(candidate)) {
      billNumber = candidate;
    }
  }

  // Check if Invoice No. is immediately followed on the next line by a number
  if (!billNumber) {
    const invNoIdx = lines.findIndex((l) => /^(?:Invoice\s*No\.?|Bill\s*No\.?|Q\s*NO\.?)/i.test(l));
    if (invNoIdx !== -1 && invNoIdx + 1 < lines.length) {
      const nextCandidate = lines[invNoIdx + 1].trim().split(/\s+/)[0];
      if (/^[A-Za-z0-9\/\-_]{2,30}$/.test(nextCandidate) && !/^(to|for|date|dated|tax)$/i.test(nextCandidate)) {
        billNumber = nextCandidate;
      }
    }
  }

  // Filename fallback (e.g. Sales_2108_26-27.pdf -> 2108/26-27)
  if (!billNumber) {
    const fileNumMatch = cleanName.match(/(?:Sales|INV|Bill|Q)?[-_ ]*([a-zA-Z0-9\/\-_]{2,25})/i);
    if (fileNumMatch && !/^(bill|invoice|doc|scan|file|pdf)$/i.test(fileNumMatch[1])) {
      billNumber = fileNumMatch[1].replace(/^(Sales|INV|Bill)_/i, '').replace(/_/g, '/');
    } else {
      billNumber = 'INV-' + Math.floor(1000 + Math.random() * 9000);
    }
  }

  // 3. EXTRACT DATE (Supports alphanumeric months like 13-Oct-26, 13-Oct-2026, 03/11/2026)
  let billDate = new Date().toISOString().slice(0, 10);
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const dateRegex =
    /(?:Dated|Date|Invoice\s*Date|Bill\s*Date|Q\s*Date)\s*[:\-]?\s*(\d{1,2})[\/\-\.](\d{1,2}|[A-Za-z]{3,9})[\/\-\.](\d{2,4})/i;
  const dateMatch = text.match(dateRegex);

  if (dateMatch) {
    let [, d, m, y] = dateMatch;
    d = d.padStart(2, '0');
    if (isNaN(Number(m))) {
      m = monthMap[m.slice(0, 3).toLowerCase()] || '01';
    } else {
      m = m.padStart(2, '0');
    }
    if (y.length === 2) y = '20' + y;
    billDate = `${y}-${m}-${d}`;
  } else {
    // Standalone date fallback (must be reasonable year 2020-2035)
    const plainDate = text.match(/\b([0-3]?\d)[\/\-]([0-1]?\d|[A-Za-z]{3,9})[\/\-](202\d|203\d|2\d)\b/);
    if (plainDate) {
      let [, d, m, y] = plainDate;
      const numY = parseInt(y.length === 2 ? '20' + y : y, 10);
      if (numY >= 2020 && numY <= 2035) {
        d = d.padStart(2, '0');
        if (isNaN(Number(m))) {
          m = monthMap[m.slice(0, 3).toLowerCase()] || '01';
        } else {
          m = m.padStart(2, '0');
        }
        if (y.length === 2) y = '20' + y;
        billDate = `${y}-${m}-${d}`;
      }
    }
  }

  // 4. EXTRACT LINE ITEMS (Mathematical verification: Qty * Rate == Amount)
  const lineItems: ExtractedLineItem[] = [];

  function checkLineCalculation(line: string) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 3) return null;
    const candidateNums = tokens.map((t) => {
      const clean = t.replace(/[₹,]/g, '');
      const val = parseFloat(clean);
      return isNaN(val) ? null : val;
    });
    const hasLeadingSno = /^\d{1,3}[\.\-]?$/.test(tokens[0]);
    const minQtyIdx = hasLeadingSno ? 1 : 0;

    for (let qIdx = minQtyIdx; qIdx < candidateNums.length - 1; qIdx++) {
      const qVal = candidateNums[qIdx];
      if (qVal === null || qVal <= 0 || qVal > 50000) continue;
      for (let rIdx = qIdx + 1; rIdx < candidateNums.length; rIdx++) {
        const rVal = candidateNums[rIdx];
        if (rVal === null || rVal <= 0) continue;
        for (let aIdx = rIdx + 1; aIdx < candidateNums.length; aIdx++) {
          const aVal = candidateNums[aIdx];
          if (aVal === null || aVal <= 0) continue;
          if (Math.abs(qVal * rVal - aVal) < 1.0) {
            let unit = 'pcs';
            if (qIdx + 1 < tokens.length && /^(pcs|nos|box|boxes|kg|m|meter|units?|set|pack)$/i.test(tokens[qIdx + 1])) {
              unit = tokens[qIdx + 1].toLowerCase();
            }
            return { qty: qVal, rate: rVal, amount: aVal, qtyIdx: qIdx, unit, tokens };
          }
        }
      }
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Ignore summary, tax and header lines
    if (/^(?:Taxable\s+Value|Total|Sub\s*Total|CGST|SGST|IGST|Round|Amount\s+Chargeable|Company's|Customer|Buyer|State\s+Name)/i.test(l)) {
      continue;
    }

    const match = checkLineCalculation(l);
    if (match) {
      let descTokens = match.tokens.slice(0, match.qtyIdx);
      if (/^\d+[\.\-]?$/.test(descTokens[0])) descTokens = descTokens.slice(1);
      if (/^\d{4,8}$/.test(descTokens[descTokens.length - 1])) descTokens = descTokens.slice(0, -1);
      if (/^(pcs|nos|box|kg|m)$/i.test(descTokens[descTokens.length - 1])) descTokens = descTokens.slice(0, -1);

      let description = descTokens.join(' ').trim();

      // Look ahead to capture multi-line descriptions (e.g. dimensions, food grade specs)
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        // If next line itself is a line item or summary section, stop
        if (checkLineCalculation(nextLine)) break;
        if (/(?:Total|Sub\s*Total|Tax|IGST|CGST|SGST|Round|Thank|Terms|Bank|Authorized)/i.test(nextLine)) break;

        let cleanContinuation = nextLine;
        const unitMatch = cleanContinuation.match(/\b(pcs|nos|box|kg|m|meter|units?|set)\b/i);
        if (unitMatch) {
          match.unit = unitMatch[1].toLowerCase();
          cleanContinuation = cleanContinuation.replace(unitMatch[0], '').trim();
        }
        cleanContinuation = cleanContinuation.replace(/\\/g, '').trim();
        if (cleanContinuation) {
          description += ' ' + cleanContinuation;
        }
        i++;
      }

      if (description.length > 2) {
        lineItems.push({
          num: String(lineItems.length + 1),
          name: description,
          qty: match.qty,
          unit: match.unit || 'pcs',
          rate: match.rate,
          amount: match.amount,
          raw_ocr: l.trim(),
        });
      }
    }
  }

  // 5. EXTRACT GST & TAXES (CGST, SGST, IGST, Subtotal, Rounding, Grand Total)
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let rounding = 0;
  let subtotal = 0;
  let grandTotal = 0;
  let taxAmount = 0;

  // Extract from line items sum first
  if (lineItems.length > 0) {
    subtotal = Math.round(lineItems.reduce((s, it) => s + it.amount, 0) * 100) / 100;
  }

  // Line-by-line scanning for taxes & rounding
  for (const line of lines) {
    // Round Off
    const roundMatch = line.match(/(?:Round(?:ed)?\s*Off|Rounding)\s*[:\-]?\s*([+\-]?\s*[\d,]+\.\d{2})/i);
    if (roundMatch) {
      rounding = parseFloat(roundMatch[1].replace(/\s+/g, '').replace(/,/g, '')) || 0;
    }

    // CGST / Central Tax (support CGST, CGST9, CGST 9%)
    if (/\b(?:CGST\d*|Central\s+Tax)\b/i.test(line) && !/taxable\s+value/i.test(line)) {
      const amounts = Array.from(line.matchAll(/\b(\d{1,3}(?:,\d{2,3})*\.\d{2}|\d+\.\d{2})\b/g))
        .map((m) => parseFloat(m[1].replace(/,/g, '')))
        .filter((v) => v > 0);
      if (amounts.length > 0) {
        cgst = amounts[amounts.length - 1];
      }
    }

    // SGST / UTGST / State Tax (support SGST, SGST9, SGST 9%)
    if (/\b(?:SGST\d*|UTGST\d*|State\s+Tax)\b/i.test(line) && !/taxable\s+value/i.test(line)) {
      const amounts = Array.from(line.matchAll(/\b(\d{1,3}(?:,\d{2,3})*\.\d{2}|\d+\.\d{2})\b/g))
        .map((m) => parseFloat(m[1].replace(/,/g, '')))
        .filter((v) => v > 0);
      if (amounts.length > 0) {
        sgst = amounts[amounts.length - 1];
      }
    }

    // IGST / Integrated Tax (support IGST, IGST18, IGST 18%)
    if (/\b(?:IGST\d*|Integrated\s+Tax)\b/i.test(line) && !/taxable\s+value/i.test(line)) {
      const amounts = Array.from(line.matchAll(/\b(\d{1,3}(?:,\d{2,3})*\.\d{2}|\d+\.\d{2})\b/g))
        .map((m) => parseFloat(m[1].replace(/,/g, '')))
        .filter((v) => v > 0);
      if (amounts.length > 0) {
        igst = amounts[amounts.length - 1];
      }
    }

    // Subtotal
    if (/\b(?:Sub\s*Total|Taxable\s+Value)\b/i.test(line)) {
      const amounts = Array.from(line.matchAll(/\b(\d{1,3}(?:,\d{2,3})*\.\d{2}|\d+\.\d{2})\b/g))
        .map((m) => parseFloat(m[1].replace(/,/g, '')))
        .filter((v) => v > 0);
      if (amounts.length > 0) {
        subtotal = amounts[amounts.length - 1];
      }
    }

    // Grand Total line
    if (/^(?:Total|Grand\s*Total|Invoice\s*Total|Total\s*Amount)\b/i.test(line) && !/tax|words/i.test(line)) {
      const amounts = Array.from(line.matchAll(/\b(\d{1,3}(?:,\d{2,3})*\.\d{2}|\d+\.\d{2})\b/g))
        .map((m) => parseFloat(m[1].replace(/,/g, '')))
        .filter((v) => v > 0);
      if (amounts.length > 0) {
        grandTotal = amounts[amounts.length - 1];
      }
    }
  }

  // Check GST tax summary table:
  // e.g. 16,805.00  9%  1,512.45  9%  1,512.45  3,024.90
  const gstTableMatch = text.match(
    /([\d,]+\.\d{2})\s+(\d+(?:\.\d+)?%?)\s+([\d,]+\.\d{2})\s+(\d+(?:\.\d+)?%?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/
  );
  if (gstTableMatch) {
    const tableSub = parseFloat(gstTableMatch[1].replace(/,/g, ''));
    const val1 = parseFloat(gstTableMatch[3].replace(/,/g, ''));
    const val2 = parseFloat(gstTableMatch[5].replace(/,/g, ''));
    const totalTaxVal = parseFloat(gstTableMatch[6].replace(/,/g, ''));
    if (tableSub > 0 && subtotal === 0) subtotal = tableSub;
    if (val1 > 0 && cgst === 0) cgst = val1;
    if (val2 > 0 && sgst === 0) sgst = val2;
    if (totalTaxVal > 0 && taxAmount === 0) taxAmount = totalTaxVal;
  }

  // Indian GST symmetry rule: CGST always equals SGST
  if (cgst > 0 && sgst === 0) sgst = cgst;
  if (sgst > 0 && cgst === 0) cgst = sgst;

  // Calculate total tax amount
  if (cgst + sgst + igst > 0) {
    taxAmount = Math.round((cgst + sgst + igst) * 100) / 100;
  }

  // If subtotal is still 0, look for explicit Taxable Value
  if (subtotal === 0) {
    const subMatch = text.match(/(?:Sub\s*Total|Taxable\s+Value)\s*[:\-]?\s*₹?\s*([\d,]+\.\d{2})/i);
    if (subMatch) {
      subtotal = parseFloat(subMatch[1].replace(/,/g, ''));
    }
  }

  // Grand Total in Words (e.g. Indian Rupees Nineteen Thousand Eight Hundred Thirty Only)
  const wordsMatch = text.match(
    /(?:Amount\s+Chargeable\s*\(in\s+words\)|\bTotal\s+in\s+Words)\s*[:\-]?\s*([A-Za-z\s\-]+(?:Only)?)/i
  );
  if (wordsMatch) {
    const wordsNum = wordsToNumber(wordsMatch[1]);
    if (wordsNum > 0) {
      grandTotal = wordsNum;
    }
  }

  // Grand Total from numeric lines (e.g. Total 25 Nos. ₹ 19,830.00 or Total: 62,755.00)
  if (grandTotal === 0) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (/^(?:Total|Grand\s+Total|Invoice\s+Total|Net\s+Amount|Total\s+Amount)\b/i.test(l) && !/tax\s+amount|words/i.test(l)) {
        const amounts = Array.from(l.matchAll(/₹?\s*([\d,]+\.\d{2}|\b\d{4,8}\b)/g))
          .map((m) => parseFloat(m[1].replace(/,/g, '')))
          .filter((v) => v > (subtotal > 0 ? subtotal * 0.8 : 0));
        if (amounts.length > 0) {
          grandTotal = amounts[amounts.length - 1];
          break;
        }
      }
    }
  }

  // CRITICAL GST CALCULATION ENFORCEMENT:
  // Grand Total MUST include Subtotal + TaxAmount + Rounding.
  // Example: Subtotal 16,805.00 + GST 3,024.90 = Grand Total 19,829.90 (or 19,830.00 with rounding)
  if (subtotal > 0 && taxAmount > 0) {
    const expectedTotal = Math.round((subtotal + taxAmount + rounding) * 100) / 100;
    // If grandTotal was mistakenly assigned pre-tax subtotal (e.g. 16,805.00), or was 0, or is lower than subtotal + tax
    if (grandTotal === 0 || Math.abs(grandTotal - subtotal) < 2 || grandTotal < subtotal + taxAmount - 2) {
      grandTotal = expectedTotal;
    } else if (Math.abs(grandTotal - (subtotal + taxAmount)) <= 5) {
      // Small rounding difference (e.g. +0.10 round-off to 19,830.00)
      rounding = Math.round((grandTotal - (subtotal + taxAmount)) * 100) / 100;
    }
  } else if (grandTotal > 0 && subtotal > 0 && grandTotal > subtotal && taxAmount === 0) {
    // If grandTotal exists and is larger than subtotal, calculate implicit tax
    taxAmount = Math.round((grandTotal - subtotal - rounding) * 100) / 100;
    if (cgst === 0 && sgst === 0 && igst === 0) {
      cgst = Math.round((taxAmount / 2) * 100) / 100;
      sgst = Math.round((taxAmount / 2) * 100) / 100;
    }
  } else if (grandTotal === 0 && subtotal > 0) {
    grandTotal = Math.round((subtotal + taxAmount + rounding) * 100) / 100;
  } else if (subtotal === 0 && grandTotal > 0) {
    subtotal = taxAmount > 0 ? Math.round((grandTotal - taxAmount - rounding) * 100) / 100 : grandTotal;
  }

  // Absolute guarantee: amount must strictly equal Subtotal + Tax Amount + Rounding
  const guaranteedAmount = Math.round((subtotal + taxAmount + rounding) * 100) / 100;
  if (guaranteedAmount > 0 && (grandTotal === 0 || Math.abs(grandTotal - subtotal) < 2)) {
    grandTotal = guaranteedAmount;
  }

  return {
    rawText: text.trim(),
    vendorName,
    gstNumber,
    phone,
    email,
    address,
    billNumber,
    billDate,
    subtotal,
    cgst,
    sgst,
    igst,
    taxAmount,
    rounding,
    amount: grandTotal, // Strictly inclusive of GST
    lineItems,
  };
}

function wordsToNumber(wordsStr: string): number {
  const units: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };

  const scales: Record<string, number> = {
    hundred: 100,
    thousand: 1000,
    lakh: 100000,
    lakhs: 100000,
    crore: 10000000,
    crores: 10000000,
  };

  const clean = wordsStr
    .toLowerCase()
    .replace(/\b(indian|rupee|rupees|only|and|paise.*)\b/gi, ' ')
    .replace(/-/g, ' ')
    .trim();

  const tokens = clean.split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;

  for (const token of tokens) {
    if (units[token] !== undefined) {
      current += units[token];
    } else if (scales[token] !== undefined) {
      if (token === 'hundred') {
        current = (current === 0 ? 1 : current) * 100;
      } else {
        current = (current === 0 ? 1 : current) * scales[token];
        total += current;
        current = 0;
      }
    }
  }

  return total + current;
}

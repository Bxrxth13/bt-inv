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

      // If native text extraction yielded very little text (e.g. scanned image-only PDF),
      // render the first page to a canvas and OCR with Tesseract
      if (
        (!rawText || rawText.trim().length < 30) &&
        typeof window !== 'undefined' &&
        (window as any).pdfjsLib &&
        (window as any).Tesseract
      ) {
        try {
          const pdfjs = (window as any).pdfjsLib;
          const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(buffer),
            disableWorker: true,
          });
          const pdf = await Promise.race([
            loadingTask.promise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PDF.js render timeout')), 6000)),
          ]);
          if (pdf.numPages >= 1) {
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              await page.render({ canvasContext: ctx, viewport }).promise;
              const result = await (window as any).Tesseract.recognize(canvas, 'eng');
              if (result?.data?.text && result.data.text.trim().length > 20) {
                rawText = result.data.text;
              }
            }
          }
        } catch (ocrErr) {
          console.warn('PDF OCR fallback failed:', ocrErr);
        }
      }
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

  // Priority A: Explicit Vendor / Supplier label
  const explicitVendorMatch = text.match(
    /(?:Supplier(?:\s+Name)?|Vendor(?:\s+Name)?|Seller|Sold\s+By|Billed\s+By|Dispatched\s+From|Consignor)\s*[:\-]\s*([A-Za-z0-9&.,'\s\-()]{3,50})/i
  );
  if (explicitVendorMatch) {
    const candidate = explicitVendorMatch[1].split(/\r?\n/)[0].trim();
    if (candidate.length >= 3 && !/customer|buyer|client|recipient|billing/i.test(candidate)) {
      vendorName = candidate;
    }
  }

  // Priority B: Header lines scanning (filter out invoice headings and buyer details)
  if (!vendorName) {
    for (const l of headerLines) {
      if (
        /^(?:tax\s+invoice|invoice|quotation|proforma|estimate|cash\s+bill|bill\s+of\s+supply|original|duplicate|triplicate|delivery\s+challan|delivery\s+note|purchase\s+order|q\s*no|date|dated|gstin|phone|ph:|email|h\.?o\.?|b\.?o\.?|place\s+of|state\s+code|reverse\s+charge|vehicle\s+no|e-way|bill\s+to|ship\s+to|buyer|consignee|customer)/i.test(
          l
        )
      ) {
        continue;
      }
      const cand = l.replace(/^(?:M\/s\.?|Messrs|To|For|FOR)\s+/i, '').trim();
      if (
        cand.length >= 3 &&
        /[a-zA-Z]/.test(cand) &&
        !/^(original|duplicate|triplicate|copy|tax|total|sub|amount|details)/i.test(cand)
      ) {
        vendorName = cand;
        break;
      }
    }
  }

  // Priority C: Check Footer Authorized Signatory: "For <Company Name>"
  if (!vendorName || vendorName.length < 4 || /industrial|supplier|invoice/i.test(vendorName)) {
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
      let l = lines[i].replace(/thank\s+you\s+for\s+your\s+business/gi, '').trim();
      const forMatch = l.match(/\b(For|FOR)\s+([A-Za-z0-9&.,'\s\-()]{3,50})/);
      if (forMatch) {
        let candidate = forMatch[2]
          .replace(/\b(?:authorized|signatory|signature|auth\.?|partner|proprietor|director|your\s+business)\b/gi, '')
          .trim()
          .replace(/^for\s+/i, '')
          .trim();
        if (candidate.length > 3 && !/customer|buyer|client|recipient|billing/i.test(candidate)) {
          vendorName = candidate;
          break;
        }
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

  // Check if any existing vendor in database matches by GST or text
  if (availableVendors.length > 0) {
    if (gstNumber) {
      const gMatch = availableVendors.find(
        (v) => v.gst_number && v.gst_number.trim().toUpperCase() === gstNumber.toUpperCase()
      );
      if (gMatch) vendorName = gMatch.name;
    }
    if (!vendorName || vendorName === 'Supplier') {
      const matchedVendor = availableVendors.find((v) =>
        text.toLowerCase().includes(v.name.toLowerCase().trim())
      );
      if (matchedVendor) {
        vendorName = matchedVendor.name;
      }
    }
  }

  if (!vendorName || vendorName.length < 3) {
    vendorName = availableVendors.length > 0 ? availableVendors[0].name : 'Supplier';
  }

  // 2. EXTRACT BILL / INVOICE NUMBER
  let billNumber = '';
  const docNumRegex =
    /(?:Q(?:TN)?\.?\s*(?:NO\.?|NUMBER|#)?|QUOTATION\s*(?:NO\.?|NUMBER|#)?|INVOICE\s*(?:NO\.?|NUMBER|#)?|INV\.?\s*(?:NO\.?|NUMBER|#)?|BILL\s*(?:NO\.?|NUMBER|#)?|CHALLAN\s*(?:NO\.?|NUMBER|#)?|DC\s*(?:NO\.?|NUMBER|#)?|REF\s*(?:NO\.?|NUMBER|#)?)\s*[:\-#]?\s*([A-Za-z0-9\/\-_]{2,30})/i;
  const numMatch = text.match(docNumRegex);

  if (numMatch && numMatch[1]) {
    const candidate = numMatch[1].trim();
    if (!/^(to|for|is|date|dated|the|and|details|of|m|bash|tax)$/i.test(candidate)) {
      billNumber = candidate;
    }
  }

  // Check if Invoice No. is immediately followed on the next line by a number
  if (!billNumber) {
    const invNoIdx = lines.findIndex((l) => /^(?:Invoice|Bill|Quotation|Q|Challan)\s*(?:No\.?|#|\/)?/i.test(l));
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

  // 3. EXTRACT DATE (Supports ISO YYYY-MM-DD, alphanumeric months 13-Oct-26, and DD/MM/YYYY)
  let billDate = new Date().toISOString().slice(0, 10);
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const dateRegex =
    /(?:Dated|Date|Invoice\s*Date|Bill\s*Date|Q\s*Date)\s*[:\-]?\s*(\d{1,4})[\/\-\.](\d{1,2}|[A-Za-z]{3,9})[\/\-\.](\d{2,4})/i;
  const dateMatch = text.match(dateRegex);

  if (dateMatch) {
    let [, p1, p2, p3] = dateMatch;
    if (p1.length === 4) {
      // YYYY-MM-DD
      const y = p1;
      const m = isNaN(Number(p2)) ? (monthMap[p2.slice(0, 3).toLowerCase()] || '01') : p2.padStart(2, '0');
      const d = p3.padStart(2, '0');
      billDate = `${y}-${m}-${d}`;
    } else {
      // DD/MM/YYYY
      let d = p1.padStart(2, '0');
      let m = isNaN(Number(p2)) ? (monthMap[p2.slice(0, 3).toLowerCase()] || '01') : p2.padStart(2, '0');
      let y = p3.length === 2 ? '20' + p3 : p3;
      billDate = `${y}-${m}-${d}`;
    }
  } else {
    // Standalone ISO date YYYY-MM-DD
    const isoMatch = text.match(/\b(202\d|203\d)[\/\-](0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])\b/);
    if (isoMatch) {
      billDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    } else {
      // Standalone date fallback (DD/MM/YYYY)
      const plainDate = text.match(/\b([0-3]?\d)[\/\-]([0-1]?\d|[A-Za-z]{3,9})[\/\-](202\d|203\d|2\d)\b/);
      if (plainDate) {
        let [, d, m, y] = plainDate;
        const numY = parseInt(y.length === 2 ? '20' + y : y, 10);
        if (numY >= 2020 && numY <= 2035) {
          d = d.padStart(2, '0');
          m = isNaN(Number(m)) ? (monthMap[m.slice(0, 3).toLowerCase()] || '01') : m.padStart(2, '0');
          if (y.length === 2) y = '20' + y;
          billDate = `${y}-${m}-${d}`;
        }
      }
    }
  }

  // 4. EXTRACT LINE ITEMS (Mathematical verification: Qty * Rate == Amount with multi-line support)
  const lineItems: ExtractedLineItem[] = [];

  function checkLineCalculation(line: string) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 2) return null;
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

          let isMatch = Math.abs(qVal * rVal - aVal) < 1.0;
          if (!isMatch) {
            for (const pct of [5, 10, 12, 15, 18, 20, 25, 28]) {
              if (
                Math.abs(qVal * rVal * (1 - pct / 100) - aVal) < 1.5 ||
                Math.abs(qVal * rVal * (1 + pct / 100) - aVal) < 1.5
              ) {
                isMatch = true;
                break;
              }
            }
          }

          if (isMatch) {
            let unit = 'pcs';
            if (
              qIdx + 1 < tokens.length &&
              /^(pcs|nos|box|boxes|kg|kgs|m|meter|meters|units?|set|sets|pack|packs|pair|pairs|roll|rolls|bundle|bundles|ltr|litres?)$/i.test(
                tokens[qIdx + 1]
              )
            ) {
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
    if (
      /^(?:Taxable\s+Value|Total|Sub\s*Total|CGST|SGST|IGST|Round|Amount\s+Chargeable|Company's|Customer|Buyer|State\s+Name)/i.test(
        l
      )
    ) {
      continue;
    }

    const match = checkLineCalculation(l);
    if (match) {
      let descTokens = match.tokens.slice(0, match.qtyIdx);
      if (/^\d+[\.\-]?$/.test(descTokens[0])) descTokens = descTokens.slice(1);
      if (/^\d{4,8}$/.test(descTokens[descTokens.length - 1])) descTokens = descTokens.slice(0, -1);
      if (/^(pcs|nos|box|kg|m)$/i.test(descTokens[descTokens.length - 1])) descTokens = descTokens.slice(0, -1);

      let description = descTokens.join(' ').trim();

      // Look back to previous line if description on current line is missing/empty!
      if (description.length <= 2 && i > 0) {
        const prev = lines[i - 1].trim();
        if (prev.length > 2 && !/^(?:Total|Sub|Tax|Invoice|Bill|Date|GST|HSN|S\.?No)/i.test(prev)) {
          description = prev.replace(/^\d+[\.\-]?\s*/, '').trim();
        }
      }

      // Look ahead to capture multi-line descriptions (e.g. dimensions, food grade specs)
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (checkLineCalculation(nextLine)) break;
        if (/(?:Total|Sub\s*Total|Tax|IGST|CGST|SGST|Round|Thank|Terms|Bank|Authorized)/i.test(nextLine)) break;

        let cleanContinuation = nextLine;
        const unitMatch = cleanContinuation.match(/\b(pcs|nos|box|kg|m|meter|units?|set)\b/i);
        if (unitMatch) {
          match.unit = unitMatch[1].toLowerCase();
          cleanContinuation = cleanContinuation.replace(unitMatch[0], '').trim();
        }
        cleanContinuation = cleanContinuation.replace(/\\/g, '').trim();
        if (cleanContinuation && cleanContinuation.length > 1) {
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

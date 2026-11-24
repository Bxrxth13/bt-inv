import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

interface ScanResponse {
  text?: string;
  vendorName?: string;
  billNumber?: string;
  billDate?: string;
  amount?: number;
  lineItems?: { name: string; qty: number; rate: number; amount: number }[];
  confidence?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { billId } = await req.json();
    if (!billId) {
      return new Response(JSON.stringify({ error: 'billId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fetch the bill record + file
    const { data: bill, error: billErr } = await supabase.from('bills').select('*').eq('id', billId).maybeSingle();
    if (billErr || !bill) {
      return new Response(JSON.stringify({ error: 'Bill not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Download file from storage
    const { data: fileData, error: fileErr } = await supabase.storage.from('bills').download(bill.storage_path);
    if (fileErr || !fileData) {
      await supabase.from('bills').update({ status: 'error' }).eq('id', billId);
      return new Response(JSON.stringify({ error: 'Could not download file' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Send to OCR.space API (free, no key required for basic usage)
    // We try the free OCR endpoint. If no API key configured, we still attempt.
    const apiKey = Deno.env.get('OCR_API_KEY') ?? 'helloworld'; // ocr.space free demo key
    const formData = new FormData();
    const fileBuf = await fileData.arrayBuffer();
    const blob = new Blob([fileBuf], { type: bill.file_name.endsWith('.pdf') ? 'application/pdf' : 'image/*' });
    formData.append('file', blob, bill.file_name);
    formData.append('apikey', apiKey);
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');

    let extractedText = '';
    let parsed: ScanResponse = {};

    try {
      const ocrRes = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formData });
      if (ocrRes.ok) {
        const ocrJson = await ocrRes.json();
        extractedText = ocrJson?.ParsedResults?.[0]?.ParsedText ?? '';
      }
    } catch (e) {
      // OCR failed; continue with empty text
      console.error('OCR error:', e);
    }

    if (extractedText) {
      parsed = parseBill(extractedText);
    }

    // Update bill record
    await supabase.from('bills').update({
      status: 'processed',
      extracted_text: extractedText,
      bill_number: parsed.billNumber ?? bill.bill_number,
      bill_date: parsed.billDate ?? bill.bill_date,
      amount: parsed.amount ?? bill.amount,
    }).eq('id', billId);

    // Try to match vendor by name
    let vendorId = bill.vendor_id;
    if (!vendorId && parsed.vendorName) {
      const { data: vmatch } = await supabase.from('vendors').select('id').ilike('name', `%${parsed.vendorName}%`).maybeSingle();
      if (vmatch) {
        vendorId = vmatch.id;
        await supabase.from('bills').update({ vendor_id: vendorId }).eq('id', billId);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      billId,
      extractedText,
      parsed,
      vendorId,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

function parseBill(text: string): ScanResponse {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const result: ScanResponse = { text, lineItems: [] };

  // Vendor name: usually first non-empty meaningful line
  result.vendorName = lines.find((l) => l.length > 2 && !/invoice|bill|tax/i.test(l) && /^[a-zA-Z]/.test(l));

  // Bill number
  const billMatch = text.match(/(?:invoice|bill|inv)\s*(?:no|number|#)?\s*[:\-]?\s*([A-Z0-9\/\-]{3,20})/i);
  if (billMatch) result.billNumber = billMatch[1];

  // Date — look for dd/mm/yyyy or dd-mm-yyyy
  const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dateMatch) {
    let [, d, m, y] = dateMatch;
    if (y.length === 2) y = '20' + y;
    result.billDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Grand total / amount
  const totalMatch = text.match(/(?:grand\s*total|total\s*amount|total|amount\s*payable|net\s*payable)\s*[:\-]?\s*₹?\s*([\d,]+\.\d{2})/i);
  if (totalMatch) {
    result.amount = parseFloat(totalMatch[1].replace(/,/g, ''));
  } else {
    // fallback: last currency-looking number
    const nums = text.match(/₹?\s*([\d,]+\.\d{2})/g);
    if (nums && nums.length) {
      const last = nums[nums.length - 1].replace(/[₹,\s]/g, '');
      result.amount = parseFloat(last);
    }
  }

  result.confidence = result.amount && result.billNumber ? 0.8 : result.amount ? 0.5 : 0.3;
  return result;
}

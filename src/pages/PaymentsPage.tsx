import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Payment, Vendor } from '@/lib/types';
import { Modal } from '@/components/Modal';
import { Button, TextField, TextAreaField, SelectField } from '@/components/Field';
import { Badge, EmptyState, PageHeader, Spinner, toast } from '@/components/ui';
import { Wallet, Plus, Check, Trash2, AlertTriangle } from 'lucide-react';

export function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'paid'>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    const [p, v] = await Promise.all([
      supabase.from('payments').select('*, vendor:vendor_id(name)').order('due_date', { ascending: true }),
      supabase.from('vendors').select('*').order('name'),
    ]);
    setPayments((p.data as Payment[] | null) ?? []);
    setVendors((v.data as Vendor[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date(new Date().toDateString());
  const isOverdue = (p: Payment) => !p.paid && new Date(p.due_date) < today;

  const filtered = payments.filter((p) => {
    if (filter === 'pending') return !p.paid;
    if (filter === 'overdue') return isOverdue(p);
    if (filter === 'paid') return p.paid;
    return true;
  }).sort((a, b) => {
    const ao = isOverdue(a) ? 0 : 1;
    const bo = isOverdue(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  const totalPending = payments.filter((p) => !p.paid).reduce((s, p) => s + Number(p.amount), 0);
  const totalOverdue = payments.filter((p) => isOverdue(p)).reduce((s, p) => s + Number(p.amount), 0);

  const markPaid = async (p: Payment) => {
    await supabase.from('payments').update({ paid: true, paid_date: new Date().toISOString().slice(0, 10) }).eq('id', p.id);
    toast.success('Payment marked as paid');
    load();
  };

  const deletePayment = async (id: string) => {
    try {
      await supabase.from('payments').delete().eq('id', id);
      toast.success('Payment reminder deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete payment reminder: ' + (err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Payment Reminders"
        subtitle={`₹${totalPending.toLocaleString('en-IN')} pending · ₹${totalOverdue.toLocaleString('en-IN')} overdue`}
        action={<Button onClick={() => setShowForm(true)}><Plus size={16} /> Add Reminder</Button>}
      />

      <div className="mb-4 flex gap-2">
        {(['pending', 'overdue', 'paid', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-emerald-600/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'border border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:text-zinc-100'}`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Wallet size={36} />} title="No payments here" subtitle="Add a payment reminder to track dues to vendors" />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const overdue = isOverdue(p);
            return (
              <div key={p.id} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${p.paid ? 'border-zinc-800 bg-zinc-900/20 opacity-60' : overdue ? 'border-red-500/30 bg-red-500/[0.04]' : 'border-zinc-800 bg-zinc-900/40'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-100">{p.vendor?.name ?? 'Vendor'}</span>
                    {p.bill_number && <Badge color="zinc">{p.bill_number}</Badge>}
                    {p.paid ? <Badge color="emerald"><Check size={11} /> Paid</Badge> : overdue ? <Badge color="red"><AlertTriangle size={11} /> Overdue</Badge> : <Badge color="amber">Pending</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    Due {new Date(p.due_date).toLocaleDateString('en-IN')}{p.paid_date ? ` · Paid ${new Date(p.paid_date).toLocaleDateString('en-IN')}` : ''}
                    {p.notes ? ` · ${p.notes}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-semibold text-zinc-100">₹{Number(p.amount).toLocaleString('en-IN')}</span>
                  {!p.paid && <button onClick={() => markPaid(p)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-emerald-400" title="Mark paid"><Check size={16} /></button>}
                  <button onClick={() => deletePayment(p.id)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400 transition-colors" title="Delete reminder"><Trash2 size={15} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <PaymentForm
          vendors={vendors}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); toast.success('Payment reminder added'); load(); }}
        />
      )}
    </div>
  );
}

function PaymentForm({ vendors, onClose, onSaved }: { vendors: Vendor[]; onClose: () => void; onSaved: () => void }) {
  const [vendorId, setVendorId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [billNumber, setBillNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorId) { setError('Select a vendor'); return; }
    setSaving(true);
    setError('');
    const res = await supabase.from('payments').insert({
      vendor_id: vendorId,
      amount: Number(amount),
      due_date: dueDate,
      bill_number: billNumber || null,
      notes: notes || null,
    });
    if (res.error) setError(res.error.message);
    else onSaved();
    setSaving(false);
  };

  return (
    <Modal open title="Add Payment Reminder" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <SelectField label="Vendor *" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
          <option value="">Select vendor...</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </SelectField>
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Amount (₹) *" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <TextField label="Due Date *" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </div>
        <TextField label="Bill Number" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
        <TextAreaField label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center justify-between pt-2">
          {(vendorId || amount || billNumber || notes) ? (
            <button
              type="button"
              onClick={() => {
                setVendorId('');
                setAmount('');
                setBillNumber('');
                setNotes('');
              }}
              className="text-xs text-zinc-500 hover:text-red-400 flex items-center gap-1 transition-colors"
              title="Clear all fields"
            >
              <Trash2 size={13} /> Clear form
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Reminder'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

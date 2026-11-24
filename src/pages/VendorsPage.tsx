import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Item, Vendor, VendorItem } from '@/lib/types';
import { Modal } from '@/components/Modal';
import { Button, TextField, TextAreaField, SelectField } from '@/components/Field';
import { EmptyState, PageHeader, Spinner, toast } from '@/components/ui';
import { Truck, Plus, Pencil, Search, Trash2, Package, Phone, Mail, X } from 'lucide-react';

export function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [vendorItems, setVendorItems] = useState<VendorItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [v, i] = await Promise.all([
      supabase.from('vendors').select('*').order('name'),
      supabase.from('items').select('*').order('name'),
    ]);
    setVendors((v.data as Vendor[] | null) ?? []);
    setItems((i.data as Item[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = vendors.filter((v) =>
    !search ||
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.contact_person ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (v.phone ?? '').includes(search)
  );

  const openVendor = async (v: Vendor) => {
    setSelectedVendor(v);
    const { data } = await supabase.from('vendor_items').select('*, item:item_id(*)').eq('vendor_id', v.id);
    setVendorItems((data as VendorItem[] | null) ?? []);
  };

  const deleteVendor = async (id: string) => {
    try {
      await supabase.from('vendors').delete().eq('id', id);
      if (selectedVendor?.id === id) setSelectedVendor(null);
      toast.success('Vendor deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete vendor: ' + (err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle="Manage suppliers and the materials you purchase from them"
        action={<Button onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={16} /> Add Vendor</Button>}
      />

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vendors..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
            title="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Truck size={36} />} title="No vendors yet" subtitle="Add your first supplier to start tracking purchases" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((v) => (
            <div key={v.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-zinc-100">{v.name}</h3>
                  {v.contact_person && <p className="text-xs text-zinc-500">{v.contact_person}</p>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditing(v); setShowForm(true); }} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-emerald-400" title="Edit"><Pencil size={14} /></button>
                  <button onClick={() => deleteVendor(v.id)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs text-zinc-400">
                {v.phone && <div className="flex items-center gap-1.5"><Phone size={12} /> {v.phone}</div>}
                {v.email && <div className="flex items-center gap-1.5 truncate"><Mail size={12} /> {v.email}</div>}
                {v.gst_number && <div className="text-zinc-500">GST: {v.gst_number}</div>}
              </div>
              <button onClick={() => openVendor(v)} className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-800/40 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-emerald-600/40 hover:text-emerald-400">
                <Package size={12} className="mr-1 inline" /> View Materials
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <VendorForm
          vendor={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); toast.success(editing ? 'Vendor updated' : 'Vendor added'); load(); }}
          onDelete={(id) => deleteVendor(id)}
        />
      )}

      {selectedVendor && (
        <VendorMaterialsModal
          vendor={selectedVendor}
          items={items}
          vendorItems={vendorItems}
          onClose={() => setSelectedVendor(null)}
          onChanged={() => openVendor(selectedVendor)}
        />
      )}
    </div>
  );
}

function VendorForm({
  vendor,
  onClose,
  onSaved,
  onDelete,
}: {
  vendor: Vendor | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(vendor?.name ?? '');
  const [contact, setContact] = useState(vendor?.contact_person ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [address, setAddress] = useState(vendor?.address ?? '');
  const [gst, setGst] = useState(vendor?.gst_number ?? '');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      name,
      contact_person: contact || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      gst_number: gst || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    };
    const res = vendor
      ? await supabase.from('vendors').update(payload).eq('id', vendor.id)
      : await supabase.from('vendors').insert(payload);
    if (res.error) setError(res.error.message);
    else onSaved();
    setSaving(false);
  };

  return (
    <Modal open title={vendor ? 'Edit Vendor' : 'Add Vendor'} onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Name *" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Contact Person" value={contact} onChange={(e) => setContact(e.target.value)} />
          <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="GST Number" value={gst} onChange={(e) => setGst(e.target.value)} />
        </div>
        <TextAreaField label="Address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        <TextAreaField label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center justify-between pt-2">
          {vendor ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                onClose();
                onDelete(vendor.id);
              }}
              title="Delete this vendor"
            >
              <Trash2 size={15} /> Delete Vendor
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : vendor ? 'Save Changes' : 'Add Vendor'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function VendorMaterialsModal({ vendor, items, vendorItems, onClose, onChanged }: { vendor: Vendor; items: Item[]; vendorItems: VendorItem[]; onClose: () => void; onChanged: () => void }) {
  const [addItemId, setAddItemId] = useState('');
  const [rate, setRate] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!addItemId) return;
    setSaving(true);
    await supabase.from('vendor_items').upsert({ vendor_id: vendor.id, item_id: addItemId, last_rate: rate ? Number(rate) : null }, { onConflict: 'vendor_id,item_id' });
    setAddItemId(''); setRate('');
    setSaving(false);
    toast.success('Material linked to vendor');
    onChanged();
  };

  const remove = async (id: string) => {
    await supabase.from('vendor_items').delete().eq('id', id);
    toast.success('Material unlinked');
    onChanged();
  };

  return (
    <Modal open title={`Materials from ${vendor.name}`} onClose={onClose} size="lg">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <SelectField label="Add material" value={addItemId} onChange={(e) => setAddItemId(e.target.value)} className="flex-1">
          <option value="">Select item...</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
        </SelectField>
        <TextField label="Last rate" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" className="sm:w-32" />
        <Button onClick={add} disabled={saving || !addItemId} variant="secondary"><Plus size={16} /> Add</Button>
      </div>

      {vendorItems.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No materials linked to this vendor yet</p>
      ) : (
        <div className="space-y-2">
          {vendorItems.map((vi) => (
            <div key={vi.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
              <div>
                <div className="text-sm text-zinc-200">{vi.item?.name}</div>
                <div className="text-xs text-zinc-500">{vi.item?.unit}</div>
              </div>
              <div className="flex items-center gap-3">
                {vi.last_rate && <span className="text-sm text-zinc-300">₹{Number(vi.last_rate).toFixed(2)}</span>}
                <button onClick={() => remove(vi.id)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400" title="Delete linked material"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

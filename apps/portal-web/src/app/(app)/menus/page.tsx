'use client';

import { useCallback, useEffect, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { PageSpinner, ErrorBanner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Meal = 'MORNING_TEA' | 'LUNCH' | 'AFTERNOON_TEA' | 'LATE_SNACK';
interface Item { id: string; date: string; meal: Meal; description: string; allergenNotes: string | null }

const MEALS: { key: Meal; label: string }[] = [
  { key: 'MORNING_TEA', label: 'Morning tea' },
  { key: 'LUNCH', label: 'Lunch' },
  { key: 'AFTERNOON_TEA', label: 'Afternoon tea' },
  { key: 'LATE_SNACK', label: 'Late snack' },
];
const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** One meal slot. Saved on its own so a half-planned week is fine. */
function Slot({ date, meal, label, item, canEdit, onChanged, onError }: { date: string; meal: Meal; label: string; item?: Item; canEdit: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const [description, setDescription] = useState(item?.description ?? '');
  const [allergens, setAllergens] = useState(item?.allergenNotes ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDescription(item?.description ?? ''); setAllergens(item?.allergenNotes ?? ''); }, [item?.id, item?.description, item?.allergenNotes]);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return item ? (
      <p className="text-sm text-foreground"><span className="text-muted">{label}: </span>{item.description}{item.allergenNotes ? <span className="text-muted"> · Allergens: {item.allergenNotes}</span> : null}</p>
    ) : null;
  }
  return (
    <div className="grid items-end gap-2 sm:grid-cols-[110px_1fr_1fr_auto]">
      <span className="text-sm text-muted">{label}</span>
      <Input aria-label={`${label} on ${date}`} placeholder="Meal" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      <Input aria-label={`${label} allergens on ${date}`} placeholder="Allergens (optional)" value={allergens} onChange={(e) => setAllergens(e.target.value)} maxLength={500} />
      <div className="flex gap-1">
        <Button size="sm" disabled={busy || !description.trim()} onClick={() => run(() => api.put(`/menus/${date}/${meal}`, { description, allergenNotes: allergens || undefined }), 'Could not save')}>Save</Button>
        {item && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.delete(`/menus/${date}/${meal}`), 'Could not clear')}>Clear</Button>}
      </div>
    </div>
  );
}

/** Weekly menu. Administrators plan it; families read it in the app, with allergen notes beside each meal. */
export default function MenusPage() {
  const { user } = useAuth();
  const canEdit = !!user && ADMIN_ROLES.includes(user.role);
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });

  const load = useCallback(() => {
    setError(null);
    api
      .get<Item[]>(`/menus?from=${iso(days[0])}&to=${iso(days[6])}`)
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the menu'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday]);
  useEffect(() => { setItems(null); load(); }, [load]);

  function shift(weeks: number) {
    const d = new Date(monday);
    d.setDate(d.getDate() + weeks * 7);
    setMonday(d);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground"><UtensilsCrossed size={22} className="mr-2 inline" />Menu</h1>
          <p className="text-sm text-muted">Week of {days[0].toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => shift(-1)}>Previous week</Button>
          <Button variant="secondary" onClick={() => setMonday(mondayOf(new Date()))}>This week</Button>
          <Button variant="secondary" onClick={() => shift(1)}>Next week</Button>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {!items ? (
        <PageSpinner />
      ) : (
        days.map((d) => {
          const date = iso(d);
          const dayItems = items.filter((i) => i.date === date);
          if (!canEdit && dayItems.length === 0) return null;
          return (
            <Card key={date}>
              <CardHeader><CardTitle>{d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {MEALS.map((m) => (
                  <Slot key={`${date}-${m.key}-${dayItems.find((i) => i.meal === m.key)?.id ?? 'none'}`} date={date} meal={m.key} label={m.label} item={dayItems.find((i) => i.meal === m.key)} canEdit={canEdit} onChanged={load} onError={setError} />
                ))}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
